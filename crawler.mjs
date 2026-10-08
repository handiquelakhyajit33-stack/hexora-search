import "dotenv/config";
import { Pool } from "pg";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import robotsParser from "robots-parser";
import crypto from "crypto";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("[HEXORA] DATABASE_URL missing");
}

// --------------------------------------------------
// CONFIG
// --------------------------------------------------

const CRAWL_BATCH_SIZE = Math.max(
  1,
  Number(process.env.CRAWL_BATCH_SIZE || 5)
);

const REQUEST_TIMEOUT_MS = Math.max(
  5000,
  Number(process.env.CRAWL_TIMEOUT_MS || 15000)
);

const WORKER_DELAY_MS = Math.max(
  1000,
  Number(process.env.CRAWL_DELAY_MS || 500)
);

const MAX_CONTENT_CHARS = Math.max(
  10000,
  Number(process.env.MAX_CONTENT_CHARS || 250000)
);

const MAX_DISCOVERED_LINKS = Math.max(
  10,
  Number(process.env.MAX_DISCOVERED_LINKS || 100)
);

const MAX_RETRIES = Math.max(
  1,
  Number(process.env.CRAWL_MAX_RETRIES || 3)
);

const STALE_MINUTES = Math.max(
  5,
  Number(process.env.CRAWL_STALE_MINUTES || 15)
);

const USER_AGENT =
  process.env.CRAWL_USER_AGENT ||
  "HEXORABot/1.0 (+https://www.hexorasearch.com/)";

// --------------------------------------------------
// STORAGE LIMITS
// --------------------------------------------------

const NEON_SLOW_MB = Number(
  process.env.NEON_SLOW_MB || 750
);

const NEON_VERY_SLOW_MB = Number(
  process.env.NEON_VERY_SLOW_MB || 850
);

const NEON_PAUSE_MB = Number(
  process.env.NEON_PAUSE_MB || 900
);

const R2_SLOW_GB = Number(
  process.env.R2_SLOW_GB || 8
);

const R2_PAUSE_GB = Number(
  process.env.R2_PAUSE_GB || 9
);

const STORAGE_CHECK_INTERVAL_MS = Number(
  process.env.STORAGE_CHECK_INTERVAL_MS ||
    5 * 60 * 1000
);

const STORAGE_PAUSE_DELAY_MS = Number(
  process.env.STORAGE_PAUSE_DELAY_MS ||
    60 * 1000
);

// --------------------------------------------------
// R2 CONFIG
// --------------------------------------------------

const R2_ACCOUNT_ID =
  process.env.R2_ACCOUNT_ID ||
  process.env.CLOUDFLARE_ACCOUNT_ID ||
  "";

const R2_BUCKET =
  process.env.R2_BUCKET ||
  process.env.R2_BUCKET_NAME ||
  "hexora";

const R2_ACCESS_KEY_ID =
  process.env.R2_ACCESS_KEY_ID ||
  process.env.R2_ACCESS_KEY ||
  "";

const R2_SECRET_ACCESS_KEY =
  process.env.R2_SECRET_ACCESS_KEY ||
  process.env.R2_SECRET_KEY ||
  "";

const R2_ENDPOINT =
  process.env.R2_ENDPOINT ||
  (
    R2_ACCOUNT_ID
      ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
      : ""
  );

const CLOUDFLARE_API_TOKEN =
  process.env.CLOUDFLARE_API_TOKEN ||
  process.env.CF_API_TOKEN ||
  "";

// --------------------------------------------------
// DATABASE
// --------------------------------------------------

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX || 10),
  ssl: {
    rejectUnauthorized: false
  }
});

pool.on("error", (error) => {
  console.error(
    "[HEXORA] PostgreSQL pool error:",
    error.message
  );
});

// --------------------------------------------------
// R2 CLIENT
// --------------------------------------------------

let r2 = null;

if (
  R2_ENDPOINT &&
  R2_ACCESS_KEY_ID &&
  R2_SECRET_ACCESS_KEY
) {
  r2 = new S3Client({
    region: "auto",
    endpoint: R2_ENDPOINT,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY
    }
  });
}

// --------------------------------------------------
// STATE
// --------------------------------------------------

let stopping = false;

const robotsCache = new Map();

let storageCache = {
  checkedAt: 0,
  neonBytes: null,
  r2Bytes: null,
  pause: false,
  slow: false
};

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}

function mb(bytes) {
  return bytes / 1024 / 1024;
}

function gb(bytes) {
  return bytes / 1024 / 1024 / 1024;
}

function normalizeUrl(value) {
  try {
    const url = new URL(String(value).trim());

    if (
      url.protocol !== "http:" &&
      url.protocol !== "https:"
    ) {
      return null;
    }

    url.hash = "";

    url.hostname = url.hostname.toLowerCase();

    if (
      (url.protocol === "http:" && url.port === "80") ||
      (url.protocol === "https:" && url.port === "443")
    ) {
      url.port = "";
    }

    return url.toString();
  } catch {
    return null;
  }
}

function makeStorageKey(url) {
  return (
    crypto
      .createHash("sha256")
      .update(url)
      .digest("hex") +
    ".html"
  );
}

function hashContent(text) {
  return crypto
    .createHash("sha256")
    .update(text)
    .digest("hex");
}

function getWordCount(text) {
  const value = String(text || "").trim();

  if (!value) {
    return 0;
  }

  return value.split(/\s+/).length;
}

function detectLanguage(text) {
  const value = String(text || "");

  if (!value) {
    return "unknown";
  }

  if (/[\u0980-\u09FF]/.test(value)) {
    return "as";
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

  if (/[\u0A00-\u0A7F]/.test(value)) {
    return "pa";
  }

  return "en";
}

// --------------------------------------------------
// HTML HELPERS
// --------------------------------------------------

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ");
}

function extractTitle(html) {
  const match = String(html || "").match(
    /<title[^>]*>([\s\S]*?)<\/title>/i
  );

  return match
    ? decodeHtmlEntities(
        match[1]
          .replace(/\s+/g, " ")
          .trim()
      ).slice(0, 500)
    : "";
}

function extractDescription(html) {
  const match = String(html || "").match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i
  );

  if (match) {
    return decodeHtmlEntities(
      match[1]
        .replace(/\s+/g, " ")
        .trim()
    ).slice(0, 2000);
  }

  const reverseMatch = String(html || "").match(
    /<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']description["'][^>]*>/i
  );

  return reverseMatch
    ? decodeHtmlEntities(
        reverseMatch[1]
          .replace(/\s+/g, " ")
          .trim()
      ).slice(0, 2000)
    : "";
}

function stripHtml(html) {
  return String(html || "")
    .replace(
      /<script[\s\S]*?<\/script>/gi,
      " "
    )
    .replace(
      /<style[\s\S]*?<\/style>/gi,
      " "
    )
    .replace(
      /<noscript[\s\S]*?<\/noscript>/gi,
      " "
    )
    .replace(
      /<svg[\s\S]*?<\/svg>/gi,
      " "
    )
    .replace(
      /<[^>]+>/g,
      " "
    )
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractLinks(html, baseUrl) {
  const found = new Set();

  const source = String(html || "");

  const regex =
    /<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;

  let match;

  while (
    (match = regex.exec(source)) !== null &&
    found.size < MAX_DISCOVERED_LINKS
  ) {
    const raw = decodeHtmlEntities(match[1]);

    if (
      !raw ||
      raw.startsWith("#") ||
      raw.startsWith("mailto:") ||
      raw.startsWith("javascript:") ||
      raw.startsWith("tel:") ||
      raw.startsWith("data:")
    ) {
      continue;
    }

    const normalized = normalizeUrl(
      new URL(raw, baseUrl).toString()
    );

    if (!normalized) {
      continue;
    }

    found.add(normalized);
  }

  return [...found];
}

// --------------------------------------------------
// STORAGE CHECK
// --------------------------------------------------

async function getNeonStorageBytes() {
  try {
    const result = await pool.query(`
      SELECT pg_database_size(current_database()) AS bytes
    `);

    return Number(
      result.rows?.[0]?.bytes || 0
    );
  } catch (error) {
    console.error(
      "[HEXORA] Neon storage check failed:",
      error.message
    );

    return null;
  }
}

async function getR2StorageBytes() {
  if (
    !CLOUDFLARE_API_TOKEN ||
    !R2_ACCOUNT_ID
  ) {
    return null;
  }

  const query = `
    query R2StorageUsage(
      $accountTag: String!
      $bucketName: String!
    ) {
      viewer {
        accounts(
          filter: {
            accountTag: $accountTag
          }
        ) {
          r2StorageAdaptiveGroups(
            filter: {
              bucketName: $bucketName
            }
            limit: 1
            orderBy: [date_DESC]
          ) {
            max {
              payloadSize
              metadataSize
            }
          }
        }
      }
    }
  `;

  try {
    const response = await fetch(
      "https://api.cloudflare.com/client/v4/graphql",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization:
            `Bearer ${CLOUDFLARE_API_TOKEN}`
        },
        body: JSON.stringify({
          query,
          variables: {
            accountTag: R2_ACCOUNT_ID,
            bucketName: R2_BUCKET
          }
        })
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    const row =
      data?.data?.viewer?.accounts?.[0]
        ?.r2StorageAdaptiveGroups?.[0]?.max;

    if (!row) {
      return null;
    }

    return (
      Number(row.payloadSize || 0) +
      Number(row.metadataSize || 0)
    );
  } catch (error) {
    console.error(
      "[HEXORA] R2 storage check failed:",
      error.message
    );

    return null;
  }
}

async function getStorageStatus(force = false) {
  const now = Date.now();

  if (
    !force &&
    now - storageCache.checkedAt <
      STORAGE_CHECK_INTERVAL_MS
  ) {
    return storageCache;
  }

  const neonBytes =
    await getNeonStorageBytes();

  const r2Bytes =
    await getR2StorageBytes();

  const neonMB =
    neonBytes === null
      ? null
      : mb(neonBytes);

  const r2GB =
    r2Bytes === null
      ? null
      : gb(r2Bytes);

  const neonPause =
    neonMB !== null &&
    neonMB >= NEON_PAUSE_MB;

  const r2Pause =
    r2GB !== null &&
    r2GB >= R2_PAUSE_GB;

  const neonSlow =
    neonMB !== null &&
    neonMB >= NEON_SLOW_MB;

  const r2Slow =
    r2GB !== null &&
    r2GB >= R2_SLOW_GB;

  storageCache = {
    checkedAt: now,
    neonBytes,
    r2Bytes,
    pause: neonPause || r2Pause,
    slow: neonSlow || r2Slow
  };

  console.log(
    `[HEXORA] Storage: ` +
    `Neon=${
      neonMB === null
        ? "unknown"
        : neonMB.toFixed(2) + "MB"
    } ` +
    `R2=${
      r2GB === null
        ? "unknown"
        : r2GB.toFixed(2) + "GB"
    } ` +
    `pause=${storageCache.pause}`
  );

  return storageCache;
}

function getSafeBatchSize(storage) {
  if (storage.pause) {
    return 0;
  }

  if (storage.slow) {
    return 1;
  }

  return CRAWL_BATCH_SIZE;
}

// --------------------------------------------------
// R2
// --------------------------------------------------

async function saveToR2(url, html) {
  if (!r2) {
    return null;
  }

  const key = makeStorageKey(url);

  try {
    await r2.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: html,
        ContentType:
          "text/html; charset=utf-8"
      })
    );

    return key;
  } catch (error) {
    console.error(
      "[HEXORA] R2 save failed:",
      error.message
    );

    return null;
  }
}

// --------------------------------------------------
// ROBOTS
// --------------------------------------------------

async function canCrawl(url) {
  try {
    const parsed = new URL(url);
    const origin = parsed.origin;

    let robots =
      robotsCache.get(origin);

    if (!robots) {
      const robotsUrl =
        `${origin}/robots.txt`;

      const response = await fetch(
        robotsUrl,
        {
          signal: AbortSignal.timeout(
            10000
          ),
          headers: {
            "User-Agent": USER_AGENT
          }
        }
      );

      const text =
        response.ok
          ? await response.text()
          : "";

      robots =
        robotsParser(
          robotsUrl,
          text
        );

      robotsCache.set(
        origin,
        robots
      );
    }

    return robots.isAllowed(
      url,
      "HEXORABot"
    );
  } catch {
    return true;
  }
}

// --------------------------------------------------
// FETCH
// --------------------------------------------------

async function fetchPage(url) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS
    );

  try {
    const response =
      await fetch(
        url,
        {
          signal:
            controller.signal,
          redirect: "follow",
          headers: {
            "User-Agent": USER_AGENT,
            Accept:
              "text/html,application/xhtml+xml"
          }
        }
      );

    const contentType =
      response.headers.get(
        "content-type"
      ) || "";

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error:
          `HTTP ${response.status}`
      };
    }

    if (
      !contentType.includes(
        "text/html"
      ) &&
      !contentType.includes(
        "application/xhtml+xml"
      )
    ) {
      return {
        ok: false,
        status: response.status,
        error:
          "Not an HTML page"
      };
    }

    const html =
      await response.text();

    return {
      ok: true,
      status: response.status,
      html,
      finalUrl:
        normalizeUrl(
          response.url
        ) || url
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error?.message ||
        "Fetch failed"
    };
  } finally {
    clearTimeout(timeout);
  }
}

// --------------------------------------------------
// QUEUE NEW LINKS
// --------------------------------------------------

async function enqueueLinks(links) {
  if (!links.length) {
    return 0;
  }

  let added = 0;

  for (const url of links) {
    try {
      const result =
        await pool.query(
          `
          INSERT INTO crawl_queue
          (
            url,
            status,
            priority,
            next_crawl_at,
            created_at,
            updated_at
          )
          VALUES
          (
            $1,
            'queued',
            0,
            NOW(),
            NOW(),
            NOW()
          )
          ON CONFLICT (url)
          DO NOTHING
          RETURNING id
          `,
          [url]
        );

      if (result.rowCount > 0) {
        added++;
      }
    } catch (error) {
      console.error(
        "[HEXORA] queue insert failed:",
        error.message
      );
    }
  }

  return added;
}

// --------------------------------------------------
// SAVE PAGE
// --------------------------------------------------

async function savePage({
  url,
  finalUrl,
  html
}) {
  const normalizedFinal =
    normalizeUrl(
      finalUrl || url
    ) || url;

  const title =
    extractTitle(html);

  const description =
    extractDescription(html);

  const fullText =
    stripHtml(html);

  const content =
    fullText.slice(
      0,
      MAX_CONTENT_CHARS
    );

  const contentHash =
    hashContent(content);

  const wordCount =
    getWordCount(content);

  const language =
    detectLanguage(content);

  const r2Key =
    await saveToR2(
      normalizedFinal,
      html
    );

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
      updated_at,
      crawl_status,
      last_crawled_at,
      r2_key
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
      NOW(),
      'indexed',
      NOW(),
      $8
    )
    ON CONFLICT (url)
    DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      content = EXCLUDED.content,
      content_hash = EXCLUDED.content_hash,
      word_count = EXCLUDED.word_count,
      language = EXCLUDED.language,
      updated_at = NOW(),
      crawl_status = 'indexed',
      last_crawled_at = NOW(),
      r2_key = COALESCE(
        EXCLUDED.r2_key,
        pages.r2_key
      )
    `,
    [
      normalizedFinal,
      title,
      description,
      content,
      contentHash,
      wordCount,
      language,
      r2Key
    ]
  );

  return {
    r2Key,
    title,
    links: extractLinks(
      html,
      normalizedFinal
    )
  };
}

// --------------------------------------------------
// CLAIM JOBS
// --------------------------------------------------

async function claimJobs(limit) {
  const result =
    await pool.query(
      `
      WITH picked AS (
        SELECT id
        FROM crawl_queue
        WHERE
          status IN (
            'queued',
            'failed',
            'error'
          )
          AND (
            next_crawl_at IS NULL
            OR next_crawl_at <= NOW()
          )
        ORDER BY
          priority DESC,
          created_at ASC,
          id ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE crawl_queue q
      SET
        status = 'processing',
        updated_at = NOW()
      FROM picked
      WHERE q.id = picked.id
      RETURNING q.*
      `,
      [limit]
    );

  return result.rows;
}

// --------------------------------------------------
// RETRY
// --------------------------------------------------

async function failJob(
  job,
  errorMessage
) {
  const attempts =
    Number(job.retry_count || 0) + 1;

  if (attempts >= MAX_RETRIES) {
    await pool.query(
      `
      UPDATE crawl_queue
      SET
        status = 'failed',
        last_error = $2,
        last_crawled_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
      `,
      [
        job.id,
        errorMessage
      ]
    );

    return;
  }

  await pool.query(
    `
    UPDATE crawl_queue
    SET
      status = 'queued',
      last_error = $2,
      next_crawl_at =
        NOW() +
        INTERVAL '5 minutes',
      updated_at = NOW()
    WHERE id = $1
    `,
    [
      job.id,
      errorMessage
    ]
  );
}

// --------------------------------------------------
// PROCESS JOB
// --------------------------------------------------

async function processJob(job) {
  const url =
    normalizeUrl(job.url);

  if (!url) {
    await pool.query(
      `
      UPDATE crawl_queue
      SET
        status = 'failed',
        last_error = 'Invalid URL',
        updated_at = NOW()
      WHERE id = $1
      `,
      [job.id]
    );

    return {
      indexed: false,
      blocked: false,
      discovered: 0
    };
  }

  const allowed =
    await canCrawl(url);

  if (!allowed) {
    await pool.query(
      `
      UPDATE crawl_queue
      SET
        status = 'blocked',
        last_error =
          'Blocked by robots.txt',
        last_crawled_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
      `,
      [job.id]
    );

    console.log(
      `[HEXORA] robots blocked: ${url}`
    );

    return {
      indexed: false,
      blocked: true,
      discovered: 0
    };
  }

  const page =
    await fetchPage(url);

  if (!page.ok) {
    await failJob(
      job,
      page.error ||
        `HTTP ${page.status || "error"}`
    );

    return {
      indexed: false,
      blocked: false,
      discovered: 0
    };
  }

  try {
    const saved =
      await savePage({
        url,
        finalUrl:
          page.finalUrl,
        html: page.html
      });

    const discovered =
      await enqueueLinks(
        saved.links
      );

    await pool.query(
      `
      UPDATE crawl_queue
      SET
        status = 'done',
        last_error = NULL,
        last_crawled_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
      `,
      [job.id]
    );

    console.log(
      `[HEXORA] indexed: ${
        page.finalUrl || url
      } | links=${discovered}`
    );

    return {
      indexed: true,
      blocked: false,
      discovered
    };
  } catch (error) {
    await failJob(
      job,
      error?.message ||
        "Indexing failed"
    );

    console.error(
      `[HEXORA] index failed: ${url}`,
      error?.message
    );

    return {
      indexed: false,
      blocked: false,
      discovered: 0
    };
  }
}

// --------------------------------------------------
// RECOVER STALE JOBS
// --------------------------------------------------

async function recoverStaleJobs() {
  const result =
    await pool.query(
      `
      UPDATE crawl_queue
      SET
        status = 'queued',
        next_crawl_at = NOW(),
        updated_at = NOW()
      WHERE
        status = 'processing'
        AND updated_at <
          NOW() -
          make_interval(
            mins => $1
          )
      RETURNING id
      `,
      [STALE_MINUTES]
    );

  if (result.rowCount > 0) {
    console.log(
      `[HEXORA] recovered stale jobs: ${
        result.rowCount
      }`
    );
  }
}

// --------------------------------------------------
// OPTIONAL SEEDS
// --------------------------------------------------

async function seedUrls() {
  const raw =
    process.env.SEED_URLS || "";

  if (!raw.trim()) {
    return;
  }

  const urls =
    raw
      .split(",")
      .map(normalizeUrl)
      .filter(Boolean);

  const added =
    await enqueueLinks(urls);

  if (added > 0) {
    console.log(
      `[HEXORA] seed URLs added: ${added}`
    );
  }
}

// --------------------------------------------------
// CRAWL CYCLE
// --------------------------------------------------

export async function runCrawlCycle() {
  if (stopping) {
    return {
      jobs: 0,
      indexed: 0,
      failed: 0,
      blocked: 0,
      discovered: 0,
      storagePaused: false
    };
  }

  const storage =
    await getStorageStatus(true);

  if (storage.pause) {
    console.warn(
      "[HEXORA] Storage protection active. Crawler paused."
    );

    return {
      jobs: 0,
      indexed: 0,
      failed: 0,
      blocked: 0,
      discovered: 0,
      storagePaused: true
    };
  }

  await recoverStaleJobs();

  const batchSize =
    getSafeBatchSize(storage);

  if (batchSize <= 0) {
    return {
      jobs: 0,
      indexed: 0,
      failed: 0,
      blocked: 0,
      discovered: 0,
      storagePaused: true
    };
  }

  const jobs =
    await claimJobs(batchSize);

  if (!jobs.length) {
    return {
      jobs: 0,
      indexed: 0,
      failed: 0,
      blocked: 0,
      discovered: 0,
      storagePaused: false
    };
  }

  let indexed = 0;
  let failed = 0;
  let blocked = 0;
  let discovered = 0;

  for (const job of jobs) {
    if (stopping) {
      break;
    }

    try {
      const result =
        await processJob(job);

      if (result.indexed) {
        indexed++;
      }

      if (result.blocked) {
        blocked++;
      }

      discovered +=
        result.discovered || 0;
    } catch (error) {
      failed++;

      console.error(
        "[HEXORA] job error:",
        error?.message || error
      );
    }

    await sleep(
      WORKER_DELAY_MS
    );
  }

  return {
    jobs: jobs.length,
    indexed,
    failed,
    blocked,
    discovered,
    storagePaused: false
  };
}

// --------------------------------------------------
// SHUTDOWN
// --------------------------------------------------

export async function shutdownCrawler() {
  if (stopping) {
    return;
  }

  stopping = true;

  console.log(
    "[HEXORA] shutting down crawler..."
  );

  try {
    await pool.end();
  } catch {}

  console.log(
    "[HEXORA] crawler shutdown complete."
  );
}

// --------------------------------------------------
// DIRECT MODE
// --------------------------------------------------

async function main() {
  console.log(
    "[HEXORA] Worldwide crawler starting..."
  );

  await pool.query(
    "SELECT 1"
  );

  console.log(
    "[HEXORA] Neon database connected."
  );

  await seedUrls();

  while (!stopping) {
    try {
      const result =
        await runCrawlCycle();

      console.log(
        `[HEXORA] cycle: ` +
        `jobs=${result.jobs} ` +
        `indexed=${result.indexed} ` +
        `failed=${result.failed} ` +
        `blocked=${result.blocked} ` +
        `discovered=${result.discovered}`
      );

      if (result.storagePaused) {
        await sleep(
          STORAGE_PAUSE_DELAY_MS
        );
      } else {
        await sleep(2000);
      }
    } catch (error) {
      console.error(
        "[HEXORA] crawl loop error:",
        error?.message || error
      );

      await sleep(10000);
    }
  }
}

const isMain =
  process.argv[1] &&
  (
    process.argv[1].endsWith(
      "/crawler.mjs"
    ) ||
    process.argv[1].endsWith(
      "\\crawler.mjs"
    )
  );

if (isMain) {
  main().catch(async (error) => {
    console.error(
      "[HEXORA] Fatal crawler error:",
      error
    );

    await shutdownCrawler();

    process.exit(1);
  });
}
