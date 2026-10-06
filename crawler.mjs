// crawler.mjs
import crypto from "node:crypto";
import dns from "node:dns/promises";
import * as cheerio from "cheerio";
import pg from "pg";
import { putHtml } from "./storage.mjs";

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: Number(process.env.CRAWL_DB_POOL || 5),
  ssl: process.env.DATABASE_SSL === "false"
    ? false
    : { rejectUnauthorized: false }
});

const USER_AGENT =
  process.env.HEXORA_USER_AGENT ||
  "HEXORA-Crawler/2.0 (+https://hexora.example)";

const TIMEOUT = Number(process.env.CRAWL_TIMEOUT_MS || 20000);
const MAX_HTML = Number(process.env.CRAWL_MAX_HTML_BYTES || 5000000);
const MAX_CONTENT = Number(process.env.CRAWL_MAX_CONTENT || 50000);
const MAX_LINKS = Number(process.env.CRAWL_MAX_LINKS || 500);
const MAX_IMAGES = Number(process.env.CRAWL_MAX_IMAGES || 50);
const MAX_VIDEOS = Number(process.env.CRAWL_MAX_VIDEOS || 30);

const BATCH_SIZE = Number(process.env.CRAWL_BATCH_SIZE || 5);
const SUCCESS_RECRAWL_HOURS =
  Number(process.env.CRAWL_SUCCESS_RECRAWL_HOURS || 168);
const ERROR_RETRY_MINUTES =
  Number(process.env.CRAWL_ERROR_RETRY_MINUTES || 60);

const robotsCache = new Map();
const domainLastFetch = new Map();

const BLOCKED_EXTENSIONS =
  /\.(jpg|jpeg|png|gif|webp|svg|ico|pdf|zip|rar|7z|mp3|wav|mp4|avi|mov|mkv|exe|dmg|iso|apk)$/i;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function clean(value, max = 10000) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function hash(value) {
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("hex");
}

function domainOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function normalizeUrl(raw, base = null) {
  try {
    const u = base
      ? new URL(raw, base)
      : new URL(raw);

    if (!["http:", "https:"].includes(u.protocol)) return null;

    u.hash = "";

    u.hostname = u.hostname.toLowerCase();

    if (
      (u.protocol === "https:" && u.port === "443") ||
      (u.protocol === "http:" && u.port === "80")
    ) {
      u.port = "";
    }

    const remove = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "gclid",
      "fbclid"
    ];

    for (const key of remove) {
      u.searchParams.delete(key);
    }

    return u.toString();
  } catch {
    return null;
  }
}

function validUrl(url) {
  if (!url) return false;

  try {
    const u = new URL(url);

    if (!["http:", "https:"].includes(u.protocol)) {
      return false;
    }

    if (BLOCKED_EXTENSIONS.test(u.pathname)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

async function safePublicHost(hostname) {
  try {
    const records = await dns.lookup(hostname, {
      all: true,
      verbatim: true
    });

    for (const record of records) {
      const ip = record.address;

      if (
        ip === "127.0.0.1" ||
        ip === "::1" ||
        ip.startsWith("10.") ||
        ip.startsWith("192.168.") ||
        ip.startsWith("172.16.") ||
        ip.startsWith("172.17.") ||
        ip.startsWith("172.18.") ||
        ip.startsWith("172.19.") ||
        ip.startsWith("172.20.") ||
        ip.startsWith("172.21.") ||
        ip.startsWith("172.22.") ||
        ip.startsWith("172.23.") ||
        ip.startsWith("172.24.") ||
        ip.startsWith("172.25.") ||
        ip.startsWith("172.26.") ||
        ip.startsWith("172.27.") ||
        ip.startsWith("172.28.") ||
        ip.startsWith("172.29.") ||
        ip.startsWith("172.30.") ||
        ip.startsWith("172.31.")
      ) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

async function domainDelay(url) {
  const domain = domainOf(url);
  const delay = Number(
    process.env.CRAWL_DOMAIN_DELAY_MS || 1000
  );

  const last = domainLastFetch.get(domain) || 0;
  const wait = delay - (Date.now() - last);

  if (wait > 0) {
    await sleep(wait);
  }

  domainLastFetch.set(domain, Date.now());
}

async function fetchText(url, options = {}) {
  await domainDelay(url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": USER_AGENT,
        "accept":
          options.accept ||
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const type =
      response.headers.get("content-type") || "";

    const text = await response.text();

    if (Buffer.byteLength(text, "utf8") > MAX_HTML) {
      throw new Error("HTML_TOO_LARGE");
    }

    return {
      text,
      contentType: type,
      status: response.status,
      finalUrl: response.url || url
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(url) {
  let lastError;

  const retries =
    Number(process.env.CRAWL_MAX_RETRIES || 3);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fetchText(url);
    } catch (error) {
      lastError = error;

      if (attempt < retries) {
        await sleep(1000 * Math.pow(2, attempt - 1));
      }
    }
  }

  throw lastError;
}

async function getRobots(origin) {
  const cached = robotsCache.get(origin);

  if (cached && cached.expires > Date.now()) {
    return cached;
  }

  const robotsUrl = `${origin}/robots.txt`;

  let result = {
    allowed: true,
    sitemaps: [],
    expires: Date.now() + 6 * 60 * 60 * 1000
  };

  try {
    const response = await fetchText(
      robotsUrl,
      {
        accept: "text/plain,*/*;q=0.8"
      }
    );

    const lines = response.text.split(/\r?\n/);

    let active = false;

    for (const raw of lines) {
      const line = raw
        .replace(/#.*/, "")
        .trim();

      if (!line) continue;

      const [key, ...rest] =
        line.split(":");

      const value =
        rest.join(":").trim();

      const lower =
        key.toLowerCase();

      if (lower === "user-agent") {
        active =
          value === "*" ||
          value.toLowerCase()
            .includes("hexora");
      }

      if (
        active &&
        lower === "disallow" &&
        value
      ) {
        if (value === "/") {
          result.allowed = false;
        }
      }

      if (lower === "sitemap") {
        const sitemap =
          normalizeUrl(value, origin);

        if (sitemap) {
          result.sitemaps.push(sitemap);
        }
      }
    }
  } catch {
    // robots unavailable = do not crash crawler
  }

  robotsCache.set(origin, result);

  return result;
}

async function robotsAllowed(url, robots) {
  if (!robots?.allowed) return false;

  // Basic robots support.
  // Full path-rule support can be added later.
  return true;
}

function detectLanguage(text) {
  const sample = text.slice(0, 10000);

  if (/[\u0980-\u09FF]/.test(sample)) {
    return "bn";
  }

  if (/[\u0C00-\u0C7F]/.test(sample)) {
    return "or";
  }

  if (/[\u0900-\u097F]/.test(sample)) {
    return "hi";
  }

  if (/[\u0A80-\u0AFF]/.test(sample)) {
    return "gu";
  }

  if (/[\u0B80-\u0BFF]/.test(sample)) {
    return "ta";
  }

  return "en";
}

function extractPage(html, finalUrl) {
  const $ = cheerio.load(html);

  $("script,style,noscript,template,svg").remove();

  const title = clean(
    $("title").first().text(),
    1000
  );

  const description = clean(
    $('meta[name="description"]')
      .attr("content") ||
    $('meta[property="og:description"]')
      .attr("content") ||
    "",
    3000
  );

  const canonical =
    normalizeUrl(
      $('link[rel="canonical"]')
        .attr("href"),
      finalUrl
    ) || finalUrl;

  const publishedAt =
    $('meta[property="article:published_time"]')
      .attr("content") ||
    $('meta[name="date"]')
      .attr("content") ||
    null;

  const text = clean(
    $("body").text(),
    MAX_CONTENT
  );

  const contentHash = hash(text);

  const words =
    text.split(/\s+/).filter(Boolean);

  const images = [];

  $("img").each((_, el) => {
    if (images.length >= MAX_IMAGES) return;

    const src =
      $(el).attr("src") ||
      $(el).attr("data-src");

    const imageUrl =
      normalizeUrl(src, finalUrl);

    if (!imageUrl) return;

    images.push({
      url: imageUrl,
      alt: clean($(el).attr("alt"), 500)
    });
  });

  const videos = [];

  $("video, source").each((_, el) => {
    if (videos.length >= MAX_VIDEOS) return;

    const src = $(el).attr("src");

    const videoUrl =
      normalizeUrl(src, finalUrl);

    if (videoUrl) {
      videos.push({
        url: videoUrl
      });
    }
  });

  const links = new Set();

  $("a[href]").each((_, el) => {
    if (links.size >= MAX_LINKS) return;

    const url =
      normalizeUrl(
        $(el).attr("href"),
        finalUrl
      );

    if (url && validUrl(url)) {
      links.add(url);
    }
  });

  const qualityScore =
    Math.min(
      100,
      Math.round(
        Math.min(words.length / 10, 60) +
        (title ? 15 : 0) +
        (description ? 15 : 0) +
        (images.length ? 5 : 0) +
        (canonical ? 5 : 0)
      )
    );

  return {
    url: finalUrl,
    canonicalUrl: canonical,
    title,
    description,
    content: text,
    contentHash,
    wordCount: words.length,
    language: detectLanguage(text),
    publishedAt,
    images,
    videos,
    links: [...links],
    qualityScore
  };
}

async function queueUrl(
  client,
  url,
  discoveredFrom = null,
  priority = 0
) {
  const normalized =
    normalizeUrl(url);

  if (!normalized || !validUrl(normalized)) {
    return false;
  }

  await client.query(
    `
    INSERT INTO crawl_queue
      (url, status, priority, discovered_from, created_at)
    VALUES
      ($1, 'queued', $2, $3, NOW())
    ON CONFLICT (url)
    DO NOTHING
    `,
    [
      normalized,
      priority,
      discoveredFrom
    ]
  );

  return true;
}

async function ensureSeeds(client) {
  const raw =
    process.env.CRAWL_SEEDS || "";

  const seeds = raw
    .split(/[\n,]+/)
    .map(x => x.trim())
    .filter(Boolean);

  for (const seed of seeds) {
    await queueUrl(
      client,
      seed,
      null,
      100
    );
  }
}

async function recoverJobs(client) {
  await client.query(
    `
    UPDATE crawl_queue
    SET
      status = 'queued',
      locked_at = NULL,
      next_crawl_at = NOW()
    WHERE
      status = 'processing'
      AND locked_at < NOW() - INTERVAL '30 minutes'
    `
  );
}

async function claimJobs(client) {
  const result =
    await client.query(
      `
      SELECT *
      FROM crawl_queue
      WHERE
        status IN ('queued','failed')
        AND COALESCE(next_crawl_at, NOW()) <= NOW()
        AND COALESCE(attempts, 0) <
            $1
      ORDER BY
        priority DESC,
        created_at ASC
      LIMIT $2
      FOR UPDATE SKIP LOCKED
      `,
      [
        Number(
          process.env.CRAWL_MAX_ATTEMPTS || 4
        ),
        BATCH_SIZE
      ]
    );

  const jobs = result.rows;

  for (const job of jobs) {
    await client.query(
      `
      UPDATE crawl_queue
      SET
        status = 'processing',
        locked_at = NOW(),
        attempts = COALESCE(attempts,0) + 1
      WHERE id = $1
      `,
      [job.id]
    );
  }

  return jobs;
}

async function savePage(
  client,
  page,
  html
) {
  const stored =
    await putHtml({
      url: page.url,
      html,
      contentHash: page.contentHash,
      metadata: {
        title: page.title,
        language: page.language
      }
    });

  const r2Key =
    typeof stored === "string"
      ? stored
      : stored?.key ||
        stored?.r2Key ||
        stored?.Key ||
        null;

  await client.query(
    `
    INSERT INTO pages (
      url,
      canonical_url,
      title,
      description,
      excerpt,
      content,
      content_hash,
      word_count,
      language,
      published_at,
      last_crawled_at,
      crawl_status,
      quality_score,
      image_items,
      video_items,
      r2_key,
      updated_at
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,
      $10,NOW(),'success',$11,$12,$13,$14,NOW()
    )
    ON CONFLICT (url)
    DO UPDATE SET
      canonical_url = EXCLUDED.canonical_url,
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      excerpt = EXCLUDED.excerpt,
      content = EXCLUDED.content,
      content_hash = EXCLUDED.content_hash,
      word_count = EXCLUDED.word_count,
      language = EXCLUDED.language,
      published_at = EXCLUDED.published_at,
      last_crawled_at = NOW(),
      crawl_status = 'success',
      quality_score = EXCLUDED.quality_score,
      image_items = EXCLUDED.image_items,
      video_items = EXCLUDED.video_items,
      r2_key = EXCLUDED.r2_key,
      updated_at = NOW()
    `,
    [
      page.url,
      page.canonicalUrl,
      page.title,
      page.description,
      page.content.slice(0, 3000),
      page.content,
      page.contentHash,
      page.wordCount,
      page.language,
      page.publishedAt,
      page.qualityScore,
      JSON.stringify(page.images),
      JSON.stringify(page.videos),
      r2Key
    ]
  );

  for (const link of page.links) {
    await queueUrl(
      client,
      link,
      page.url,
      Math.max(
        0,
        page.qualityScore
      )
    );
  }
}

async function markSuccess(
  client,
  jobId
) {
  await client.query(
    `
    UPDATE crawl_queue
    SET
      status = 'done',
      locked_at = NULL,
      next_crawl_at =
        NOW() +
        ($2 || ' hours')::interval,
      last_crawled_at = NOW(),
      last_error = NULL
    WHERE id = $1
    `,
    [
      jobId,
      SUCCESS_RECRAWL_HOURS
    ]
  );
}

async function markFailure(
  client,
  job,
  error
) {
  const attempts =
    Number(job.attempts || 1);

  const maxAttempts =
    Number(
      process.env.CRAWL_MAX_ATTEMPTS || 4
    );

  const permanent =
    /HTTP 404|HTTP 410|HTML_TOO_LARGE/i
      .test(error.message || "");

  const status =
    permanent || attempts >= maxAttempts
      ? "dead"
      : "failed";

  await client.query(
    `
    UPDATE crawl_queue
    SET
      status = $2,
      locked_at = NULL,
      last_error = $3,
      next_crawl_at =
        CASE
          WHEN $2 = 'failed'
          THEN NOW() +
               ($4 || ' minutes')::interval
          ELSE NULL
        END
    WHERE id = $1
    `,
    [
      job.id,
      status,
      clean(error.message, 2000),
      ERROR_RETRY_MINUTES
    ]
  );
}

async function crawlJob(client, job) {
  const url =
    normalizeUrl(job.url);

  if (!url) {
    throw new Error("INVALID_URL");
  }

  const host =
    new URL(url).hostname;

  if (
    !(await safePublicHost(host))
  ) {
    throw new Error(
      "PRIVATE_OR_INVALID_HOST"
    );
  }

  const origin =
    new URL(url).origin;

  const robots =
    await getRobots(origin);

  if (!(await robotsAllowed(url, robots))) {
    throw new Error(
      "ROBOTS_DISALLOWED"
    );
  }

  const response =
    await fetchWithRetry(url);

  if (
    !response.contentType
      .toLowerCase()
      .includes("html")
  ) {
    throw new Error(
      "NOT_HTML"
    );
  }

  const page =
    extractPage(
      response.text,
      response.finalUrl
    );

  await savePage(
    client,
    page,
    response.text
  );
}

export async function runCrawlCycle() {
  const client =
    await pool.connect();

  let completed = 0;

  try {
    await recoverJobs(client);

    await ensureSeeds(client);

    await client.query(
      "BEGIN"
    );

    const jobs =
      await claimJobs(client);

    await client.query(
      "COMMIT"
    );

    for (const job of jobs) {
      try {
        await crawlJob(
          client,
          job
        );

        await markSuccess(
          client,
          job.id
        );

        completed++;

        console.log(
          `[HEXORA] indexed: ${job.url}`
        );
      } catch (error) {
        console.error(
          `[HEXORA] failed: ${job.url}`,
          error.message
        );

        await markFailure(
          client,
          job,
          error
        );
      }
    }

    return {
      jobs: jobs.length,
      completed
    };
  } finally {
    client.release();
  }
}

export async function shutdownCrawler() {
  await pool.end();
}
