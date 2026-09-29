// ============================================================
// HEXORA CRAWLER
// Compatible with existing worker/worker.mjs
// Clean content + Supabase indexing
// ============================================================

import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

// ============================================================
// CONFIG
// ============================================================

const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

const USER_AGENT =
  "HEXORA-Bot/1.0 (+https://hexora-search-production.up.railway.app/)";

const DEFAULT_BATCH_SIZE = 12;

const CONCURRENCY = Number(
  process.env.CRAWL_CONCURRENCY || 2
);

const FETCH_TIMEOUT = Number(
  process.env.CRAWL_TIMEOUT || 15000
);

const MAX_CONTENT_LENGTH = 100000;

const MAX_LINKS_PER_PAGE = 100;

// ============================================================
// SUPABASE
// ============================================================

if (
  !SUPABASE_URL ||
  !SUPABASE_SERVICE_ROLE_KEY
) {
  throw new Error(
    "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing"
  );
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  }
);

// ============================================================
// SEEDS
// ============================================================

const SEED_URLS = [
  "https://www.wikipedia.org/",
  "https://www.india.gov.in/",
  "https://assam.gov.in/",
  "https://www.python.org/",
  "https://www.w3.org/"
];

// ============================================================
// BASIC HELPERS
// ============================================================

function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  );
}

function normalizeUrl(
  url,
  baseUrl = null
) {
  try {
    const parsed = new URL(
      url,
      baseUrl || undefined
    );

    if (
      parsed.protocol !== "http:" &&
      parsed.protocol !== "https:"
    ) {
      return null;
    }

    parsed.hash = "";

    const trackingParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid",
      "mc_cid",
      "mc_eid"
    ];

    for (
      const param of trackingParams
    ) {
      parsed.searchParams.delete(param);
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

function isBadUrl(url) {
  if (!url) return true;

  try {
    const parsed = new URL(url);

    const pathname =
      parsed.pathname.toLowerCase();

    const blockedExtensions = [
      ".jpg",
      ".jpeg",
      ".png",
      ".gif",
      ".webp",
      ".svg",
      ".ico",
      ".bmp",
      ".mp3",
      ".wav",
      ".mp4",
      ".avi",
      ".mov",
      ".mkv",
      ".zip",
      ".rar",
      ".7z",
      ".exe",
      ".apk",
      ".dmg",
      ".iso",
      ".css",
      ".js",
      ".woff",
      ".woff2",
      ".ttf",
      ".otf"
    ];

    if (
      blockedExtensions.some(ext =>
        pathname.endsWith(ext)
      )
    ) {
      return true;
    }

    const blockedPaths = [
      "/login",
      "/signin",
      "/signup",
      "/register",
      "/logout",
      "/wp-login",
      "/cart",
      "/checkout",
      "/account",
      "/admin",
      "/cdn-cgi/"
    ];

    if (
      blockedPaths.some(path =>
        pathname.includes(path)
      )
    ) {
      return true;
    }

    return false;
  } catch {
    return true;
  }
}

// ============================================================
// TEXT CLEANING
// ============================================================

function decodeHtmlEntities(text) {
  if (!text) return "";

  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(
      /&#(\d+);/g,
      (_, n) =>
        String.fromCharCode(
          Number(n)
        )
    )
    .replace(
      /&#x([0-9a-f]+);/gi,
      (_, n) =>
        String.fromCharCode(
          parseInt(n, 16)
        )
    );
}

function cleanText(text) {
  if (!text) return "";

  return text
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripTags(html) {
  return html
    .replace(
      /<(br|\/p|\/div|\/section|\/article|\/li|\/h[1-6])[^>]*>/gi,
      "\n"
    )
    .replace(/<[^>]+>/g, " ");
}

function removeComments(html) {
  return html.replace(
    /<!--[\s\S]*?-->/g,
    " "
  );
}

// ============================================================
// REMOVE ONLY CLEARLY USELESS BLOCKS
// ============================================================

function removeElementBlocks(
  html,
  tags
) {
  for (const tag of tags) {
    const regex = new RegExp(
      `<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`,
      "gi"
    );

    html = html.replace(
      regex,
      " "
    );
  }

  return html;
}

// ============================================================
// NOISE CLEANING
// ============================================================

function removeNoiseBlocks(html) {
  const noiseWords = [
    "advertisement",
    "ad-container",
    "adbox",
    "cookie-banner",
    "cookie-consent",
    "newsletter",
    "subscribe-box",
    "social-share",
    "share-buttons",
    "comments-section",
    "related-posts",
    "related-content",
    "recommended-posts",
    "recommendations",
    "trending-posts",
    "most-read",
    "popular-posts",
    "popup",
    "modal",
    "newsletter-box"
  ];

  const pattern =
    noiseWords.join("|");

  const regex = new RegExp(
    `<([a-z0-9]+)\\b[^>]*(?:class|id)=["'][^"']*(?:${pattern})[^"']*["'][^>]*>[\\s\\S]*?<\\/\\1>`,
    "gi"
  );

  return html.replace(
    regex,
    " "
  );
}

// ============================================================
// TITLE
// ============================================================

function extractTitle(html) {
  const match =
    html.match(
      /<title[^>]*>([\s\S]*?)<\/title>/i
    );

  if (!match) return "";

  return cleanText(
    decodeHtmlEntities(
      stripTags(match[1])
    )
  );
}

// ============================================================
// DESCRIPTION
// ============================================================

function extractDescription(html) {
  const patterns = [
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i,

    /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i,

    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["'][^>]*>/i,

    /<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:description["'][^>]*>/i
  ];

  for (
    const regex of patterns
  ) {
    const match =
      html.match(regex);

    if (
      match &&
      match[1]
    ) {
      return cleanText(
        decodeHtmlEntities(
          match[1]
        )
      ).slice(0, 1000);
    }
  }

  return "";
}

// ============================================================
// CANONICAL
// ============================================================

function extractCanonical(
  html,
  baseUrl
) {
  const match =
    html.match(
      /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i
    );

  if (!match) {
    return null;
  }

  return normalizeUrl(
    match[1],
    baseUrl
  );
}

// ============================================================
// MAIN CONTENT EXTRACTION
// ============================================================

function extractMainContent(html) {
  let source = html;

  source =
    removeComments(source);

  // Remove only definitely non-content tags
  source =
    removeElementBlocks(
      source,
      [
        "script",
        "style",
        "noscript",
        "svg",
        "canvas",
        "iframe",
        "object",
        "embed",
        "template",
        "form"
      ]
    );

  // Remove obvious advertisement/social blocks
  source =
    removeNoiseBlocks(source);

  // ----------------------------------------------------------
  // ARTICLE
  // ----------------------------------------------------------

  const articles = [
    ...source.matchAll(
      /<article\b[^>]*>([\s\S]*?)<\/article>/gi
    )
  ];

  if (articles.length) {
    const articleText =
      articles
        .map(match =>
          stripTags(match[1])
        )
        .join("\n");

    const cleaned =
      cleanText(
        decodeHtmlEntities(
          articleText
        )
      );

    if (
      cleaned.length >= 300
    ) {
      return cleaned.slice(
        0,
        MAX_CONTENT_LENGTH
      );
    }
  }

  // ----------------------------------------------------------
  // MAIN
  // ----------------------------------------------------------

  const mains = [
    ...source.matchAll(
      /<main\b[^>]*>([\s\S]*?)<\/main>/gi
    )
  ];

  if (mains.length) {
    const mainText =
      mains
        .map(match =>
          stripTags(match[1])
        )
        .join("\n");

    const cleaned =
      cleanText(
        decodeHtmlEntities(
          mainText
        )
      );

    if (
      cleaned.length >= 300
    ) {
      return cleaned.slice(
        0,
        MAX_CONTENT_LENGTH
      );
    }
  }

  // ----------------------------------------------------------
  // BODY FALLBACK
  // ----------------------------------------------------------

  const bodyMatch =
    source.match(
      /<body\b[^>]*>([\s\S]*?)<\/body>/i
    );

  const body =
    bodyMatch
      ? bodyMatch[1]
      : source;

  let text =
    stripTags(body);

  text =
    decodeHtmlEntities(text);

  text =
    cleanText(text);

  // ----------------------------------------------------------
  // REMOVE VERY COMMON NOISE LINES
  // ----------------------------------------------------------

  const badLines = [
    /^advertisement$/i,
    /^advertisements$/i,
    /^loading\.{0,3}$/i,
    /^load more$/i,
    /^sign in$/i,
    /^log in$/i,
    /^subscribe now$/i,
    /^follow us$/i
  ];

  const lines =
    text
      .split("\n")
      .map(line =>
        line.trim()
      )
      .filter(Boolean)
      .filter(line =>
        !badLines.some(
          regex =>
            regex.test(line)
        )
      );

  text =
    cleanText(
      lines.join("\n")
    );

  return text.slice(
    0,
    MAX_CONTENT_LENGTH
  );
}

// ============================================================
// LINKS
// ============================================================

function extractLinks(
  html,
  baseUrl
) {
  const links =
    new Set();

  const regex =
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;

  let match;

  while (
    (match = regex.exec(html))
  ) {
    if (
      links.size >=
      MAX_LINKS_PER_PAGE
    ) {
      break;
    }

    const url =
      normalizeUrl(
        match[1],
        baseUrl
      );

    if (!url) continue;

    if (
      isBadUrl(url)
    ) {
      continue;
    }

    links.add(url);
  }

  return [
    ...links
  ];
}

// ============================================================
// HASH
// ============================================================

function makeHash(text) {
  return crypto
    .createHash("sha256")
    .update(text)
    .digest("hex");
}

// ============================================================
// FETCH
// ============================================================

async function fetchPage(url) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      FETCH_TIMEOUT
    );

  try {
    const response =
      await fetch(
        url,
        {
          method: "GET",

          headers: {
            "User-Agent":
              USER_AGENT,

            Accept:
              "text/html,application/xhtml+xml",

            "Accept-Language":
              "en-US,en;q=0.9"
          },

          redirect:
            "follow",

          signal:
            controller.signal
        }
      );

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    const contentType =
      response.headers.get(
        "content-type"
      ) || "";

    if (
      !contentType.includes(
        "text/html"
      ) &&
      !contentType.includes(
        "application/xhtml+xml"
      )
    ) {
      throw new Error(
        `Unsupported content type: ${contentType}`
      );
    }

    const html =
      await response.text();

    return {
      html,

      finalUrl:
        normalizeUrl(
          response.url
        ) || url
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================
// SAVE PAGE
// ============================================================

async function savePage({
  url,
  title,
  description,
  content,
  canonicalUrl
}) {
  const words =
    content
      .split(/\s+/)
      .filter(Boolean);

  const row = {
    url:
      canonicalUrl ||
      url,

    title:
      title ||
      url,

    description:
      description ||
      null,

    content,

    content_hash:
      makeHash(content),

    word_count:
      words.length,

    language:
      "unknown",

    updated_at:
      new Date().toISOString(),

    last_crawled_at:
      new Date().toISOString()
  };

  const { error } =
    await supabase
      .from("pages")
      .upsert(
        row,
        {
          onConflict: "url"
        }
      );

  if (error) {
    throw new Error(
      `Supabase pages error: ${error.message}`
    );
  }
}

// ============================================================
// QUEUE LINKS
// ============================================================

async function queueLinks(
  links
) {
  if (!links.length) {
    return;
  }

  const rows =
    links.map(url => ({
      url,
      status: "queued"
    }));

  const { error } =
    await supabase
      .from("crawl_queue")
      .upsert(
        rows,
        {
          onConflict: "url",
          ignoreDuplicates: true
        }
      );

  if (error) {
    console.log(
      "[HEXORA] Queue warning:",
      error.message
    );
  }
}

// ============================================================
// QUEUE STATUS
// ============================================================

async function markDone(id) {
  const { error } =
    await supabase
      .from("crawl_queue")
      .update({
        status: "done",

        last_crawled_at:
          new Date().toISOString(),

        last_error: null
      })
      .eq("id", id);

  if (error) {
    console.log(
      "[HEXORA] Queue update warning:",
      error.message
    );
  }
}

async function markFailed(
  id,
  message
) {
  const { error } =
    await supabase
      .from("crawl_queue")
      .update({
        status: "failed",

        last_crawled_at:
          new Date().toISOString(),

        last_error:
          String(message).slice(
            0,
            1000
          )
      })
      .eq("id", id);

  if (error) {
    console.log(
      "[HEXORA] Queue failure warning:",
      error.message
    );
  }
}

// ============================================================
// CRAWL ONE URL
// ============================================================

async function crawlOne(item) {
  const url =
    item.url;

  console.log(
    `[HEXORA] Crawling: ${url}`
  );

  try {
    const page =
      await fetchPage(url);

    const html =
      page.html;

    const finalUrl =
      page.finalUrl;

    const title =
      extractTitle(html);

    const description =
      extractDescription(html);

    const canonicalUrl =
      extractCanonical(
        html,
        finalUrl
      );

    const content =
      extractMainContent(html);

    if (
      !content ||
      content.length < 80
    ) {
      throw new Error(
        "No useful page content found"
      );
    }

    const links =
      extractLinks(
        html,
        finalUrl
      );

    await savePage({
      url: finalUrl,
      title,
      description,
      content,
      canonicalUrl
    });

    await queueLinks(
      links
    );

    await markDone(
      item.id
    );

    console.log(
      `[HEXORA] Indexed: ${
        title || finalUrl
      }`
    );

    console.log(
      `[HEXORA] Words: ${
        content
          .split(/\s+/)
          .filter(Boolean)
          .length
      } | Links: ${
        links.length
      }`
    );

    return {
      ok: true,
      url: finalUrl
    };
  } catch (error) {
    const message =
      error?.message ||
      String(error);

    console.log(
      `[HEXORA] Crawl failed: ${url} -> ${message}`
    );

    await markFailed(
      item.id,
      message
    );

    return {
      ok: false,
      url,
      error: message
    };
  }
}

// ============================================================
// GET PENDING URLS
// ============================================================

async function getPending(
  batchSize
) {
  const { data, error } =
    await supabase
      .from("crawl_queue")
      .select(
        "id,url,status"
      )
      .eq(
        "status",
        "queued"
      )
      .order(
        "created_at",
        {
          ascending: true
        }
      )
      .limit(
        batchSize
      );

  if (error) {
    throw new Error(
      `Queue read error: ${error.message}`
    );
  }

  return data || [];
}

// ============================================================
// SEED
// ============================================================

async function seedQueue() {
  const rows =
    SEED_URLS.map(url => ({
      url,
      status: "queued"
    }));

  const { error } =
    await supabase
      .from("crawl_queue")
      .upsert(
        rows,
        {
          onConflict: "url",
          ignoreDuplicates: true
        }
      );

  if (error) {
    console.log(
      "[HEXORA] Seed warning:",
      error.message
    );
  }
}

// ============================================================
// CRAWL BATCH
// ============================================================
// IMPORTANT:
// Existing worker may call:
// crawlBatch({ batchSize: 12 })
//
// This function accepts BOTH:
// crawlBatch(12)
// crawlBatch({ batchSize: 12 })
// ============================================================

export async function crawlBatch(
  options = DEFAULT_BATCH_SIZE
) {
  let batchSize;

  if (
    typeof options === "number"
  ) {
    batchSize = options;
  } else if (
    options &&
    typeof options === "object"
  ) {
    batchSize =
      Number(
        options.batchSize ||
        options.batch ||
        DEFAULT_BATCH_SIZE
      );
  } else {
    batchSize =
      DEFAULT_BATCH_SIZE;
  }

  if (
    !Number.isFinite(batchSize) ||
    batchSize <= 0
  ) {
    batchSize =
      DEFAULT_BATCH_SIZE;
  }

  batchSize =
    Math.min(
      Math.floor(batchSize),
      50
    );

  console.log(
    `[HEXORA] Starting crawl batch: ${batchSize}`
  );

  const items =
    await getPending(
      batchSize
    );

  if (!items.length) {
    console.log(
      "[HEXORA] No pending URLs."
    );

    return {
      processed: 0,
      successful: 0,
      failed: 0
    };
  }

  let nextIndex = 0;

  let successful = 0;

  let failed = 0;

  async function worker() {
    while (true) {
      const index =
        nextIndex++;

      if (
        index >=
        items.length
      ) {
        break;
      }

      const result =
        await crawlOne(
          items[index]
        );

      if (result.ok) {
        successful++;
      } else {
        failed++;
      }

      await sleep(500);
    }
  }

  const workers = [];

  const workerCount =
    Math.min(
      CONCURRENCY,
      items.length
    );

  for (
    let i = 0;
    i < workerCount;
    i++
  ) {
    workers.push(
      worker()
    );
  }

  await Promise.all(
    workers
  );

  console.log(
    `[HEXORA] Batch completed | processed: ${items.length} | successful: ${successful} | failed: ${failed}`
  );

  return {
    processed:
      items.length,

    successful,

    failed
  };
}

// ============================================================
// FULL CRAWLER
// ============================================================

export async function runCrawler() {
  console.log(
    "======================================"
  );

  console.log(
    "       HEXORA CRAWLER"
  );

  console.log(
    "======================================"
  );

  try {
    await seedQueue();

    return await crawlBatch({
      batchSize:
        DEFAULT_BATCH_SIZE
    });
  } catch (error) {
    console.error(
      "[HEXORA] Crawler error:",
      error
    );

    return {
      processed: 0,
      successful: 0,
      failed: 0,
      error:
        error?.message ||
        String(error)
    };
  }
}

// ============================================================
// DIRECT RUN
// ============================================================

const isMain =
  process.argv[1] &&
  process.argv[1].endsWith(
    "crawler.mjs"
  );

if (isMain) {
  await runCrawler();
}
