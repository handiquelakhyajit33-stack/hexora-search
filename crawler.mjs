// HEXORA CRAWLER
// Clean webpage content + Supabase indexing
// Compatible with worker/worker.mjs:
// import { crawlBatch } from "../crawler.mjs";

import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

// =====================================================
// CONFIG
// =====================================================

const SUPABASE_URL = process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

const USER_AGENT =
  "HEXORA-Bot/1.0 (+https://hexora-search-production.up.railway.app/)";

const DEFAULT_BATCH_SIZE = Number(
  process.env.CRAWL_BATCH_SIZE || 10
);

const CONCURRENCY = Number(
  process.env.CRAWL_CONCURRENCY || 2
);

const FETCH_TIMEOUT = Number(
  process.env.CRAWL_TIMEOUT || 15000
);

const MAX_CONTENT_LENGTH = 100000;

const MAX_LINKS_PER_PAGE = 100;

// =====================================================
// SUPABASE
// =====================================================

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
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
      autoRefreshToken: false,
    },
  }
);

// =====================================================
// SEEDS
// =====================================================

const SEED_URLS = [
  "https://www.wikipedia.org/",
  "https://www.india.gov.in/",
  "https://assam.gov.in/",
  "https://www.python.org/",
  "https://www.w3.org/",
];

// =====================================================
// UTILS
// =====================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeUrl(url, baseUrl = null) {
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
      "mc_eid",
    ];

    for (const param of trackingParams) {
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
      ".otf",
    ];

    if (
      blockedExtensions.some((ext) =>
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
      "/cdn-cgi/",
    ];

    if (
      blockedPaths.some((path) =>
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
        String.fromCharCode(Number(n))
    )
    .replace(
      /&#x([0-9a-f]+);/gi,
      (_, n) =>
        String.fromCharCode(
          parseInt(n, 16)
        )
    );
}

function stripTags(html) {
  return html
    .replace(
      /<(br|\/p|\/div|\/section|\/article|\/li)[^>]*>/gi,
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

// =====================================================
// HTML CLEANING
// =====================================================

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

function removeNoiseByClass(html) {
  const noiseWords = [
    "advert",
    "advertisement",
    "advertisements",
    "ads",
    "ad-container",
    "adbox",
    "banner",
    "cookie",
    "cookies",
    "social",
    "share",
    "sharing",
    "comment",
    "comments",
    "related",
    "recommend",
    "recommended",
    "recommendation",
    "newsletter",
    "subscribe",
    "subscription",
    "popup",
    "modal",
    "overlay",
    "sidebar",
    "side-bar",
    "breadcrumb",
    "breadcrumbs",
    "navigation",
    "nav-menu",
    "menu",
    "footer",
    "header",
    "promo",
    "promotion",
    "sponsor",
    "sponsored",
    "login",
    "signup",
    "register",
    "print",
    "share-buttons",
    "social-buttons",
    "latest-news",
    "trending",
    "most-read",
    "popular-posts",
    "more-stories",
    "related-stories",
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

// =====================================================
// TITLE
// =====================================================

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

// =====================================================
// DESCRIPTION
// =====================================================

function extractDescription(html) {
  const patterns = [
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i,

    /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i,

    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["'][^>]*>/i,

    /<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:description["'][^>]*>/i,
  ];

  for (const regex of patterns) {
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

// =====================================================
// CANONICAL
// =====================================================

function extractCanonical(
  html,
  baseUrl
) {
  const match =
    html.match(
      /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i
    );

  if (!match) return null;

  return normalizeUrl(
    match[1],
    baseUrl
  );
}

// =====================================================
// MAIN CONTENT
// =====================================================

function extractMainContent(html) {
  let source = html;

  source = removeComments(
    source
  );

  // Remove scripts and useless blocks
  source = removeElementBlocks(
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
      "form",
      "dialog",
    ]
  );

  // Remove navigation structures
  source = removeElementBlocks(
    source,
    [
      "nav",
      "footer",
      "aside",
    ]
  );

  // Remove advertisement /
  // social / recommendation blocks
  source =
    removeNoiseByClass(
      source
    );

  // -------------------------------------------------
  // ARTICLE FIRST
  // -------------------------------------------------

  const articles = [
    ...source.matchAll(
      /<article\b[^>]*>([\s\S]*?)<\/article>/gi
    ),
  ];

  if (articles.length) {
    const articleText =
      articles
        .map((m) =>
          stripTags(m[1])
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

  // -------------------------------------------------
  // MAIN SECOND
  // -------------------------------------------------

  const mains = [
    ...source.matchAll(
      /<main\b[^>]*>([\s\S]*?)<\/main>/gi
    ),
  ];

  if (mains.length) {
    const mainText =
      mains
        .map((m) =>
          stripTags(m[1])
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

  // -------------------------------------------------
  // BODY FALLBACK
  // -------------------------------------------------

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
    decodeHtmlEntities(
      text
    );

  text =
    cleanText(text);

  // Remove common text noise
  const noisePatterns = [
    /^advertisement$/i,
    /^advertisements$/i,
    /^loading\.{0,3}$/i,
    /^load more$/i,
    /^subscribe now$/i,
    /^sign in$/i,
    /^log in$/i,
    /^follow us$/i,
    /^share this$/i,
    /^share on$/i,
  ];

  const lines =
    text
      .split("\n")
      .map((line) =>
        line.trim()
      )
      .filter(Boolean)
      .filter(
        (line) =>
          !noisePatterns.some(
            (regex) =>
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

// =====================================================
// LINKS
// =====================================================

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
    ...links,
  ];
}

// =====================================================
// HASH
// =====================================================

function makeHash(text) {
  return crypto
    .createHash("sha256")
    .update(text)
    .digest("hex");
}

// =====================================================
// FETCH
// =====================================================

async function fetchPage(
  url
) {
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
              "en-US,en;q=0.9",
          },

          redirect:
            "follow",

          signal:
            controller.signal,
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
        ) || url,
    };
  } finally {
    clearTimeout(
      timeout
    );
  }
}

// =====================================================
// SAVE PAGE
// =====================================================

async function savePage(
  data
) {
  const words =
    data.content
      .split(/\s+/)
      .filter(Boolean);

  const row = {
    url:
      data.canonicalUrl ||
      data.url,

    title:
      data.title ||
      data.url,

    description:
      data.description ||
      null,

    content:
      data.content,

    content_hash:
      makeHash(
        data.content
      ),

    word_count:
      words.length,

    language:
      "unknown",

    updated_at:
      new Date().toISOString(),

    last_crawled_at:
      new Date().toISOString(),
  };

  const { error } =
    await supabase
      .from("pages")
      .upsert(
        row,
        {
          onConflict:
            "url",
        }
      );

  if (error) {
    throw new Error(
      `Supabase pages error: ${error.message}`
    );
  }
}

// =====================================================
// QUEUE LINKS
// =====================================================

async function queueLinks(
  links
) {
  if (!links.length) {
    return;
  }

  const rows =
    links.map(
      (url) => ({
        url,
        status:
          "queued",
      })
    );

  const { error } =
    await supabase
      .from("crawl_queue")
      .upsert(
        rows,
        {
          onConflict:
            "url",

          ignoreDuplicates:
            true,
        }
      );

  if (error) {
    console.log(
      "[HEXORA] Queue warning:",
      error.message
    );
  }
}

// =====================================================
// QUEUE STATUS
// =====================================================

async function markDone(
  id
) {
  const { error } =
    await supabase
      .from("crawl_queue")
      .update({
        status: "done",

        last_crawled_at:
          new Date().toISOString(),

        last_error:
          null,
      })
      .eq(
        "id",
        id
      );

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
          ),
      })
      .eq(
        "id",
        id
      );

  if (error) {
    console.log(
      "[HEXORA] Queue failure update warning:",
      error.message
    );
  }
}

// =====================================================
// CRAWL ONE URL
// =====================================================

async function crawlOne(
  item
) {
  const url =
    item.url;

  console.log(
    `[HEXORA] Crawling: ${url}`
  );

  try {
    const page =
      await fetchPage(
        url
      );

    const html =
      page.html;

    const finalUrl =
      page.finalUrl;

    const title =
      extractTitle(
        html
      );

    const description =
      extractDescription(
        html
      );

    const canonicalUrl =
      extractCanonical(
        html,
        finalUrl
      );

    const content =
      extractMainContent(
        html
      );

    if (
      !content ||
      content.length < 50
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
      url:
        finalUrl,

      title,

      description,

      content,

      canonicalUrl,
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
      url: finalUrl,
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
      error: message,
    };
  }
}

// =====================================================
// GET PENDING QUEUE
// =====================================================

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
          ascending: true,
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

// =====================================================
// SEED QUEUE
// =====================================================

async function seedQueue() {
  const rows =
    SEED_URLS.map(
      (url) => ({
        url,
        status:
          "queued",
      })
    );

  const { error } =
    await supabase
      .from("crawl_queue")
      .upsert(
        rows,
        {
          onConflict:
            "url",

          ignoreDuplicates:
            true,
        }
      );

  if (error) {
    console.log(
      "[HEXORA] Seed warning:",
      error.message
    );
  }
}

// =====================================================
// CRAWL BATCH
// =====================================================
// IMPORTANT:
// worker/worker.mjs imports this function.
// =====================================================

export async function crawlBatch(
  batchSize = DEFAULT_BATCH_SIZE
) {
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
      failed: 0,
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

    failed,
  };
}

// =====================================================
// RUN ONE CRAWL CYCLE
// =====================================================

export async function runCrawler() {
  console.log("");
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

    return await crawlBatch(
      DEFAULT_BATCH_SIZE
    );
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
        String(error),
    };
  }
}

// =====================================================
// DIRECT EXECUTION
// =====================================================

const isMain =
  process.argv[1] &&
  process.argv[1].endsWith(
    "crawler.mjs"
  );

if (isMain) {
  await runCrawler();
}
