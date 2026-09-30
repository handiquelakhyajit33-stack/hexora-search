```javascript
// ============================================================
// HEXORA SEARCH ENGINE - CRAWLER
// Neon + Cloudflare R2
// Supabase is NOT used for new crawl data
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

const DATABASE_URL = process.env.DATABASE_URL;

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

const MAX_QUEUE_BATCH =
  Number(process.env.CRAWL_BATCH_SIZE || 12);

// ============================================================
// NEON DATABASE
// ============================================================

if (!DATABASE_URL) {
  throw new Error("[HEXORA] DATABASE_URL is missing");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

async function checkNeon() {
  const result = await pool.query("SELECT 1 AS ok");

  if (result.rows?.[0]?.ok !== 1) {
    throw new Error("Neon database check failed");
  }

  console.log("[HEXORA] Neon: CONNECTED");
}

// ============================================================
// CLOUDFLARE R2
// ============================================================

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY =
  process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;

let r2 = null;

if (
  R2_ACCOUNT_ID &&
  R2_ACCESS_KEY_ID &&
  R2_SECRET_ACCESS_KEY &&
  R2_BUCKET_NAME
) {
  r2 = new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });

  console.log(
    `[HEXORA] R2: CONNECTED | bucket=${R2_BUCKET_NAME}`
  );
} else {
  console.error(
    "[HEXORA] R2 configuration missing"
  );
}

// ============================================================
// SEED URLS
// ============================================================

const SEED_URLS = [
  "https://en.wikipedia.org/wiki/Search_engine",
  "https://www.india.gov.in/",
  "https://assam.gov.in/",
  "https://python.org/",
  "https://www.w3.org/",
];

// ============================================================
// MEMORY
// ============================================================

const domainLastRequest = new Map();

const robotsCache = new Map();

// ============================================================
// URL NORMALIZATION
// ============================================================

function normalizeUrl(input) {
  try {
    const url = new URL(input);

    if (
      url.protocol !== "http:" &&
      url.protocol !== "https:"
    ) {
      return null;
    }

    url.hash = "";

    url.hostname = url.hostname.toLowerCase();

    if (
      (url.protocol === "https:" && url.port === "443") ||
      (url.protocol === "http:" && url.port === "80")
    ) {
      url.port = "";
    }

    // Remove common tracking parameters
    const trackingParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid",
      "dclid",
      "msclkid",
      "ref",
    ];

    for (const param of trackingParams) {
      url.searchParams.delete(param);
    }

    return url.toString();
  } catch {
    return null;
  }
}

// ============================================================
// DOMAIN
// ============================================================

function getDomain(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

// ============================================================
// URL VALIDATION
// ============================================================

function isValidUrl(url) {
  try {
    const parsed = new URL(url);

    if (
      parsed.protocol !== "http:" &&
      parsed.protocol !== "https:"
    ) {
      return false;
    }

    const blockedExtensions = [
      ".jpg",
      ".jpeg",
      ".png",
      ".gif",
      ".webp",
      ".svg",
      ".ico",
      ".mp4",
      ".mp3",
      ".avi",
      ".mov",
      ".zip",
      ".rar",
      ".7z",
      ".pdf",
      ".doc",
      ".docx",
      ".xls",
      ".xlsx",
      ".ppt",
      ".pptx",
    ];

    const pathname = parsed.pathname.toLowerCase();

    if (
      blockedExtensions.some((ext) =>
        pathname.endsWith(ext)
      )
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

// ============================================================
// LANGUAGE DETECTION
// ============================================================

function detectLanguage(text = "") {
  if (/[\u0C00-\u0C7F]/.test(text)) {
    return "assamese";
  }

  if (/[\u0900-\u097F]/.test(text)) {
    return "hindi";
  }

  if (/[a-zA-Z]/.test(text)) {
    return "english";
  }

  return "unknown";
}

// ============================================================
// TEXT CLEANING
// ============================================================

function cleanText(text = "") {
  return text
    .replace(/\s+/g, " ")
    .replace(/\u00a0/g, " ")
    .trim();
}

// ============================================================
// HTML EXTRACTION
// ============================================================

function extractPage(html, url) {
  const $ = cheerio.load(html);

  $(
    "script, style, noscript, iframe, svg, canvas, nav, footer, form"
  ).remove();

  const title =
    cleanText($("title").first().text()) ||
    cleanText($("h1").first().text()) ||
    url;

  let description = "";

  const metaDescription = $(
    'meta[name="description"]'
  ).attr("content");

  if (metaDescription) {
    description = cleanText(metaDescription);
  }

  if (!description) {
    description = cleanText(
      $("p").first().text()
    );
  }

  const content = cleanText(
    $("body").text()
  ).slice(0, MAX_CONTENT);

  const language = detectLanguage(
    `${title} ${description} ${content}`
  );

  return {
    title,
    description: description.slice(0, 1000),
    content,
    language,
  };
}

// ============================================================
// LINK EXTRACTION
// ============================================================

function extractLinks(html, baseUrl) {
  const $ = cheerio.load(html);

  const links = [];
  const seen = new Set();

  $("a[href]").each((_, element) => {
    if (links.length >= MAX_LINKS) {
      return false;
    }

    const href = $(element).attr("href");

    if (!href) {
      return;
    }

    try {
      const absolute = new URL(
        href,
        baseUrl
      ).toString();

      const normalized = normalizeUrl(
        absolute
      );

      if (
        !normalized ||
        !isValidUrl(normalized) ||
        seen.has(normalized)
      ) {
        return;
      }

      seen.add(normalized);
      links.push(normalized);
    } catch {
      // Ignore invalid URLs
    }
  });

  return links;
}

// ============================================================
// FETCH HTML
// ============================================================

async function fetchPage(url) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml",
        "Accept-Language":
          "en-US,en;q=0.9,as;q=0.8,hi;q=0.7",
      },
    });

    const finalUrl =
      normalizeUrl(response.url) || url;

    const contentType =
      response.headers.get("content-type") || "";

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        finalUrl,
        error: `HTTP ${response.status}`,
      };
    }

    if (
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml")
    ) {
      return {
        ok: false,
        status: response.status,
        finalUrl,
        error: "Not HTML",
      };
    }

    const html = await response.text();

    if (!html || html.length < 20) {
      return {
        ok: false,
        status: response.status,
        finalUrl,
        error: "Empty HTML",
      };
    }

    return {
      ok: true,
      status: response.status,
      finalUrl,
      html,
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================
// DOMAIN DELAY
// ============================================================

async function respectDomainDelay(url) {
  const domain = getDomain(url);

  if (!domain) {
    return;
  }

  const last =
    domainLastRequest.get(domain) || 0;

  const elapsed =
    Date.now() - last;

  const wait =
    DOMAIN_DELAY - elapsed;

  if (wait > 0) {
    await new Promise((resolve) =>
      setTimeout(resolve, wait)
    );
  }

  domainLastRequest.set(
    domain,
    Date.now()
  );
}

// ============================================================
// ROBOTS.TXT
// ============================================================

function parseRobots(text = "") {
  const lines = text.split(/\r?\n/);

  let applies = false;
  let disallow = [];

  for (const rawLine of lines) {
    const line = rawLine
      .split("#")[0]
      .trim();

    if (!line) {
      continue;
    }

    const separator =
      line.indexOf(":");

    if (separator === -1) {
      continue;
    }

    const key = line
      .slice(0, separator)
      .trim()
      .toLowerCase();

    const value = line
      .slice(separator + 1)
      .trim();

    if (key === "user-agent") {
      applies =
        value === "*" ||
        value.toLowerCase() === "hexora-bot";
      continue;
    }

    if (
      applies &&
      key === "disallow" &&
      value
    ) {
      disallow.push(value);
    }
  }

  return disallow;
}

async function robotsAllows(url) {
  try {
    const parsed = new URL(url);

    const robotsUrl =
      `${parsed.protocol}//${parsed.host}/robots.txt`;

    const cacheKey = robotsUrl;

    let rules =
      robotsCache.get(cacheKey);

    if (!rules) {
      const controller =
        new AbortController();

      const timeout = setTimeout(
        () => controller.abort(),
        10000
      );

      try {
        const response = await fetch(
          robotsUrl,
          {
            headers: {
              "User-Agent": USER_AGENT,
            },
            signal: controller.signal,
          }
        );

        if (!response.ok) {
          rules = [];
        } else {
          const text =
            await response.text();

          rules = parseRobots(text);
        }

        robotsCache.set(
          cacheKey,
          rules
        );
      } finally {
        clearTimeout(timeout);
      }
    }

    const pathname =
      parsed.pathname || "/";

    for (const rule of rules) {
      if (
        pathname.startsWith(rule)
      ) {
        return false;
      }
    }

    return true;
  } catch {
    return true;
  }
}

// ============================================================
// HASH
// ============================================================

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("hex");
}

// ============================================================
// NEON: PAGE DUPLICATE CHECK
// ============================================================

async function pageExistsByUrl(url) {
  const result = await pool.query(
    `
      SELECT id
      FROM pages
      WHERE url = $1
      LIMIT 1
    `,
    [url]
  );

  return result.rows.length > 0;
}

async function pageExistsByContentHash(
  contentHash
) {
  try {
    const result = await pool.query(
      `
        SELECT id
        FROM pages
        WHERE content_hash = $1
        LIMIT 1
      `,
      [contentHash]
    );

    return result.rows.length > 0;
  } catch (error) {
    // If old Neon schema does not have content_hash,
    // URL duplicate protection still works.
    if (
      String(error?.message || "")
        .toLowerCase()
        .includes("content_hash")
    ) {
      console.warn(
        "[HEXORA] content_hash column not available; using URL dedupe"
      );

      return false;
    }

    throw error;
  }
}

// ============================================================
// R2 SAVE
// ============================================================

async function saveRawToR2({
  url,
  finalUrl,
  title,
  description,
  content,
  language,
  contentHash,
}) {
  if (!r2) {
    throw new Error(
      "R2 is not configured"
    );
  }

  const urlHash = sha256(url);

  const key =
    `pages/${urlHash}.json`;

  const payload = {
    engine: "HEXORA",
    version: "6.0",
    url,
    finalUrl,
    title,
    description,
    content,
    language,
    contentHash,
    crawledAt:
      new Date().toISOString(),
  };

  await r2.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: JSON.stringify(
        payload
      ),
      ContentType:
        "application/json; charset=utf-8",
    })
  );

  console.log(
    `[HEXORA] RAW -> R2 | ${url}`
  );

  return key;
}

// ============================================================
// SAVE SEARCHABLE PAGE TO NEON
// ============================================================

async function savePage({
  url,
  finalUrl,
  title,
  description,
  content,
  language,
}) {
  const contentHash =
    sha256(content);

  // URL duplicate
  if (
    await pageExistsByUrl(url)
  ) {
    console.log(
      `[HEXORA] Duplicate URL skipped | ${url}`
    );

    return {
      saved: false,
      duplicate: true,
      reason: "url",
    };
  }

  // Content duplicate
  if (
    await pageExistsByContentHash(
      contentHash
    )
  ) {
    console.log(
      `[HEXORA] Duplicate content skipped | ${url}`
    );

    return {
      saved: false,
      duplicate: true,
      reason: "content",
    };
  }

  // Save raw page to R2 first
  const r2Key =
    await saveRawToR2({
      url,
      finalUrl,
      title,
      description,
      content,
      language,
      contentHash,
    });

  // Save searchable data to Neon
  try {
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
        ON CONFLICT (url)
        DO NOTHING
      `,
      [
        url,
        title,
        description,
        content,
        contentHash,
        content
          .split(/\s+/)
          .filter(Boolean)
          .length,
        language,
      ]
    );

    console.log(
      `[HEXORA] NEW INDEX -> NEON | ${url}`
    );

    console.log(
      `[HEXORA] R2 KEY -> ${r2Key}`
    );

    return {
      saved: true,
      duplicate: false,
      r2Key,
    };
  } catch (error) {
    console.error(
      `[HEXORA] Neon save failed: ${url}`,
      error?.message || error
    );

    throw error;
  }
}

// ============================================================
// QUEUE LINK
// ============================================================

async function queueLink(url) {
  const normalized =
    normalizeUrl(url);

  if (
    !normalized ||
    !isValidUrl(normalized)
  ) {
    return false;
  }

  try {
    const result =
      await pool.query(
        `
          INSERT INTO crawl_queue
          (
            url,
            status
          )
          VALUES
          (
            $1,
            'queued'
          )
          ON CONFLICT (url)
          DO NOTHING
          RETURNING id
        `,
        [normalized]
      );

    return (
      result.rows.length > 0
    );
  } catch (error) {
    console.error(
      "[HEXORA] Queue insert failed:",
      error?.message || error
    );

    return false;
  }
}

// ============================================================
// QUEUE MULTIPLE LINKS
// ============================================================

async function queueLinks(
  links = []
) {
  let added = 0;

  for (const link of links) {
    if (
      await queueLink(link)
    ) {
      added++;
    }
  }

  return added;
}

// ============================================================
// SEED QUEUE
// ============================================================

async function seedQueue() {
  let added = 0;

  for (const seed of SEED_URLS) {
    if (
      await queueLink(seed)
    ) {
      added++;
    }
  }

  console.log(
    `[HEXORA] Seed queue ready | added=${added}`
  );

  return added;
}

// ============================================================
// RECOVER OLD QUEUE STATUS
// ============================================================

async function normalizeOldQueueStatuses() {
  const result =
    await pool.query(
      `
        UPDATE crawl_queue
        SET status = 'queued',
            last_error = NULL
        WHERE status IN
        (
          'processing',
          'crawling',
          'running'
        )
        RETURNING id
      `
    );

  return result.rowCount || 0;
}

// ============================================================
// GET QUEUE BATCH
// ============================================================

async function getQueueBatch(
  limit = MAX_QUEUE_BATCH
) {
  const result =
    await pool.query(
      `
        SELECT id, url
        FROM crawl_queue
        WHERE status = 'queued'
        ORDER BY id ASC
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
  const result =
    await pool.query(
      `
        UPDATE crawl_queue
        SET status = 'processing'
        WHERE id = $1
          AND status = 'queued'
        RETURNING id, url
      `,
      [id]
    );

  return (
    result.rows[0] || null
  );
}

// ============================================================
// MARK SUCCESS
// ============================================================

async function markSuccess(id) {
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
}

// ============================================================
// MARK FAILED
// ============================================================

async function markFailed(
  id,
  error
) {
  await pool.query(
    `
      UPDATE crawl_queue
      SET
        status = 'queued',
        last_error = $2
      WHERE id = $1
    `,
    [
      id,
      String(
        error?.message ||
        error ||
        "Unknown error"
      ).slice(0, 2000),
    ]
  );
}

// ============================================================
// CRAWL ONE URL
// ============================================================

async function crawlOne(row) {
  const claimed =
    await claimUrl(row.id);

  if (!claimed) {
    return {
      success: false,
      skipped: true,
    };
  }

  const url =
    claimed.url;

  try {
    console.log(
      `[HEXORA] Crawling | ${url}`
    );

    // Respect domain delay
    await respectDomainDelay(
      url
    );

    // Robots
    const allowed =
      await robotsAllows(url);

    if (!allowed) {
      console.log(
        `[HEXORA] robots.txt blocked: ${url}`
      );

      await markSuccess(
        claimed.id
      );

      return {
        success: false,
        blocked: true,
      };
    }

    // Fetch
    const fetched =
      await fetchPage(url);

    if (!fetched.ok) {
      console.log(
        `[HEXORA] Fetch failed | ${url} | ${fetched.error}`
      );

      await markFailed(
        claimed.id,
        fetched.error
      );

      return {
        success: false,
        error: fetched.error,
      };
    }

    const finalUrl =
      fetched.finalUrl || url;

    // Extract
    const page =
      extractPage(
        fetched.html,
        finalUrl
      );

    // Links
    const links =
      extractLinks(
        fetched.html,
        finalUrl
      );

    const queued =
      await queueLinks(
        links
      );

    if (queued > 0) {
      console.log(
        `[HEXORA] Links queued: ${queued}`
      );
    }

    // Save page
    const saved =
      await savePage({
        url,
        finalUrl,
        title: page.title,
        description:
          page.description,
        content:
          page.content,
        language:
          page.language,
      });

    await markSuccess(
      claimed.id
    );

    return {
      success: true,
      saved: saved.saved,
      duplicate:
        saved.duplicate,
      url,
    };
  } catch (error) {
    console.error(
      `[HEXORA] Crawl failed: ${url}`,
      error?.message || error
    );

    try {
      await markFailed(
        claimed.id,
        error
      );
    } catch (markError) {
      console.error(
        "[HEXORA] Could not update queue:",
        markError?.message ||
          markError
      );
    }

    return {
      success: false,
      error:
        error?.message || String(error),
      url,
    };
  }
}

// ============================================================
// CRAWL BATCH
// ============================================================

async function crawlBatch(
  batchSize = MAX_QUEUE_BATCH
) {
  const rows =
    await getQueueBatch(
      batchSize
    );

  if (!rows.length) {
    return {
      processed: 0,
      successful: 0,
      failed: 0,
    };
  }

  console.log(
    `[HEXORA] Processing ${rows.length} URLs`
  );

  let successful = 0;
  let failed = 0;

  const workers =
    Math.min(4, rows.length);

  let index = 0;

  async function worker() {
    while (true) {
      const current =
        index++;

      if (current >= rows.length) {
        return;
      }

      const result =
        await crawlOne(
          rows[current]
        );

      if (result?.success) {
        successful++;
      } else {
        failed++;
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: workers },
      () => worker()
    )
  );

  console.log(
    `[HEXORA] crawl cycle | processed: ${rows.length}, successful: ${successful}, failed: ${failed}`
  );

  return {
    processed: rows.length,
    successful,
    failed,
  };
}

// ============================================================
// DATABASE SHUTDOWN
// ============================================================

async function closeCrawlerDatabase() {
  try {
    await pool.end();
  } catch {
    // Ignore shutdown errors
  }
}

// ============================================================
// EXPORTS
// ============================================================

export {
  crawlBatch,
  normalizeOldQueueStatuses,
  seedQueue,
  queueLink,
  queueLinks,
  checkNeon,
  closeCrawlerDatabase,
};
```
