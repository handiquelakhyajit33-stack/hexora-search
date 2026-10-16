// ============================================================
// HEXORA SEARCH ENGINE
// COMMON CRAWL IMPORTER
// R2-only Common Crawl importer
// ============================================================

import crypto from "crypto";
import zlib from "zlib";
import * as cheerio from "cheerio";

import {
  S3Client,
  PutObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";


// ============================================================
// CONFIG
// ============================================================

const R2_ACCOUNT_ID = String(process.env.R2_ACCOUNT_ID || "").trim();
const R2_ACCESS_KEY_ID = String(process.env.R2_ACCESS_KEY_ID || "").trim();
const R2_SECRET_ACCESS_KEY = String(process.env.R2_SECRET_ACCESS_KEY || "").trim();

const R2_BUCKET_NAME =
  String(process.env.R2_BUCKET_NAME || "hexora").trim();

const COMMONCRAWL_COLLECTION =
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
  .map((x) => x.trim())
  .filter(Boolean);

const PAGES_PER_DOMAIN = Math.max(
  1,
  Number(process.env.COMMONCRAWL_PAGES_PER_DOMAIN || 20)
);

const MAX_PAGES = Math.max(
  1,
  Number(process.env.COMMONCRAWL_MAX_PAGES || 200)
);

const TIMEOUT_MS = Math.max(
  10000,
  Number(process.env.COMMONCRAWL_TIMEOUT_MS || 120000)
);

const MAX_RETRIES = Math.max(
  1,
  Number(process.env.COMMONCRAWL_MAX_RETRIES || 4)
);

const MAX_CONTENT = Math.max(
  10000,
  Number(process.env.CRAWL_MAX_CONTENT || 100000)
);

const MAX_LINKS = Math.max(
  10,
  Number(process.env.CRAWL_MAX_LINKS || 100)
);

const USER_AGENT =
  process.env.HEXORA_USER_AGENT ||
  "HEXORA-SearchBot/1.0 (+https://www.hexorasearch.com/)";

// ============================================================
// VALIDATION
// ============================================================

if (
  !R2_ACCOUNT_ID ||
  !R2_ACCESS_KEY_ID ||
  !R2_SECRET_ACCESS_KEY
) {
  throw new Error(
    "[HEXORA] R2 credentials are missing"
  );
}

// ============================================================
// R2
// ============================================================

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
// LOG
// ============================================================

function log(...args) {
  console.log("[HEXORA]", ...args);
}

// ============================================================
// SLEEP
// ============================================================

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// ============================================================
// TIMEOUT FETCH
// ============================================================

async function fetchWithTimeout(
  url,
  options = {},
  timeout = TIMEOUT_MS
) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, timeout);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// FETCH WITH RETRIES
// ============================================================

async function fetchRetry(
  url,
  options = {},
  retries = MAX_RETRIES
) {
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetchWithTimeout(
        url,
        options
      );

      if (response.ok) {
        return response;
      }

      const status = response.status;

      if (
        status !== 408 &&
        status !== 429 &&
        status < 500
      ) {
        throw new Error(
          `HTTP ${status}`
        );
      }

      throw new Error(
        `HTTP ${status}`
      );
    } catch (error) {
      lastError = error;

      log(
        `Request failed: ${url} (attempt ${attempt}/${retries})`
      );

      log(
        `Reason: ${error.message}`
      );

      if (attempt < retries) {
        const delay =
          Math.min(
            30000,
            2000 * Math.pow(2, attempt - 1)
          );

        log(
          `Retry in ${delay}ms...`
        );

        await sleep(delay);
      }
    }
  }

  throw lastError;
}

// ============================================================
// COMMON CRAWL COLLECTION
// ============================================================

async function discoverCollection() {
  if (COMMONCRAWL_COLLECTION) {
    return COMMONCRAWL_COLLECTION;
  }

  log(
    "Discovering Common Crawl collection..."
  );

  const response = await fetchRetry(
    "https://index.commoncrawl.org/collinfo.json",
    {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
    }
  );

  const data = await response.json();

  if (!Array.isArray(data) || !data.length) {
    throw new Error(
      "Common Crawl collection list is empty"
    );
  }

  // First collection is normally newest.
  const collection =
    data[0]?.id ||
    data[0]?.name;

  if (!collection) {
    throw new Error(
      "Could not determine Common Crawl collection"
    );
  }

  return collection;
}

// ============================================================
// COMMON CRAWL INDEX QUERY
// ============================================================

async function queryIndex(
  collection,
  domain
) {
  const indexBase =
    `https://index.commoncrawl.org/${collection}-index`;

  const queries = [
    `https://${domain}/*`,
    `http://${domain}/*`,
    `*.${domain}/*`,
  ];

  let records = [];

  for (const pattern of queries) {
    if (records.length >= PAGES_PER_DOMAIN) {
      break;
    }

    const params = new URLSearchParams();

    params.set("url", pattern);
    params.set("output", "json");
    params.set("filter", "status:200");
    params.append(
      "filter",
      "mime:text/html"
    );
    params.set(
      "collapse",
      "urlkey"
    );
    params.set(
      "pageSize",
      String(
        Math.max(
          PAGES_PER_DOMAIN * 2,
          50
        )
      )
    );

    const url =
      `${indexBase}?${params.toString()}`;

    log(
      `Querying: ${pattern}`
    );

    try {
      const response =
        await fetchRetry(url, {
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "application/json",
          },
        });

      const text =
        await response.text();

      const lines =
        text
          .split(/\r?\n/)
          .map((line) => line.trim())
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
            records.push(record);
          }
        } catch {
          // Ignore malformed index line.
        }
      }
    } catch (error) {
      log(
        `Index query failed: ${error.message}`
      );
    }
  }

  // Remove duplicate URLs.
  const unique = new Map();

  for (const record of records) {
    if (!unique.has(record.url)) {
      unique.set(
        record.url,
        record
      );
    }
  }

  return Array.from(
    unique.values()
  ).slice(
    0,
    PAGES_PER_DOMAIN
  );
}

// ============================================================
// DOWNLOAD WARC RECORD
// ============================================================

async function downloadWarcRecord(
  record
) {
  const start =
    Number(record.offset);

  const length =
    Number(record.length);

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(length) ||
    start < 0 ||
    length <= 0
  ) {
    throw new Error(
      "Invalid WARC range"
    );
  }

  const end =
    start + length - 1;

  const url =
    `https://data.commoncrawl.org/${record.filename}`;

  const response =
    await fetchRetry(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Range: `bytes=${start}-${end}`,
      },
    });

  const buffer =
    Buffer.from(
      await response.arrayBuffer()
    );

  if (!buffer.length) {
    throw new Error(
      "Empty WARC response"
    );
  }

  return buffer;
}

// ============================================================
// GZIP DECOMPRESS
// ============================================================

function decompressWarc(buffer) {
  try {
    return zlib.gunzipSync(buffer);
  } catch {
    return buffer;
  }
}

// ============================================================
// EXTRACT HTTP RESPONSE
// ============================================================

function extractHttpResponse(buffer) {
  const text =
    buffer.toString(
      "latin1"
    );

  let httpStart =
    text.indexOf("HTTP/");

  if (httpStart < 0) {
    httpStart = 0;
  }

  const headerEnd =
    text.indexOf(
      "\r\n\r\n",
      httpStart
    );

  if (headerEnd < 0) {
    return {
      headers: "",
      body: buffer,
    };
  }

  const headersText =
    text.slice(
      httpStart,
      headerEnd
    );

  const bodyStart =
    headerEnd + 4;

  const body =
    buffer.subarray(
      bodyStart
    );

  return {
    headers: headersText,
    body,
  };
}

// ============================================================
// HTTP BODY DECOMPRESSION
// ============================================================

function decodeHttpBody(
  body,
  headersText
) {
  const encodingMatch =
    headersText.match(
      /content-encoding\s*:\s*([^\r\n]+)/i
    );

  if (!encodingMatch) {
    return body;
  }

  const encoding =
    encodingMatch[1]
      .trim()
      .toLowerCase();

  try {
    if (
      encoding.includes("gzip")
    ) {
      return zlib.gunzipSync(
        body
      );
    }

    if (
      encoding.includes("deflate")
    ) {
      return zlib.inflateSync(
        body
      );
    }
  } catch {
    return body;
  }

  return body;
}

// ============================================================
// HTML TEXT NORMALIZER
// ============================================================

function safeString(value) {
  if (
    typeof value === "string"
  ) {
    return value;
  }

  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  try {
    return String(value);
  } catch {
    return "";
  }
}

// ============================================================
// LANGUAGE DETECTION
// ============================================================

function detectLanguage(
  text
) {
  const value =
    safeString(text)
      .slice(0, 30000);

  // Assamese-specific characters FIRST.
  // Assamese and Bengali share Unicode range,
  // so Assamese must be checked before Bengali.
  if (
    /[ৰৱয়ড়ঢ়]/u.test(value)
  ) {
    return "as";
  }

  if (
    /[\u0900-\u097F]/u.test(value)
  ) {
    return "hi";
  }

  if (
    /[\u0980-\u09FF]/u.test(value)
  ) {
    return "bn";
  }

  if (
    /[\u0A00-\u0A7F]/u.test(value)
  ) {
    return "pa";
  }

  if (
    /[\u0B80-\u0BFF]/u.test(value)
  ) {
    return "ta";
  }

  if (
    /[\u0C00-\u0C7F]/u.test(value)
  ) {
    return "te";
  }

  if (
    /[\u0C80-\u0CFF]/u.test(value)
  ) {
    return "kn";
  }

  if (
    /[\u0D00-\u0D7F]/u.test(value)
  ) {
    return "ml";
  }

  if (
    /[\u4E00-\u9FFF]/u.test(value)
  ) {
    return "zh";
  }

  if (
    /[\u3040-\u30FF]/u.test(value)
  ) {
    return "ja";
  }

  if (
    /[\uAC00-\uD7AF]/u.test(value)
  ) {
    return "ko";
  }

  if (
    /[\u0600-\u06FF]/u.test(value)
  ) {
    return "ar";
  }

  if (
    /[\u0400-\u04FF]/u.test(value)
  ) {
    return "ru";
  }

  return "en";
}

// ============================================================
// CLEAN URL
// ============================================================

function normalizeUrl(
  value
) {
  try {
    const url =
      new URL(value);

    url.hash = "";

    return url.toString();
  } catch {
    return value;
  }
}

// ============================================================
// CONTENT HASH
// ============================================================

function sha256(
  value
) {
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("hex");
}

// ============================================================
// R2 KEY
// ============================================================

function makeR2Key(
  url,
  contentHash
) {
  let hostname =
    "unknown";

  try {
    hostname =
      new URL(url).hostname;
  } catch {}

  hostname =
    hostname
      .replace(/[^a-zA-Z0-9.-]/g, "_")
      .toLowerCase();

  return `pages/${hostname}/${contentHash}.html`;
}

// ============================================================
// PARSE HTML
// ============================================================

function parseHtml(
  html,
  sourceUrl
) {
  const $ =
    cheerio.load(
      safeString(html),
      {
        decodeEntities: true,
      }
    );

  $("script").remove();
  $("style").remove();
  $("noscript").remove();
  $("svg").remove();

  // ----------------------------------------------------------
  // TITLE
  // ----------------------------------------------------------

  const titleRaw =
    $("title")
      .first()
      .text();

  const title =
    safeString(titleRaw)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);

  // ----------------------------------------------------------
  // DESCRIPTION
  // ----------------------------------------------------------

  const descriptionRaw =
    $('meta[name="description"]')
      .first()
      .attr("content");

  const ogDescriptionRaw =
    $('meta[property="og:description"]')
      .first()
      .attr("content");

  const description =
    safeString(
      descriptionRaw ||
      ogDescriptionRaw ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1000);

  // ----------------------------------------------------------
  // BODY TEXT
  // ----------------------------------------------------------

  const bodyTextRaw =
    $("body")
      .text();

  // IMPORTANT:
  // Cheerio may return a non-string value in
  // certain overloaded cases. Never directly call
  // .replace() on .text().
  const bodyText =
    safeString(bodyTextRaw);

  const content =
    bodyText
      .replace(/\s+/g, " ")
      .trim()
      .slice(
        0,
        MAX_CONTENT
      );

  // ----------------------------------------------------------
  // LANGUAGE
  // ----------------------------------------------------------

  const language =
    detectLanguage(
      `${title} ${description} ${content}`
    );

  // ----------------------------------------------------------
  // LINKS
  // ----------------------------------------------------------

  const links = [];

  $("a[href]").each(
    (_, element) => {
      if (
        links.length >= MAX_LINKS
      ) {
        return;
      }

      const hrefRaw =
        $(element).attr("href");

      const href =
        safeString(hrefRaw);

      if (!href) {
        return;
      }

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

        links.push(
          absolute.toString()
        );
      } catch {
        // Ignore invalid links.
      }
    }
  );

  return {
    title,
    description,
    content,
    language,
    links,
  };
}

// ============================================================
// R2 UPLOAD
// ============================================================

async function uploadToR2(
  key,
  html
) {
  const body =
    Buffer.from(
      safeString(html),
      "utf8"
    );

  await r2.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType:
        "text/html; charset=utf-8",
      CacheControl:
        "public, max-age=31536000",
    })
  );
}

// ============================================================
// R2 CHECK
// ============================================================

async function checkR2() {
  await r2.send(
    new HeadBucketCommand({
      Bucket: R2_BUCKET_NAME,
    })
  );

  log(
    `R2 bucket check: ${R2_BUCKET_NAME}`
  );
}

async function r2ObjectExists(key) {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
    return true;
  } catch (error) {
    if (error?.name === "NotFound" || error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) return false;
    throw error;
  }
}

async function putR2Json(key, value) {
  await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key, Body: JSON.stringify(value), ContentType: "application/json" }));
}

function indexKeyForUrl(url) {
  let host = "unknown";
  try { host = new URL(url).hostname.toLowerCase(); } catch {}
  return `index/${host}/${sha256(url)}.json`;
}

// ============================================================
// R2-ONLY DEDUPLICATION + SAVE
// ============================================================
async function pageExists(url) {
  return await r2ObjectExists(indexKeyForUrl(url));
}

async function savePage({ url, title, description, content, language, contentHash, r2Key, html }) {
  const host = new URL(url).hostname.toLowerCase();
  const pageKey = `pages/${host}/${sha256(url)}.html`;
  const indexKey = indexKeyForUrl(url);
  if (await r2ObjectExists(indexKey)) return { duplicate: true, r2Key: pageKey };
  await uploadToR2(pageKey, html);
  await putR2Json(indexKey, {
    id: sha256(url), url, canonical_url: url, title: title || "",
    description: description || "", excerpt: String(content || "").slice(0, 1800),
    language: language || "unknown", domain: host, r2_key: pageKey,
    content_hash: contentHash, crawled_at: new Date().toISOString(),
    search_text: `${title || ""} ${description || ""} ${String(content || "").slice(0, 5000)}`.slice(0, 7000)
  });
  return { duplicate: false, r2Key: pageKey };
}

async function queueLinks(links) {
  let inserted = 0;
  for (const raw of links || []) {
    const url = normalizeUrl(raw);
    if (!url || await pageExists(url)) continue;
    const key = `queue/pending/${sha256(url)}.json`;
    if (await r2ObjectExists(key)) continue;
    await putR2Json(key, { url, queued_at: new Date().toISOString(), attempts: 0 });
    inserted++;
  }
  return inserted;
}

// ============================================================
// IMPORT ONE RECORD
// ============================================================

async function importRecord(
  record
) {
  const originalUrl =
    safeString(record.url);

  const url =
    normalizeUrl(
      originalUrl
    );

  log(
    `Processing: ${url}`
  );

  // ----------------------------------------------------------
  // Duplicate URL check
  // ----------------------------------------------------------

  const existing =
    await pageExists(url);

  if (existing) {
    log(
      `Already indexed: ${url}`
    );

    return {
      status: "duplicate",
    };
  }

  // ----------------------------------------------------------
  // Download WARC
  // ----------------------------------------------------------

  const compressed =
    await downloadWarcRecord(
      record
    );

  // ----------------------------------------------------------
  // Decompress WARC
  // ----------------------------------------------------------

  const warc =
    decompressWarc(
      compressed
    );

  // ----------------------------------------------------------
  // Extract HTTP
  // ----------------------------------------------------------

  const httpResponse =
    extractHttpResponse(
      warc
    );

  const decodedBody =
    decodeHttpBody(
      httpResponse.body,
      httpResponse.headers
    );

  const html =
    decodedBody.toString(
      "utf8"
    );

  if (
    !html ||
    html.length < 50
  ) {
    throw new Error(
      "HTML body is empty or too small"
    );
  }

  // ----------------------------------------------------------
  // Parse HTML
  // ----------------------------------------------------------

  const parsed =
    parseHtml(
      html,
      url
    );

  if (
    !parsed.title &&
    !parsed.content
  ) {
    throw new Error(
      "No useful HTML content found"
    );
  }

  // ----------------------------------------------------------
  // HASH
  // ----------------------------------------------------------

  const contentHash =
    sha256(html);

  // URL duplicates are checked against the R2 search index before download.

  // ----------------------------------------------------------
  // R2 KEY
  // ----------------------------------------------------------

  const host = new URL(url).hostname.toLowerCase();
  const r2Key = `pages/${host}/${sha256(url)}.html`;

  // ----------------------------------------------------------
  // SAVE PAGE + SEARCH METADATA TO R2 ONLY
  // ----------------------------------------------------------
  const saved = await savePage({
    url, title: parsed.title, description: parsed.description,
    content: parsed.content, language: parsed.language,
    contentHash, r2Key, html,
  });
  if (saved.duplicate) {
    log(`Duplicate URL skipped: ${url}`);
    return { status: "duplicate", url };
  }
  log(`R2 saved page and search index: ${url}`);

  // ----------------------------------------------------------
  // DISCOVER LINKS
  // ----------------------------------------------------------

  const queued =
    await queueLinks(
      parsed.links
    );

  log(
    `Links discovered: ${parsed.links.length}, queue attempted: ${queued || 0}`
  );

  return {
    status: "imported",
    url,
    language: parsed.language,
    r2Key,
  };
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  log(
    "=================================================="
  );

  log(
    "HEXORA COMMON CRAWL IMPORTER"
  );

  log(
    "=================================================="
  );

  log(
    `R2 bucket: ${R2_BUCKET_NAME}`
  );

  log(
    `Pages/domain: ${PAGES_PER_DOMAIN}`
  );

  log(
    `Maximum pages: ${MAX_PAGES}`
  );

  log(
    `Timeout: ${TIMEOUT_MS}ms`
  );

  log(
    `Max retries: ${MAX_RETRIES}`
  );

  log(
    `Target domains: ${TARGET_DOMAINS.join(",")}`
  );

  // ----------------------------------------------------------
  // R2 TEST
  // ----------------------------------------------------------

  await checkR2();

  // ----------------------------------------------------------
  // COLLECTION
  // ----------------------------------------------------------

  const collection =
    await discoverCollection();

  log(
    `Using collection: ${collection}`
  );

  log(
    `Index URL: https://index.commoncrawl.org/${collection}-index`
  );

  // ----------------------------------------------------------
  // STATS
  // ----------------------------------------------------------

  let processed = 0;
  let imported = 0;
  let duplicates = 0;
  let duplicateContent = 0;
  let failed = 0;

  // ----------------------------------------------------------
  // DOMAIN LOOP
  // ----------------------------------------------------------

  for (
    const domain of TARGET_DOMAINS
  ) {
    if (
      processed >= MAX_PAGES
    ) {
      break;
    }

    log(
      `DOMAIN: ${domain}`
    );

    let records = [];

    try {
      records =
        await queryIndex(
          collection,
          domain
        );

      log(
        `Found ${records.length} records for ${domain}`
      );
    } catch (error) {
      log(
        `Index ${domain} failed: ${error.message}`
      );

      continue;
    }

    // --------------------------------------------------------
    // RECORD LOOP
    // --------------------------------------------------------

    for (
      const record of records
    ) {
      if (
        processed >= MAX_PAGES
      ) {
        break;
      }

      processed++;

      try {
        const result =
          await importRecord(
            record
          );

        if (
          result.status ===
          "imported"
        ) {
          imported++;
        } else if (
          result.status ===
          "duplicate"
        ) {
          duplicates++;
        } else if (
          result.status ===
          "duplicate-content"
        ) {
          duplicateContent++;
        }
      } catch (error) {
        failed++;

        log(
          `Import failed: ${record.url}`
        );

        log(
          `Reason: ${error.message}`
        );
      }

      // Small delay so the service does not
      // hammer Common Crawl and R2.
      await sleep(250);
    }
  }

  // ----------------------------------------------------------
  // FINAL STATS
  // ----------------------------------------------------------

  log(
    "=================================================="
  );

  log(
    "COMMON CRAWL IMPORT COMPLETE"
  );

  log(
    `Processed: ${processed}`
  );

  log(
    `Imported: ${imported}`
  );

  log(
    `Duplicate URLs: ${duplicates}`
  );

  log(
    `Duplicate content: ${duplicateContent}`
  );

  log(
    `Failed: ${failed}`
  );

  log(
    `R2 bucket: ${R2_BUCKET_NAME}`
  );

  log(
    `Storage: R2 only (no Neon writes)`
  );

  log(
    "=================================================="
  );

}

// ============================================================
// ERROR HANDLER
// ============================================================

main()
  .catch(async (error) => {
    console.error(
      "[HEXORA] Common Crawl importer fatal error:",
      error
    );

    try {
        } catch {}

    process.exit(1);
  });
