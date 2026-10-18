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

// Public .com starting points. Robots rules and site rate limits still apply.
// Additional seed URLs can be supplied through CRAWL_SEED_URLS (comma-separated).
const DEFAULT_COM_SEEDS = [
  // User-requested first targets: Amazon and Flipkart.
  "https://www.flipkart.com/",
  "https://www.amazon.com/",
  "https://www.amazon.in/",
  "https://www.youtube.com/",
  "https://www.facebook.com/",
  "https://www.whatsapp.com/",
  "https://www.instagram.com/",
  "https://www.reddit.com/",
  "https://www.microsoft.com/",
  "https://www.apple.com/",
  "https://www.netflix.com/",
  "https://www.google.com/",
  "https://www.linkedin.com/",
  "https://www.nytimes.com/",
  "https://www.cnn.com/",
  "https://www.bbc.com/",
  "https://www.espn.com/",
  "https://www.nfl.com/",
  "https://www.ebay.com/",
  "https://www.walmart.com/",
  "https://www.target.com/",
  "https://www.adobe.com/",
  "https://www.oracle.com/",
  "https://www.ibm.com/",
  "https://www.salesforce.com/",
  "https://www.dropbox.com/",
  "https://www.zoom.com/",
  "https://www.canva.com/",
  "https://www.shopify.com/",
  "https://www.booking.com/",
  "https://www.expedia.com/",
  "https://www.airbnb.com/",
  "https://www.spotify.com/",
  "https://www.pinterest.com/",
  "https://www.tiktok.com/",
  "https://www.stackoverflow.com/",
  "https://www.github.com/",
  "https://www.cloudflare.com/",
  "https://www.cloudflare.com/learning/",
  "https://www.weather.com/",
  "https://www.accuweather.com/",
  "https://www.imdb.com/",
  "https://www.rottentomatoes.com/",
  "https://www.nationalgeographic.com/"
];

const SEED_URLS = String(env.CRAWL_SEED_URLS || "")
  .split(",")
  .map(value => value.trim())
  .filter(Boolean);

const HOST_MIN_DELAY_MS = Math.max(
  1500,
  Number(env.CRAWL_HOST_DELAY_MS || 2500)
);
const MAX_HTML_BYTES = Math.max(
  256 * 1024,
  Number(env.CRAWL_MAX_HTML_BYTES || 2 * 1024 * 1024)
);
const hostLastRequest = new Map();

function isComDomain(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  return host === "com" || host.endsWith(".com");
}

function isComUrl(value) {
  try { return isComDomain(new URL(value).hostname); }
  catch { return false; }
}

function crawlPriority(value) {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    // Highest priority for the explicitly requested public storefronts.
    if (host === "flipkart.com" || host.endsWith(".flipkart.com")) return 100000;
    if (host === "amazon.com" || host.endsWith(".amazon.com")) return 99000;
    if (host === "amazon.in" || host.endsWith(".amazon.in")) return 98000;
  } catch {}
  return isComUrl(value) ? 1000 : 100;
}

async function waitForHost(url) {
  const host = new URL(url).hostname.toLowerCase();
  const previous = hostLastRequest.get(host) || 0;
  const wait = HOST_MIN_DELAY_MS - (Date.now() - previous);
  if (wait > 0) await sleep(wait);
  hostLastRequest.set(host, Date.now());
}

async function readHtmlLimited(response) {
  if (!response.body || typeof response.body.getReader !== "function") {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_HTML_BYTES) {
      throw new Error(`HTML exceeds ${MAX_HTML_BYTES} byte safety limit`);
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_HTML_BYTES) {
        await reader.cancel().catch(() => {});
        throw new Error(`HTML exceeds ${MAX_HTML_BYTES} byte safety limit`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  return Buffer.concat(chunks).toString("utf8");
}

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
  let response;
  for (let attempt = 1; attempt <= 3; attempt++) {
    await waitForHost(url);
    try {
      response = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml"
        },
        redirect: "follow",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT)
      });
    } catch (error) {
      if (attempt >= 3) throw error;
      await sleep(1000 * attempt);
      continue;
    }

    if (response.ok) break;
    const status = response.status;
    const retryable = status === 408 || status === 425 || status === 429 || status >= 500;
    if (!retryable || attempt >= 3) {
      throw new Error(`HTTP ${status}`);
    }
    const retryAfter = Number(response.headers.get("retry-after") || 0);
    const waitMs = Math.min(30000, Math.max(1000 * attempt, retryAfter * 1000));
    try { await response.body?.cancel(); } catch {}
    console.warn(`[HEXORA] Temporary HTTP ${status}; bounded retry ${attempt}/2 after ${waitMs}ms: ${url}`);
    await sleep(waitMs);
  }

  if (!response || !response.ok) {
    throw new Error("Request failed after bounded retries");
  }

  const finalUrl = normalizeUrl(response.url || url);
  if (!finalUrl) throw new Error("Invalid final URL after redirect");
  // Do not let an allowed .com seed silently redirect the crawler onto another TLD.
  if (isComUrl(url) && !isComUrl(finalUrl)) {
    throw new Error("Redirect left .com domain scope");
  }

  const contentType =
    response.headers.get("content-type") || "";

  if (
    !contentType.includes("text/html") &&
    !contentType.includes("application/xhtml+xml")
  ) {
    throw new Error("URL does not return HTML");
  }

  const html = await readHtmlLimited(response);
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

      // Keep same-host navigation and discover other public .com hosts.
      // This is bounded by MAX_LINKS and the queue's URL uniqueness constraint.
      if (
        normalized &&
        (target.hostname.toLowerCase() === responseHost.toLowerCase() || isComDomain(target.hostname)) &&
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

    if (columns.has("priority")) {
      fields.push("priority");
      values.push(crawlPriority(url));
    }

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

  // .com seeds and discoveries are processed before legacy non-.com queue rows.
  let order = `CASE
    WHEN lower(split_part(split_part(url, '/', 3), ':', 1)) LIKE '%.com' THEN 0
    ELSE 1
  END ASC`;

  if (columns.has("priority")) {
    order += ', "priority" DESC';
  }
  if (columns.has("created_at")) {
    order += ', "created_at" ASC';
  } else {
    order += ', url ASC';
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
    const seeds = [...new Set([...DEFAULT_COM_SEEDS, ...SEED_URLS])]
      .map(normalizeUrl)
      .filter(Boolean);
    await enqueueUrls(seeds);

    // Promote already-queued storefront URLs too; ON CONFLICT alone would
    // otherwise leave old queue rows at their previous priority.
    const queueColumns = await getColumns("crawl_queue");
    if (queueColumns.has("priority")) {
      await pool.query(`
        UPDATE crawl_queue
           SET priority = GREATEST(COALESCE(priority, 0),
             CASE
               WHEN lower(url) ~ '^https?://([^/]*\.)?flipkart\.com([/:]|$)' THEN 100000
               WHEN lower(url) ~ '^https?://([^/]*\.)?amazon\.com([/:]|$)' THEN 99000
               WHEN lower(url) ~ '^https?://([^/]*\.)?amazon\.in([/:]|$)' THEN 98000
               ELSE COALESCE(priority, 0)
             END)
         WHERE status IN ('queued', 'pending', 'retry')
           AND lower(url) ~ '^https?://([^/]*\.)?(flipkart\.com|amazon\.com|amazon\.in)([/:]|$)'
      `);
    }
    console.log(`[HEXORA] Priority seeds queued: Flipkart, Amazon.com, Amazon.in; total seeds: ${seeds.length}`);
    console.log(`[HEXORA] Host delay: ${HOST_MIN_DELAY_MS}ms; max HTML: ${MAX_HTML_BYTES} bytes; transient retries: 2`);
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
