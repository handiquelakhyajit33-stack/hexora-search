import "dotenv/config";
import * as cheerio from "cheerio";
import robotsParser from "robots-parser";
import crypto from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand
} from "@aws-sdk/client-s3";

const env = process.env;

// ============================================================
// HEXORA WORLDWIDE CRAWLER
// All new crawl data, metadata, index and queue are stored in R2.
// Existing Neon data is not modified by this crawler.
// ============================================================

const CF_ACCOUNT_ID = String(env.R2_ACCOUNT_ID || "").trim();
const R2_BUCKET = String(env.R2_BUCKET_NAME || "hexora").trim();

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

// ============================================================
// CLOUDFLARE R2 CONNECTION
// R2 storage is used for archiving pages.
// No Cloudflare Analytics token is required.
// ============================================================

const s3 =
  CF_ACCOUNT_ID &&
  String(env.R2_ACCESS_KEY_ID || "").trim() &&
  String(env.R2_SECRET_ACCESS_KEY || "").trim()
    ? new S3Client({
        region: "auto",
        endpoint:
          `https://${CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: String(env.R2_ACCESS_KEY_ID || "").trim(),
          secretAccessKey: String(env.R2_SECRET_ACCESS_KEY || "").trim()
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
    html,
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

async function objectExists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return true;
  } catch (error) {
    if (error?.name === "NotFound" || error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) return false;
    throw error;
  }
}

function pageIndexKey(url) {
  const u = new URL(url);
  return `index/${u.hostname}/${hash(url)}.json`;
}

async function enqueueUrls(urls) {
  for (const raw of [...new Set(urls)]) {
    const url = normalizeUrl(raw);
    if (!url) continue;
    if (await objectExists(pageIndexKey(url))) continue;
    const key = `queue/pending/${hash(url)}.json`;
    if (!(await objectExists(key))) await putR2Json(key, { url, queued_at: new Date().toISOString(), attempts: 0 });
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

// ============================================================
// R2 ARCHIVE + SEARCH INDEX — no crawler writes to Neon
// ============================================================
async function archiveToR2(page) {
  if (!s3) throw new Error("R2 S3 credentials are not configured");
  const host = new URL(page.url).hostname.toLowerCase();
  const id = hash(page.url);
  const pageKey = `pages/${host}/${id}.html`;
  const metadataKey = `pages/${host}/${id}.json`;
  const indexKey = `index/${host}/${id}.json`;
  if (await objectExists(indexKey)) { console.log(`[HEXORA] Duplicate URL skipped: ${page.url}`); return pageKey; }
  const crawledAt = new Date().toISOString();
  if (!page.html) throw new Error("Fetched HTML missing; refusing to save incomplete page");
  await s3.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: pageKey, Body: page.html, ContentType: "text/html; charset=utf-8" }));
  const savedPage = { ...page, html: undefined, r2_key: pageKey, crawled_at: crawledAt };
  await putR2Json(metadataKey, savedPage);
  const indexDoc = {
    id, url: page.url, canonical_url: page.url,
    title: page.title || "", description: page.description || "",
    excerpt: String(page.content || "").slice(0, 1800),
    language: page.language || "unknown", domain: host,
    r2_key: pageKey, crawled_at: crawledAt,
    search_text: `${page.title || ""} ${page.description || ""} ${String(page.content || "").slice(0, 5000)}`.slice(0, 7000)
  };
  await putR2Json(indexKey, indexDoc);
  console.log(`[HEXORA] R2 saved HTML + metadata + search index: ${page.url}`);
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
    if (await objectExists(pageIndexKey(url))) {
      await finishJob(job, "done");
      console.log(`[HEXORA] Already indexed; skipped duplicate: ${url}`);
      return "duplicate";
    }
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
  console.log("[HEXORA] Storage mode: R2-only. No Neon connection or writes.");
  if (!s3) { console.error("[HEXORA] R2 credentials missing. Configure R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME."); process.exit(1); }
  const defaultSeeds = [
    "https://www.wikipedia.org/", "https://www.britannica.com/", "https://www.bbc.com/",
    "https://www.reuters.com/", "https://apnews.com/", "https://www.theguardian.com/",
    "https://www.npr.org/", "https://www.nationalgeographic.com/", "https://www.nasa.gov/",
    "https://www.noaa.gov/", "https://www.un.org/", "https://www.who.int/",
    "https://www.worldbank.org/", "https://www.imf.org/", "https://www.oecd.org/",
    "https://www.gov.uk/", "https://www.usa.gov/", "https://www.india.gov.in/",
    "https://www.pib.gov.in/", "https://www.isro.gov.in/", "https://www.incredibleindia.gov.in/",
    "https://www.thehindu.com/", "https://indianexpress.com/", "https://www.ndtv.com/",
    "https://www.hindustantimes.com/", "https://www.indiatoday.in/", "https://www.livemint.com/",
    "https://www.assam.gov.in/", "https://assamtribune.com/", "https://nenow.in/",
    "https://github.com/", "https://developer.mozilla.org/", "https://docs.python.org/",
    "https://nodejs.org/", "https://www.w3.org/", "https://www.rfc-editor.org/",
    "https://arxiv.org/", "https://pubmed.ncbi.nlm.nih.gov/", "https://www.nature.com/",
    "https://www.science.org/", "https://www.khanacademy.org/", "https://www.openstreetmap.org/",
    "https://www.unesco.org/", "https://www.unicef.org/", "https://www.fao.org/",
    "https://www.bbc.co.uk/", "https://www.dw.com/", "https://www.france24.com/",
    "https://www.aljazeera.com/", "https://www.cbc.ca/", "https://www.abc.net.au/"
  ];
  const configuredSeeds = String(env.CRAWL_SEED_URLS || "").split(/[\s,]+/).filter(Boolean);
  const seeds = configuredSeeds.length ? configuredSeeds : defaultSeeds;
  try {
    await s3.send(new HeadBucketCommand({ Bucket: R2_BUCKET }));
    console.log(`[HEXORA] R2 connection verified for bucket: ${R2_BUCKET}`);
  } catch (error) {
    console.error(`[HEXORA] R2 preflight failed. Check account ID, bucket and API key pair. ${error.message}`);
    process.exit(1);
  }
  await enqueueUrls(seeds);
  console.log(`[HEXORA] Seed URLs submitted to R2 queue: ${seeds.length}`);
  while (true) {
    try {
      const jobs = await getJobs();
      if (!jobs.length) {
        console.log("[HEXORA] No R2 queued jobs. Set CRAWL_SEED_URLS or add seed URLs in R2 queue.");
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
