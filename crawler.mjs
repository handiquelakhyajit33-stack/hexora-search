// HEXORA - Web Crawler
// Clean content extraction + Supabase indexing
// File: crawler.mjs

import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

// --------------------------------------------------
// CONFIG
// --------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

const USER_AGENT = "HEXORA-Bot/1.0 (+https://hexora-search-production.up.railway.app/)";

const BATCH_SIZE = Number(process.env.CRAWL_BATCH_SIZE || 10);
const CONCURRENCY = Number(process.env.CRAWL_CONCURRENCY || 2);
const FETCH_TIMEOUT = Number(process.env.CRAWL_TIMEOUT || 15000);

const MAX_CONTENT_LENGTH = 100000;
const MAX_LINKS_PER_PAGE = 100;

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

// --------------------------------------------------
// SEED URLS
// --------------------------------------------------

const SEED_URLS = [
  "https://www.wikipedia.org/",
  "https://www.india.gov.in/",
  "https://assam.gov.in/",
  "https://www.python.org/",
  "https://www.w3.org/",
];

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeUrl(url, baseUrl = null) {
  try {
    const parsed = new URL(url, baseUrl || undefined);

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }

    parsed.hash = "";

    // Remove tracking parameters
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
    const pathname = parsed.pathname.toLowerCase();

    // Skip downloads / binary files
    const blockedExtensions = [
      ".jpg",
      ".jpeg",
      ".png",
      ".gif",
      ".webp",
      ".svg",
      ".ico",
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

    // Skip obvious tracking / login URLs
    const badWords = [
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
      badWords.some((word) =>
        pathname.includes(word)
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
    .replace(/\r/g, " ")
    .replace(/\n+/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
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
    .replace(/&#(\d+);/g, (_, n) =>
      String.fromCharCode(Number(n))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCharCode(parseInt(n, 16))
    );
}

function stripTags(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/section>/gi, "\n")
    .replace(/<\/article>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
}

function removeComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, " ");
}

// --------------------------------------------------
// REMOVE UNWANTED HTML
// --------------------------------------------------

function removeElementBlocks(html, tagNames) {
  for (const tag of tagNames) {
    const regex = new RegExp(
      `<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`,
      "gi"
    );

    html = html.replace(regex, " ");
  }

  return html;
}

function removeNoiseByClass(html) {
  const noiseWords = [
    "advert",
    "advertisement",
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

  const pattern = noiseWords.join("|");

  const regex = new RegExp(
    `<([a-z0-9]+)\\b[^>]*(?:class|id)=["'][^"']*(?:${pattern})[^"']*["'][^>]*>[\\s\\S]*?<\\/\\1>`,
    "gi"
  );

  return html.replace(regex, " ");
}

// --------------------------------------------------
// TITLE
// --------------------------------------------------

function extractTitle(html) {
  const titleMatch = html.match(
    /<title[^>]*>([\s\S]*?)<\/title>/i
  );

  if (!titleMatch) return "";

  return cleanText(
    decodeHtmlEntities(
      stripTags(titleMatch[1])
    )
  );
}

// --------------------------------------------------
// META DESCRIPTION
// --------------------------------------------------

function extractDescription(html) {
  const patterns = [
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i,
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:description["'][^>]*>/i,
  ];

  for (const regex of patterns) {
    const match = html.match(regex);

    if (match && match[1]) {
      return cleanText(
        decodeHtmlEntities(match[1])
      ).slice(0, 1000);
    }
  }

  return "";
}

// --------------------------------------------------
// CANONICAL URL
// --------------------------------------------------

function extractCanonical(html, baseUrl) {
  const match = html.match(
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i
  );

  if (!match) return null;

  return normalizeUrl(match[1], baseUrl);
}

// --------------------------------------------------
// MAIN CONTENT EXTRACTION
// --------------------------------------------------

function extractMainContent(html) {
  let source = html;

  source = removeComments(source);

  // Remove dangerous / useless tags
  source = removeElementBlocks(source, [
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
  ]);

  // Remove common navigation structures
  source = removeElementBlocks(source, [
    "nav",
    "footer",
    "aside",
  ]);

  // Remove elements identified as ads/noise
  source = removeNoiseByClass(source);

  // Prefer ARTICLE
  let articleMatches = [
    ...source.matchAll(
      /<article\b[^>]*>([\s\S]*?)<\/article>/gi
    ),
  ];

  if (articleMatches.length > 0) {
    const articleText = articleMatches
      .map((m) => stripTags(m[1]))
      .join("\n");

    const cleaned = cleanText(
      decodeHtmlEntities(articleText)
    );

    if (cleaned.length >= 300) {
      return cleaned;
    }
  }

  // Prefer MAIN
  let mainMatches = [
    ...source.matchAll(
      /<main\b[^>]*>([\s\S]*?)<\/main>/gi
    ),
  ];

  if (mainMatches.length > 0) {
    const mainText = mainMatches
      .map((m) => stripTags(m[1]))
      .join("\n");

    const cleaned = cleanText(
      decodeHtmlEntities(mainText)
    );

    if (cleaned.length >= 300) {
      return cleaned;
    }
  }

  // BODY fallback
  const bodyMatch = source.match(
    /<body\b[^>]*>([\s\S]*?)<\/body>/i
  );

  const body = bodyMatch
    ? bodyMatch[1]
    : source;

  let text = stripTags(body);

  text = decodeHtmlEntities(text);

  text = cleanText(text);

  // Remove common text-only noise
  const noiseLines = [
    "advertisement",
    "advertisements",
    "loading...",
    "load more",
    "subscribe now",
    "sign in",
    "log in",
    "follow us",
    "share this",
    "share on",
    "cookie policy",
    "privacy policy",
    "terms and conditions",
  ];

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const lower = line.toLowerCase();

      return !noiseLines.some((noise) =>
        lower === noise ||
        lower.includes(noise)
      );
    });

  text = cleanText(lines.join("\n"));

  return text;
}

// --------------------------------------------------
// EXTRACT LINKS
// --------------------------------------------------

function extractLinks(html, baseUrl) {
  const links = new Set();

  const regex =
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;

  let match;

  while ((match = regex.exec(html)) !== null) {
    if (links.size >= MAX_LINKS_PER_PAGE) break;

    let url = normalizeUrl(
      match[1],
      baseUrl
    );

    if (!url) continue;

    if (isBadUrl(url)) continue;

    links.add(url);
  }

  return [...links];
}

// --------------------------------------------------
// HASH
// --------------------------------------------------

function contentHash(text) {
  return crypto
    .createHash("sha256")
    .update(text)
    .digest("hex");
}

// --------------------------------------------------
// FETCH PAGE
// --------------------------------------------------

async function fetchPage(url) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, FETCH_TIMEOUT);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml",
        "Accept-Language":
          "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    const contentType =
      response.headers.get("content-type") || "";

    if (
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml")
    ) {
      throw new Error(
        `Unsupported content type: ${contentType}`
      );
    }

    const html = await response.text();

    return {
      html,
      finalUrl:
        normalizeUrl(response.url) || url,
    };
  } finally {
    clearTimeout(timer);
  }
}

// --------------------------------------------------
// SAVE PAGE
// --------------------------------------------------

async function savePage({
  url,
  title,
  description,
  content,
  canonicalUrl,
}) {
  const finalUrl =
    canonicalUrl || url;

  const words = content
    .split(/\s+/)
    .filter(Boolean);

  const hash = contentHash(content);

  const pageData = {
    url: finalUrl,
    title: title || finalUrl,
    description:
      description || null,
    content:
      content.slice(0, MAX_CONTENT_LENGTH),
    content_hash: hash,
    word_count: words.length,
    language: "unknown",
    updated_at: new Date().toISOString(),
    last_crawled_at:
      new Date().toISOString(),
  };

  const { error } = await supabase
    .from("pages")
    .upsert(
      pageData,
      {
        onConflict: "url",
      }
    );

  if (error) {
    throw new Error(
      `Supabase pages error: ${error.message}`
    );
  }
}

// --------------------------------------------------
// QUEUE LINKS
// --------------------------------------------------

async function queueLinks(links) {
  if (!links.length) return;

  const rows = links.map((url) => ({
    url,
    status: "queued",
  }));

  const { error } = await supabase
    .from("crawl_queue")
    .upsert(
      rows,
      {
        onConflict: "url",
        ignoreDuplicates: true,
      }
    );

  if (error) {
    console.log(
      "[HEXORA] Queue insert warning:",
      error.message
    );
  }
}

// --------------------------------------------------
// UPDATE QUEUE
// --------------------------------------------------

async function markQueueDone(
  queueId,
  errorMessage = null
) {
  const update = {
    status: errorMessage
      ? "failed"
      : "done",
    last_crawled_at:
      new Date().toISOString(),
    last_error:
      errorMessage || null,
  };

  const { error } = await supabase
    .from("crawl_queue")
    .update(update)
    .eq("id", queueId);

  if (error) {
    console.log(
      "[HEXORA] Queue update warning:",
      error.message
    );
  }
}

// --------------------------------------------------
// CRAWL ONE URL
// --------------------------------------------------

async function crawlUrl(
  queueItem
) {
  const url = queueItem.url;

  console.log(
    `[HEXORA] Crawling: ${url}`
  );

  try {
    const page =
      await fetchPage(url);

    const html = page.html;
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

    if (!content || content.length < 50) {
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
      canonicalUrl,
    });

    await queueLinks(links);

    await markQueueDone(
      queueItem.id
    );

    console.log(
      `[HEXORA] Indexed: ${title || finalUrl}`
    );

    console.log(
      `[HEXORA] Words: ${content
        .split(/\s+/)
        .filter(Boolean).length} | Links: ${links.length}`
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

    await markQueueDone(
      queueItem.id,
      message.slice(0, 1000)
    );

    return {
      ok: false,
      url,
      error: message,
    };
  }
}

// --------------------------------------------------
// GET QUEUE
// --------------------------------------------------

async function getPendingUrls() {
  const { data, error } =
    await supabase
      .from("crawl_queue")
      .select(
        "id,url,status"
      )
      .eq("status", "queued")
      .order(
        "created_at",
        {
          ascending: true,
        }
      )
      .limit(BATCH_SIZE);

  if (error) {
    throw new Error(
      `Queue read error: ${error.message}`
    );
  }

  return data || [];
}

// --------------------------------------------------
// SEED QUEUE
// --------------------------------------------------

async function seedQueue() {
  const rows =
    SEED_URLS.map((url) => ({
      url,
      status: "queued",
    }));

  const { error } =
    await supabase
      .from("crawl_queue")
      .upsert(
        rows,
        {
          onConflict: "url",
          ignoreDuplicates: true,
        }
      );

  if (error) {
    console.log(
      "[HEXORA] Seed warning:",
      error.message
    );
  }
}

// --------------------------------------------------
// CONCURRENT PROCESSING
// --------------------------------------------------

async function processBatch(items) {
  let index = 0;

  async function worker() {
    while (true) {
      const current =
        index++;

      if (current >= items.length) {
        break;
      }

      await crawlUrl(
        items[current]
      );

      // Small delay between requests
      await sleep(500);
    }
  }

  const workers = [];

  const count = Math.min(
    CONCURRENCY,
    items.length
  );

  for (let i = 0; i < count; i++) {
    workers.push(
      worker()
    );
  }

  await Promise.all(
    workers
  );
}

// --------------------------------------------------
// MAIN CRAWL CYCLE
// --------------------------------------------------

export async function runCrawler() {
  console.log("");
  console.log(
    "======================================"
  );
  console.log(
    " HEXORA CRAWLER"
  );
  console.log(
    "======================================"
  );

  try {
    await seedQueue();

    const items =
      await getPendingUrls();

    if (!items.length) {
      console.log(
        "[HEXORA] No pending URLs."
      );

      return {
        processed: 0,
      };
    }

    console.log(
      `[HEXORA] Processing ${items.length} URLs...`
    );

    await processBatch(
      items
    );

    console.log(
      "[HEXORA] Crawl cycle completed."
    );

    return {
      processed:
        items.length,
    };
  } catch (error) {
    console.error(
      "[HEXORA] Crawler error:",
      error
    );

    return {
      processed: 0,
      error:
        error?.message ||
        String(error),
    };
  }
}

// --------------------------------------------------
// DIRECT RUN
// --------------------------------------------------

const isMain =
  process.argv[1] &&
  (
    process.argv[1].endsWith(
      "crawler.mjs"
    )
  );

if (isMain) {
  await runCrawler();
}
