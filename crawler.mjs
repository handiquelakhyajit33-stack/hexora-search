import "dotenv/config";
import pg from "pg";
import * as cheerio from "cheerio";
import robotsParser from "robots-parser";
import crypto from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand
} from "@aws-sdk/client-s3";

const { Pool } = pg;
const env = process.env;

// ============================================================
// HEXORA WORLDWIDE CRAWLER
// Neon = compact searchable metadata only
// R2 = full crawled page content
// Full page content is archived to R2 before metadata indexing
// ============================================================

const DATABASE_URL = env.DATABASE_URL || "";
const CF_ACCOUNT_ID = env.R2_ACCOUNT_ID || "";
const R2_BUCKET = env.R2_BUCKET_NAME || "hexora";

const BATCH_SIZE = Math.max(
  1,
  Math.min(20, Number(env.CRAWL_BATCH_SIZE || 5))
);

const LOOP_DELAY = Math.max(
  5000,
  Number(env.CRAWL_DELAY_MS || 15000)
);

const REQUEST_TIMEOUT = Math.max(
  5000,
  Number(env.CRAWL_TIMEOUT_MS || 15000)
);

const MAX_CONTENT = Math.max(
  1000,
  Number(env.CRAWL_MAX_CONTENT || 50000)
);

const MAX_LINKS = Math.max(
  1,
  Math.min(200, Number(env.CRAWL_MAX_LINKS || 50))
);

const USER_AGENT =
  env.HEXORA_USER_AGENT ||
  "HEXORA-Bot/1.0 (+https://hexorasearch.com/)";

if (!DATABASE_URL) {
  console.error("[HEXORA] DATABASE_URL missing.");
  process.exit(1);
}

// ============================================================
// NEON CONNECTION
// ============================================================

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: Math.max(1, Number(env.DB_POOL_MAX || 5)),
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000,
  ssl: { rejectUnauthorized: false }
});

// ============================================================
// CLOUDFLARE R2 CONNECTION
// R2 storage is used for archiving pages.
// No Cloudflare Analytics token is required.
// ============================================================

const s3 =
  CF_ACCOUNT_ID &&
  env.R2_ACCESS_KEY_ID &&
  env.R2_SECRET_ACCESS_KEY
    ? new S3Client({
        region: "auto",
        endpoint:
          `https://${CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: env.R2_ACCESS_KEY_ID,
          secretAccessKey: env.R2_SECRET_ACCESS_KEY
        }
      })
    : null;

if (!s3) {
  console.warn(
    "[HEXORA] R2 credentials missing. R2 archiving will fail " +
    "until R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and " +
    "R2_SECRET_ACCESS_KEY are configured."
  );
}

const columnCache = new Map();
const robotsCache = new Map();

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

function hash(value) {
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("hex");
}

// ============================================================
// URL NORMALIZATION
// ============================================================

function normalizeUrl(value) {
  try {
    const u = new URL(value);

    if (!["http:", "https:"].includes(u.protocol)) {
      return null;
    }

    u.hash = "";
    u.hostname = u.hostname.toLowerCase();

    for (const key of [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid"
    ]) {
      u.searchParams.delete(key);
    }

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

// ============================================================
// DATABASE SCHEMA HELPERS
// ============================================================

async function getColumns(table) {
  if (columnCache.has(table)) {
    return columnCache.get(table);
  }

  const result = await pool.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1`,
    [table]
  );

  const columns = new Set(
    result.rows.map(row => row.column_name)
  );

  if (columns.size === 0) {
    throw new Error(`Missing database table: public.${table}`);
  }

  columnCache.set(table, columns);
  return columns;
}

// ============================================================
// STORAGE STATUS
// New page bodies are stored in R2. Neon stores compact metadata.
// Do not pause the R2 crawler because the old Neon content quota is full.
// ============================================================

async function getStorageStatus() {
  return { safe: true, mode: "R2-first; compact Neon metadata" };
}

// ============================================================
// ROBOTS.TXT
// If robots.txt is unavailable, skip the site.
// ============================================================

async function canCrawl(url) {
  const parsed = new URL(url);
  const robotsUrl = `${parsed.origin}/robots.txt`;

  if (!robotsCache.has(robotsUrl)) {
    try {
      const response = await fetch(robotsUrl, {
        headers: {
          "User-Agent": USER_AGENT
        },
        redirect: "follow",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT)
      });

      if (response.status === 404) {
        robotsCache.set(
          robotsUrl,
          robotsParser(robotsUrl, "")
        );
      } else {
        if (!response.ok) {
          throw new Error(
            `robots.txt HTTP ${response.status}`
          );
        }

        robotsCache.set(
          robotsUrl,
          robotsParser(
            robotsUrl,
            await response.text()
          )
        );
      }
    } catch (error) {
      console.warn(
        `[HEXORA] robots.txt unavailable for ${parsed.hostname}:`,
        error.message
      );

      return false;
    }
  }

  return (
    robotsCache.get(robotsUrl)
      .isAllowed(url, "HEXORA-Bot") !== false
  );
}

// ============================================================
// FETCH AND PARSE HTML
// ============================================================

async function fetchPage(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const contentType =
    response.headers.get("content-type") || "";

  if (
    !contentType.includes("text/html") &&
    !contentType.includes("application/xhtml+xml")
  ) {
    throw new Error("URL does not return HTML");
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  $(
    "script, style, noscript, iframe, svg, canvas, nav, footer"
  ).remove();

  const title = (
    $("title").first().text() ||
    $("h1").first().text() ||
    url
  ).trim().slice(0, 1000);

  const description = (
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") ||
    ""
  ).trim().slice(0, 3000);

  let canonical = normalizeUrl(response.url);

  const canonicalHref =
    $('link[rel="canonical"]').attr("href");

  if (canonicalHref) {
    try {
      canonical =
        normalizeUrl(
          new URL(
            canonicalHref,
            response.url
          ).toString()
        ) || canonical;
    } catch {
      // Ignore invalid canonical URLs.
    }
  }

  const content = $("body")
    .text()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CONTENT);

  const links = [];
  const responseHost = new URL(response.url).hostname;

  $("a[href]").each((_, element) => {
    if (links.length >= MAX_LINKS) {
      return false;
    }

    try {
      const target = new URL(
        $(element).attr("href"),
        response.url
      );

      const normalized = normalizeUrl(target.toString());

      // Discover same-host links only.
      if (
        normalized &&
        target.hostname === responseHost &&
        !links.includes(normalized)
      ) {
        links.push(normalized);
      }
    } catch {
      // Ignore malformed links.
    }
  });

  return {
    url: canonical || normalizeUrl(response.url) || url,
    title,
    description,
    content,
    content_hash: hash(content),
    word_count: content
      ? content.split(/\s+/u).length
      : 0,
    language: (
      $("html").attr("lang") || "unknown"
    ).slice(0, 20),
    links
  };
}

// ============================================================
// R2 QUEUE HELPERS — crawler never writes to Neon
// ============================================================
async function readR2Json(key) {
  if (!s3) return null;
  try {
    const response = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return JSON.parse(await response.Body.transformToString());
  } catch (error) {
    if (error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}

async function putR2Json(key, value) {
  if (!s3) throw new Error("R2 S3 credentials are not configured");
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET, Key: key,
    Body: JSON.stringify(value), ContentType: "application/json"
  }));
}

async function enqueueUrls(urls) {
  for (const raw of [...new Set(urls)]) {
    const url = normalizeUrl(raw);
    if (!url) continue;
    const key = `queue/pending/${hash(url)}.json`;
    await putR2Json(key, { url, queued_at: new Date().toISOString(), attempts: 0 });
  }
}

async function getJobs() {
  if (!s3) throw new Error("R2 S3 credentials are not configured");
  const listed = await s3.send(new ListObjectsV2Command({
    Bucket: R2_BUCKET, Prefix: "queue/pending/", MaxKeys: BATCH_SIZE
  }));
  const jobs = [];
  for (const item of (listed.Contents || [])) {
    if (!item.Key) continue;
    const job = await readR2Json(item.Key);
    if (job?.url) jobs.push({ ...job, key: item.Key });
  }
  return jobs;
}

async function finishJob(job, status, message = null) {
  if (!job?.key) return;
  if (status === "done" || status === "blocked") {
    await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: job.key }));
    if (status === "blocked") {
      await putR2Json(`queue/blocked/${hash(job.url)}.json`, {
        url: job.url, status, message, updated_at: new Date().toISOString()
      });
    }
    return;
  }
  await putR2Json(`queue/failed/${hash(job.url)}.json`, {
    url: job.url, status, message, updated_at: new Date().toISOString()
  });
  await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: job.key }));
}

// Import a small batch of the old Neon queue into R2. This query is READ-ONLY;
// an offset marker in R2 prevents re-importing the same rows on every restart.
async function importLegacyNeonQueue() {
  if (!DATABASE_URL || !s3) return;
  const markerKey = "meta/neon-queue-import-offset.json";
  const marker = await readR2Json(markerKey);
  if (marker?.completed === true) return;
  const offset = Math.max(0, Number(marker?.offset || 0));
  try {
    const result = await pool.query(
      `SELECT url FROM crawl_queue WHERE status IN ('queued','pending','retry') ORDER BY id ASC LIMIT $1 OFFSET $2`,
      [Math.max(100, Math.min(1000, Number(env.CRAWL_QUEUE_MIGRATE_BATCH || 500))), offset]
    );
    for (const row of result.rows) await enqueueUrls([row.url]);
    const nextOffset = offset + result.rows.length;
    await putR2Json(markerKey, {
      offset: result.rows.length ? nextOffset : 0,
      last_batch_count: result.rows.length,
      updated_at: new Date().toISOString(),
      completed: result.rows.length === 0
    });
    if (result.rows.length) console.log(`[HEXORA] Imported ${result.rows.length} legacy queue URLs from Neon (read-only); offset=${nextOffset}`);
  } catch (error) {
    console.warn("[HEXORA] Legacy Neon queue import skipped (read-only):", error.message);
  }
}

// ============================================================
// R2 ARCHIVE + SEARCH INDEX — no crawler writes to Neon
// ============================================================
async function archiveToR2(page) {
  if (!s3) throw new Error("R2 S3 credentials are not configured");
  const host = new URL(page.url).hostname;
  const pageKey = `pages/${host}/${hash(page.url)}.json`;
  const crawledAt = new Date().toISOString();
  const savedPage = { ...page, crawled_at: crawledAt };
  await putR2Json(pageKey, savedPage);
  const indexDoc = {
    id: hash(page.url), url: page.url, canonical_url: page.url,
    title: page.title || "", description: page.description || "",
    excerpt: String(page.content || "").slice(0, 1800),
    language: page.language || "unknown", domain: host,
    r2_key: pageKey, crawled_at: crawledAt,
    search_text: `${page.title || ""} ${page.description || ""} ${String(page.content || "").slice(0, 5000)}`.slice(0, 7000)
  };
  await putR2Json(`index/${host}/${hash(page.url)}.json`, indexDoc);
  console.log(`[HEXORA] R2 saved page + search index: ${page.url}`);
  return pageKey;
}

async function savePage(page) {
  const r2Key = await archiveToR2(page);
  return { duplicate: false, r2Key };
}

// ============================================================
// PROCESS A QUEUED URL — queue/status are stored only in R2
// ============================================================
async function processJob(job) {
  const url = normalizeUrl(job.url);
  if (!url) { await finishJob(job, "failed", "Invalid URL"); return "failed"; }
  try {
    if (!(await canCrawl(url))) {
      await finishJob(job, "blocked", "Robots policy denied or unavailable");
      return "blocked";
    }
    const page = await fetchPage(url);
    await savePage(page);
    await enqueueUrls(page.links);
    await finishJob(job, "done");
    console.log(`[HEXORA] Indexed to R2: ${page.url}`);
    return "indexed";
  } catch (error) {
    console.error(`[HEXORA] Failed ${url}:`, error.message);
    try { await finishJob(job, "failed", error.message.slice(0, 1000)); } catch {}
    return "failed";
  }
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log("[HEXORA] Worldwide crawler starting...");
  console.log("[HEXORA] Storage mode: R2-only writes (page data, search index, and queue). Neon is read-only for legacy queue import.");
  if (!s3) { console.error("[HEXORA] R2 credentials missing. Configure R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME."); process.exit(1); }
  if (DATABASE_URL) {
    try { await pool.query("SELECT 1"); console.log("[HEXORA] Neon read-only connection available for legacy queue import."); }
    catch (error) { console.warn("[HEXORA] Neon unavailable; continuing with R2 queue only:", error.message); }
  } else {
    console.log("[HEXORA] DATABASE_URL not set; using only R2 queue/seeds.");
  }
  const seeds = String(env.CRAWL_SEED_URLS || "").split(/[\s,]+/).filter(Boolean);
  if (seeds.length) { await enqueueUrls(seeds); console.log(`[HEXORA] Seed URLs queued in R2: ${seeds.length}`); }
  while (true) {
    try {
      await importLegacyNeonQueue();
      const jobs = await getJobs();
      if (!jobs.length) {
        console.log("[HEXORA] No R2 queued jobs. Set CRAWL_SEED_URLS or wait for legacy queue import.");
        await sleep(LOOP_DELAY); continue;
      }
      let indexed = 0, failed = 0, blocked = 0;
      for (const job of jobs) {
        const result = await processJob(job);
        if (result === "indexed") indexed++;
        else if (result === "failed") failed++;
        else if (result === "blocked") blocked++;
        await sleep(1000);
      }
      console.log(`[HEXORA] Cycle complete: jobs=${jobs.length} indexed=${indexed} failed=${failed} blocked=${blocked}`);
    } catch (error) { console.error("[HEXORA] Cycle error:", error.message); }
    await sleep(LOOP_DELAY);
  }
}

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(
    "[HEXORA] Shutdown requested."
  );

  try {
    await pool.end();
  } catch (error) {
    console.error(
      "[HEXORA] Database shutdown error:",
      error.message
    );
  }

  try {
    s3?.destroy();
  } catch {
    // Ignore S3 client shutdown errors.
  }

  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

main().catch(error => {
  console.error(
    "[HEXORA] Fatal error:",
    error
  );

  process.exit(1);
});
