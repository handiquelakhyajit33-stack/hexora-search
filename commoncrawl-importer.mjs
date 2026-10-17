// ============================================================
// HEXORA SEARCH ENGINE
// COMMON CRAWL IMPORTER
// R2-only Common Crawl importer
// ============================================================

import crypto from "crypto";
import zlib from "zlib";
import * as cheerio from "cheerio";

import {
  S3Client,
  PutObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";


// ============================================================
// CONFIG
// ============================================================

const R2_ACCOUNT_ID = String(process.env.R2_ACCOUNT_ID || "").trim();
const R2_ACCESS_KEY_ID = String(process.env.R2_ACCESS_KEY_ID || "").trim();
const R2_SECRET_ACCESS_KEY = String(process.env.R2_SECRET_ACCESS_KEY || "").trim();

const R2_BUCKET_NAME =
  String(process.env.R2_BUCKET_NAME || "hexora").trim();

const COMMONCRAWL_COLLECTION =
  process.env.COMMONCRAWL_COLLECTION || "";

// Broad Common Crawl URL patterns by public suffix. These are discovery
// patterns, not a claim that every URL on the live web is covered. The
// environment variable can optionally override them with comma-separated
// domains or Common Crawl wildcard patterns.
const DEFAULT_TARGET_PATTERNS = [
  // Start with explicit .com hosts; broad *.com/* queries often time out.
  // This is a prioritized seed list, not complete coverage of all .com sites.
  "www.google.com/*",
  "www.youtube.com/*",
  "www.facebook.com/*",
  "www.instagram.com/*",
  "www.reddit.com/*",
  "www.linkedin.com/*",
  "www.microsoft.com/*",
  "www.apple.com/*",
  "www.amazon.com/*",
  "www.wikipedia.org/*",
  "www.yahoo.com/*",
  "www.bing.com/*",
  "www.ebay.com/*",
  "www.pinterest.com/*",
  "www.tiktok.com/*",
  "www.netflix.com/*",
  "www.adobe.com/*",
  "www.ibm.com/*",
  "www.oracle.com/*",
  "www.salesforce.com/*",
  "www.cnn.com/*",
  "www.nbcnews.com/*",
  "www.foxnews.com/*",
  "www.usatoday.com/*",
  "www.washingtonpost.com/*",
  "www.bloomberg.com/*",
  "www.forbes.com/*",
  "www.cbsnews.com/*",
  "www.npr.org/*",
  "www.weather.com/*",
  "www.nationalgeographic.com/*",
  "www.nytimes.com/*",
  "www.reuters.com/*",
  "www.theguardian.com/*",
  "www.bbc.com/*",
  "www.espn.com/*",
  "www.nba.com/*",
  "www.nfl.com/*",
  "www.mlb.com/*",
  "www.fifa.com/*",
  "www.coursera.org/*",
  "www.udemy.com/*",
  "www.khanacademy.org/*",
  "www.stackoverflow.com/*",
  "github.com/*",
  "www.gitlab.com/*",
  "www.mozilla.org/*",
  "www.cloudflare.com/*",
  "www.openai.com/*",
  "www.nvidia.com/*",
  "www.intel.com/*",
  "www.amd.com/*",
  "www.samsung.com/*",
  "www.sony.com/*",
  "www.dell.com/*",
  "www.hp.com/*",
  "www.lenovo.com/*",
  "www.cisco.com/*",
  "www.zoom.com/*",
  "www.slack.com/*",
  "www.shopify.com/*",
  "www.walmart.com/*",
  "www.target.com/*",
  "www.bestbuy.com/*",
  "www.etsy.com/*",
  "www.booking.com/*",
  "www.expedia.com/*",
  "www.tripadvisor.com/*",
  "www.airbnb.com/*",
  "www.uber.com/*",
  "www.lyft.com/*",
  "www.paypal.com/*",
  "www.visa.com/*",
  "www.mastercard.com/*",
  "www.chase.com/*",
  "www.bankofamerica.com/*",
  "www.wellsfargo.com/*",
  "www.fidelity.com/*",
  "www.morningstar.com/*",
  "www.investopedia.com/*",
  "www.healthline.com/*",
  "www.webmd.com/*",
  "www.mayoclinic.org/*",
  "www.cdc.gov/*",
  "www.nih.gov/*",
  "www.nasa.gov/*",
  "www.nationalparks.org/*",
  "www.whitehouse.gov/*",
  "www.usa.gov/*",
  "www.state.gov/*",
  "www.homedepot.com/*",
  "www.lowes.com/*",
  "www.ikea.com/*",
  "www.coca-cola.com/*",
  "www.pepsi.com/*",
  "www.nike.com/*",
  "www.adidas.com/*",
  "www.puma.com/*",
  "www.underarmour.com/*",
  "www.disney.com/*",
  "www.warnerbros.com/*",
  "www.universalpictures.com/*",
  "www.imdb.com/*",
  "www.rottentomatoes.com/*",
  "www.goodreads.com/*",
  "www.medium.com/*",
  "www.quora.com/*",
  "www.tumblr.com/*",
  "www.wordpress.com/*",
  "www.atlassian.com/*",
  "www.notion.so/*",
  "www.dropbox.com/*",
  "www.box.com/*",
  "www.intuit.com/*",
  "www.turbotax.com/*",
  "www.indeed.com/*",
  "www.glassdoor.com/*",
  "www.monster.com/*",
  "www.zillow.com/*",
  "www.realtor.com/*",
  "www.autotrader.com/*",
  "www.cars.com/*",
  "www.carmax.com/*",
  "www.edmunds.com/*",
  "www.kbb.com/*",
  "www.allrecipes.com/*",
  "www.foodnetwork.com/*",
  "www.bonappetit.com/*",
  "www.epicurious.com/*",
  "www.seriouseats.com/*",
  "www.marthastewart.com/*",
  "www.food.com/*",
  "www.delish.com/*",
  "www.simplyrecipes.com/*",
  "www.kingarthurbaking.com/*",
  "www.britannica.com/*",
  "www.dictionary.com/*",
  "www.merriam-webster.com/*",
  "www.thespruce.com/*",
  "www.parents.com/*",
  "www.babycenter.com/*",
  "www.popsugar.com/*",
  "www.vogue.com/*",
  "www.gq.com/*",
  "www.cosmopolitan.com/*",
  "www.people.com/*",
  "www.usmagazine.com/*",
  "www.gamespot.com/*",
  "www.ign.com/*",
  "www.polygon.com/*",
  "www.gamesradar.com/*",
  "www.pcgamer.com/*",
  "www.tomshardware.com/*",
  "www.techradar.com/*",
  "www.theverge.com/*",
  "www.wired.com/*",
  "www.engadget.com/*",
  "www.cnet.com/*",
  "www.zdnet.com/*",
  "www.techcrunch.com/*",
  "www.producthunt.com/*",
  "www.kickstarter.com/*",
  "www.indiegogo.com/*",
  "www.gofundme.com/*",
  "www.change.org/*",
  "www.archive.org/*",
  "www.fandom.com/*",
  "www.ziprecruiter.com/*",
  "www.careerbuilder.com/*",
  "www.simplyhired.com/*",
  "www.docusign.com/*",
  "www.canva.com/*",
  "www.figma.com/*",
  "www.autodesk.com/*",
  "www.sketchup.com/*",
  "www.trimble.com/*"
];
const EXTRA_TARGET_PATTERNS = String(
  process.env.COMMONCRAWL_TARGET_DOMAINS || ""
).split(",").map((x) => x.trim()).filter(Boolean);
const TARGET_DOMAINS = [...new Set([
  ...DEFAULT_TARGET_PATTERNS,
  ...EXTRA_TARGET_PATTERNS.filter((x) => !DEFAULT_TARGET_PATTERNS.includes(x)),
])];

const PAGES_PER_DOMAIN = Math.max(
  1,
  Number(process.env.COMMONCRAWL_PAGES_PER_DOMAIN || 20)
);

const MAX_PAGES = Math.max(
  1,
  Number(process.env.COMMONCRAWL_MAX_PAGES || 200)
);

const TIMEOUT_MS = Math.max(
  10000,
  Number(process.env.COMMONCRAWL_TIMEOUT_MS || 120000)
);

const MAX_RETRIES = Math.max(
  1,
  Number(process.env.COMMONCRAWL_MAX_RETRIES || 1)
);

const MAX_CONTENT = Math.max(
  10000,
  Number(process.env.CRAWL_MAX_CONTENT || 100000)
);

const MAX_LINKS = Math.max(
  10,
  Number(process.env.CRAWL_MAX_LINKS || 100)
);

const USER_AGENT =
  process.env.HEXORA_USER_AGENT ||
  "HEXORA-SearchBot/1.0 (+https://www.hexorasearch.com/)";

// ============================================================
// VALIDATION
// ============================================================

if (
  !R2_ACCOUNT_ID ||
  !R2_ACCESS_KEY_ID ||
  !R2_SECRET_ACCESS_KEY
) {
  throw new Error(
    "[HEXORA] R2 credentials are missing"
  );
}

// ============================================================
// R2
// ============================================================

const r2 = new S3Client({
  region: "auto",

  endpoint:
    `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,

  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

// ============================================================
// LOG
// ============================================================

function log(...args) {
  console.log("[HEXORA]", ...args);
}

// ============================================================
// SLEEP
// ============================================================

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// ============================================================
// TIMEOUT FETCH
// ============================================================

async function fetchWithTimeout(
  url,
  options = {},
  timeout = TIMEOUT_MS
) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, timeout);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// FETCH WITH RETRIES
// ============================================================

async function fetchRetry(
  url,
  options = {},
  retries = MAX_RETRIES
) {
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    let retryAfterMs = 0;

    try {
      const response = await fetchWithTimeout(
        url,
        options
      );

      if (response.ok) {
        return response;
      }

      const status = response.status;
      const retryAfter = response.headers.get("retry-after");

      if (retryAfter) {
        const seconds = Number(retryAfter);
        if (Number.isFinite(seconds) && seconds >= 0) {
          retryAfterMs = Math.min(120000, seconds * 1000);
        } else {
          const retryDate = Date.parse(retryAfter);
          if (Number.isFinite(retryDate)) {
            retryAfterMs = Math.min(120000, Math.max(0, retryDate - Date.now()));
          }
        }
      }

      // Common Crawl commonly uses HTTP 404 when a valid pattern has no
      // matching captures. Do not waste all retries on a no-match response.
      let responseDetail = "";
      if (status === 404) {
        try { responseDetail = (await response.text()).slice(0, 300).replace(/\s+/g, " "); } catch {}
      } else {
        try { await response.body?.cancel(); } catch {}
      }

      const httpError = new Error(`HTTP ${status}${responseDetail ? `: ${responseDetail}` : ""}`);
      httpError.status = status;
      throw httpError;
    } catch (error) {
      lastError = error;

      log(
        `Request failed: ${url} (attempt ${attempt}/${retries})`
      );

      log(
        `Reason: ${error.message}`
      );

      if (error?.status === 404) {
        break;
      }

      // Common Crawl index/WARC overload errors are not helped by repeated
      // immediate requests. Skip this request and let the importer continue.
      if ([502, 503, 504].includes(error?.status)) {
        log(`Not retrying HTTP ${error.status}; skipping this request.`);
        break;
      }

      if (attempt < retries) {
        // Common Crawl may temporarily return 503. Use longer exponential
        // backoff and honor Retry-After when the server provides it.
        const exponentialDelay = Math.min(
          60000,
          5000 * Math.pow(2, attempt - 1)
        );
        const delay = Math.max(
          retryAfterMs,
          exponentialDelay + Math.floor(Math.random() * 1000)
        );

        log(
          `Retry in ${delay}ms...`
        );

        await sleep(delay);
      }
    }
  }

  throw lastError;
}

// ============================================================
// COMMON CRAWL COLLECTION
// ============================================================

async function discoverCollection() {
  if (COMMONCRAWL_COLLECTION) {
    return COMMONCRAWL_COLLECTION;
  }

  log(
    "Discovering Common Crawl collection..."
  );

  const response = await fetchRetry(
    "https://index.commoncrawl.org/collinfo.json",
    {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
    }
  );

  const data = await response.json();

  if (!Array.isArray(data) || !data.length) {
    throw new Error(
      "Common Crawl collection list is empty"
    );
  }

  // First collection is normally newest.
  const collection =
    data[0]?.id ||
    data[0]?.name;

  if (!collection) {
    throw new Error(
      "Could not determine Common Crawl collection"
    );
  }

  return collection;
}

// ============================================================
// COMMON CRAWL INDEX QUERY
// ============================================================

async function queryIndex(
  collection,
  domain
) {
  const indexBase =
    `https://index.commoncrawl.org/${collection}-index`;

  // Common Crawl accepts URL patterns directly (for example *.ca/*).
  // Do not expand a wildcard into https://*.ca/* and http://*.ca/*:
  // those broad scheme-specific queries are expensive and may time out.
  const queries = domain.includes("*") || domain.includes("/")
    ? [domain]
    : [`${domain}/*`, `*.${domain}/*`];

  let records = [];

  for (const pattern of queries) {
    if (records.length >= PAGES_PER_DOMAIN) {
      break;
    }

    const params = new URLSearchParams();

    params.set("url", pattern);
    params.set("output", "json");
    params.set("filter", "status:200");
    params.append(
      "filter",
      "mime:text/html"
    );
    params.set(
      "collapse",
      "urlkey"
    );
    params.set(
      "pageSize",
      String(
        Math.max(
          PAGES_PER_DOMAIN,
          10
        )
      )
    );

    const url =
      `${indexBase}?${params.toString()}`;

    log(
      `Querying: ${pattern}`
    );

    try {
      const response =
        await fetchRetry(url, {
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "application/json",
          },
        }, 1);

      const text =
        await response.text();

      const lines =
        text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);

      for (const line of lines) {
        try {
          const record =
            JSON.parse(line);

          if (
            record &&
            record.url &&
            record.filename &&
            record.offset !== undefined &&
            record.length !== undefined
          ) {
            records.push(record);
          }
        } catch {
          // Ignore malformed index line.
        }
      }
    } catch (error) {
      if (error?.status === 404 || /HTTP 404\b/.test(String(error?.message || ""))) {
        log(`No matching captures for pattern ${pattern} in ${collection}`);
      } else {
        log(`Index query failed for ${pattern}: ${error.message}`);
        if (/HTTP (?:502|503|504)\b/.test(String(error?.message || ""))) {
          log(`Skipping this pattern after retries; continue with the next host/pattern.`);
        }
      }
    }
  }

  // Remove duplicate URLs.
  const unique = new Map();

  for (const record of records) {
    if (!unique.has(record.url)) {
      unique.set(
        record.url,
        record
      );
    }
  }

  return Array.from(
    unique.values()
  ).slice(
    0,
    PAGES_PER_DOMAIN
  );
}

// ============================================================
// DOWNLOAD WARC RECORD
// ============================================================

async function downloadWarcRecord(
  record
) {
  const start =
    Number(record.offset);

  const length =
    Number(record.length);

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(length) ||
    start < 0 ||
    length <= 0
  ) {
    throw new Error(
      "Invalid WARC range"
    );
  }

  const end =
    start + length - 1;

  const url =
    `https://data.commoncrawl.org/${record.filename}`;

  const response =
    await fetchRetry(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Range: `bytes=${start}-${end}`,
      },
    });

  if (response.status !== 206 && response.status !== 200) {
    throw new Error(`WARC download returned HTTP ${response.status} for ${record.filename}`);
  }

  const buffer =
    Buffer.from(
      await response.arrayBuffer()
    );

  if (!buffer.length) {
    throw new Error(
      "Empty WARC response"
    );
  }

  return buffer;
}

// ============================================================
// GZIP DECOMPRESS
// ============================================================

function decompressWarc(buffer) {
  try {
    return zlib.gunzipSync(buffer);
  } catch {
    return buffer;
  }
}

// ============================================================
// EXTRACT HTTP RESPONSE
// ============================================================

function extractHttpResponse(buffer) {
  const text =
    buffer.toString(
      "latin1"
    );

  let httpStart =
    text.indexOf("HTTP/");

  if (httpStart < 0) {
    httpStart = 0;
  }

  const headerEnd =
    text.indexOf(
      "\r\n\r\n",
      httpStart
    );

  if (headerEnd < 0) {
    return {
      headers: "",
      body: buffer,
    };
  }

  const headersText =
    text.slice(
      httpStart,
      headerEnd
    );

  const bodyStart =
    headerEnd + 4;

  const body =
    buffer.subarray(
      bodyStart
    );

  return {
    headers: headersText,
    body,
  };
}

// ============================================================
// HTTP BODY DECOMPRESSION
// ============================================================

function decodeHttpBody(
  body,
  headersText
) {
  const encodingMatch =
    headersText.match(
      /content-encoding\s*:\s*([^\r\n]+)/i
    );

  if (!encodingMatch) {
    return body;
  }

  const encoding =
    encodingMatch[1]
      .trim()
      .toLowerCase();

  try {
    if (
      encoding.includes("gzip")
    ) {
      return zlib.gunzipSync(
        body
      );
    }

    if (
      encoding.includes("deflate")
    ) {
      return zlib.inflateSync(
        body
      );
    }
  } catch {
    return body;
  }

  return body;
}

// ============================================================
// HTML TEXT NORMALIZER
// ============================================================

function safeString(value) {
  if (
    typeof value === "string"
  ) {
    return value;
  }

  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  try {
    return String(value);
  } catch {
    return "";
  }
}

// ============================================================
// LANGUAGE DETECTION
// ============================================================

function detectLanguage(
  text
) {
  const value =
    safeString(text)
      .slice(0, 30000);

  // Assamese-specific characters FIRST.
  // Assamese and Bengali share Unicode range,
  // so Assamese must be checked before Bengali.
  if (
    /[ৰৱয়ড়ঢ়]/u.test(value)
  ) {
    return "as";
  }

  if (
    /[\u0900-\u097F]/u.test(value)
  ) {
    return "hi";
  }

  if (
    /[\u0980-\u09FF]/u.test(value)
  ) {
    return "bn";
  }

  if (
    /[\u0A00-\u0A7F]/u.test(value)
  ) {
    return "pa";
  }

  if (
    /[\u0B80-\u0BFF]/u.test(value)
  ) {
    return "ta";
  }

  if (
    /[\u0C00-\u0C7F]/u.test(value)
  ) {
    return "te";
  }

  if (
    /[\u0C80-\u0CFF]/u.test(value)
  ) {
    return "kn";
  }

  if (
    /[\u0D00-\u0D7F]/u.test(value)
  ) {
    return "ml";
  }

  if (
    /[\u4E00-\u9FFF]/u.test(value)
  ) {
    return "zh";
  }

  if (
    /[\u3040-\u30FF]/u.test(value)
  ) {
    return "ja";
  }

  if (
    /[\uAC00-\uD7AF]/u.test(value)
  ) {
    return "ko";
  }

  if (
    /[\u0600-\u06FF]/u.test(value)
  ) {
    return "ar";
  }

  if (
    /[\u0400-\u04FF]/u.test(value)
  ) {
    return "ru";
  }

  return "en";
}

// ============================================================
// CLEAN URL
// ============================================================

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"]) {
      url.searchParams.delete(key);
    }
    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
    return url.toString();
  } catch {
    return null;
  }
}

// ============================================================
// CONTENT HASH
// ============================================================

function sha256(
  value
) {
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("hex");
}

// ============================================================
// R2 KEY
// ============================================================

function makeR2Key(
  url,
  contentHash
) {
  let hostname =
    "unknown";

  try {
    hostname =
      new URL(url).hostname;
  } catch {}

  hostname =
    hostname
      .replace(/[^a-zA-Z0-9.-]/g, "_")
      .toLowerCase();

  return `pages/${hostname}/${contentHash}.html`;
}

// ============================================================
// PARSE HTML
// ============================================================

function parseHtml(
  html,
  sourceUrl
) {
  const $ =
    cheerio.load(
      safeString(html),
      {
        decodeEntities: true,
      }
    );

  $("script").remove();
  $("style").remove();
  $("noscript").remove();
  $("svg").remove();

  // ----------------------------------------------------------
  // TITLE
  // ----------------------------------------------------------

  const titleRaw =
    $("title")
      .first()
      .text();

  const title =
    safeString(titleRaw)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);

  // ----------------------------------------------------------
  // DESCRIPTION
  // ----------------------------------------------------------

  const descriptionRaw =
    $('meta[name="description"]')
      .first()
      .attr("content");

  const ogDescriptionRaw =
    $('meta[property="og:description"]')
      .first()
      .attr("content");

  const description =
    safeString(
      descriptionRaw ||
      ogDescriptionRaw ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1000);

  // ----------------------------------------------------------
  // BODY TEXT
  // ----------------------------------------------------------

  const bodyTextRaw =
    $("body")
      .text();

  // IMPORTANT:
  // Cheerio may return a non-string value in
  // certain overloaded cases. Never directly call
  // .replace() on .text().
  const bodyText =
    safeString(bodyTextRaw);

  const content =
    bodyText
      .replace(/\s+/g, " ")
      .trim()
      .slice(
        0,
        MAX_CONTENT
      );

  // ----------------------------------------------------------
  // LANGUAGE
  // ----------------------------------------------------------

  const language =
    detectLanguage(
      `${title} ${description} ${content}`
    );

  const absoluteUrl = value => {
    try {
      const u = new URL(value, sourceUrl);
      return ["http:", "https:"].includes(u.protocol) ? u.toString() : null;
    } catch { return null; }
  };
  const imageSet = new Set();
  for (const value of [
    $('meta[property="og:image"]').attr('content'),
    $('meta[name="twitter:image"]').attr('content'),
    $('meta[property="og:image:url"]').attr('content')
  ]) {
    const u = value && absoluteUrl(value);
    if (u) imageSet.add(u);
  }
  $('img[src]').each((_, el) => {
    if (imageSet.size >= 12) return false;
    const u = absoluteUrl($(el).attr('src'));
    if (u) imageSet.add(u);
  });
  const videoSet = new Set();
  for (const value of [
    $('meta[property="og:video"]').attr('content'),
    $('meta[property="og:video:url"]').attr('content'),
    $('meta[name="twitter:player:stream"]').attr('content')
  ]) {
    const u = value && absoluteUrl(value);
    if (u) videoSet.add(u);
  }
  $('video[src], video source[src], iframe[src]').each((_, el) => {
    if (videoSet.size >= 8) return false;
    const u = absoluteUrl($(el).attr('src'));
    if (u && (/\.(mp4|webm|m3u8)(?:$|[?#])/i.test(u) || /youtube|youtu\.be|vimeo|dailymotion/i.test(u))) videoSet.add(u);
  });
  const publishedAt = (
    $('meta[property="article:published_time"]').attr('content') ||
    $('meta[name="pubdate"]').attr('content') ||
    $('meta[name="date"]').attr('content') ||
    $('time[datetime]').first().attr('datetime') || ''
  ).trim().slice(0, 100);
  const articleType = String($('meta[property="og:type"]').attr('content') || '').toLowerCase();
  const isNews = /article|news/i.test(articleType) || /news|press-release|journalism/i.test(String($('meta[name="section"]').attr('content') || ''));

  // ----------------------------------------------------------
  // LINKS
  // ----------------------------------------------------------

  const links = [];

  $("a[href]").each(
    (_, element) => {
      if (
        links.length >= MAX_LINKS
      ) {
        return;
      }

      const hrefRaw =
        $(element).attr("href");

      const href =
        safeString(hrefRaw);

      if (!href) {
        return;
      }

      try {
        const absolute =
          new URL(
            href,
            sourceUrl
          );

        if (
          absolute.protocol !== "http:" &&
          absolute.protocol !== "https:"
        ) {
          return;
        }

        absolute.hash = "";

        links.push(
          absolute.toString()
        );
      } catch {
        // Ignore invalid links.
      }
    }
  );

  return {
    title,
    description,
    content,
    language,
    image_items: [...imageSet].map(url => ({ url, image_url: url, source_url: sourceUrl })),
    video_items: [...videoSet].map(url => ({ url, video_url: url, source_url: sourceUrl })),
    published_at: publishedAt || null,
    is_news: isNews,
    content_type: isNews ? "news" : (videoSet.size ? "video" : (imageSet.size ? "image" : "web")),
    links,
  };
}

// ============================================================
// R2 UPLOAD
// ============================================================

async function uploadToR2(
  key,
  html
) {
  const body =
    Buffer.from(
      safeString(html),
      "utf8"
    );

  await r2.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType:
        "text/html; charset=utf-8",
      CacheControl:
        "public, max-age=31536000",
    })
  );

  // Confirm the object exists before reporting the page as saved.
  await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
}

// ============================================================
// R2 CHECK
// ============================================================

async function checkR2() {
  await r2.send(
    new HeadBucketCommand({
      Bucket: R2_BUCKET_NAME,
    })
  );

  log(
    `R2 bucket check: ${R2_BUCKET_NAME}`
  );
}

async function r2ObjectExists(key) {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
    return true;
  } catch (error) {
    if (error?.name === "NotFound" || error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) return false;
    throw error;
  }
}

async function putR2Json(key, value) {
  await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key, Body: JSON.stringify(value), ContentType: "application/json" }));
}

function indexKeyForUrl(url) {
  let host = "unknown";
  try { host = new URL(url).hostname.toLowerCase(); } catch {}
  return `index/${host}/${sha256(url)}.json`;
}

// ============================================================
// R2-ONLY DEDUPLICATION + SAVE
// ============================================================
async function pageExists(url) {
  return await r2ObjectExists(indexKeyForUrl(url));
}

async function savePage({ url, title, description, content, language, contentHash, r2Key, html, published_at, is_news, content_type, image_items, video_items }) {
  const host = new URL(url).hostname.toLowerCase();
  const pageKey = `pages/${host}/${sha256(url)}.html`;
  const indexKey = indexKeyForUrl(url);
  if (await r2ObjectExists(indexKey)) return { duplicate: true, r2Key: pageKey };
  await uploadToR2(pageKey, html);
  await putR2Json(indexKey, {
    id: sha256(url), url, canonical_url: url, title: title || "",
    description: description || "", excerpt: String(content || "").slice(0, 1800),
    language: language || "unknown", domain: host, r2_key: pageKey,
    content_hash: contentHash, crawled_at: new Date().toISOString(),
    published_at: published_at || null,
    is_news: Boolean(is_news),
    content_type: content_type || "web",
    image_items: Array.isArray(image_items) ? image_items : [],
    video_items: Array.isArray(video_items) ? video_items : [],
    search_text: `${title || ""} ${description || ""} ${String(content || "").slice(0, 5000)}`.slice(0, 7000)
  });
  return { duplicate: false, r2Key: pageKey };
}

async function queueLinks(links) {
  let inserted = 0;
  for (const raw of links || []) {
    const url = normalizeUrl(raw);
    if (!url || await pageExists(url)) continue;
    const key = `queue/pending/${sha256(url)}.json`;
    if (await r2ObjectExists(key)) continue;
    await putR2Json(key, { url, queued_at: new Date().toISOString(), attempts: 0 });
    inserted++;
  }
  return inserted;
}

// ============================================================
// IMPORT ONE RECORD
// ============================================================

async function importRecord(
  record
) {
  const originalUrl =
    safeString(record.url);

  const url = normalizeUrl(originalUrl);
  if (!url) throw new Error("Invalid or unsupported URL from Common Crawl");

  log(
    `Processing: ${url}`
  );

  // ----------------------------------------------------------
  // Duplicate URL check
  // ----------------------------------------------------------

  const existing =
    await pageExists(url);

  if (existing) {
    log(
      `Already indexed: ${url}`
    );

    return {
      status: "duplicate",
    };
  }

  // ----------------------------------------------------------
  // Download WARC
  // ----------------------------------------------------------

  const compressed =
    await downloadWarcRecord(
      record
    );

  // ----------------------------------------------------------
  // Decompress WARC
  // ----------------------------------------------------------

  const warc =
    decompressWarc(
      compressed
    );

  // ----------------------------------------------------------
  // Extract HTTP
  // ----------------------------------------------------------

  const httpResponse =
    extractHttpResponse(
      warc
    );

  const decodedBody =
    decodeHttpBody(
      httpResponse.body,
      httpResponse.headers
    );

  const html =
    decodedBody.toString(
      "utf8"
    );

  if (
    !html ||
    html.length < 50
  ) {
    throw new Error(
      "HTML body is empty or too small"
    );
  }

  // ----------------------------------------------------------
  // Parse HTML
  // ----------------------------------------------------------

  const parsed =
    parseHtml(
      html,
      url
    );

  if (
    !parsed.title &&
    !parsed.content
  ) {
    throw new Error(
      "No useful HTML content found"
    );
  }

  // ----------------------------------------------------------
  // HASH
  // ----------------------------------------------------------

  const contentHash =
    sha256(html);

  // URL duplicates are checked against the R2 search index before download.

  // ----------------------------------------------------------
  // R2 KEY
  // ----------------------------------------------------------

  const host = new URL(url).hostname.toLowerCase();
  const r2Key = `pages/${host}/${sha256(url)}.html`;

  // ----------------------------------------------------------
  // SAVE PAGE + SEARCH METADATA TO R2 ONLY
  // ----------------------------------------------------------
  const saved = await savePage({
    url, title: parsed.title, description: parsed.description,
    content: parsed.content, language: parsed.language,
    contentHash, r2Key, html,
    published_at: parsed.published_at,
    is_news: parsed.is_news,
    content_type: parsed.content_type,
    image_items: parsed.image_items,
    video_items: parsed.video_items,
  });
  if (saved.duplicate) {
    log(`Duplicate URL skipped: ${url}`);
    return { status: "duplicate", url };
  }
  log(`R2 saved page and search index: ${url}`);

  // ----------------------------------------------------------
  // DISCOVER LINKS
  // ----------------------------------------------------------

  const queued =
    await queueLinks(
      parsed.links
    );

  log(
    `Links discovered: ${parsed.links.length}, queue attempted: ${queued || 0}`
  );

  return {
    status: "imported",
    url,
    language: parsed.language,
    r2Key,
  };
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  log(
    "=================================================="
  );

  log(
    "HEXORA COMMON CRAWL IMPORTER"
  );

  log(
    "=================================================="
  );

  log(
    `R2 bucket: ${R2_BUCKET_NAME}`
  );

  log(
    `Pages/domain: ${PAGES_PER_DOMAIN}`
  );

  log(
    `Maximum pages: ${MAX_PAGES}`
  );

  log(
    `Timeout: ${TIMEOUT_MS}ms`
  );

  log(
    `Max retries: ${MAX_RETRIES}`
  );

  log(
    `Worldwide Common Crawl patterns: ${TARGET_DOMAINS.length}`
  );

  // ----------------------------------------------------------
  // R2 TEST
  // ----------------------------------------------------------

  await checkR2();

  // ----------------------------------------------------------
  // COLLECTION
  // ----------------------------------------------------------

  const collection =
    await discoverCollection();

  log(`Target priority: explicit .com hosts first (${DEFAULT_TARGET_PATTERNS.length} hosts)`);
  log(`Total configured host patterns: ${TARGET_DOMAINS.length}`);
  log(
    `Using collection: ${collection}`
  );

  log(
    `Index URL: https://index.commoncrawl.org/${collection}-index`
  );

  // ----------------------------------------------------------
  // STATS
  // ----------------------------------------------------------

  let processed = 0;
  let imported = 0;
  let duplicates = 0;
  let duplicateContent = 0;
  let failed = 0;

  // ----------------------------------------------------------
  // DOMAIN LOOP
  // ----------------------------------------------------------

  for (
    const domain of TARGET_DOMAINS
  ) {
    if (
      processed >= MAX_PAGES
    ) {
      break;
    }

    log(
      `WORLDWIDE URL PATTERN: ${domain}`
    );

    let records = [];

    try {
      records =
        await queryIndex(
          collection,
          domain
        );

      log(
        `Found ${records.length} records for pattern ${domain}`
      );
    } catch (error) {
      log(
        `Index pattern ${domain} failed: ${error.message}`
      );

      continue;
    }

    // --------------------------------------------------------
    // RECORD LOOP
    // --------------------------------------------------------

    for (
      const record of records
    ) {
      if (
        processed >= MAX_PAGES
      ) {
        break;
      }

      processed++;

      try {
        const result =
          await importRecord(
            record
          );

        if (
          result.status ===
          "imported"
        ) {
          imported++;
        } else if (
          result.status ===
          "duplicate"
        ) {
          duplicates++;
        } else if (
          result.status ===
          "duplicate-content"
        ) {
          duplicateContent++;
        }
      } catch (error) {
        failed++;

        log(
          `Import failed: ${record.url}`
        );

        log(
          `Reason: ${error.message}`
        );
      }

      // Small delay so the service does not
      // hammer Common Crawl and R2.
      await sleep(250);
    }
  }

  // ----------------------------------------------------------
  // FINAL STATS
  // ----------------------------------------------------------

  log(
    "=================================================="
  );

  log(
    "COMMON CRAWL IMPORT COMPLETE"
  );

  log(
    `Processed: ${processed}`
  );

  log(
    `Imported: ${imported}`
  );

  log(
    `Duplicate URLs: ${duplicates}`
  );

  log(
    `Duplicate content: ${duplicateContent}`
  );

  log(
    `Failed: ${failed}`
  );

  log(
    `R2 bucket: ${R2_BUCKET_NAME}`
  );

  log(
    `Storage: R2 only (no Neon writes)`
  );

  log(
    "=================================================="
  );

}

// ============================================================
// ERROR HANDLER
// ============================================================

main()
  .catch(async (error) => {
    console.error(
      "[HEXORA] Common Crawl importer fatal error:",
      error
    );

    try {
        } catch {}

    process.exit(1);
  });
