// ============================================================
// HEXORA SEARCH ENGINE
// Common Crawl -> R2 (hexora) -> Neon PostgreSQL
// NO SUPABASE WRITES
// ============================================================

import pg from "pg";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { putHtml, makeR2Key } from "./storage.mjs";
import * as cheerio from "cheerio";

const { Pool } = pg;

// ============================================================
// CONFIG
// ============================================================

const DATABASE_URL = process.env.DATABASE_URL || "";

if (!DATABASE_URL) {
  throw new Error("[HEXORA] DATABASE_URL is missing");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: Number(process.env.CC_DB_POOL_SIZE || 3),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
  ssl: DATABASE_URL.includes("sslmode=require")
    ? { rejectUnauthorized: false }
    : undefined,
});

const CC_COLLECTION =
  process.env.COMMONCRAWL_COLLECTION || "";

const TARGET_DOMAINS = (
  process.env.COMMONCRAWL_TARGET_DOMAINS ||
  [
    "wikipedia.org",
    "mozilla.org",
    "python.org",
    "nodejs.org",
    "w3.org",
    "ietf.org",
    "apache.org",
    "ubuntu.com",
    "debian.org",
    "gnu.org",
    "linux.org",
    "stackoverflow.com",
    "npmjs.com",
    "cloudflare.com",
    "india.gov.in",
    "assam.gov.in",
  ].join(",")
)
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

const PAGES_PER_DOMAIN = Number(
  process.env.COMMONCRAWL_PAGES_PER_DOMAIN || 20
);

const MAX_PAGES = Number(
  process.env.COMMONCRAWL_MAX_PAGES || 200
);

const REQUEST_TIMEOUT = Number(
  process.env.COMMONCRAWL_TIMEOUT_MS || 30000
);

const MAX_HTML_SIZE = Number(
  process.env.COMMONCRAWL_MAX_HTML_BYTES || 5000000
);

const USER_AGENT =
  process.env.HEXORA_USER_AGENT ||
  "HEXORA-Bot/1.0 (+https://hexorasearch.com/)";

// ============================================================
// HELPERS
// ============================================================

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("hex");
}

function timeoutSignal(ms) {
  return AbortSignal.timeout(ms);
}

function cleanText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/\u0000/g, "")
    .trim();
}

function getDomain(url) {
  try {
    return new URL(url).hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return "";
  }
}

function detectLanguage($, text) {
  const htmlLang = cleanText(
    $("html").attr("lang") || ""
  ).toLowerCase();

  if (htmlLang) {
    return htmlLang.slice(0, 20);
  }

  if (/[\u0B80-\u0BFF]/.test(text)) return "ta";
  if (/[\u0980-\u09FF]/.test(text)) return "bn";
  if (/[\u0C00-\u0C7F]/.test(text)) return "te";
  if (/[\u0C80-\u0CFF]/.test(text)) return "kn";
  if (/[\u0D00-\u0D7F]/.test(text)) return "ml";
  if (/[\u0A80-\u0AFF]/.test(text)) return "gu";
  if (/[\u0900-\u097F]/.test(text)) return "hi";
  if (/[\u0A00-\u0A7F]/.test(text)) return "pa";
  if (/[\u0600-\u06FF]/.test(text)) return "ar";
  if (/[\u4E00-\u9FFF]/.test(text)) return "zh";
  if (/[\u3040-\u30FF]/.test(text)) return "ja";
  if (/[\uAC00-\uD7AF]/.test(text)) return "ko";

  return "unknown";
}

// ============================================================
// COMMON CRAWL COLLECTION
// ============================================================

async function getCollection() {
  if (CC_COLLECTION) {
    return CC_COLLECTION;
  }

  console.log(
    "[HEXORA] Discovering latest Common Crawl collection..."
  );

  const response = await fetch(
    "https://index.commoncrawl.org/collinfo.json",
    {
      headers: {
        "User-Agent": USER_AGENT,
      },
      signal: timeoutSignal(REQUEST_TIMEOUT),
    }
  );

  if (!response.ok) {
    throw new Error(
      `Common Crawl collection discovery failed: HTTP ${response.status}`
    );
  }

  const collections = await response.json();

  if (!Array.isArray(collections) || !collections.length) {
    throw new Error(
      "Common Crawl returned no collections"
    );
  }

  const latest =
    collections.find((x) => x.id) || collections[0];

  if (!latest?.id) {
    throw new Error(
      "Could not determine Common Crawl collection"
    );
  }

  console.log(
    `[HEXORA] Using Common Crawl collection: ${latest.id}`
  );

  return latest.id;
}

// ============================================================
// COMMON CRAWL INDEX
// ============================================================

async function getIndexRecords(collection, domain) {
  const indexUrl =
    `https://index.commoncrawl.org/${collection}-index`;

  const params = new URLSearchParams();

  params.set(
    "url",
    `*.${domain}/*`
  );

  params.set("output", "json");
  params.set("filter", "status:200");
  params.append("filter", "mime:text/html");
  params.set("collapse", "urlkey");
  params.set(
    "pageSize",
    String(PAGES_PER_DOMAIN)
  );

  const fullUrl =
    `${indexUrl}?${params.toString()}`;

  console.log(
    `[HEXORA] Index query: ${domain}`
  );

  const response = await fetch(fullUrl, {
    headers: {
      "User-Agent": USER_AGENT,
    },
    signal: timeoutSignal(REQUEST_TIMEOUT),
  });

  if (!response.ok) {
    console.log(
      `[HEXORA] Index query failed for ${domain}: HTTP ${response.status}`
    );

    return [];
  }

  const body = await response.text();

  if (!body.trim()) {
    return [];
  }

  const records = [];

  for (const line of body.split("\n")) {
    const trimmed = line.trim();

    if (!trimmed) continue;

    try {
      const record = JSON.parse(trimmed);

      if (
        record.url &&
        record.filename &&
        Number.isFinite(Number(record.offset)) &&
        Number.isFinite(Number(record.length))
      ) {
        records.push(record);
      }
    } catch {
      // Ignore malformed index lines.
    }
  }

  console.log(
    `[HEXORA] ${domain}: ${records.length} Common Crawl records`
  );

  return records;
}

// ============================================================
// WARC DOWNLOAD
// ============================================================

async function downloadWarcRecord(record) {
  const offset = Number(record.offset);
  const length = Number(record.length);

  if (
    !Number.isFinite(offset) ||
    !Number.isFinite(length) ||
    length <= 0
  ) {
    return null;
  }

  if (length > MAX_HTML_SIZE * 3) {
    console.log(
      `[HEXORA] Skipping oversized WARC record: ${record.url}`
    );

    return null;
  }

  const end = offset + length - 1;

  const warcUrl =
    `https://data.commoncrawl.org/${record.filename}`;

  const response = await fetch(warcUrl, {
    headers: {
      Range: `bytes=${offset}-${end}`,
      "User-Agent": USER_AGENT,
    },
    signal: timeoutSignal(REQUEST_TIMEOUT),
  });

  if (!response.ok && response.status !== 206) {
    console.log(
      `[HEXORA] WARC download failed: HTTP ${response.status}`
    );

    return null;
  }

  const arrayBuffer = await response.arrayBuffer();

  let buffer = Buffer.from(arrayBuffer);

  // Common Crawl WARC records are generally gzip compressed.
  try {
    buffer = zlib.gunzipSync(buffer);
  } catch {
    // Some responses may already be decompressed.
  }

  return buffer;
}

// ============================================================
// EXTRACT HTML FROM WARC
// ============================================================

function extractHtmlFromWarc(buffer) {
  if (!buffer || !buffer.length) {
    return "";
  }

  const text = buffer.toString("utf8");

  let payload = text;

  // WARC header
  const warcSeparator = text.indexOf("\r\n\r\n");

  if (warcSeparator !== -1) {
    payload = text.slice(warcSeparator + 4);
  }

  // HTTP response header
  const httpSeparator = payload.indexOf("\r\n\r\n");

  if (httpSeparator !== -1) {
    const possibleHttpHeader =
      payload.slice(0, httpSeparator);

    if (
      /^HTTP\/\d/i.test(
        possibleHttpHeader.trim()
      )
    ) {
      payload = payload.slice(
        httpSeparator + 4
      );
    }
  }

  // Find actual HTML start if there is extra response data.
  const lower = payload.toLowerCase();

  const htmlIndex = lower.indexOf("<html");
  const doctypeIndex = lower.indexOf("<!doctype");
  const headIndex = lower.indexOf("<head");

  const candidates = [
    htmlIndex,
    doctypeIndex,
    headIndex,
  ].filter((x) => x >= 0);

  if (candidates.length) {
    const start = Math.min(...candidates);

    payload = payload.slice(start);
  }

  return payload.trim();
}

// ============================================================
// PARSE HTML
// ============================================================

function parseHtml(url, html) {
  if (!html) {
    return null;
  }

  if (Buffer.byteLength(html, "utf8") > MAX_HTML_SIZE) {
    html = Buffer.from(
      html,
      "utf8"
    )
      .subarray(0, MAX_HTML_SIZE)
      .toString("utf8");
  }

  const $ = cheerio.load(html);

  $("script, style, noscript, template, svg").remove();

  const title = cleanText(
    $("title").first().text()
  );

  const description = cleanText(
    $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      ""
  );

  const canonical =
    $('link[rel="canonical"]').attr("href") ||
    "";

  let canonicalUrl = url;

  try {
    canonicalUrl = new URL(
      canonical,
      url
    ).href;
  } catch {
    canonicalUrl = url;
  }

  const text = cleanText(
    $("body").text()
  );

  const excerpt = cleanText(
    description ||
      text.slice(0, 1200)
  );

  const language =
    detectLanguage($, text);

  const wordCount =
    text
      .split(/\s+/)
      .filter(Boolean)
      .length;

  const domain = getDomain(
    canonicalUrl || url
  );

  return {
    url,
    canonicalUrl,
    title:
      title ||
      domain ||
      url,
    description:
      description.slice(0, 5000),
    excerpt:
      excerpt.slice(0, 5000),
    content:
      text.slice(0, 100000),
    language,
    domain,
    wordCount,
  };
}

// ============================================================
// NEON DUPLICATE CHECK
// ============================================================

async function getExistingPage(client, url) {
  const result = await client.query(
    `
      SELECT
        id,
        url,
        content_hash,
        r2_key
      FROM pages
      WHERE url = $1
      LIMIT 1
    `,
    [url]
  );

  return result.rows[0] || null;
}

// ============================================================
// SAVE PAGE
// ============================================================

async function savePage(client, page, html) {
  const contentHash = sha256(html);

  const existing =
    await getExistingPage(
      client,
      page.url
    );

  if (
    existing &&
    existing.content_hash === contentHash
  ) {
    console.log(
      `[HEXORA] Duplicate unchanged: ${page.url}`
    );

    return {
      status: "duplicate",
      id: existing.id,
    };
  }

  const r2Key = makeR2Key(
    page.url,
    contentHash
  );

  // ----------------------------------------------------------
  // R2 full HTML
  // ----------------------------------------------------------

  const r2Result = await putHtml({
    url: page.url,
    html,
    contentHash,
    metadata: {
      source: "common-crawl",
      source_url: page.url,
      collection:
        CC_COLLECTION || "latest",
    },
  });

  // ----------------------------------------------------------
  // Neon metadata + searchable content
  // ----------------------------------------------------------

  if (existing) {
    const result = await client.query(
      `
        UPDATE pages
        SET
          canonical_url = $2,
          title = $3,
          description = $4,
          excerpt = $5,
          content = $6,
          domain = $7,
          language = $8,
          content_hash = $9,
          word_count = $10,
          status_code = 200,
          crawl_status = 'done',
          r2_key = $11,
          r2_etag = $12,
          updated_at = NOW()
        WHERE id = $1
        RETURNING id
      `,
      [
        existing.id,
        page.canonicalUrl,
        page.title,
        page.description,
        page.excerpt,
        page.content,
        page.domain,
        page.language,
        contentHash,
        page.wordCount,
        r2Result.key || r2Key,
        r2Result.etag || null,
      ]
    );

    return {
      status: "updated",
      id: result.rows[0]?.id,
    };
  }

  const result = await client.query(
    `
      INSERT INTO pages (
        url,
        canonical_url,
        title,
        description,
        excerpt,
        content,
        domain,
        language,
        content_hash,
        word_count,
        status_code,
        crawl_status,
        r2_key,
        r2_etag
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        200,
        'done',
        $11,
        $12
      )
      ON CONFLICT (url)
      DO UPDATE SET
        canonical_url = EXCLUDED.canonical_url,
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        excerpt = EXCLUDED.excerpt,
        content = EXCLUDED.content,
        domain = EXCLUDED.domain,
        language = EXCLUDED.language,
        content_hash = EXCLUDED.content_hash,
        word_count = EXCLUDED.word_count,
        status_code = EXCLUDED.status_code,
        crawl_status = EXCLUDED.crawl_status,
        r2_key = EXCLUDED.r2_key,
        r2_etag = EXCLUDED.r2_etag,
        updated_at = NOW()
      RETURNING id
    `,
    [
      page.url,
      page.canonicalUrl,
      page.title,
      page.description,
      page.excerpt,
      page.content,
      page.domain,
      page.language,
      contentHash,
      page.wordCount,
      r2Result.key || r2Key,
      r2Result.etag || null,
    ]
  );

  return {
    status: "inserted",
    id: result.rows[0]?.id,
  };
}

// ============================================================
// DISCOVER LINKS
// ============================================================

async function discoverLinks(
  client,
  baseUrl,
  html
) {
  const $ = cheerio.load(html);

  const links = new Set();

  $("a[href]").each((_, element) => {
    const href =
      $(element).attr("href") || "";

    if (
      !href ||
      href.startsWith("#") ||
      href.startsWith("javascript:") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:")
    ) {
      return;
    }

    try {
      const absolute =
        new URL(href, baseUrl);

      if (
        absolute.protocol !== "http:" &&
        absolute.protocol !== "https:"
      ) {
        return;
      }

      absolute.hash = "";

      const normalized =
        absolute.href;

      if (
        normalized.length <= 2000
      ) {
        links.add(normalized);
      }
    } catch {
      // Ignore invalid URLs.
    }
  });

  let inserted = 0;

  for (const url of links) {
    try {
      const result = await client.query(
        `
          INSERT INTO crawl_queue (
            url
          )
          VALUES ($1)
          ON CONFLICT (url)
          DO NOTHING
        `,
        [url]
      );

      inserted +=
        result.rowCount || 0;
    } catch {
      // Queue schema can differ between deployments.
      // Page saving remains successful.
    }
  }

  return inserted;
}

// ============================================================
// PROCESS ONE COMMON CRAWL RECORD
// ============================================================

async function processRecord(
  client,
  record,
  collection
) {
  const url = record.url;

  console.log(
    `[HEXORA] Processing: ${url}`
  );

  // Check Neon BEFORE downloading/uploading
  const existing =
    await getExistingPage(
      client,
      url
    );

  const buffer =
    await downloadWarcRecord(
      record
    );

  if (!buffer) {
    return "download_failed";
  }

  const html =
    extractHtmlFromWarc(
      buffer
    );

  if (
    !html ||
    html.length < 100
  ) {
    return "no_html";
  }

  const page =
    parseHtml(
      url,
      html
    );

  if (!page) {
    return "parse_failed";
  }

  const contentHash =
    sha256(html);

  if (
    existing &&
    existing.content_hash === contentHash
  ) {
    console.log(
      `[HEXORA] Already indexed: ${url}`
    );

    return "duplicate";
  }

  const result =
    await savePage(
      client,
      page,
      html
    );

  console.log(
    `[HEXORA] ${result.status}: ${url}`
  );

  // Discover future crawler URLs
  const discovered =
    await discoverLinks(
      client,
      url,
      html
    );

  if (discovered > 0) {
    console.log(
      `[HEXORA] Discovered ${discovered} new URLs from ${url}`
    );
  }

  return result.status;
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log("");
  console.log(
    "============================================================"
  );
  console.log(
    " HEXORA COMMON CRAWL IMPORTER"
  );
  console.log(
    " Common Crawl -> R2 (hexora) -> Neon"
  );
  console.log(
    " Supabase writes: DISABLED"
  );
  console.log(
    "============================================================"
  );
  console.log("");

  console.log(
    `[HEXORA] Target domains: ${TARGET_DOMAINS.join(", ")}`
  );

  console.log(
    `[HEXORA] Max pages this run: ${MAX_PAGES}`
  );

  console.log(
    `[HEXORA] Pages per domain: ${PAGES_PER_DOMAIN}`
  );

  const dbClient =
    await pool.connect();

  try {
    await dbClient.query(
      "SELECT 1"
    );

    console.log(
      "[HEXORA] Neon connected"
    );

    const collection =
      await getCollection();

    let imported = 0;
    let updated = 0;
    let duplicate = 0;
    let failed = 0;

    for (
      const domain of TARGET_DOMAINS
    ) {
      if (
        imported +
          updated >=
        MAX_PAGES
      ) {
        break;
      }

      const records =
        await getIndexRecords(
          collection,
          domain
        );

      for (
        const record of records
      ) {
        if (
          imported +
            updated >=
          MAX_PAGES
        ) {
          break;
        }

        try {
          const result =
            await processRecord(
              dbClient,
              record,
              collection
            );

          if (result === "inserted") {
            imported++;
          } else if (
            result === "updated"
          ) {
            updated++;
          } else if (
            result === "duplicate"
          ) {
            duplicate++;
          } else {
            failed++;
          }
        } catch (error) {
          failed++;

          console.error(
            `[HEXORA] Import failed: ${record.url}`
          );

          console.error(
            error?.message ||
              error
          );
        }
      }
    }

    console.log("");
    console.log(
      "============================================================"
    );
    console.log(
      "[HEXORA] Common Crawl import complete"
    );
    console.log(
      `[HEXORA] New pages: ${imported}`
    );
    console.log(
      `[HEXORA] Updated pages: ${updated}`
    );
    console.log(
      `[HEXORA] Duplicates: ${duplicate}`
    );
    console.log(
      `[HEXORA] Failed/skipped: ${failed}`
    );
    console.log(
      "============================================================"
    );
    console.log("");
  } finally {
    dbClient.release();

    await pool.end();
  }
}

// ============================================================
// RUN
// ============================================================

main().catch((error) => {
  console.error(
    "[HEXORA] Common Crawl importer crashed"
  );

  console.error(
    error?.stack ||
      error?.message ||
      error
  );

  process.exit(1);
});
