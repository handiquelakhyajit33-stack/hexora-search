// crawler.mjs
import "dotenv/config";
import { Pool } from "pg";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import robotsParser from "robots-parser";
import crypto from "crypto";

const PORT = Number(process.env.PORT || 8080);

const DATABASE_URL = process.env.DATABASE_URL;

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
  (R2_ACCOUNT_ID
    ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    : "");

const CLOUDFLARE_API_TOKEN =
  process.env.CLOUDFLARE_API_TOKEN ||
  process.env.CF_API_TOKEN ||
  "";

// --------------------------------------------------
// STORAGE LIMITS
// --------------------------------------------------

const NEON_SLOW_MB = Number(process.env.NEON_SLOW_MB || 750);
const NEON_VERY_SLOW_MB = Number(process.env.NEON_VERY_SLOW_MB || 850);
const NEON_PAUSE_MB = Number(process.env.NEON_PAUSE_MB || 900);

const R2_SLOW_GB = Number(process.env.R2_SLOW_GB || 8);
const R2_PAUSE_GB = Number(process.env.R2_PAUSE_GB || 9);

const STORAGE_CHECK_INTERVAL_MS =
  Number(process.env.STORAGE_CHECK_INTERVAL_MS || 5 * 60 * 1000);

const STORAGE_PAUSE_DELAY_MS =
  Number(process.env.STORAGE_PAUSE_DELAY_MS || 60 * 1000);

// --------------------------------------------------
// DATABASE
// --------------------------------------------------

if (!DATABASE_URL) {
  throw new Error("[HEXORA] DATABASE_URL missing");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

pool.on("error", (err) => {
  console.error("[HEXORA] PostgreSQL pool error:", err.message);
});

// --------------------------------------------------
// R2
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
// BASIC HELPERS
// --------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mb(bytes) {
  return bytes / 1024 / 1024;
}

function gb(bytes) {
  return bytes / 1024 / 1024 / 1024;
}

function normalizeUrl(value) {
  try {
    const u = new URL(value);

    u.hash = "";

    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return null;
    }

    return u.toString();
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

// --------------------------------------------------
// NEON STORAGE
// --------------------------------------------------

async function getNeonStorageBytes() {
  try {
    const result = await pool.query(`
      SELECT pg_database_size(current_database()) AS bytes
    `);

    const value = result.rows?.[0]?.bytes;

    if (typeof value === "number") {
      return value;
    }

    return Number(value || 0);
  } catch (error) {
    console.error(
      "[HEXORA] Neon storage check failed:",
      error.message
    );

    return null;
  }
}

// --------------------------------------------------
// CLOUDFLARE R2 STORAGE
// --------------------------------------------------

async function getR2StorageBytes() {
  if (!CLOUDFLARE_API_TOKEN || !R2_ACCOUNT_ID) {
    return null;
  }

  const query = `
    query R2StorageUsage(
      $accountTag: String!
      $bucketName: String!
    ) {
      viewer {
        accounts(filter: {
          accountTag: $accountTag
        }) {
          r2StorageAdaptiveGroups(
            filter: {
              bucketName: $bucketName
            }
            limit: 1
            orderBy: [date_DESC]
          ) {
            dimensions {
              date
              bucketName
            }
            max {
              payloadSize
              metadataSize
              objectCount
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
          Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`
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
      console.error(
        "[HEXORA] R2 usage HTTP error:",
        response.status
      );

      return null;
    }

    const data = await response.json();

    const rows =
      data?.data?.viewer?.accounts?.[0]
        ?.r2StorageAdaptiveGroups || [];

    if (!rows.length) {
      return null;
    }

    const row = rows[0]?.max || {};

    const payloadSize = Number(row.payloadSize || 0);
    const metadataSize = Number(row.metadataSize || 0);

    return payloadSize + metadataSize;
  } catch (error) {
    console.error(
      "[HEXORA] R2 storage check failed:",
      error.message
    );

    return null;
  }
}

// --------------------------------------------------
// STORAGE STATUS
// --------------------------------------------------

let storageCache = {
  checkedAt: 0,
  neonBytes: null,
  r2Bytes: null,
  pause: false,
  slow: false
};

async function getStorageStatus(force = false) {
  const now = Date.now();

  if (
    !force &&
    now - storageCache.checkedAt <
      STORAGE_CHECK_INTERVAL_MS
  ) {
    return storageCache;
  }

  const neonBytes = await getNeonStorageBytes();
  const r2Bytes = await getR2StorageBytes();

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
    `[HEXORA] Storage check: ` +
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

  if (neonMB !== null) {
    if (neonMB >= NEON_PAUSE_MB) {
      console.warn(
        `[HEXORA] NEON STORAGE LIMIT REACHED: ` +
          `${neonMB.toFixed(2)}MB >= ${NEON_PAUSE_MB}MB`
      );
    } else if (neonMB >= NEON_VERY_SLOW_MB) {
      console.warn(
        `[HEXORA] NEON STORAGE VERY HIGH: ` +
          `${neonMB.toFixed(2)}MB`
      );
    } else if (neonMB >= NEON_SLOW_MB) {
      console.warn(
        `[HEXORA] NEON STORAGE HIGH: ` +
          `${neonMB.toFixed(2)}MB`
      );
    }
  }

  if (r2GB !== null) {
    if (r2GB >= R2_PAUSE_GB) {
      console.warn(
        `[HEXORA] R2 STORAGE LIMIT REACHED: ` +
          `${r2GB.toFixed(2)}GB >= ${R2_PAUSE_GB}GB`
      );
    } else if (r2GB >= R2_SLOW_GB) {
      console.warn(
        `[HEXORA] R2 STORAGE HIGH: ` +
          `${r2GB.toFixed(2)}GB`
      );
    }
  }

  return storageCache;
}

// --------------------------------------------------
// SAFE BATCH SIZE
// --------------------------------------------------

function getSafeBatchSize(storageStatus) {
  if (storageStatus.pause) {
    return 0;
  }

  if (storageStatus.slow) {
    return 1;
  }

  return 5;
}

// --------------------------------------------------
// R2 SAVE
// --------------------------------------------------

async function saveToR2(url, html) {
  if (!r2) {
    console.warn(
      "[HEXORA] R2 not configured; skipping R2 save"
    );

    return null;
  }

  const key = makeStorageKey(url);

  try {
    await r2.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: html,
        ContentType: "text/html; charset=utf-8"
      })
    );

    console.log(
      `[HEXORA] R2 saved: ${key}`
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

const robotsCache = new Map();

async function canCrawl(url) {
  try {
    const parsed = new URL(url);
    const origin = parsed.origin;

    let robots = robotsCache.get(origin);

    if (!robots) {
      const robotsUrl = `${origin}/robots.txt`;

      const response = await fetch(
        robotsUrl,
        {
          headers: {
            "User-Agent":
              "HEXORABot/1.0 (+https://www.hexorasearch.com/)"
          }
        }
      );

      const text = await response.text();

      robots = robotsParser(
        robotsUrl,
        text
      );

      robotsCache.set(origin, robots);
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
// FETCH PAGE
// --------------------------------------------------

async function fetchPage(url) {
  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    15000
  );

  try {
    const response = await fetch(
      url,
      {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent":
            "HEXORABot/1.0 (+https://www.hexorasearch.com/)",
          Accept:
            "text/html,application/xhtml+xml"
        }
      }
    );

    const contentType =
      response.headers.get("content-type") || "";

    if (!response.ok) {
      return {
        ok: false,
        status: response.status
      };
    }

    if (
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml")
    ) {
      return {
        ok: false,
        status: response.status
      };
    }

    const html = await response.text();

    return {
      ok: true,
      status: response.status,
      html,
      finalUrl: response.url,
      contentType
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message
    };
  } finally {
    clearTimeout(timeout);
  }
}

// --------------------------------------------------
// SIMPLE METADATA
// --------------------------------------------------

function extractTitle(html) {
  const match = html.match(
    /<title[^>]*>([\s\S]*?)<\/title>/i
  );

  return match
    ? match[1]
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 500)
    : "";
}

function stripHtml(html) {
  return html
    .replace(
      /<script[\s\S]*?<\/script>/gi,
      " "
    )
    .replace(
      /<style[\s\S]*?<\/style>/gi,
      " "
    )
    .replace(
      /<[^>]+>/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

// --------------------------------------------------
// SAVE PAGE TO NEON
// --------------------------------------------------

async function savePage({
  url,
  finalUrl,
  html
}) {
  const title = extractTitle(html);
  const text = stripHtml(html);

  const r2Key = await saveToR2(
    finalUrl || url,
    html
  );

  await pool.query(
    `
    INSERT INTO pages
      (
        url,
        title,
        content,
        crawl_status,
        last_crawled_at
      )
    VALUES
      (
        $1,
        $2,
        $3,
        'indexed',
        NOW()
      )
    ON CONFLICT (url)
    DO UPDATE SET
      title = EXCLUDED.title,
      content = EXCLUDED.content,
      crawl_status = 'indexed',
      last_crawled_at = NOW()
    `,
    [
      finalUrl || url,
      title,
      text
    ]
  );

  return r2Key;
}

// --------------------------------------------------
// CLAIM JOBS
// --------------------------------------------------

async function claimJobs(limit) {
  const result = await pool.query(
    `
    WITH picked AS (
      SELECT id
      FROM crawl_queue
      WHERE
        status IN ('pending', 'failed', 'error')
        AND (
          next_crawl_at IS NULL
          OR next_crawl_at <= NOW()
        )
      ORDER BY
        priority DESC NULLS LAST,
        id
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
// PROCESS JOB
// --------------------------------------------------

async function processJob(job) {
  const url = normalizeUrl(job.url);

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

    return false;
  }

  const allowed = await canCrawl(url);

  if (!allowed) {
    await pool.query(
      `
      UPDATE crawl_queue
      SET
        status = 'blocked',
        last_error = 'Blocked by robots.txt',
        updated_at = NOW()
      WHERE id = $1
      `,
      [job.id]
    );

    console.log(
      `[HEXORA] robots blocked: ${url}`
    );

    return false;
  }

  const page = await fetchPage(url);

  if (!page.ok) {
    await pool.query(
      `
      UPDATE crawl_queue
      SET
        status = 'failed',
        last_error = $2,
        updated_at = NOW()
      WHERE id = $1
      `,
      [
        job.id,
        page.error ||
          `HTTP ${page.status || "error"}`
      ]
    );

    console.warn(
      `[HEXORA] crawl failed: ${url}`
    );

    return false;
  }

  try {
    await savePage({
      url,
      finalUrl: page.finalUrl,
      html: page.html
    });

    await pool.query(
      `
      UPDATE crawl_queue
      SET
        status = 'done',
        last_error = NULL,
        updated_at = NOW()
      WHERE id = $1
      `,
      [job.id]
    );

    console.log(
      `[HEXORA] indexed: ${page.finalUrl || url}`
    );

    return true;
  } catch (error) {
    await pool.query(
      `
      UPDATE crawl_queue
      SET
        status = 'failed',
        last_error = $2,
        updated_at = NOW()
      WHERE id = $1
      `,
      [
        job.id,
        error.message
      ]
    );

    console.error(
      `[HEXORA] index failed: ${url}`,
      error.message
    );

    return false;
  }
}

// --------------------------------------------------
// RECOVER STALE JOBS
// --------------------------------------------------

async function recoverStaleJobs() {
  try {
    const result = await pool.query(`
      UPDATE crawl_queue
      SET
        status = 'pending',
        updated_at = NOW(),
        next_crawl_at = NOW()
      WHERE
        status = 'processing'
        AND updated_at < NOW() - INTERVAL '15 minutes'
      RETURNING id
    `);

    if (result.rowCount > 0) {
      console.log(
        `[HEXORA] Recovered stale jobs: ${result.rowCount}`
      );
    }
  } catch (error) {
    console.error(
      "[HEXORA] stale job recovery failed:",
      error.message
    );
  }
}

// --------------------------------------------------
// CRAWL CYCLE
// --------------------------------------------------

async function runCrawlCycle() {
  const storage =
    await getStorageStatus(true);

  if (storage.pause) {
    console.warn(
      "[HEXORA] Storage protection ACTIVE. " +
      "Crawler paused. Search service remains available."
    );

    return {
      storagePaused: true,
      jobs: 0,
      indexed: 0,
      failed: 0,
      blocked: 0
    };
  }

  await recoverStaleJobs();

  const batchSize =
    getSafeBatchSize(storage);

  if (batchSize <= 0) {
    return {
      storagePaused: true,
      jobs: 0,
      indexed: 0,
      failed: 0,
      blocked: 0
    };
  }

  console.log(
    `[HEXORA] Starting batch: ${batchSize} jobs`
  );

  const jobs =
    await claimJobs(batchSize);

  if (!jobs.length) {
    console.log(
      "[HEXORA] No crawl jobs available."
    );

    return {
      storagePaused: false,
      jobs: 0,
      indexed: 0,
      failed: 0,
      blocked: 0
    };
  }

  let indexed = 0;
  let failed = 0;
  let blocked = 0;

  for (const job of jobs) {
    try {
      const ok =
        await processJob(job);

      if (ok) {
        indexed++;
      } else {
        failed++;
      }
    } catch (error) {
      failed++;

      console.error(
        "[HEXORA] job processing error:",
        error.message
      );
    }

    await sleep(500);
  }

  console.log(
    `[HEXORA] Batch finished: ` +
      `jobs=${jobs.length} ` +
      `indexed=${indexed} ` +
      `failed=${failed} ` +
      `blocked=${blocked}`
  );

  return {
    storagePaused: false,
    jobs: jobs.length,
    indexed,
    failed,
    blocked
  };
}

// --------------------------------------------------
// MAIN LOOP
// --------------------------------------------------

async function main() {
  console.log(
    "[HEXORA] Worldwide crawler starting..."
  );

  console.log(
    `[HEXORA] Neon pause limit: ${NEON_PAUSE_MB}MB`
  );

  console.log(
    `[HEXORA] R2 pause limit: ${R2_PAUSE_GB}GB`
  );

  console.log(
    `[HEXORA] R2 metrics: ${
      CLOUDFLARE_API_TOKEN &&
      R2_ACCOUNT_ID
        ? "configured"
        : "not configured"
    }`
  );

  await pool.query("SELECT 1");

  console.log(
    "[HEXORA] Neon database connected."
  );

  const initial =
    await getStorageStatus(true);

  if (initial.pause) {
    console.warn(
      "[HEXORA] Startup storage protection is ACTIVE."
    );
  }

  while (true) {
    try {
      const result =
        await runCrawlCycle();

      if (result.storagePaused) {
        console.warn(
          `[HEXORA] Storage paused. ` +
            `Retrying after ${STORAGE_PAUSE_DELAY_MS / 1000}s`
        );

        await sleep(
          STORAGE_PAUSE_DELAY_MS
        );

        continue;
      }

      await sleep(2000);
    } catch (error) {
      console.error(
        "[HEXORA] Crawl loop error:",
        error.message
      );

      await sleep(10000);
    }
  }
}

// --------------------------------------------------
// START
// --------------------------------------------------

main().catch((error) => {
  console.error(
    "[HEXORA] Fatal crawler error:",
    error
  );

  process.exit(1);
});
