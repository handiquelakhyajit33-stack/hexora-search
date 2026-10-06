import crypto from "crypto";
import dns from "dns/promises";
import * as cheerio from "cheerio";
import pg from "pg";
import { putHtml } from "./storage.mjs";

const { Pool } = pg;

/* =========================================================
   HEXORA WORLDWIDE CRAWLER
   ========================================================= */

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("[HEXORA] DATABASE_URL is missing");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX || 5),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
  ssl:
    process.env.DATABASE_SSL === "false"
      ? false
      : { rejectUnauthorized: false },
});

/* =========================================================
   CONFIG
   ========================================================= */

const USER_AGENT =
  process.env.CRAWLER_USER_AGENT ||
  "HEXORA-Bot/1.0 (+https://hexora-search.com/bot)";

const REQUEST_TIMEOUT =
  Number(process.env.CRAWL_TIMEOUT_MS || 15000);

const MAX_HTML =
  Number(process.env.MAX_HTML_BYTES || 5000000);

const MAX_CONTENT =
  Number(process.env.MAX_CONTENT_CHARS || 100000);

const MAX_LINKS =
  Number(process.env.MAX_LINKS_PER_PAGE || 200);

const MAX_IMAGES =
  Number(process.env.MAX_IMAGES_PER_PAGE || 50);

const MAX_VIDEOS =
  Number(process.env.MAX_VIDEOS_PER_PAGE || 30);

const BATCH_SIZE =
  Number(process.env.CRAWL_BATCH_SIZE || 5);

const LOOP_DELAY =
  Number(process.env.CRAWL_LOOP_DELAY_MS || 5000);

const RECRAWL_HOURS =
  Number(process.env.RECRAWL_HOURS || 24);

const RETRY_DELAY =
  Number(process.env.RETRY_DELAY_MS || 60000);

const MAX_RETRIES =
  Number(process.env.MAX_RETRIES || 5);

const JOB_TIMEOUT =
  Number(process.env.CRAWL_JOB_TIMEOUT_MS || 20 * 60 * 1000);

/* =========================================================
   STATE
   ========================================================= */

let shuttingDown = false;

const robotsCache = new Map();
const hostLastRequest = new Map();

/* =========================================================
   LOGGING
   ========================================================= */

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function warn(...args) {
  console.warn(new Date().toISOString(), ...args);
}

function errorLog(...args) {
  console.error(new Date().toISOString(), ...args);
}

/* =========================================================
   SLEEP
   ========================================================= */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* =========================================================
   HASH
   ========================================================= */

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""))
    .digest("hex");
}

/* =========================================================
   URL NORMALIZATION
   ========================================================= */

function normalizeUrl(rawUrl, baseUrl = null) {
  try {
    const url = baseUrl
      ? new URL(rawUrl, baseUrl)
      : new URL(rawUrl);

    if (!["http:", "https:"].includes(url.protocol)) {
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

/* =========================================================
   PUBLIC HOST SAFETY
   ========================================================= */

function isPrivateIPv4(ip) {
  const parts = ip.split(".").map(Number);

  if (parts.length !== 4 || parts.some(Number.isNaN)) {
    return false;
  }

  const [a, b] = parts;

  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;

  return false;
}

function isPrivateIPv6(ip) {
  const value = ip.toLowerCase();

  return (
    value === "::1" ||
    value.startsWith("fc") ||
    value.startsWith("fd") ||
    value.startsWith("fe80:")
  );
}

async function safePublicHost(hostname) {
  const host = String(hostname || "")
    .toLowerCase()
    .replace(/\.$/, "");

  if (!host) return false;

  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  ) {
    return false;
  }

  try {
    const records = await dns.lookup(host, {
      all: true,
      verbatim: true,
    });

    if (!records.length) return false;

    for (const record of records) {
      if (record.family === 4 && isPrivateIPv4(record.address)) {
        return false;
      }

      if (record.family === 6 && isPrivateIPv6(record.address)) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

/* =========================================================
   DOMAIN RATE LIMIT
   ========================================================= */

async function domainDelay(hostname) {
  const host = String(hostname || "").toLowerCase();

  const last = hostLastRequest.get(host) || 0;

  const delay = 500;

  const wait = delay - (Date.now() - last);

  if (wait > 0) {
    await sleep(wait);
  }

  hostLastRequest.set(host, Date.now());
}

/* =========================================================
   FETCH
   ========================================================= */

async function fetchText(url) {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT
  );

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language":
          "en-US,en;q=0.9,as;q=0.8,hi;q=0.7",
      },
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
      throw new Error(`Not HTML: ${contentType}`);
    }

    const contentLength =
      Number(response.headers.get("content-length") || 0);

    if (contentLength > MAX_HTML) {
      throw new Error("HTML too large");
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.length > MAX_HTML) {
      throw new Error("HTML exceeded size limit");
    }

    return {
      html: buffer.toString("utf8"),
      finalUrl: response.url || url,
      contentType,
      status: response.status,
    };
  } finally {
    clearTimeout(timer);
  }
}

/* =========================================================
   RETRY
   ========================================================= */

async function fetchWithRetry(url, attempts = 3) {
  let lastError;

  for (let i = 1; i <= attempts; i++) {
    try {
      return await fetchText(url);
    } catch (err) {
      lastError = err;

      if (i < attempts) {
        await sleep(
          Math.min(RETRY_DELAY * i, 10000)
        );
      }
    }
  }

  throw lastError;
}

/* =========================================================
   ROBOTS
   ========================================================= */

function robotsAllowedFromText(text, targetUrl) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((x) => x.trim());

  let applies = false;
  let rules = [];

  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;

    const index = line.indexOf(":");

    if (index === -1) continue;

    const key = line
      .slice(0, index)
      .trim()
      .toLowerCase();

    const value = line
      .slice(index + 1)
      .trim();

    if (key === "user-agent") {
      applies =
        value === "*" ||
        value.toLowerCase() === USER_AGENT.toLowerCase();

      continue;
    }

    if (applies && key === "disallow") {
      rules.push({
        type: "disallow",
        value,
      });
    }

    if (applies && key === "allow") {
      rules.push({
        type: "allow",
        value,
      });
    }
  }

  const pathname = new URL(targetUrl).pathname || "/";

  let best = null;

  for (const rule of rules) {
    if (!rule.value) continue;

    if (pathname.startsWith(rule.value)) {
      if (!best || rule.value.length > best.value.length) {
        best = rule;
      }
    }
  }

  if (!best) return true;

  return best.type === "allow";
}

async function robotsAllowed(url) {
  let parsed;

  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const origin = parsed.origin;

  const cached = robotsCache.get(origin);

  if (cached && cached.expires > Date.now()) {
    return cached.allowed(url);
  }

  const robotsUrl = `${origin}/robots.txt`;

  try {
    await domainDelay(parsed.hostname);

    const result = await fetchText(robotsUrl);

    const text = result.html;

    const allowed = (target) =>
      robotsAllowedFromText(text, target);

    robotsCache.set(origin, {
      expires: Date.now() + 6 * 60 * 60 * 1000,
      allowed,
    });

    return allowed(url);
  } catch {
    /*
      If robots.txt cannot be downloaded, don't permanently
      block the entire website.
    */

    const allowed = () => true;

    robotsCache.set(origin, {
      expires: Date.now() + 30 * 60 * 1000,
      allowed,
    });

    return true;
  }
}

/* =========================================================
   LANGUAGE
   ========================================================= */

function detectLanguage(text) {
  const value = String(text || "").slice(0, 20000);

  if (/[\u0980-\u09FF]/.test(value)) {
    return "bn";
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

  if (/[\u0900-\u097F]/.test(value)) {
    return "hi";
  }

  if (/[\u0A00-\u0A7F]/.test(value)) {
    return "pa";
  }

  if (/[A-Za-z]/.test(value)) {
    return "en";
  }

  return "unknown";
}

/* =========================================================
   TEXT CLEANING
   ========================================================= */

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\u00a0/g, " ")
    .trim();
}

/* =========================================================
   PAGE EXTRACTION
   ========================================================= */

function extractPage(html, pageUrl) {
  const $ = cheerio.load(html);

  $(
    "script, style, noscript, template, svg, canvas, iframe"
  ).remove();

  const canonical =
    $('link[rel="canonical"]').attr("href") || null;

  const title =
    cleanText($("title").first().text()) ||
    cleanText($("h1").first().text());

  const description =
    cleanText(
      $('meta[name="description"]').attr("content") ||
        $('meta[property="og:description"]').attr("content") ||
        ""
    );

  const ogTitle =
    cleanText(
      $('meta[property="og:title"]').attr("content") || ""
    );

  const finalTitle = title || ogTitle;

  const bodyText = cleanText(
    $("body").text()
  ).slice(0, MAX_CONTENT);

  const excerpt =
    description ||
    bodyText.slice(0, 500);

  const language =
    $('html').attr("lang") ||
    detectLanguage(bodyText);

  const publishedAt =
    $('meta[property="article:published_time"]').attr(
      "content"
    ) ||
    $('meta[name="date"]').attr("content") ||
    $('time[datetime]').first().attr("datetime") ||
    null;

  /* ---------------- LINKS ---------------- */

  const links = [];
  const seenLinks = new Set();

  $("a[href]").each((_, el) => {
    if (links.length >= MAX_LINKS) return;

    const href = $(el).attr("href");

    const normalized = normalizeUrl(
      href,
      pageUrl
    );

    if (!normalized) return;

    if (seenLinks.has(normalized)) return;

    seenLinks.add(normalized);

    links.push(normalized);
  });

  /* ---------------- IMAGES ---------------- */

  const images = [];
  const seenImages = new Set();

  $("img").each((_, el) => {
    if (images.length >= MAX_IMAGES) return;

    const src =
      $(el).attr("src") ||
      $(el).attr("data-src") ||
      $(el).attr("data-lazy-src");

    if (!src) return;

    const normalized = normalizeUrl(
      src,
      pageUrl
    );

    if (!normalized) return;

    if (seenImages.has(normalized)) return;

    seenImages.add(normalized);

    images.push({
      url: normalized,
      alt: cleanText($(el).attr("alt") || ""),
      title: cleanText($(el).attr("title") || ""),
    });
  });

  /* ---------------- OPEN GRAPH IMAGE ---------------- */

  const ogImage =
    $('meta[property="og:image"]').attr("content");

  if (
    ogImage &&
    images.length < MAX_IMAGES
  ) {
    const normalized = normalizeUrl(
      ogImage,
      pageUrl
    );

    if (
      normalized &&
      !seenImages.has(normalized)
    ) {
      images.unshift({
        url: normalized,
        alt: finalTitle || "",
        title: finalTitle || "",
      });
    }
  }

  /* ---------------- VIDEOS ---------------- */

  const videos = [];
  const seenVideos = new Set();

  $("video, source").each((_, el) => {
    if (videos.length >= MAX_VIDEOS) return;

    const src =
      $(el).attr("src") ||
      $(el).attr("data-src");

    if (!src) return;

    const normalized = normalizeUrl(
      src,
      pageUrl
    );

    if (!normalized) return;

    if (seenVideos.has(normalized)) return;

    seenVideos.add(normalized);

    videos.push({
      url: normalized,
      type: $(el).attr("type") || null,
    });
  });

  /* ---------------- IFRAME VIDEOS ---------------- */

  $("iframe").each((_, el) => {
    if (videos.length >= MAX_VIDEOS) return;

    const src = $(el).attr("src");

    if (!src) return;

    const normalized = normalizeUrl(
      src,
      pageUrl
    );

    if (!normalized) return;

    if (seenVideos.has(normalized)) return;

    const lower = normalized.toLowerCase();

    if (
      lower.includes("youtube.com") ||
      lower.includes("youtu.be") ||
      lower.includes("vimeo.com") ||
      lower.includes("dailymotion.com")
    ) {
      seenVideos.add(normalized);

      videos.push({
        url: normalized,
        type: "embed",
      });
    }
  });

  const domain =
    (() => {
      try {
        return new URL(pageUrl).hostname;
      } catch {
        return null;
      }
    })();

  const wordCount =
    bodyText
      .split(/\s+/)
      .filter(Boolean)
      .length;

  return {
    url: pageUrl,
    canonicalUrl:
      normalizeUrl(canonical, pageUrl) ||
      pageUrl,
    title: finalTitle,
    description,
    excerpt,
    content: bodyText,
    language,
    publishedAt,
    domain,
    wordCount,
    links,
    images,
    videos,
  };
}

/* =========================================================
   QUEUE URL
   ========================================================= */

async function queueUrl(
  url,
  discoveredFrom = null,
  priority = 0
) {
  const normalized = normalizeUrl(url);

  if (!normalized) return false;

  try {
    const host = new URL(normalized).hostname;

    if (!(await safePublicHost(host))) {
      return false;
    }
  } catch {
    return false;
  }

  try {
    await pool.query(
      `
      INSERT INTO crawl_queue
        (
          url,
          status,
          priority,
          discovered_from,
          canonical_url,
          attempts,
          next_crawl_at
        )
      VALUES
        ($1, 'pending', $2, $3, $1, 0, NOW())
      ON CONFLICT (url)
      DO UPDATE SET
        priority = GREATEST(
          COALESCE(crawl_queue.priority, 0),
          EXCLUDED.priority
        ),
        next_crawl_at =
          CASE
            WHEN crawl_queue.status IN ('failed', 'error')
            THEN COALESCE(
              crawl_queue.next_crawl_at,
              NOW()
            )
            ELSE crawl_queue.next_crawl_at
          END
      `,
      [
        normalized,
        priority,
        discoveredFrom,
      ]
    );

    return true;
  } catch (err) {
    /*
      Fallback for older queue schemas.
    */

    try {
      await pool.query(
        `
        INSERT INTO crawl_queue
          (url, status)
        VALUES
          ($1, 'pending')
        ON CONFLICT (url)
        DO NOTHING
        `,
        [normalized]
      );

      return true;
    } catch {
      return false;
    }
  }
}

/* =========================================================
   SEEDS
   ========================================================= */

function getSeeds() {
  const raw =
    process.env.CRAWL_SEEDS ||
    process.env.SEED_URLS ||
    "";

  if (!raw.trim()) {
    return [
      "https://www.wikipedia.org/",
      "https://www.bbc.com/",
      "https://www.reuters.com/",
      "https://www.nasa.gov/",
      "https://www.mozilla.org/",
      "https://www.w3.org/",
    ];
  }

  return raw
    .split(/[\n,]+/)
    .map((x) => normalizeUrl(x.trim()))
    .filter(Boolean);
}

async function ensureSeeds() {
  const seeds = getSeeds();

  for (const seed of seeds) {
    await queueUrl(
      seed,
      "seed",
      100
    );
  }

  log(
    `[HEXORA] Seeds checked: ${seeds.length}`
  );
}

/* =========================================================
   RECOVER STALE JOBS
   ========================================================= */

async function recoverJobs() {
  try {
    const result = await pool.query(
      `
      UPDATE crawl_queue
      SET
        status = 'pending',
        locked_at = NULL,
        next_crawl_at = NOW()
      WHERE status = 'processing'
        AND (
          locked_at IS NULL
          OR locked_at < NOW() - INTERVAL '20 minutes'
        )
      RETURNING id
      `
    );

    if (result.rowCount) {
      log(
        `[HEXORA] Recovered stale jobs: ${result.rowCount}`
      );
    }
  } catch (err) {
    /*
      Compatible fallback for base schema.
    */

    try {
      const result = await pool.query(
        `
        UPDATE crawl_queue
        SET status = 'pending'
        WHERE status = 'processing'
        `
      );

      if (result.rowCount) {
        log(
          `[HEXORA] Recovered jobs: ${result.rowCount}`
        );
      }
    } catch (fallbackError) {
      warn(
        "[HEXORA] Job recovery warning:",
        fallbackError.message
      );
    }
  }
}

/* =========================================================
   CLAIM JOBS
   ========================================================= */

async function claimJobs(limit) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    /*
      IMPORTANT:
      Existing database contains a very large number
      of PENDING jobs. Therefore pending MUST be included.
    */

    const result = await client.query(
      `
      SELECT
        id,
        url,
        status,
        attempts
      FROM crawl_queue
      WHERE status IN ('pending', 'queued', 'failed')
        AND (
          next_crawl_at IS NULL
          OR next_crawl_at <= NOW()
        )
        AND COALESCE(attempts, 0) < $1
      ORDER BY
        COALESCE(priority, 0) DESC,
        COALESCE(created_at, NOW()) ASC
      LIMIT $2
      FOR UPDATE SKIP LOCKED
      `,
      [
        MAX_RETRIES + 1,
        limit,
      ]
    );

    if (!result.rows.length) {
      await client.query("COMMIT");
      return [];
    }

    const ids =
      result.rows.map((row) => row.id);

    await client.query(
      `
      UPDATE crawl_queue
      SET
        status = 'processing',
        locked_at = NOW(),
        attempts = COALESCE(attempts, 0) + 1
      WHERE id = ANY($1::bigint[])
      `,
      [ids]
    );

    await client.query("COMMIT");

    return result.rows.map((row) => ({
      ...row,
      attempts:
        Number(row.attempts || 0) + 1,
    }));
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/* =========================================================
   SAVE PAGE
   ========================================================= */

async function savePage(page, html) {
  const contentHash =
    sha256(page.content);

  let r2Key = null;

  try {
    r2Key = await putHtml(
      page.url,
      html
    );
  } catch (err) {
    warn(
      `[HEXORA] R2 save failed: ${page.url}`,
      err.message
    );
  }

  const imageJson =
    JSON.stringify(page.images || []);

  const videoJson =
    JSON.stringify(page.videos || []);

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
        canonical_url,
        excerpt,
        domain,
        published_at,
        last_crawled_at,
        crawl_status,
        quality_score,
        authority_score,
        popularity_score,
        inbound_links,
        image_items,
        video_items,
        r2_key,
        updated_at
      )
      VALUES
      (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,NOW(),'success',
        $12,$13,$14,0,$15,$16,$17,NOW()
      )
      ON CONFLICT (url)
      DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        content = EXCLUDED.content,
        content_hash = EXCLUDED.content_hash,
        word_count = EXCLUDED.word_count,
        language = EXCLUDED.language,
        canonical_url = EXCLUDED.canonical_url,
        excerpt = EXCLUDED.excerpt,
        domain = EXCLUDED.domain,
        published_at = EXCLUDED.published_at,
        last_crawled_at = NOW(),
        crawl_status = 'success',
        image_items = EXCLUDED.image_items,
        video_items = EXCLUDED.video_items,
        r2_key = EXCLUDED.r2_key,
        updated_at = NOW()
      `,
      [
        page.url,
        page.title,
        page.description,
        page.content,
        contentHash,
        page.wordCount,
        page.language,
        page.canonicalUrl,
        page.excerpt,
        page.domain,
        page.publishedAt,
        0.5,
        0.1,
        0.1,
        imageJson,
        videoJson,
        r2Key,
      ]
    );
  } catch (err) {
    /*
      Fallback for installations where some optional
      columns are not available.
    */

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
      ($1,$2,$3,$4,$5,$6,$7,NOW())
      ON CONFLICT (url)
      DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        content = EXCLUDED.content,
        content_hash = EXCLUDED.content_hash,
        word_count = EXCLUDED.word_count,
        language = EXCLUDED.language,
        updated_at = NOW()
      `,
      [
        page.url,
        page.title,
        page.description,
        page.content,
        contentHash,
        page.wordCount,
        page.language,
      ]
    );
  }

  return {
    contentHash,
    r2Key,
  };
}

/* =========================================================
   MARK SUCCESS
   ========================================================= */

async function markSuccess(
  jobId,
  url
) {
  try {
    await pool.query(
      `
      UPDATE crawl_queue
      SET
        status = 'done',
        last_crawled_at = NOW(),
        last_error = NULL,
        locked_at = NULL,
        failure_type = NULL,
        next_crawl_at =
          NOW() +
          ($2 * INTERVAL '1 hour')
      WHERE id = $1
      `,
      [
        jobId,
        RECRAWL_HOURS,
      ]
    );
  } catch {
    await pool.query(
      `
      UPDATE crawl_queue
      SET
        status = 'done',
        last_crawled_at = NOW(),
        last_error = NULL
      WHERE id = $1
      `,
      [jobId]
    );
  }

  log(
    `[HEXORA] indexed: ${url}`
  );
}

/* =========================================================
   MARK FAILURE
   ========================================================= */

async function markFailure(
  job,
  err,
  type = "error"
) {
  const message =
    String(err?.message || err || "Unknown error")
      .slice(0, 1000);

  const attempts =
    Number(job.attempts || 1);

  const permanent =
    attempts >= MAX_RETRIES;

  const status =
    permanent ? "dead" : "failed";

  try {
    await pool.query(
      `
      UPDATE crawl_queue
      SET
        status = $1,
        last_error = $2,
        locked_at = NULL,
        failure_type = $3,
        next_crawl_at =
          CASE
            WHEN $4 = TRUE THEN NULL
            ELSE NOW() +
              ($5 * INTERVAL '1 second')
          END
      WHERE id = $6
      `,
      [
        status,
        message,
        type,
        permanent,
        Math.min(
          RETRY_DELAY / 1000 * attempts,
          3600
        ),
        job.id,
      ]
    );
  } catch {
    await pool.query(
      `
      UPDATE crawl_queue
      SET
        status = $1,
        last_error = $2,
        locked_at = NULL
      WHERE id = $3
      `,
      [
        status,
        message,
        job.id,
      ]
    );
  }

  errorLog(
    `[HEXORA] ${status}: ${job.url} -> ${message}`
  );
}

/* =========================================================
   MARK BLOCKED
   ========================================================= */

async function markBlocked(
  job,
  reason
) {
  try {
    await pool.query(
      `
      UPDATE crawl_queue
      SET
        status = 'blocked',
        last_error = $1,
        locked_at = NULL,
        failure_type = 'robots'
      WHERE id = $2
      `,
      [
        String(reason || "Blocked").slice(0, 1000),
        job.id,
      ]
    );
  } catch {
    await pool.query(
      `
      UPDATE crawl_queue
      SET
        status = 'blocked',
        last_error = $1
      WHERE id = $2
      `,
      [
        String(reason || "Blocked").slice(0, 1000),
        job.id,
      ]
    );
  }
}

/* =========================================================
   CRAWL ONE JOB
   ========================================================= */

async function crawlJob(job) {
  const url = normalizeUrl(job.url);

  if (!url) {
    throw new Error("Invalid URL");
  }

  const parsed = new URL(url);

  if (!(await safePublicHost(parsed.hostname))) {
    await markBlocked(
      job,
      "Private or unsafe host"
    );

    return {
      status: "blocked",
    };
  }

  const allowed =
    await robotsAllowed(url);

  if (!allowed) {
    await markBlocked(
      job,
      "robots.txt disallow"
    );

    return {
      status: "blocked",
    };
  }

  await domainDelay(
    parsed.hostname
  );

  const result =
    await fetchWithRetry(url, 3);

  const finalUrl =
    normalizeUrl(result.finalUrl) || url;

  const page =
    extractPage(
      result.html,
      finalUrl
    );

  if (
    !page.content &&
    !page.title &&
    !page.description
  ) {
    throw new Error(
      "No useful page content"
    );
  }

  await savePage(
    page,
    result.html
  );

  /*
    Queue discovered URLs.
  */

  let discovered = 0;

  for (const link of page.links) {
    if (shuttingDown) break;

    const ok =
      await queueUrl(
        link,
        finalUrl,
        0
      );

    if (ok) {
      discovered++;
    }
  }

  await markSuccess(
    job.id,
    finalUrl
  );

  return {
    status: "done",
    discovered,
    images: page.images.length,
    videos: page.videos.length,
  };
}

/* =========================================================
   ONE CRAWL CYCLE
   ========================================================= */

export async function runCrawlCycle() {
  await recoverJobs();

  const jobs =
    await claimJobs(BATCH_SIZE);

  if (!jobs.length) {
    return {
      jobs: 0,
      completed: 0,
      failed: 0,
      blocked: 0,
    };
  }

  log(
    `[HEXORA] Starting batch: ${jobs.length} jobs`
  );

  let completed = 0;
  let failed = 0;
  let blocked = 0;

  /*
    Sequential processing helps avoid hammering
    websites and keeps memory usage lower.
  */

  for (const job of jobs) {
    if (shuttingDown) break;

    try {
      const result =
        await crawlJob(job);

      if (result.status === "done") {
        completed++;
      } else if (
        result.status === "blocked"
      ) {
        blocked++;
      }
    } catch (err) {
      failed++;

      await markFailure(
        job,
        err,
        "crawl"
      );
    }
  }

  log(
    `[HEXORA] Batch finished: jobs=${jobs.length} indexed=${completed} failed=${failed} blocked=${blocked}`
  );

  return {
    jobs: jobs.length,
    completed,
    failed,
    blocked,
  };
}

/* =========================================================
   DATABASE HEALTH
   ========================================================= */

async function databaseHealth() {
  const result =
    await pool.query(
      "SELECT NOW() AS now"
    );

  return result.rows[0];
}

/* =========================================================
   START CRAWLER
   ========================================================= */

async function startCrawler() {
  log(
    "[HEXORA] Worldwide crawler starting..."
  );

  log(
    `[HEXORA] Batch size: ${BATCH_SIZE}`
  );

  log(
    `[HEXORA] Timeout: ${REQUEST_TIMEOUT}ms`
  );

  log(
    `[HEXORA] Max retries: ${MAX_RETRIES}`
  );

  log(
    `[HEXORA] R2 storage: enabled`
  );

  await databaseHealth();

  log(
    "[HEXORA] Neon database connected."
  );

  await ensureSeeds();

  /*
    CONTINUOUS WORLDWIDE CRAWL LOOP
  */

  while (!shuttingDown) {
    try {
      const result =
        await runCrawlCycle();

      if (result.jobs === 0) {
        log(
          `[HEXORA] No ready jobs. Waiting ${Math.round(
            LOOP_DELAY / 1000
          )}s...`
        );

        await sleep(LOOP_DELAY);
      } else {
        /*
          Small pause between batches.
        */

        await sleep(1000);
      }
    } catch (err) {
      errorLog(
        "[HEXORA] Crawl cycle error:",
        err
      );

      await sleep(
        Math.max(LOOP_DELAY, 10000)
      );
    }
  }

  log(
    "[HEXORA] Crawler stopped."
  );
}

/* =========================================================
   SHUTDOWN
   ========================================================= */

export async function shutdownCrawler() {
  if (shuttingDown) return;

  shuttingDown = true;

  log(
    "[HEXORA] Shutdown requested..."
  );

  try {
    await pool.end();
  } catch (err) {
    errorLog(
      "[HEXORA] Database shutdown error:",
      err.message
    );
  }
}

process.on(
  "SIGTERM",
  shutdownCrawler
);

process.on(
  "SIGINT",
  shutdownCrawler
);

process.on(
  "uncaughtException",
  (err) => {
    errorLog(
      "[HEXORA] Uncaught exception:",
      err
    );
  }
);

process.on(
  "unhandledRejection",
  (reason) => {
    errorLog(
      "[HEXORA] Unhandled rejection:",
      reason
    );
  }
);

/* =========================================================
   AUTO START
   ========================================================= */

startCrawler().catch((err) => {
  errorLog(
    "[HEXORA] FATAL:",
    err
  );

  process.exit(1);
});
