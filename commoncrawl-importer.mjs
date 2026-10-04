// ============================================================
// HEXORA SEARCH ENGINE
// COMMON CRAWL IMPORTER
// ============================================================
// Features:
// - Latest Common Crawl collection discovery
// - 504/429/5xx automatic retry
// - 120 second request timeout
// - Smaller Common Crawl index queries
// - Neon PostgreSQL storage
// - Cloudflare R2 HTML storage
// - Duplicate URL/content protection
// - Crawl queue link discovery
// ============================================================

import crypto from "crypto";
import zlib from "zlib";
import { promisify } from "util";
import pg from "pg";
import * as cheerio from "cheerio";
import {
  S3Client,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

const { Pool } = pg;
const gunzip = promisify(zlib.gunzip);

// ============================================================
// CONFIG
// ============================================================

const DATABASE_URL = process.env.DATABASE_URL || "";

const R2_ACCOUNT_ID =
  process.env.R2_ACCOUNT_ID || "";

const R2_ACCESS_KEY_ID =
  process.env.R2_ACCESS_KEY_ID || "";

const R2_SECRET_ACCESS_KEY =
  process.env.R2_SECRET_ACCESS_KEY || "";

const R2_BUCKET_NAME =
  process.env.R2_BUCKET_NAME || "hexora";

const REQUEST_TIMEOUT =
  Number(process.env.COMMONCRAWL_TIMEOUT_MS || 120000);

const MAX_RETRIES =
  Number(process.env.COMMONCRAWL_MAX_RETRIES || 4);

const PAGES_PER_DOMAIN =
  Number(process.env.COMMONCRAWL_PAGES_PER_DOMAIN || 20);

const MAX_PAGES =
  Number(process.env.COMMONCRAWL_MAX_PAGES || 200);

const MAX_CONTENT =
  Number(process.env.COMMONCRAWL_MAX_CONTENT || 150000);

const MAX_LINKS =
  Number(process.env.COMMONCRAWL_MAX_LINKS || 100);

const DELAY_MS =
  Number(process.env.COMMONCRAWL_DELAY_MS || 1000);

const COLLECTION_ENV =
  process.env.COMMONCRAWL_COLLECTION || "";

const TARGET_DOMAINS = (
  process.env.COMMONCRAWL_TARGET_DOMAINS ||
  [
    "wikipedia.org",
    "github.com",
    "mozilla.org",
    "python.org",
    "nodejs.org",
    "apache.org",
    "bbc.com",
    "reuters.com",
    "ndtv.com",
    "thehindu.com",
    "indianexpress.com",
  ].join(",")
)
  .split(",")
  .map((x) => x.trim().toLowerCase())
  .filter(Boolean);

// ============================================================
// USER AGENT
// ============================================================

const USER_AGENT =
  process.env.HEXORA_USER_AGENT ||
  "HEXORA-SearchEngine/1.0 (+https://hexorasearch.com/)";

// ============================================================
// NEON
// ============================================================

if (!DATABASE_URL) {
  console.error(
    "[HEXORA] ERROR: DATABASE_URL is missing."
  );
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 30000,
  ssl: DATABASE_URL.includes("neon.tech")
    ? { rejectUnauthorized: false }
    : undefined,
});

// ============================================================
// R2
// ============================================================

if (
  !R2_ACCOUNT_ID ||
  !R2_ACCESS_KEY_ID ||
  !R2_SECRET_ACCESS_KEY
) {
  console.error(
    "[HEXORA] ERROR: R2 credentials are missing."
  );
  process.exit(1);
}

const r2 = new S3Client({
  region: "auto",
  endpoint:
    `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

// ============================================================
// STATS
// ============================================================

const stats = {
  processed: 0,
  imported: 0,
  skipped: 0,
  failed: 0,
  records: 0,
  linksQueued: 0,
  retries: 0,
};

// ============================================================
// HELPERS
// ============================================================

function sleep(ms) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}

function normalizeUrl(value) {
  try {
    const u = new URL(value);

    u.hash = "";

    u.hostname = u.hostname.toLowerCase();

    if (
      (u.protocol === "https:" && u.port === "443") ||
      (u.protocol === "http:" && u.port === "80")
    ) {
      u.port = "";
    }

    return u.toString();
  } catch {
    return null;
  }
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("hex");
}

function getR2Key(url, contentHash) {
  const u = new URL(url);

  const host = u.hostname
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, "_");

  return `pages/${host}/${contentHash}.html`;
}

function detectLanguage(text) {
  if (!text) return "unknown";

  if (/[\u0980-\u09FF]/.test(text)) {
    return "bn";
  }

  if (/[\u0A00-\u0A7F]/.test(text)) {
    return "pa";
  }

  if (/[\u0900-\u097F]/.test(text)) {
    return "hi";
  }

  if (/[\u0B80-\u0BFF]/.test(text)) {
    return "ta";
  }

  if (/[\u0C00-\u0C7F]/.test(text)) {
    return "te";
  }

  if (/[\u0C80-\u0CFF]/.test(text)) {
    return "kn";
  }

  if (/[\u0D00-\u0D7F]/.test(text)) {
    return "ml";
  }

  // Assamese/Bengali script.
  // Assamese-specific characters are checked first.
  if (/[ৰৱয়অআইঈউঊএঐওঔ]/.test(text)) {
    return "as";
  }

  if (/[\u0400-\u04FF]/.test(text)) {
    return "ru";
  }

  if (/[\u4E00-\u9FFF]/.test(text)) {
    return "zh";
  }

  if (/[\u3040-\u30FF]/.test(text)) {
    return "ja";
  }

  if (/[\uAC00-\uD7AF]/.test(text)) {
    return "ko";
  }

  return "en";
}

// ============================================================
// FETCH WITH RETRY
// ============================================================

async function fetchWithRetry(
  url,
  options = {},
  label = "request"
) {
  let lastError = null;

  for (
    let attempt = 1;
    attempt <= MAX_RETRIES;
    attempt++
  ) {
    const controller = new AbortController();

    const timer = setTimeout(() => {
      controller.abort();
    }, REQUEST_TIMEOUT);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          "User-Agent": USER_AGENT,
          ...(options.headers || {}),
        },
      });

      clearTimeout(timer);

      if (
        response.ok
      ) {
        return response;
      }

      const retryable =
        response.status === 408 ||
        response.status === 425 ||
        response.status === 429 ||
        response.status === 500 ||
        response.status === 502 ||
        response.status === 503 ||
        response.status === 504;

      if (!retryable) {
        throw new Error(
          `${label}: HTTP ${response.status}`
        );
      }

      lastError = new Error(
        `${label}: HTTP ${response.status}`
      );

      console.log(
        `[HEXORA] ${label} failed: HTTP ${response.status} ` +
        `(attempt ${attempt}/${MAX_RETRIES})`
      );

      if (attempt < MAX_RETRIES) {
        stats.retries++;

        const wait =
          Math.min(
            30000,
            2000 * Math.pow(2, attempt - 1)
          );

        console.log(
          `[HEXORA] Retry in ${wait}ms...`
        );

        await sleep(wait);
      }
    } catch (error) {
      clearTimeout(timer);

      lastError = error;

      const message =
        error?.name === "AbortError"
          ? "TIMEOUT"
          : error?.message || String(error);

      console.log(
        `[HEXORA] ${label} error: ${message} ` +
        `(attempt ${attempt}/${MAX_RETRIES})`
      );

      if (attempt < MAX_RETRIES) {
        stats.retries++;

        const wait =
          Math.min(
            30000,
            2000 * Math.pow(2, attempt - 1)
          );

        await sleep(wait);
      }
    }
  }

  throw lastError || new Error(
    `${label}: request failed`
  );
}

// ============================================================
// COMMON CRAWL COLLECTION
// ============================================================

async function getCollection() {
  if (COLLECTION_ENV) {
    console.log(
      `[HEXORA] Using configured collection: ${COLLECTION_ENV}`
    );

    return COLLECTION_ENV;
  }

  console.log(
    "[HEXORA] Discovering Common Crawl collection..."
  );

  const response = await fetchWithRetry(
    "https://index.commoncrawl.org/collinfo.json",
    {},
    "Collection discovery"
  );

  const data = await response.json();

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(
      "Common Crawl collection list is empty."
    );
  }

  const collection =
    data.find((x) => x.id)?.id;

  if (!collection) {
    throw new Error(
      "Could not determine Common Crawl collection."
    );
  }

  return collection;
}

// ============================================================
// COMMON CRAWL INDEX QUERY
// ============================================================

async function queryIndex(
  indexUrl,
  domain
) {
  const queries = [
    `https://${domain}/*`,
    `http://${domain}/*`,
  ];

  let allRecords = [];

  for (const urlPattern of queries) {
    const params = new URLSearchParams();

    params.set(
      "url",
      urlPattern
    );

    params.set(
      "output",
      "json"
    );

    params.set(
      "filter",
      "status:200"
    );

    params.append(
      "filter",
      "mime:text/html"
    );

    params.set(
      "collapse",
      "urlkey"
    );

    const url =
      `${indexUrl}?${params.toString()}`;

    console.log(
      `[HEXORA] Querying: ${urlPattern}`
    );

    try {
      const response =
        await fetchWithRetry(
          url,
          {},
          `Index ${domain}`
        );

      const text =
        await response.text();

      const lines =
        text
          .split("\n")
          .map((x) => x.trim())
          .filter(Boolean);

      for (const line of lines) {
        try {
          const record =
            JSON.parse(line);

          if (
            record &&
            record.url &&
            record.filename &&
            record.offset !== undefined &&
            record.length !== undefined
          ) {
            allRecords.push(record);
          }
        } catch {
          // Ignore malformed JSONL line.
        }
      }
    } catch (error) {
      console.log(
        `[HEXORA] Query failed for ${domain}: ` +
        `${error.message}`
      );
    }

    if (
      allRecords.length >=
      PAGES_PER_DOMAIN
    ) {
      break;
    }

    await sleep(1000);
  }

  // Remove duplicate URLs.
  const map = new Map();

  for (const record of allRecords) {
    const normalized =
      normalizeUrl(record.url);

    if (!normalized) continue;

    if (!map.has(normalized)) {
      map.set(normalized, {
        ...record,
        url: normalized,
      });
    }
  }

  return Array.from(map.values())
    .slice(0, PAGES_PER_DOMAIN);
}

// ============================================================
// WARC DOWNLOAD
// ============================================================

async function downloadWarcRecord(record) {
  const start =
    Number(record.offset);

  const length =
    Number(record.length);

  const end =
    start + length - 1;

  const warcUrl =
    `https://data.commoncrawl.org/${record.filename}`;

  const response =
    await fetchWithRetry(
      warcUrl,
      {
        headers: {
          Range:
            `bytes=${start}-${end}`,
        },
      },
      "WARC download"
    );

  const buffer =
    Buffer.from(
      await response.arrayBuffer()
    );

  return buffer;
}

// ============================================================
// EXTRACT HTTP BODY FROM WARC
// ============================================================

function extractHttpBody(buffer) {
  let data = buffer;

  // Common Crawl WARC records are usually gzip compressed.
  try {
    if (
      data.length >= 2 &&
      data[0] === 0x1f &&
      data[1] === 0x8b
    ) {
      data = zlib.gunzipSync(data);
    }
  } catch {
    // Continue with original buffer.
  }

  const text =
    data.toString("utf8");

  const httpMarker =
    "HTTP/";

  const httpIndex =
    text.indexOf(httpMarker);

  if (httpIndex === -1) {
    return text;
  }

  const headerEnd1 =
    text.indexOf(
      "\r\n\r\n",
      httpIndex
    );

  const headerEnd2 =
    text.indexOf(
      "\n\n",
      httpIndex
    );

  let bodyStart = -1;

  if (
    headerEnd1 !== -1 &&
    headerEnd2 !== -1
  ) {
    bodyStart =
      Math.min(
        headerEnd1,
        headerEnd2
      );
  } else if (
    headerEnd1 !== -1
  ) {
    bodyStart = headerEnd1;
  } else if (
    headerEnd2 !== -1
  ) {
    bodyStart = headerEnd2;
  }

  if (bodyStart === -1) {
    return text;
  }

  const separator =
    text.startsWith(
      "\r\n\r\n",
      bodyStart
    )
      ? 4
      : 2;

  return text.slice(
    bodyStart + separator
  );
}

// ============================================================
// HTML PARSING
// ============================================================

function parseHtml(
  html,
  sourceUrl
) {
  const $ =
    cheerio.load(
      html,
      {
        decodeEntities: true,
      }
    );

  $(
    "script, style, noscript, svg, canvas, iframe"
  ).remove();

  const title =
    $("title")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);

  const description =
    $('meta[name="description"]')
      .attr("content") ||
    $('meta[property="og:description"]')
      .attr("content") ||
    "";

  const text =
    $("body")
      .text(" ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_CONTENT);

  const language =
    detectLanguage(
      `${title} ${description} ${text}`
    );

  const links = [];

  $("a[href]").each(
    (_, element) => {
      if (
        links.length >= MAX_LINKS
      ) {
        return;
      }

      const href =
        $(element).attr("href");

      if (!href) return;

      try {
        const absolute =
          new URL(
            href,
            sourceUrl
          );

        if (
          absolute.protocol !== "http:" &&
          absolute.protocol !== "https:"
        ) {
          return;
        }

        absolute.hash = "";

        const normalized =
          normalizeUrl(
            absolute.toString()
          );

        if (
          normalized &&
          !links.includes(normalized)
        ) {
          links.push(normalized);
        }
      } catch {
        // Ignore invalid links.
      }
    }
  );

  return {
    title,
    description:
      description
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 2000),
    text,
    language,
    links,
  };
}

// ============================================================
// CHECK PAGE EXISTS
// ============================================================

async function pageExists(url) {
  const result =
    await pool.query(
      `
      SELECT id, content_hash, r2_key
      FROM pages
      WHERE url = $1
      LIMIT 1
      `,
      [url]
    );

  return result.rows[0] || null;
}

// ============================================================
// CHECK CONTENT HASH
// ============================================================

async function contentExists(
  contentHash
) {
  const result =
    await pool.query(
      `
      SELECT id, url, r2_key
      FROM pages
      WHERE content_hash = $1
      LIMIT 1
      `,
      [contentHash]
    );

  return result.rows[0] || null;
}

// ============================================================
// SAVE HTML TO R2
// ============================================================

async function saveToR2(
  url,
  html,
  contentHash
) {
  const key =
    getR2Key(
      url,
      contentHash
    );

  await r2.send(
    new PutObjectCommand({
      Bucket:
        R2_BUCKET_NAME,

      Key: key,

      Body:
        Buffer.from(html, "utf8"),

      ContentType:
        "text/html; charset=utf-8",

      Metadata: {
        url: encodeURIComponent(url),
        contenthash: contentHash,
      },
    })
  );

  return key;
}

// ============================================================
// SAVE PAGE TO NEON
// ============================================================

async function savePage({
  url,
  title,
  description,
  content,
  contentHash,
  language,
  r2Key,
}) {
  const wordCount =
    content
      .split(/\s+/)
      .filter(Boolean)
      .length;

  await pool.query(
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
}

// ============================================================
// QUEUE DISCOVERED LINKS
// ============================================================

async function queueLinks(
  links
) {
  if (!links.length) {
    return 0;
  }

  let added = 0;

  for (const url of links) {
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

      added++;
    } catch (error) {
      // Queue schema may differ on older database.
      console.log(
        `[HEXORA] Queue insert skipped: ${error.message}`
      );
    }
  }

  return added;
}

// ============================================================
// IMPORT ONE RECORD
// ============================================================

async function importRecord(
  record
) {
  const url =
    normalizeUrl(record.url);

  if (!url) {
    stats.skipped++;
    return;
  }

  console.log(
    `[HEXORA] Processing: ${url}`
  );

  // ----------------------------------------------------------
  // URL duplicate
  // ----------------------------------------------------------

  const existing =
    await pageExists(url);

  if (existing) {
    console.log(
      `[HEXORA] Already indexed: ${url}`
    );

    stats.skipped++;
    return;
  }

  // ----------------------------------------------------------
  // Download WARC
  // ----------------------------------------------------------

  const warc =
    await downloadWarcRecord(
      record
    );

  if (!warc || !warc.length) {
    throw new Error(
      "Empty WARC record"
    );
  }

  // ----------------------------------------------------------
  // Extract HTML
  // ----------------------------------------------------------

  const html =
    extractHttpBody(warc);

  if (!html || html.length < 100) {
    throw new Error(
      "HTML content is empty or too small"
    );
  }

  // ----------------------------------------------------------
  // Parse
  // ----------------------------------------------------------

  const parsed =
    parseHtml(
      html,
      url
    );

  if (
    !parsed.text ||
    parsed.text.length < 50
  ) {
    throw new Error(
      "Page has insufficient text content"
    );
  }

  // ----------------------------------------------------------
  // Hash
  // ----------------------------------------------------------

  const contentHash =
    sha256(
      parsed.text
    );

  // ----------------------------------------------------------
  // Content duplicate
  // ----------------------------------------------------------

  const duplicate =
    await contentExists(
      contentHash
    );

  if (duplicate) {
    console.log(
      `[HEXORA] Duplicate content skipped: ${url}`
    );

    stats.skipped++;
    return;
  }

  // ----------------------------------------------------------
  // R2
  // ----------------------------------------------------------

  const r2Key =
    await saveToR2(
      url,
      html,
      contentHash
    );

  console.log(
    `[HEXORA] R2 saved: ${r2Key}`
  );

  // ----------------------------------------------------------
  // Neon
  // ----------------------------------------------------------

  await savePage({
    url,
    title: parsed.title,
    description: parsed.description,
    content: parsed.text,
    contentHash,
    language: parsed.language,
    r2Key,
  });

  console.log(
    `[HEXORA] Neon saved: ${url}`
  );

  // ----------------------------------------------------------
  // Queue discovered links
  // ----------------------------------------------------------

  const queued =
    await queueLinks(
      parsed.links
    );

  stats.linksQueued += queued;

  console.log(
    `[HEXORA] Language: ${parsed.language}`
  );

  console.log(
    `[HEXORA] Links discovered: ${parsed.links.length}`
  );

  console.log(
    `[HEXORA] Links queued: ${queued}`
  );

  stats.imported++;
}

// ============================================================
// PROCESS DOMAIN
// ============================================================

async function processDomain(
  indexUrl,
  domain
) {
  console.log("");
  console.log(
    "------------------------------------------------------------"
  );
  console.log(
    `[HEXORA] DOMAIN: ${domain}`
  );
  console.log(
    "------------------------------------------------------------"
  );

  let records = [];

  try {
    records =
      await queryIndex(
        indexUrl,
        domain
      );
  } catch (error) {
    console.log(
      `[HEXORA] Domain query failed: ${error.message}`
    );

    return;
  }

  stats.records += records.length;

  console.log(
    `[HEXORA] Found ${records.length} records for ${domain}`
  );

  for (
    const record of records
  ) {
    if (
      stats.processed >= MAX_PAGES
    ) {
      return;
    }

    stats.processed++;

    try {
      await importRecord(
        record
      );
    } catch (error) {
      stats.failed++;

      console.log(
        `[HEXORA] Import failed: ${record.url}`
      );

      console.log(
        `[HEXORA] Reason: ${error.message}`
      );
    }

    await sleep(
      DELAY_MS
    );
  }
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
    `[HEXORA] R2 bucket: ${R2_BUCKET_NAME}`
  );

  console.log(
    `[HEXORA] Pages/domain: ${PAGES_PER_DOMAIN}`
  );

  console.log(
    `[HEXORA] Maximum pages: ${MAX_PAGES}`
  );

  console.log(
    `[HEXORA] Timeout: ${REQUEST_TIMEOUT}ms`
  );

  console.log(
    `[HEXORA] Max retries: ${MAX_RETRIES}`
  );

  console.log(
    `[HEXORA] Target domains: ${TARGET_DOMAINS.join(",")}`
  );

  console.log(
    "============================================================"
  );

  // ----------------------------------------------------------
  // Test Neon
  // ----------------------------------------------------------

  try {
    await pool.query(
      "SELECT 1"
    );

    console.log(
      `[HEXORA] Neon connected: ${new Date()}`
    );
  } catch (error) {
    console.error(
      `[HEXORA] Neon connection failed: ${error.message}`
    );

    process.exit(1);
  }

  // ----------------------------------------------------------
  // Test R2
  // ----------------------------------------------------------

  try {
    console.log(
      `[HEXORA] R2 bucket check: ${R2_BUCKET_NAME}`
    );

    // A harmless upload test is avoided.
    // Actual R2 validation happens on first page.
  } catch (error) {
    console.error(
      `[HEXORA] R2 configuration error: ${error.message}`
    );

    process.exit(1);
  }

  // ----------------------------------------------------------
  // Collection
  // ----------------------------------------------------------

  let collection;

  try {
    collection =
      await getCollection();

    console.log(
      `[HEXORA] Using collection: ${collection}`
    );
  } catch (error) {
    console.error(
      `[HEXORA] Collection discovery failed: ${error.message}`
    );

    process.exit(1);
  }

  const indexUrl =
    `https://index.commoncrawl.org/${collection}-index`;

  console.log(
    `[HEXORA] Index URL: ${indexUrl}`
  );

  // ----------------------------------------------------------
  // Domains
  // ----------------------------------------------------------

  for (
    const domain of TARGET_DOMAINS
  ) {
    if (
      stats.processed >= MAX_PAGES
    ) {
      console.log(
        "[HEXORA] Maximum page limit reached."
      );

      break;
    }

    await processDomain(
      indexUrl,
      domain
    );

    // Small pause between domains.
    await sleep(1500);
  }

  // ----------------------------------------------------------
  // Final stats
  // ----------------------------------------------------------

  console.log("");
  console.log(
    "============================================================"
  );

  console.log(
    "[HEXORA] COMMON CRAWL IMPORT COMPLETE"
  );

  console.log(
    "============================================================"
  );

  console.log(
    `[HEXORA] Records found: ${stats.records}`
  );

  console.log(
    `[HEXORA] Processed: ${stats.processed}`
  );

  console.log(
    `[HEXORA] Imported: ${stats.imported}`
  );

  console.log(
    `[HEXORA] Skipped: ${stats.skipped}`
  );

  console.log(
    `[HEXORA] Failed: ${stats.failed}`
  );

  console.log(
    `[HEXORA] Retries: ${stats.retries}`
  );

  console.log(
    `[HEXORA] Links queued: ${stats.linksQueued}`
  );

  console.log(
    `[HEXORA] R2 bucket: ${R2_BUCKET_NAME}`
  );

  console.log(
    `[HEXORA] Collection: ${collection}`
  );

  console.log(
    "============================================================"
  );

  await pool.end();
}

// ============================================================
// START
// ============================================================

main().catch(
  async (error) => {
    console.error("");
    console.error(
      "[HEXORA] FATAL ERROR:"
    );
    console.error(
      error?.stack || error?.message || error
    );

    try {
      await pool.end();
    } catch {}

    process.exit(1);
  }
);
