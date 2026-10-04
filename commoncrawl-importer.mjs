// ============================================================
// HEXORA SEARCH ENGINE
// COMMON CRAWL -> NEON + CLOUDFLARE R2 IMPORTER
// ============================================================

import crypto from "crypto";
import zlib from "zlib";
import { promisify } from "util";
import pg from "pg";
import * as cheerio from "cheerio";
import { putHtml, makeR2Key } from "./storage.mjs";

const { Pool } = pg;
const gunzip = promisify(zlib.gunzip);

// ============================================================
// CONFIG
// ============================================================

const DATABASE_URL = process.env.DATABASE_URL || "";

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL missing");
}

const PORT = Number(process.env.PORT || 8080);

const COLLECTION =
  process.env.COMMONCRAWL_COLLECTION || "CC-MAIN-2026-38";

const TARGET_DOMAINS =
  process.env.COMMONCRAWL_TARGET_DOMAINS ||
  "wikipedia.org,github.com,mozilla.org,python.org,nodejs.org,apache.org,bbc.com,reuters.com,ndtv.com,thehindu.com,indianexpress.com";

const PAGES_PER_DOMAIN = Number(
  process.env.COMMONCRAWL_PAGES_PER_DOMAIN || 20
);

const MAX_PAGES = Number(
  process.env.COMMONCRAWL_MAX_PAGES || 200
);

const TIMEOUT_MS = Number(
  process.env.COMMONCRAWL_TIMEOUT_MS || 30000
);

const MAX_HTML_SIZE = Number(
  process.env.COMMONCRAWL_MAX_HTML_SIZE || 5000000
);

const MAX_CONTENT = Number(
  process.env.COMMONCRAWL_MAX_CONTENT || 100000
);

const MAX_LINKS = Number(
  process.env.COMMONCRAWL_MAX_LINKS || 100
);

const USER_AGENT =
  process.env.HEXORA_USER_AGENT ||
  "HEXORA-Bot/1.0 (+https://hexorasearch.com/)";

// ============================================================
// NEON
// ============================================================

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
  ssl: DATABASE_URL.includes("neon.tech")
    ? { rejectUnauthorized: false }
    : undefined,
});

async function testDatabase() {
  const result = await pool.query("SELECT NOW()");
  console.log(
    `[HEXORA] Neon connected: ${result.rows[0].now}`
  );
}

// ============================================================
// HELPERS
// ============================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("hex");
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\u0000/g, "")
    .trim();
}

function detectLanguage(text) {
  const value = String(text || "");

  if (/[\u0B80-\u0BFF]/.test(value)) return "ta";
  if (/[\u0900-\u097F]/.test(value)) return "hi";
  if (/[\u0980-\u09FF]/.test(value)) return "bn";
  if (/[\u0A00-\u0A7F]/.test(value)) return "pa";
  if (/[\u0B00-\u0B7F]/.test(value)) return "or";
  if (/[\u0C00-\u0C7F]/.test(value)) return "te";
  if (/[\u0C80-\u0CFF]/.test(value)) return "kn";
  if (/[\u0D00-\u0D7F]/.test(value)) return "ml";
  if (/[\u0A80-\u0AFF]/.test(value)) return "gu";
  if (/[\u0C00-\u0C7F]/.test(value)) return "te";
  if (/[\u0400-\u04FF]/.test(value)) return "ru";
  if (/[\u4E00-\u9FFF]/.test(value)) return "zh";
  if (/[\u3040-\u30FF]/.test(value)) return "ja";
  if (/[\uAC00-\uD7AF]/.test(value)) return "ko";

  return "en";
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);

    u.hash = "";

    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return null;
    }

    u.hostname = u.hostname.toLowerCase();

    return u.toString();
  } catch {
    return null;
  }
}

function isValidHttpUrl(url) {
  try {
    const u = new URL(url);

    return (
      (u.protocol === "http:" || u.protocol === "https:") &&
      !!u.hostname
    );
  } catch {
    return false;
  }
}

function domainMatches(url, domain) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    const target = domain
      .trim()
      .toLowerCase()
      .replace(/^www\./, "");

    return (
      hostname === target ||
      hostname.endsWith("." + target)
    );
  } catch {
    return false;
  }
}

function isProbablyHtml(url, mime = "") {
  if (mime && !mime.toLowerCase().includes("html")) {
    return false;
  }

  const lower = url.toLowerCase();

  const badExtensions = [
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".svg",
    ".ico",
    ".pdf",
    ".zip",
    ".rar",
    ".7z",
    ".mp3",
    ".wav",
    ".mp4",
    ".avi",
    ".mov",
    ".mkv",
    ".exe",
    ".dmg",
    ".iso",
    ".css",
    ".js",
    ".json",
    ".xml",
  ];

  return !badExtensions.some((ext) =>
    lower.endsWith(ext)
  );
}

// ============================================================
// FETCH WITH TIMEOUT
// ============================================================

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        ...(options.headers || {}),
      },
    });

    return response;
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// COMMON CRAWL COLLECTION
// ============================================================

async function getCollectionInfo() {
  const url =
    "https://index.commoncrawl.org/collinfo.json";

  console.log(
    "[HEXORA] Discovering Common Crawl collection..."
  );

  const response = await fetchWithTimeout(url);

  if (!response.ok) {
    throw new Error(
      `Common Crawl collection discovery failed: HTTP ${response.status}`
    );
  }

  const data = await response.json();

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(
      "Common Crawl collection list is empty"
    );
  }

  if (process.env.COMMONCRAWL_COLLECTION) {
    const found = data.find(
      (item) =>
        item.id === process.env.COMMONCRAWL_COLLECTION
    );

    if (!found) {
      throw new Error(
        `Requested Common Crawl collection not found: ${process.env.COMMONCRAWL_COLLECTION}`
      );
    }

    return found;
  }

  return data[0];
}

// ============================================================
// COMMON CRAWL INDEX QUERY
// ============================================================

async function queryIndex(indexUrl, domain) {
  const params = new URLSearchParams();

  params.set("url", `*.${domain}/*`);
  params.append("url", `${domain}/*`);
  params.set("output", "json");
  params.set("filter", "status:200");
  params.append("filter", "mime:text/html");
  params.set("collapse", "urlkey");

  const url =
    `${indexUrl}?${params.toString()}`;

  console.log(
    `[HEXORA] Querying Common Crawl index: ${domain}`
  );

  const response = await fetchWithTimeout(url);

  if (!response.ok) {
    console.log(
      `[HEXORA] Index query failed for ${domain}: HTTP ${response.status}`
    );

    return [];
  }

  const text = await response.text();

  if (!text.trim()) {
    return [];
  }

  const rows = [];

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;

    try {
      const row = JSON.parse(line);

      if (
        row.status === "200" &&
        row.mime &&
        row.mime.includes("html") &&
        row.url &&
        row.filename &&
        row.offset !== undefined &&
        row.length !== undefined
      ) {
        rows.push(row);
      }
    } catch {
      // Ignore malformed index rows.
    }

    if (rows.length >= PAGES_PER_DOMAIN) {
      break;
    }
  }

  return rows;
}

// ============================================================
// DOWNLOAD WARC RECORD
// ============================================================

async function downloadWarcRecord(row) {
  const start = Number(row.offset);
  const length = Number(row.length);

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(length) ||
    length <= 0
  ) {
    throw new Error("Invalid WARC offset/length");
  }

  if (length > MAX_HTML_SIZE * 2) {
    throw new Error(
      `WARC record too large: ${length}`
    );
  }

  const end = start + length - 1;

  const url =
    `https://data.commoncrawl.org/${row.filename}`;

  const response = await fetchWithTimeout(url, {
    headers: {
      Range: `bytes=${start}-${end}`,
    },
  });

  if (!response.ok && response.status !== 206) {
    throw new Error(
      `WARC download failed: HTTP ${response.status}`
    );
  }

  const buffer = Buffer.from(
    await response.arrayBuffer()
  );

  if (!buffer.length) {
    throw new Error("Empty WARC response");
  }

  let data = buffer;

  // Common Crawl WARC records are normally gzip compressed.
  try {
    data = await gunzip(buffer);
  } catch {
    // Some responses may already be uncompressed.
    data = buffer;
  }

  return extractHtmlFromWarc(data);
}

// ============================================================
// WARC HTML EXTRACTION
// ============================================================

function extractHtmlFromWarc(buffer) {
  const text = buffer.toString("utf8");

  const httpHeaderIndex =
    text.search(/\r?\n\r?\n/);

  if (httpHeaderIndex === -1) {
    return text;
  }

  const separatorMatch =
    text.match(/\r?\n\r?\n/);

  const separatorLength =
    separatorMatch ? separatorMatch[0].length : 4;

  const bodyStart =
    httpHeaderIndex + separatorLength;

  let body = text.slice(bodyStart);

  const warcEnd =
    body.indexOf("\r\nWARC/");

  if (warcEnd > 0) {
    body = body.slice(0, warcEnd);
  }

  return body;
}

// ============================================================
// HTML PARSER
// ============================================================

function parseHtml(html, sourceUrl) {
  if (!html || html.length < 50) {
    return null;
  }

  if (html.length > MAX_HTML_SIZE) {
    html = html.slice(0, MAX_HTML_SIZE);
  }

  const $ = cheerio.load(html);

  $(
    "script, style, noscript, template, svg, canvas"
  ).remove();

  const title = cleanText(
    $("title").first().text()
  );

  let description = cleanText(
    $('meta[name="description"]')
      .attr("content") || ""
  );

  if (!description) {
    description = cleanText(
      $('meta[property="og:description"]')
        .attr("content") || ""
    );
  }

  let content = cleanText(
    $("body").text()
  );

  if (content.length > MAX_CONTENT) {
    content = content.slice(0, MAX_CONTENT);
  }

  const headings = [];

  $("h1,h2,h3").each((_, element) => {
    const value = cleanText($(element).text());

    if (value) {
      headings.push(value);
    }

    if (headings.length >= 20) {
      return false;
    }
  });

  const links = [];

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");

    if (!href) return;

    try {
      const absolute =
        new URL(href, sourceUrl).toString();

      const normalized =
        normalizeUrl(absolute);

      if (
        normalized &&
        isValidHttpUrl(normalized)
      ) {
        links.push(normalized);
      }
    } catch {
      // Ignore invalid links.
    }

    if (links.length >= MAX_LINKS) {
      return false;
    }
  });

  const combinedText = cleanText(
    `${title} ${description} ${headings.join(" ")} ${content}`
  );

  const language =
    detectLanguage(combinedText);

  return {
    title: title || sourceUrl,
    description:
      description ||
      content.slice(0, 300),
    content,
    headings,
    language,
    links: [...new Set(links)],
  };
}

// ============================================================
// DUPLICATE CHECK
// ============================================================

async function pageExists(url) {
  try {
    const result = await pool.query(
      `
      SELECT id, content_hash
      FROM pages
      WHERE url = $1
      LIMIT 1
      `,
      [url]
    );

    return result.rows[0] || null;
  } catch (error) {
    console.error(
      `[HEXORA] Neon duplicate check failed for ${url}:`,
      error.message
    );

    throw error;
  }
}

// ============================================================
// SAVE PAGE TO NEON
// ============================================================

async function savePage({
  url,
  title,
  description,
  content,
  language,
  contentHash,
  r2Key,
}) {
  const wordCount = content
    ? content.split(/\s+/).filter(Boolean).length
    : 0;

  const result = await pool.query(
    `
    INSERT INTO pages
    (
      url,
      title,
      description,
      content,
      content_hash,
      word_count,
      language,
      r2_key,
      updated_at
    )
    VALUES
    (
      $1,
      $2,
      $3,
      $4,
      $5,
      $6,
      $7,
      $8,
      NOW()
    )
    ON CONFLICT (url)
    DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      content = EXCLUDED.content,
      content_hash = EXCLUDED.content_hash,
      word_count = EXCLUDED.word_count,
      language = EXCLUDED.language,
      r2_key = EXCLUDED.r2_key,
      updated_at = NOW()
    RETURNING id
    `,
    [
      url,
      title,
      description,
      content,
      contentHash,
      wordCount,
      language,
      r2Key,
    ]
  );

  return result.rows[0]?.id || null;
}

// ============================================================
// SAVE CRAWL QUEUE
// ============================================================

async function enqueueUrl(url) {
  if (!isValidHttpUrl(url)) {
    return;
  }

  try {
    await pool.query(
      `
      INSERT INTO crawl_queue
      (
        url,
        status,
        created_at
      )
      VALUES
      (
        $1,
        'pending',
        NOW()
      )
      ON CONFLICT (url)
      DO NOTHING
      `,
      [url]
    );
  } catch (error) {
    // Queue table may use another status scheme.
    // Do not stop the whole importer.
    console.log(
      `[HEXORA] Queue insert skipped: ${error.message}`
    );
  }
}

// ============================================================
// IMPORT ONE RECORD
// ============================================================

async function importRecord(row) {
  const originalUrl =
    normalizeUrl(row.url);

  if (!originalUrl) {
    return {
      imported: false,
      reason: "invalid_url",
    };
  }

  if (!isProbablyHtml(originalUrl, row.mime)) {
    return {
      imported: false,
      reason: "not_html",
    };
  }

  console.log(
    `[HEXORA] Processing: ${originalUrl}`
  );

  const existing =
    await pageExists(originalUrl);

  if (existing) {
    console.log(
      `[HEXORA] Already indexed: ${originalUrl}`
    );

    return {
      imported: false,
      reason: "already_indexed",
    };
  }

  const html =
    await downloadWarcRecord(row);

  const parsed =
    parseHtml(html, originalUrl);

  if (!parsed) {
    return {
      imported: false,
      reason: "empty_html",
    };
  }

  if (
    !parsed.content ||
    parsed.content.length < 50
  ) {
    return {
      imported: false,
      reason: "low_content",
    };
  }

  const contentHash =
    sha256(parsed.content);

  // Content duplicate check.
  try {
    const duplicate =
      await pool.query(
        `
        SELECT id
        FROM pages
        WHERE content_hash = $1
        LIMIT 1
        `,
        [contentHash]
      );

    if (duplicate.rows.length > 0) {
      console.log(
        `[HEXORA] Duplicate content skipped: ${originalUrl}`
      );

      return {
        imported: false,
        reason: "duplicate_content",
      };
    }
  } catch (error) {
    console.log(
      `[HEXORA] Content duplicate check skipped: ${error.message}`
    );
  }

  // ==========================================================
  // R2
  // ==========================================================

  const r2Key =
    makeR2Key(
      originalUrl,
      contentHash
    );

  await putHtml({
    url: originalUrl,
    html,
    contentHash,
  });

  console.log(
    `[HEXORA] R2 saved: ${r2Key}`
  );

  // ==========================================================
  // NEON
  // ==========================================================

  const pageId =
    await savePage({
      url: originalUrl,
      title: parsed.title,
      description: parsed.description,
      content: parsed.content,
      language: parsed.language,
      contentHash,
      r2Key,
    });

  console.log(
    `[HEXORA] Neon indexed: ${originalUrl} | id=${pageId}`
  );

  // ==========================================================
  // DISCOVER LINKS
  // ==========================================================

  let queued = 0;

  for (const link of parsed.links) {
    if (queued >= MAX_LINKS) {
      break;
    }

    // Only enqueue normal web pages.
    if (!isValidHttpUrl(link)) {
      continue;
    }

    await enqueueUrl(link);

    queued++;
  }

  return {
    imported: true,
    url: originalUrl,
    language: parsed.language,
    links: queued,
  };
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
    "             HEXORA COMMON CRAWL IMPORTER"
  );
  console.log(
    "============================================================"
  );
  console.log(
    `[HEXORA] Collection: ${COLLECTION}`
  );
  console.log(
    `[HEXORA] R2 bucket: ${process.env.R2_BUCKET_NAME || "hexora"}`
  );
  console.log(
    `[HEXORA] Target domains: ${TARGET_DOMAINS}`
  );
  console.log(
    `[HEXORA] Pages/domain: ${PAGES_PER_DOMAIN}`
  );
  console.log(
    `[HEXORA] Maximum pages: ${MAX_PAGES}`
  );
  console.log(
    "============================================================"
  );
  console.log("");

  await testDatabase();

  const collection =
    await getCollectionInfo();

  const indexUrl =
    collection.index ||
    collection["cdx-api"] ||
    `https://index.commoncrawl.org/${collection.id}-index`;

  console.log(
    `[HEXORA] Using collection: ${collection.id}`
  );

  console.log(
    `[HEXORA] Index URL: ${indexUrl}`
  );

  const domains =
    TARGET_DOMAINS
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

  let totalProcessed = 0;
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const domain of domains) {
    if (totalProcessed >= MAX_PAGES) {
      break;
    }

    console.log("");
    console.log(
      `------------------------------------------------------------`
    );
    console.log(
      `[HEXORA] DOMAIN: ${domain}`
    );
    console.log(
      `------------------------------------------------------------`
    );

    let rows = [];

    try {
      rows =
        await queryIndex(
          indexUrl,
          domain
        );
    } catch (error) {
      console.error(
        `[HEXORA] Index error for ${domain}:`,
        error.message
      );

      continue;
    }

    console.log(
      `[HEXORA] Found ${rows.length} records for ${domain}`
    );

    for (const row of rows) {
      if (totalProcessed >= MAX_PAGES) {
        break;
      }

      totalProcessed++;

      try {
        const result =
          await importRecord(row);

        if (result.imported) {
          imported++;

          console.log(
            `[HEXORA] IMPORTED ${imported}/${MAX_PAGES}`
          );
        } else {
          skipped++;
        }
      } catch (error) {
        failed++;

        console.error(
          `[HEXORA] Import failed: ${row.url}`
        );

        console.error(
          `[HEXORA] Reason: ${error.message}`
        );
      }

      // Small delay to avoid hammering Common Crawl/R2/Neon.
      await sleep(250);
    }
  }

  console.log("");
  console.log(
    "============================================================"
  );
  console.log(
    "             HEXORA COMMON CRAWL COMPLETE"
  );
  console.log(
    "============================================================"
  );
  console.log(
    `[HEXORA] Processed: ${totalProcessed}`
  );
  console.log(
    `[HEXORA] Imported:  ${imported}`
  );
  console.log(
    `[HEXORA] Skipped:   ${skipped}`
  );
  console.log(
    `[HEXORA] Failed:    ${failed}`
  );
  console.log(
    `[HEXORA] R2 bucket: ${process.env.R2_BUCKET_NAME || "hexora"}`
  );
  console.log(
    `[HEXORA] Collection: ${collection.id}`
  );
  console.log(
    "============================================================"
  );
  console.log("");
}

// ============================================================
// RUN
// ============================================================

main()
  .catch((error) => {
    console.error("");
    console.error(
      "[HEXORA] FATAL ERROR:",
      error.message
    );
    console.error(error.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await pool.end();
    } catch {
      // Ignore pool close errors.
    }
  });
