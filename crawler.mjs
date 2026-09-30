```javascript
// ============================================================
// HEXORA SEARCH ENGINE - CRAWLER
// Neon PostgreSQL + Cloudflare R2
// Supabase is NOT used by the crawler
// ============================================================

import crypto from "crypto";
import * as cheerio from "cheerio";
import pg from "pg";
import {
  S3Client,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

const { Pool } = pg;

// ============================================================
// CONFIG
// ============================================================

const DATABASE_URL = process.env.DATABASE_URL || "";

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "";
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";
const R2_SECRET_ACCESS_KEY =
  process.env.R2_SECRET_ACCESS_KEY || "";
const R2_BUCKET_NAME =
  process.env.R2_BUCKET_NAME || "hexoraase";

const USER_AGENT =
  process.env.HEXORA_USER_AGENT ||
  "HEXORA-Bot/1.0 (+https://hexorasearch.com/)";

const REQUEST_TIMEOUT =
  Number(process.env.CRAWL_TIMEOUT_MS || 15000);

const DOMAIN_DELAY =
  Number(process.env.CRAWL_DOMAIN_DELAY_MS || 1500);

const MAX_CONTENT =
  Number(process.env.CRAWL_MAX_CONTENT || 100000);

const MAX_LINKS =
  Number(process.env.CRAWL_MAX_LINKS || 100);

const DEFAULT_BATCH =
  Number(process.env.CRAWLER_BATCH_SIZE || 12);

// ============================================================
// SEED URLS
// ============================================================

const SEED_URLS = [
  "https://en.wikipedia.org/wiki/Search_engine",
  "https://www.india.gov.in/",
  "https://assam.gov.in/",
  "https://www.python.org/",
  "https://www.w3.org/",
];

// ============================================================
// NEON
// ============================================================

if (!DATABASE_URL) {
  console.error(
    "[HEXORA] DATABASE_URL is missing"
  );
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// ============================================================
// R2
// ============================================================

let r2 = null;

if (
  R2_ACCOUNT_ID &&
  R2_ACCESS_KEY_ID &&
  R2_SECRET_ACCESS_KEY &&
  R2_BUCKET_NAME
) {
  r2 = new S3Client({
    region: "auto",
    endpoint:
      "https://" +
      R2_ACCOUNT_ID +
      ".r2.cloudflarestorage.com",
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });

  console.log(
    "[HEXORA] R2 configured | bucket=" +
      R2_BUCKET_NAME
  );
} else {
  console.warn(
    "[HEXORA] R2 variables are incomplete"
  );
}

// ============================================================
// MEMORY
// ============================================================

const domainLastRequest = new Map();
const robotsCache = new Map();

// ============================================================
// BASIC HELPERS
// ============================================================

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(String(value))
    .digest("hex");
}

function normalizeUrl(input) {
  try {
    const url = new URL(input);

    url.hash = "";

    url.hostname = url.hostname.toLowerCase();

    if (
      (url.protocol === "https:" && url.port === "443") ||
      (url.protocol === "http:" && url.port === "80")
    ) {
      url.port = "";
    }

    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }

    return url.toString();
  } catch {
    return null;
  }
}

function getDomain(input) {
  try {
    return new URL(input).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isValidHttpUrl(input) {
  try {
    const url = new URL(input);

    if (
      url.protocol !== "http:" &&
      url.protocol !== "https:"
    ) {
      return false;
    }

    if (!url.hostname) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function detectLanguage(text) {
  const value = String(text || "");

  if (/[\u0980-\u09FF]/.test(value)) {
    return "bn";
  }

  if (/[\u0A00-\u0A7F]/.test(value)) {
    return "pa";
  }

  if (/[\u0900-\u097F]/.test(value)) {
    return "hi";
  }

  if (/[\u0B80-\u0BFF]/.test(value)) {
    return "ta";
  }

  if (/[\u0C00-\u0C7F]/.test(value)) {
    return "te";
  }

  if (/[\u0C80-\u0CFF]/.test(value)) {
    return "kn";
  }

  if (/[\u0D00-\u0D7F]/.test(value)) {
    return "ml";
  }

  if (/[\u0A80-\u0AFF]/.test(value)) {
    return "gu";
  }

  if (/[\u0B00-\u0B7F]/.test(value)) {
    return "or";
  }

  if (/[\u0D80-\u0DFF]/.test(value)) {
    return "si";
  }

  return "en";
}

// ============================================================
// ROBOTS.TXT
// ============================================================

async function getRobots(domain) {
  if (robotsCache.has(domain)) {
    return robotsCache.get(domain);
  }

  const robotsUrl = "https://" + domain + "/robots.txt";

  try {
    const controller = new AbortController();

    const timer = setTimeout(function () {
      controller.abort();
    }, 10000);

    const response = await fetch(robotsUrl, {
      method: "GET",
      headers: {
        "user-agent": USER_AGENT,
      },
      signal: controller.signal,
      redirect: "follow",
    });

    clearTimeout(timer);

    if (!response.ok) {
      const result = {
        available: false,
        text: "",
      };

      robotsCache.set(domain, result);
      return result;
    }

    const text = await response.text();

    const result = {
      available: true,
      text: text,
    };

    robotsCache.set(domain, result);

    return result;
  } catch {
    const result = {
      available: false,
      text: "",
    };

    robotsCache.set(domain, result);

    return result;
  }
}

function robotsAllows(robotsText, targetUrl) {
  if (!robotsText) {
    return true;
  }

  const lines = robotsText.split(/\r?\n/);

  let applies = false;
  let disallow = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const parts = line.split(":");

    if (parts.length < 2) {
      continue;
    }

    const key = parts[0]
      .trim()
      .toLowerCase();

    const value = parts
      .slice(1)
      .join(":")
      .trim();

    if (key === "user-agent") {
      applies =
        value === "*" ||
        value.toLowerCase().includes("hexora");
      continue;
    }

    if (applies && key === "disallow") {
      disallow.push(value);
    }
  }

  let pathname = "/";

  try {
    pathname = new URL(targetUrl).pathname || "/";
  } catch {
    return true;
  }

  for (let i = 0; i < disallow.length; i++) {
    const rule = disallow[i];

    if (!rule) {
      continue;
    }

    if (pathname.startsWith(rule)) {
      return false;
    }
  }

  return true;
}

async function allowedByRobots(url) {
  const domain = getDomain(url);

  if (!domain) {
    return false;
  }

  const robots = await getRobots(domain);

  if (!robots.available) {
    return true;
  }

  return robotsAllows(robots.text, url);
}

// ============================================================
// DOMAIN DELAY
// ============================================================

async function respectDomainDelay(url) {
  const domain = getDomain(url);

  if (!domain) {
    return;
  }

  const now = Date.now();
  const previous = domainLastRequest.get(domain) || 0;

  const wait =
    DOMAIN_DELAY - (now - previous);

  if (wait > 0) {
    await sleep(wait);
  }

  domainLastRequest.set(
    domain,
    Date.now()
  );
}

// ============================================================
// FETCH PAGE
// ============================================================

async function fetchPage(url) {
  await respectDomainDelay(url);

  const controller = new AbortController();

  const timer = setTimeout(function () {
    controller.abort();
  }, REQUEST_TIMEOUT);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "user-agent": USER_AGENT,
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
      redirect: "follow",
    });

    clearTimeout(timer);

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        finalUrl: url,
        html: "",
        contentType: "",
      };
    }

    const contentType =
      response.headers.get("content-type") || "";

    if (
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml")
    ) {
      return {
        ok: false,
        status: response.status,
        finalUrl: url,
        html: "",
        contentType: contentType,
      };
    }

    const html = await response.text();

    return {
      ok: true,
      status: response.status,
      finalUrl:
        response.url || url,
      html: html,
      contentType: contentType,
    };
  } catch (error) {
    clearTimeout(timer);

    return {
      ok: false,
      status: 0,
      finalUrl: url,
      html: "",
      contentType: "",
      error: error?.message || String(error),
    };
  }
}

// ============================================================
// EXTRACT HTML
// ============================================================

function extractPage(html, pageUrl) {
  const $ = cheerio.load(html);

  $(
    "script, style, noscript, iframe, svg, canvas, form"
  ).remove();

  const title =
    $("title").first().text().trim() ||
    $("h1").first().text().trim() ||
    "";

  let description =
    $('meta[name="description"]')
      .attr("content") ||
    "";

  if (!description) {
    description =
      $('meta[property="og:description"]')
        .attr("content") ||
      "";
  }

  const bodyText = $("body")
    .text(" ")
    .replace(/\s+/g, " ")
    .trim();

  const content = bodyText.slice(
    0,
    MAX_CONTENT
  );

  const links = [];

  $("a[href]").each(function () {
    if (links.length >= MAX_LINKS) {
      return;
    }

    const href = $(this).attr("href");

    if (!href) {
      return;
    }

    try {
      const absolute =
        new URL(href, pageUrl).toString();

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
  });

  const uniqueLinks = [
    ...new Set(links),
  ];

  return {
    title: title.slice(0, 1000),
    description:
      description.slice(0, 3000),
    content: content,
    language: detectLanguage(
      title + " " + content
    ),
    links: uniqueLinks,
  };
}

// ============================================================
// NEON CHECK
// ============================================================

async function checkNeon() {
  try {
    await pool.query("SELECT 1");
    console.log(
      "[HEXORA] Neon: CONNECTED"
    );
    return true;
  } catch (error) {
    console.error(
      "[HEXORA] Neon connection failed:",
      error?.message || error
    );

    return false;
  }
}

// ============================================================
// R2 CHECK
// ============================================================

async function checkR2() {
  if (!r2) {
    return false;
  }

  try {
    // A small harmless object is not created here.
    // The real R2 test happens during page upload.
    console.log(
      "[HEXORA] R2: READY | bucket=" +
        R2_BUCKET_NAME
    );

    return true;
  } catch (error) {
    console.error(
      "[HEXORA] R2 check failed:",
      error?.message || error
    );

    return false;
  }
}

// ============================================================
// DUPLICATE CHECK - NEON ONLY
// ============================================================

async function pageExistsByUrl(url) {
  try {
    const result = await pool.query(
      "SELECT 1 FROM pages WHERE url = $1 LIMIT 1",
      [url]
    );

    return result.rowCount > 0;
  } catch (error) {
    console.error(
      "[HEXORA] URL duplicate check failed:",
      error?.message || error
    );

    return false;
  }
}

async function pageExistsByHash(contentHash) {
  if (!contentHash) {
    return false;
  }

  try {
    const result = await pool.query(
      "SELECT 1 FROM pages WHERE content_hash = $1 LIMIT 1",
      [contentHash]
    );

    return result.rowCount > 0;
  } catch (error) {
    console.warn(
      "[HEXORA] Content hash check unavailable:",
      error?.message || error
    );

    return false;
  }
}

// ============================================================
// R2 RAW PAGE STORAGE
// ============================================================

async function saveRawToR2(
  url,
  title,
  description,
  content,
  language,
  contentHash
) {
  if (!r2) {
    return null;
  }

  const objectId = sha256(url);

  const key =
    "pages/" +
    objectId +
    ".json";

  const data = JSON.stringify(
    {
      url: url,
      title: title,
      description: description,
      content: content,
      language: language,
      content_hash: contentHash,
      crawled_at:
        new Date().toISOString(),
    }
  );

  await r2.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: data,
      ContentType:
        "application/json; charset=utf-8",
    })
  );

  console.log(
    "[HEXORA] RAW -> R2 | " + url
  );

  return key;
}

// ============================================================
// SAVE INDEX TO NEON
// ============================================================

async function savePageToNeon(page) {
  const contentHash = sha256(
    page.content
  );

  const existsByUrl =
    await pageExistsByUrl(page.url);

  if (existsByUrl) {
    console.log(
      "[HEXORA] Duplicate URL skipped | " +
        page.url
    );

    return {
      saved: false,
      reason: "url",
      contentHash: contentHash,
    };
  }

  const existsByHash =
    await pageExistsByHash(contentHash);

  if (existsByHash) {
    console.log(
      "[HEXORA] Duplicate content skipped | " +
        page.url
    );

    return {
      saved: false,
      reason: "content",
      contentHash: contentHash,
    };
  }

  const wordCount =
    page.content
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
        NOW()
      )
      ON CONFLICT (url) DO NOTHING
    `,
    [
      page.url,
      page.title,
      page.description,
      page.content,
      contentHash,
      wordCount,
      page.language,
    ]
  );

  console.log(
    "[HEXORA] NEW INDEX -> NEON | " +
      page.url
  );

  return {
    saved: true,
    reason: "new",
    contentHash: contentHash,
  };
}

// ============================================================
// QUEUE LINK
// ============================================================

async function queueLink(url) {
  const normalized =
    normalizeUrl(url);

  if (!normalized) {
    return false;
  }

  if (!isValidHttpUrl(normalized)) {
    return false;
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
          'queued',
          NOW()
        )
        ON CONFLICT (url) DO NOTHING
      `,
      [normalized]
    );

    return true;
  } catch (error) {
    console.error(
      "[HEXORA] Queue insert failed:",
      normalized,
      error?.message || error
    );

    return false;
  }
}

async function queueLinks(urls) {
  for (let i = 0; i < urls.length; i++) {
    await queueLink(urls[i]);
  }
}

// ============================================================
// SEED QUEUE
// ============================================================

async function seedQueue() {
  for (let i = 0; i < SEED_URLS.length; i++) {
    await queueLink(SEED_URLS[i]);
  }

  console.log(
    "[HEXORA] Seed queue ready"
  );
}

// ============================================================
// RECOVER QUEUE
// ============================================================

async function normalizeOldQueueStatuses() {
  try {
    await pool.query(
      `
        UPDATE crawl_queue
        SET status = 'queued'
        WHERE status = 'processing'
      `
    );

    console.log(
      "[HEXORA] Queue recovery completed"
    );
  } catch (error) {
    console.error(
      "[HEXORA] Queue recovery failed:",
      error?.message || error
    );
  }
}

// ============================================================
// GET QUEUE BATCH
// ============================================================

async function getQueueBatch(limit) {
  const result = await pool.query(
    `
      SELECT id, url
      FROM crawl_queue
      WHERE status = 'queued'
      ORDER BY created_at ASC
      LIMIT $1
    `,
    [limit]
  );

  return result.rows;
}

// ============================================================
// CLAIM URL
// ============================================================

async function claimUrl(id) {
  const result = await pool.query(
    `
      UPDATE crawl_queue
      SET status = 'processing'
      WHERE id = $1
        AND status = 'queued'
      RETURNING id, url
    `,
    [id]
  );

  return result.rows[0] || null;
}

// ============================================================
// MARK QUEUE STATUS
// ============================================================

async function markQueueSuccess(id) {
  try {
    await pool.query(
      `
        UPDATE crawl_queue
        SET
          status = 'done',
          last_crawled_at = NOW(),
          last_error = NULL
        WHERE id = $1
      `,
      [id]
    );
  } catch (error) {
    console.error(
      "[HEXORA] Queue success update failed:",
      error?.message || error
    );
  }
}

async function markQueueFailed(
  id,
  errorMessage
) {
  try {
    await pool.query(
      `
        UPDATE crawl_queue
        SET
          status = 'failed',
          last_error = $2
        WHERE id = $1
      `,
      [
        id,
        String(errorMessage || "Unknown error")
          .slice(0, 2000),
      ]
    );
  } catch (error) {
    console.error(
      "[HEXORA] Queue failure update failed:",
      error?.message || error
    );
  }
}

// ============================================================
// CRAWL ONE URL
// ============================================================

async function crawlOne(item) {
  const claimed =
    await claimUrl(item.id);

  if (!claimed) {
    return {
      processed: false,
      successful: false,
    };
  }

  const url = claimed.url;

  try {
    console.log(
      "[HEXORA] Crawling | " + url
    );

    const allowed =
      await allowedByRobots(url);

    if (!allowed) {
      console.log(
        "[HEXORA] robots.txt blocked | " +
          url
      );

      await markQueueSuccess(
        claimed.id
      );

      return {
        processed: true,
        successful: false,
        blocked: true,
      };
    }

    const result =
      await fetchPage(url);

    if (!result.ok) {
      const message =
        result.error ||
        "HTTP " + result.status;

      console.log(
        "[HEXORA] Fetch failed | " +
          url +
          " | " +
          message
      );

      await markQueueFailed(
        claimed.id,
        message
      );

      return {
        processed: true,
        successful: false,
      };
    }

    const finalUrl =
      normalizeUrl(result.finalUrl) ||
      url;

    const extracted =
      extractPage(
        result.html,
        finalUrl
      );

    if (
      !extracted.content ||
      extracted.content.length < 30
    ) {
      await markQueueFailed(
        claimed.id,
        "No useful page content"
      );

      return {
        processed: true,
        successful: false,
      };
    }

    // Queue discovered links first.
    await queueLinks(
      extracted.links
    );

    const contentHash =
      sha256(extracted.content);

    // Store raw page in R2.
    try {
      await saveRawToR2(
        finalUrl,
        extracted.title,
        extracted.description,
        extracted.content,
        extracted.language,
        contentHash
      );
    } catch (error) {
      console.error(
        "[HEXORA] R2 upload failed:",
        finalUrl,
        error?.message || error
      );
    }

    // Store searchable index in Neon.
    const saved =
      await savePageToNeon({
        url: finalUrl,
        title: extracted.title,
        description:
          extracted.description,
        content: extracted.content,
        language: extracted.language,
      });

    await markQueueSuccess(
      claimed.id
    );

    return {
      processed: true,
      successful: saved.saved,
      duplicate:
        !saved.saved,
    };
  } catch (error) {
    console.error(
      "[HEXORA] Crawl failed | " +
        url +
        " | " +
        (error?.message || error)
    );

    await markQueueFailed(
      claimed.id,
      error?.message || String(error)
    );

    return {
      processed: true,
      successful: false,
    };
  }
}

// ============================================================
// CRAWL BATCH
// ============================================================

async function crawlBatch(
  batchSize = DEFAULT_BATCH
) {
  const items =
    await getQueueBatch(batchSize);

  if (!items.length) {
    return {
      processed: 0,
      successful: 0,
      failed: 0,
    };
  }

  console.log(
    "[HEXORA] Processing " +
      items.length +
      " URLs"
  );

  let processed = 0;
  let successful = 0;
  let failed = 0;

  const concurrency = Math.min(
    4,
    items.length
  );

  let index = 0;

  async function worker() {
    while (true) {
      const current =
        items[index++];

      if (!current) {
        break;
      }

      const result =
        await crawlOne(current);

      if (result.processed) {
        processed++;
      }

      if (result.successful) {
        successful++;
      } else if (
        result.processed &&
        !result.blocked
      ) {
        failed++;
      }
    }
  }

  const workers = [];

  for (
    let i = 0;
    i < concurrency;
    i++
  ) {
    workers.push(worker());
  }

  await Promise.all(workers);

  console.log(
    "[HEXORA] crawl cycle | processed: " +
      processed +
      " | successful: " +
      successful +
      " | failed: " +
      failed
  );

  return {
    processed: processed,
    successful: successful,
    failed: failed,
  };
}

// ============================================================
// FULL CRAWLER LOOP
// ============================================================

async function runCrawler() {
  const neonOk =
    await checkNeon();

  if (!neonOk) {
    throw new Error(
      "Neon database unavailable"
    );
  }

  await checkR2();

  await normalizeOldQueueStatuses();

  await seedQueue();

  while (true) {
    const result =
      await crawlBatch(
        DEFAULT_BATCH
      );

    if (!result.processed) {
      await sleep(5000);
    }
  }
}

// ============================================================
// EXPORTS
// ============================================================

export {
  runCrawler,
  crawlBatch,
  normalizeOldQueueStatuses,
  seedQueue,
  crawlOne,
};

// ============================================================
// IMPORTANT:
// worker/worker.mjs starts the crawler.
// This file does NOT auto-start.
// ============================================================
```
