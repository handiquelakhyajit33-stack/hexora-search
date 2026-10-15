import "dotenv/config";
import pg from "pg";
import * as cheerio from "cheerio";
import robotsParser from "robots-parser";
import crypto from "node:crypto";
import {
  S3Client,
  PutObjectCommand
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
// QUEUE HELPERS
// Requires crawl_queue.id, url and status.
// crawl_queue.url must have a UNIQUE constraint.
// ============================================================

async function enqueueUrls(urls) {
  const columns = await getColumns("crawl_queue");

  for (const url of [...new Set(urls)]) {
    const fields = ["url", "status"];
    const values = [url, "queued"];

    if (columns.has("created_at")) {
      fields.push("created_at");
      values.push(new Date());
    }

    if (columns.has("updated_at")) {
      fields.push("updated_at");
      values.push(new Date());
    }

    const placeholders = values.map(
      (_, i) => `$${i + 1}`
    );

    await pool.query(
      `INSERT INTO crawl_queue
        (${fields.map(c => `"${c}"`).join(",")})
       VALUES (${placeholders.join(",")})
       ON CONFLICT (url) DO NOTHING`,
      values
    );
  }
}

async function getJobs() {
  const columns = await getColumns("crawl_queue");

  if (
    !columns.has("id") ||
    !columns.has("url") ||
    !columns.has("status")
  ) {
    throw new Error(
      "crawl_queue needs id, url and status columns"
    );
  }

  let order = columns.has("priority")
    ? '"priority" DESC'
    : '"url" ASC';

  if (columns.has("created_at")) {
    order += ', "created_at" ASC';
  }

  const result = await pool.query(
    `SELECT id, url
       FROM crawl_queue
      WHERE status IN ('queued', 'pending', 'retry')
      ORDER BY ${order}
      LIMIT $1`,
    [BATCH_SIZE]
  );

  return result.rows;
}

async function updateJob(id, status, message = null) {
  const columns = await getColumns("crawl_queue");

  const sets = ['"status" = $1'];
  const values = [status];
  let next = 2;

  if (columns.has("updated_at")) {
    sets.push('"updated_at" = NOW()');
  }

  if (
    status === "done" &&
    columns.has("last_crawled_at")
  ) {
    sets.push('"last_crawled_at" = NOW()');
  }

  if (columns.has("last_error")) {
    sets.push(`"last_error" = $${next++}`);
    values.push(message);
  } else if (columns.has("error")) {
    sets.push(`"error" = $${next++}`);
    values.push(message);
  }

  values.push(id);

  await pool.query(
    `UPDATE crawl_queue
        SET ${sets.join(", ")}
      WHERE id = $${next}`,
    values
  );
}

// ============================================================
// R2 ARCHIVE
// Writes a JSON copy of the crawled page to R2.
// No R2 storage usage check is performed.
// ============================================================

async function archiveToR2(page) {
  if (!s3) {
    throw new Error(
      "R2 S3 credentials are not configured"
    );
  }

  const host = new URL(page.url).hostname;
  const key = `pages/${host}/${hash(page.url)}.json`;

  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: JSON.stringify({
        ...page,
        crawled_at: new Date().toISOString()
      }),
      ContentType: "application/json"
    })
  );

  return key;
}

// ============================================================
// SAVE TO NEON
// Requires a UNIQUE constraint on pages.url.
// ============================================================

async function savePage(page) {
  // First save the complete page body to R2. If R2 fails, do not pretend
  // that the page was archived or mark the job complete.
  const r2Key = await archiveToR2(page);
  const columns = await getColumns("pages");
  const hostname = (() => {
    try { return new URL(page.url).hostname.toLowerCase(); }
    catch { return ""; }
  })();

  // Keep only a compact searchable excerpt in Neon. The full body stays in R2.
  // Existing rows' content is deliberately excluded from UPDATE so old data
  // is never erased by a new crawl.
  const compactExcerpt = String(page.content || "").slice(0, 1800);
  const compactDescription = String(
    page.description || compactExcerpt || ""
  ).slice(0, 3000);

  const data = {
    url: page.url,
    canonical_url: page.canonical_url || page.url,
    title: page.title,
    description: compactDescription,
    excerpt: compactExcerpt,
    content: null,
    content_hash: page.content_hash,
    word_count: page.word_count,
    language: page.language,
    domain: hostname,
    r2_key: r2Key,
    last_crawled_at: new Date(),
    updated_at: new Date(),
    crawl_status: "indexed"
  };

  const fields = Object.keys(data).filter(key => columns.has(key));
  if (!fields.includes("url")) {
    throw new Error("pages.url column is missing");
  }

  const values = fields.map(key => data[key]);
  const placeholders = fields.map((_, i) => `$${i + 1}`);
  // Never overwrite the existing full content column on conflict.
  const updates = fields
    .filter(key => key !== "url" && key !== "content")
    .map(key => `"${key}" = EXCLUDED."${key}"`);

  await pool.query(
    `INSERT INTO pages (${fields.map(c => `"${c}"`).join(",")})
     VALUES (${placeholders.join(",")})
     ON CONFLICT (url) DO UPDATE SET
       ${updates.length ? updates.join(",") : '"url" = EXCLUDED."url"'}`,
    values
  );

  console.log(`[HEXORA] R2 archived: ${r2Key}; compact metadata indexed in Neon`);
  return { duplicate: false, r2Key };
}

// ============================================================
// PROCESS A QUEUED URL
// ============================================================

async function processJob(job) {
  const url = normalizeUrl(job.url);

  if (!url) {
    await updateJob(
      job.id,
      "failed",
      "Invalid URL"
    );

    return "failed";
  }

  try {
    if (!(await canCrawl(url))) {
      await updateJob(
        job.id,
        "blocked",
        "Robots policy denied or unavailable"
      );

      return "blocked";
    }

    const page = await fetchPage(url);
    const saved = await savePage(page);

    if (saved.duplicate) {
      await updateJob(job.id, "done");

      console.log(
        `[HEXORA] Duplicate skipped: ${page.url}`
      );

      return "duplicate";
    }

    await enqueueUrls(page.links);
    await updateJob(job.id, "done");

    console.log(
      `[HEXORA] Indexed: ${page.url}`
    );

    return "indexed";
  } catch (error) {
    console.error(
      `[HEXORA] Failed ${url}:`,
      error.message
    );

    try {
      await updateJob(
        job.id,
        "failed",
        error.message.slice(0, 1000)
      );
    } catch (updateError) {
      console.error(
        "[HEXORA] Queue update failed:",
        updateError.message
      );
    }

    return "failed";
  }
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log(
    "[HEXORA] Worldwide crawler starting..."
  );

  console.log(
    "[HEXORA] Storage mode: full page bodies in R2; compact search metadata in Neon."
  );

  try {
    await pool.query("SELECT 1");

    console.log(
      "[HEXORA] Neon database connected."
    );

    await getColumns("pages");
    await getColumns("crawl_queue");
  } catch (error) {
    console.error(
      "[HEXORA] Database/schema check failed:",
      error.message
    );

    process.exit(1);
  }

  while (true) {
    try {
      // Do not pause crawling on the old Neon content-storage threshold.
      // R2 holds full content; Neon receives compact metadata only.

      const jobs = await getJobs();

      if (!jobs.length) {
        console.log(
          "[HEXORA] No queued jobs."
        );

        await sleep(LOOP_DELAY);
        continue;
      }

      let indexed = 0;
      let failed = 0;
      let blocked = 0;
      let duplicates = 0;

      for (const job of jobs) {
        const result = await processJob(job);

        if (result === "indexed") indexed++;
        else if (result === "failed") failed++;
        else if (result === "blocked") blocked++;
        else if (result === "duplicate") duplicates++;

        await sleep(1000);
      }

      console.log(
        `[HEXORA] Cycle complete: jobs=${jobs.length} ` +
        `indexed=${indexed} failed=${failed} ` +
        `blocked=${blocked} duplicates=${duplicates}`
      );
    } catch (error) {
      console.error(
        "[HEXORA] Cycle error:",
        error.message
      );
    }

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
