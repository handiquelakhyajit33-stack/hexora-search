
import "dotenv/config";
import pg from "pg";
import {
  S3Client,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import * as cheerio from "cheerio";
import robotsParser from "robots-parser";
import crypto from "node:crypto";

const { Pool } = pg;

// ============================================================
// HEXORA CRAWLER — NEON + CLOUDFLARE R2
// Storage protection remains enabled.
// ============================================================

const DATABASE_URL = process.env.DATABASE_URL;
const PORT = Number(process.env.PORT || 8080);

const R2_ACCOUNT_ID =
  process.env.R2_ACCOUNT_ID ||
  process.env.CLOUDFLARE_ACCOUNT_ID;

const R2_BUCKET =
  process.env.R2_BUCKET ||
  process.env.R2_BUCKET_NAME ||
  "hexora";

const R2_ACCESS_KEY_ID =
  process.env.R2_ACCESS_KEY_ID ||
  process.env.R2_ACCESS_KEY;

const R2_SECRET_ACCESS_KEY =
  process.env.R2_SECRET_ACCESS_KEY ||
  process.env.R2_SECRET_KEY;

const CLOUDFLARE_API_TOKEN =
  process.env.CLOUDFLARE_API_TOKEN ||
  process.env.CF_API_TOKEN;

const USER_AGENT =
  process.env.HEXORA_USER_AGENT ||
  "HEXORA-Bot/1.0 (+https://www.hexsorasearch.com/bot)";

const BATCH_SIZE = Math.max(
  1,
  Number(process.env.CRAWL_BATCH_SIZE || 5)
);

const CRAWL_INTERVAL_MS = Math.max(
  10000,
  Number(process.env.CRAWL_INTERVAL_MS || 30000)
);

const REQUEST_TIMEOUT_MS = Math.max(
  5000,
  Number(process.env.CRAWL_TIMEOUT_MS || 15000)
);

const DOMAIN_DELAY_MS = Math.max(
  1000,
  Number(process.env.CRAWL_DOMAIN_DELAY_MS || 2000)
);

const MAX_CONTENT_CHARS = Math.max(
  1000,
  Number(process.env.CRAWL_MAX_CONTENT || 50000)
);

const MAX_LINKS_PER_PAGE = Math.max(
  1,
  Number(process.env.CRAWL_MAX_LINKS || 30)
);

// Do not disable these safeguards to force crawling.
const NEON_PAUSE_MB = Number(
  process.env.NEON_PAUSE_MB || 900
);

const NEON_SLOW_MB = Number(
  process.env.NEON_SLOW_MB || 750
);

const R2_PAUSE_GB = Number(
  process.env.R2_PAUSE_GB || 9
);

const R2_SLOW_GB = Number(
  process.env.R2_SLOW_GB || 8
);

const PAUSE_DELAY_MS = Math.max(
  30000,
  Number(process.env.STORAGE_PAUSE_DELAY_MS || 60000)
);

if (!DATABASE_URL) {
  console.error("[HEXORA] DATABASE_URL is missing.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX || 5),
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL)
    ? false
    : { rejectUnauthorized: false },
});

let s3 = null;

if (
  R2_ACCOUNT_ID &&
  R2_ACCESS_KEY_ID &&
  R2_SECRET_ACCESS_KEY
) {
  s3 = new S3Client({
    region: "auto",
    endpoint:
      `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
}

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("hex");
}

function normalizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);

    if (!["http:", "https:"].includes(url.protocol)) {
      return null;
    }

    if (url.username || url.password) {
      return null;
    }

    url.hash = "";

    for (const key of [...url.searchParams.keys()]) {
      if (
        key.toLowerCase().startsWith("utm_") ||
        ["fbclid", "gclid", "ref_src"].includes(
          key.toLowerCase()
        )
      ) {
        url.searchParams.delete(key);
      }
    }

    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }

    return url.toString();
  } catch {
    return null;
  }
}

function safeHostname(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isPublicWebUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return false;
    }

    if (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host === "metadata.google.internal" ||
      host === "169.254.169.254"
    ) {
      return false;
    }

    // Prevent common private and loopback IPv4 destinations.
    const parts = host.split(".").map(Number);

    if (
      parts.length === 4 &&
      parts.every(
        (part) =>
          Number.isInteger(part) &&
          part >= 0 &&
          part <= 255
      )
    ) {
      const [a, b] = parts;

      if (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        a >= 224 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168)
      ) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

// ============================================================
// DATABASE
// ============================================================

async function checkDatabase() {
  await pool.query("SELECT 1");
  console.log("[HEXORA] Neon database connected.");
}

async function getQueueColumnNames() {
  const result = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'crawl_queue'
  `);

  return new Set(result.rows.map((row) => row.column_name));
}

// ============================================================
// STORAGE CHECKS
// ============================================================

// Uses Neon database size. This measures the connected database,
// not every database in a Neon project.
async function getNeonStorageBytes() {
  const result = await pool.query(`
    SELECT pg_database_size(current_database()) AS bytes
  `);

  return Number(result.rows[0].bytes);
}

// Cloudflare account token needs permission to read R2 analytics.
// If the API cannot confirm usage, return null and pause safely.
async function getR2StorageBytes() {
  if (!R2_ACCOUNT_ID || !CLOUDFLARE_API_TOKEN) {
    console.error(
      "[HEXORA] R2 usage unknown: missing account ID or API token."
    );
    return null;
  }

  const query = `
    query HexoraR2Storage {
      viewer {
        accounts(filter: { accountTag: "${R2_ACCOUNT_ID}" }) {
          r2StorageAdaptiveGroups(
            limit: 100
            orderBy: [date_DESC]
          ) {
            dimensions {
              bucketName
              date
            }
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
          Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(15000),
      }
    );

    const data = await response.json();

    if (!response.ok || data.errors?.length) {
      console.error(
        "[HEXORA] R2 GraphQL error:",
        JSON.stringify(data.errors || data).slice(0, 1200)
      );
      return null;
    }

    const groups =
      data.data?.viewer?.accounts?.[0]
        ?.r2StorageAdaptiveGroups;

    if (!Array.isArray(groups)) {
      console.error(
        "[HEXORA] R2 usage response has no storage groups."
      );
      return null;
    }

    const bucketGroups = groups.filter(
      (group) =>
        group.dimensions?.bucketName === R2_BUCKET
    );

    if (bucketGroups.length === 0) {
      console.error(
        `[HEXORA] No R2 usage record found for bucket "${R2_BUCKET}".`
      );
      return null;
    }

    // Each record represents a date. Use the latest date only,
    // and sum its reported payload and metadata size.
    bucketGroups.sort((a, b) =>
      String(b.dimensions?.date || "").localeCompare(
        String(a.dimensions?.date || "")
      )
    );

    const latestDate = bucketGroups[0].dimensions?.date;

    const latestGroups = bucketGroups.filter(
      (group) => group.dimensions?.date === latestDate
    );

    const bytes = latestGroups.reduce((total, group) => {
      const payload = Number(group.max?.payloadSize || 0);
      const metadata = Number(group.max?.metadataSize || 0);
      return total + payload + metadata;
    }, 0);

    if (!Number.isFinite(bytes) || bytes < 0) {
      console.error("[HEXORA] Invalid R2 usage value.");
      return null;
    }

    return bytes;
  } catch (error) {
    console.error(
      "[HEXORA] Cannot read R2 usage:",
      error.message
    );
    return null;
  }
}

async function getStorageStatus() {
  let neonBytes;
  let r2Bytes;

  try {
    neonBytes = await getNeonStorageBytes();
  } catch (error) {
    console.error(
      "[HEXORA] Cannot check Neon storage:",
      error.message
    );

    return {
      known: false,
      pause: true,
      reason: "Neon storage check failed",
    };
  }

  r2Bytes = await getR2StorageBytes();

  const neonMB = neonBytes / (1024 * 1024);
  const r2GB =
    r2Bytes === null
      ? null
      : r2Bytes / (1024 * 1024 * 1024);

  console.log(
    `[HEXORA] Storage: Neon=${neonMB.toFixed(2)}MB ` +
    `R2=${r2GB === null ? "unknown" : r2GB.toFixed(3) + "GB"}`
  );

  if (r2Bytes === null) {
    return {
      known: false,
      pause: true,
      reason: "R2 usage unknown",
    };
  }

  if (neonMB >= NEON_PAUSE_MB) {
    return {
      known: true,
      pause: true,
      reason: `Neon reached ${NEON_PAUSE_MB}MB safety limit`,
    };
  }

  if (r2GB >= R2_PAUSE_GB) {
    return {
      known: true,
      pause: true,
      reason: `R2 reached ${R2_PAUSE_GB}GB safety limit`,
    };
  }

  const slow =
    neonMB >= NEON_SLOW_MB ||
    r2GB >= R2_SLOW_GB;

  return {
    known: true,
    pause: false,
    slow,
    neonMB,
    r2GB,
  };
}

// ============================================================
// R2 HTML ARCHIVE
// ============================================================

async function saveHtmlToR2(url, html) {
  if (!s3) {
    throw new Error(
      "R2 S3 credentials are not configured."
    );
  }

  const key =
    "pages/" +
    new Date().toISOString().slice(0, 10) +
    "/" +
    sha256(url) +
    ".html";

  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: html,
      ContentType: "text/html; charset=utf-8",
      Metadata: {
        "source-url-hash": sha256(url),
      },
    })
  );

  return key;
}

// ============================================================
// ROBOTS.TXT
// ============================================================

const robotsCache = new Map();

async function canCrawl(url) {
  const parsed = new URL(url);
  const origin = parsed.origin;
  const robotsUrl = `${origin}/robots.txt`;

  let entry = robotsCache.get(origin);

  if (!entry || entry.expiresAt < Date.now()) {
    try {
      const response = await fetch(robotsUrl, {
        headers: { "User-Agent": USER_AGENT },
        redirect: "follow",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.status === 404) {
        entry = {
          parser: robotsParser(robotsUrl, ""),
          expiresAt: Date.now() + 60 * 60 * 1000,
        };
      } else if (response.ok) {
        const text = await response.text();

        entry = {
          parser: robotsParser(robotsUrl, text),
          expiresAt: Date.now() + 60 * 60 * 1000,
        };
      } else {
        // If robots policy cannot be verified, do not crawl
        // this origin in this cycle.
        console.warn(
          `[HEXORA] robots.txt returned HTTP ${response.status}: ${origin}`
        );
        return false;
      }

      robotsCache.set(origin, entry);
    } catch (error) {
      console.warn(
        `[HEXORA] robots.txt unavailable for ${origin}: ${error.message}`
      );
      return false;
    }
  }

  const allowed = entry.parser.isAllowed(url, USER_AGENT);

  return allowed !== false;
}

// ============================================================
// FETCH AND PARSE
// ============================================================

async function fetchPage(url) {
  if (!isPublicWebUrl(url)) {
    throw new Error("URL is not an allowed public web URL.");
  }

  if (!(await canCrawl(url))) {
    const error = new Error("Blocked by robots.txt or robots check.");
    error.blocked = true;
    throw error;
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept:
        "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const finalUrl = normalizeUrl(response.url);

  if (!finalUrl || !isPublicWebUrl(finalUrl)) {
    throw new Error("Redirected to a disallowed URL.");
  }

  const contentType =
    response.headers.get("content-type") || "";

  if (!contentType.toLowerCase().includes("text/html")) {
    throw new Error("Not an HTML page.");
  }

  const html = await response.text();

  if (!html || html.length < 50) {
    throw new Error("HTML page is empty or too small.");
  }

  return {
    html,
    finalUrl,
    status: response.status,
  };
}

function parsePage(html, url) {
  const $ = cheerio.load(html);

  $("script, style, noscript, iframe, svg, canvas").remove();
  $("nav, footer, header, aside, form").remove();

  const title =
    $("title").first().text().trim() ||
    $("h1").first().text().trim() ||
    new URL(url).hostname;

  const description =
    $('meta[name="description"]').attr("content")?.trim() ||
    $('meta[property="og:description"]')
      .attr("content")
      ?.trim() ||
    "";

  const canonicalRaw =
    $('link[rel="canonical"]').attr("href") || url;

  const canonicalUrl = normalizeUrl(
    new URL(canonicalRaw, url).toString()
  ) || url;

  const language =
    $("html").attr("lang")?.trim().toLowerCase() ||
    "unknown";

  const content = $("body")
    .text()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CONTENT_CHARS);

  const links = [];

  $("a[href]").each((_, element) => {
    if (links.length >= MAX_LINKS_PER_PAGE) {
      return false;
    }

    const href = $(element).attr("href");

    if (!href) return;

    try {
      const normalized = normalizeUrl(
        new URL(href, url).toString()
      );

      if (
        normalized &&
        isPublicWebUrl(normalized) &&
        !links.includes(normalized)
      ) {
        links.push(normalized);
      }
    } catch {
      // Ignore malformed links.
    }
  });

  return {
    title: title.slice(0, 1000),
    description: description.slice(0, 3000),
    content,
    language: language.slice(0, 50),
    canonicalUrl,
    links,
    contentHash: sha256(content),
    wordCount: content
      ? content.split(/\s+/).length
      : 0,
  };
}

// ============================================================
// SAVE PAGE TO NEON
// ============================================================

async function savePage(page, archiveKey) {
  // This assumes pages.url has a UNIQUE constraint.
  // The index must only be updated after the archive succeeds.
  const result = await pool.query(
    `
    INSERT INTO pages (
      url,
      title,
      description,
      content,
      content_hash,
      word_count,
      language,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    ON CONFLICT (url)
    DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      content = EXCLUDED.content,
      content_hash = EXCLUDED.content_hash,
      word_count = EXCLUDED.word_count,
      language = EXCLUDED.language,
      updated_at = NOW()
    RETURNING url
    `,
    [
      page.canonicalUrl,
      page.title,
      page.description,
      page.content,
      page.contentHash,
      page.wordCount,
      page.language,
    ]
  );

  // Add archiveKey to a separate metadata table if your schema
  // supports it. This crawler does not assume such a column exists.
  return result.rowCount > 0;
}

// ============================================================
// QUEUE MANAGEMENT
// ============================================================

async function getJobs() {
  const columns = await getQueueColumnNames();

  if (
    !columns.has("url") ||
    !columns.has("status")
  ) {
    throw new Error(
      "crawl_queue must contain url and status columns."
    );
  }

  const orderColumn = columns.has("priority")
    ? "priority DESC, created_at ASC"
    : "created_at ASC";

  const createdOrder = columns.has("created_at")
    ? orderColumn
    : "url ASC";

  // Claim queued jobs in a transaction to reduce the chance
  // that multiple workers claim the same URL.
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(`
      SELECT *
      FROM crawl_queue
      WHERE status = 'queued'
      ORDER BY ${createdOrder}
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    `, [BATCH_SIZE]);

    const jobs = result.rows;

    if (jobs.length > 0) {
      const ids = jobs
        .map((job) => job.id)
        .filter((id) => id !== undefined && id !== null);

      if (ids.length !== jobs.length) {
        throw new Error(
          "crawl_queue rows need an id column for safe claiming."
        );
      }

      await client.query(
        `
        UPDATE crawl_queue
        SET status = 'processing'
        WHERE id = ANY($1::bigint[])
        `,
        [ids]
      );
    }

    await client.query("COMMIT");
    return jobs;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function enqueueUrls(urls, columns) {
  let added = 0;

  for (const rawUrl of urls) {
    const url = normalizeUrl(rawUrl);

    if (!url || !isPublicWebUrl(url)) continue;

    try {
      // Use only columns that actually exist.
      const insertColumns = ["url", "status"];
      const values = [url, "queued"];

      if (columns.has("priority")) {
        insertColumns.push("priority");
        values.push(0);
      }

      if (columns.has("created_at")) {
        insertColumns.push("created_at");
        values.push(new Date());
      }

      const placeholders = values.map(
        (_, index) => `$${index + 1}`
      );

      const result = await pool.query(
        `
        INSERT INTO crawl_queue (${insertColumns.join(", ")})
        VALUES (${placeholders.join(", ")})
        ON CONFLICT (url) DO NOTHING
        `,
        values
      );

      added += result.rowCount || 0;
    } catch (error) {
      console.error(
        `[HEXORA] Queue insert failed for ${url}: ${error.message}`
      );
    }
  }

  return added;
}

async function finishJob(job, finalUrl) {
  const columns = await getQueueColumnNames();

  const sets = ["status = 'done'"];
  const values = [];
  let index = 1;

  if (columns.has("last_crawled_at")) {
    sets.push(`last_crawled_at = NOW()`);
  }

  if (columns.has("updated_at")) {
    sets.push(`updated_at = NOW()`);
  }

  if (
    finalUrl &&
    finalUrl !== job.url &&
    columns.has("url")
  ) {
    values.push(finalUrl);
    sets.push(`url = $${index++}`);
  }

  values.push(job.id);

  await pool.query(
    `
    UPDATE crawl_queue
    SET ${sets.join(", ")}
    WHERE id = $${index}
    `,
    values
  );
}

async function failJob(job, error) {
  const columns = await getQueueColumnNames();

  const attempts = Number(job.retry_count || 0) + 1;
  const retryLimit = Number(
    process.env.CRAWL_MAX_RETRIES || 3
  );

  const blocked = Boolean(error.blocked);
  const status =
    !blocked && attempts < retryLimit
      ? "queued"
      : "failed";

  const sets = ["status = $1"];
  const values = [status];
  let index = 2;

  if (columns.has("retry_count")) {
    values.push(attempts);
    sets.push(`retry_count = $${index++}`);
  }

  if (columns.has("last_error")) {
    values.push(String(error.message || error).slice(0, 2000));
    sets.push(`last_error = $${index++}`);
  }

  if (columns.has("updated_at")) {
    sets.push("updated_at = NOW()");
  }

  values.push(job.id);

  await pool.query(
    `
    UPDATE crawl_queue
    SET ${sets.join(", ")}
    WHERE id = $${index}
    `,
    values
  );
}

// ============================================================
// ONE CRAWL JOB
// ============================================================

async function processJob(job) {
  const originalUrl = normalizeUrl(job.url);

  if (!originalUrl) {
    await failJob(
      job,
      new Error("Invalid URL in crawl queue.")
    );
    return { indexed: 0, failed: 1, blocked: 0, discovered: 0 };
  }

  try {
    const fetched = await fetchPage(originalUrl);
    const page = parsePage(fetched.html, fetched.finalUrl);

    if (!page.content || page.content.length < 80) {
      throw new Error("Page contains insufficient readable text.");
    }

    // Save to R2 first. Do not index a page if archive upload fails.
    const archiveKey = await saveHtmlToR2(
      fetched.finalUrl,
      fetched.html
    );

    await savePage(page, archiveKey);

    // Mark the original job complete.
    await finishJob(job, fetched.finalUrl);

    // Discover new URLs after successfully indexing this page.
    const columns = await getQueueColumnNames();
    const discovered = await enqueueUrls(
      page.links,
      columns
    );

    console.log(
      `[HEXORA] Indexed: ${fetched.finalUrl} ` +
      `(words=${page.wordCount}, links=${discovered})`
    );

    return {
      indexed: 1,
      failed: 0,
      blocked: 0,
      discovered,
    };
  } catch (error) {
    console.error(
      `[HEXORA] Crawl failed: ${originalUrl}: ${error.message}`
    );

    try {
      await failJob(job, error);
    } catch (queueError) {
      console.error(
        "[HEXORA] Could not update failed queue row:",
        queueError.message
      );
    }

    return {
      indexed: 0,
      failed: error.blocked ? 0 : 1,
      blocked: error.blocked ? 1 : 0,
      discovered: 0,
    };
  }
}

// ============================================================
// CRAWLER LOOP
// ============================================================

let stopping = false;

async function runCycle() {
  const storage = await getStorageStatus();

  if (storage.pause) {
    console.warn(
      `[HEXORA] Storage protection active. Crawler paused: ${storage.reason}`
    );
    return;
  }

  const jobs = await getJobs();

  if (jobs.length === 0) {
    console.log(
      "[HEXORA] No queued jobs. Check crawl_queue and seed URLs."
    );
    return;
  }

  let indexed = 0;
  let failed = 0;
  let blocked = 0;
  let discovered = 0;

  console.log(
    `[HEXORA] Starting cycle with ${jobs.length} jobs.`
  );

  for (const job of jobs) {
    if (stopping) break;

    const result = await processJob(job);

    indexed += result.indexed;
    failed += result.failed;
    blocked += result.blocked;
    discovered += result.discovered;

    // Respect target servers; don't crawl them aggressively.
    await sleep(DOMAIN_DELAY_MS);

    // Recheck storage during the batch.
    if (indexed > 0 && indexed % 3 === 0) {
      const currentStorage = await getStorageStatus();

      if (currentStorage.pause) {
        console.warn(
          `[HEXORA] Pausing remaining jobs: ${currentStorage.reason}`
        );
        break;
      }
    }
  }

  console.log(
    `[HEXORA] Cycle complete: jobs=${jobs.length} ` +
    `indexed=${indexed} failed=${failed} ` +
    `blocked=${blocked} discovered=${discovered}`
  );
}

async function main() {
  console.log("[HEXORA] Worldwide crawler starting...");

  if (!s3) {
    console.error(
      "[HEXORA] R2 S3 configuration incomplete. " +
      "Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, " +
      "R2_SECRET_ACCESS_KEY and R2_BUCKET_NAME."
    );
  }

  await checkDatabase();

  while (!stopping) {
    try {
      await runCycle();
    } catch (error) {
      console.error(
        "[HEXORA] Cycle error:",
        error.stack || error.message
      );
    }

    await sleep(PAUSE_DELAY_MS);
  }
}

process.on("SIGTERM", () => {
  stopping = true;
  console.log("[HEXORA] SIGTERM received; stopping safely.");
});

process.on("SIGINT", () => {
  stopping = true;
  console.log("[HEXORA] SIGINT received; stopping safely.");
});

main().catch((error) => {
  console.error(
    "[HEXORA] Fatal startup error:",
    error.stack || error.message
  );
  process.exitCode = 1;
});
