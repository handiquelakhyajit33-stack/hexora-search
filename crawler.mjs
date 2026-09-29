// ============================================================
// HEXORA SEARCH ENGINE
// FULL WEB CRAWLER
// crawler.mjs
// ============================================================

import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

// ============================================================
// ENVIRONMENT
// ============================================================

const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL) {
  throw new Error(
    "[HEXORA] SUPABASE_URL is missing"
  );
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "[HEXORA] SUPABASE_SERVICE_ROLE_KEY is missing"
  );
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

// ============================================================
// CONFIGURATION
// ============================================================

const USER_AGENT =
  process.env.HEXORA_USER_AGENT ||
  "HEXORA-Bot/1.0 (+https://hexora-search-production.up.railway.app/)";

const DEFAULT_BATCH_SIZE =
  Number(process.env.CRAWL_BATCH_SIZE || 12);

const CONCURRENCY =
  Number(process.env.CRAWLER_CONCURRENCY || 2);

const FETCH_TIMEOUT =
  Number(process.env.CRAWLER_TIMEOUT || 15000);

const DOMAIN_DELAY =
  Number(
    process.env.CRAWL_DOMAIN_DELAY_MS || 1500
  );

const MAX_CONTENT_LENGTH =
  Number(
    process.env.CRAWL_MAX_CONTENT || 100000
  );

const MAX_LINKS_PER_PAGE =
  Number(
    process.env.CRAWL_MAX_LINKS || 100
  );

// ============================================================
// SEED URLS
// ============================================================

const SEED_URLS = [
  "https://www.wikipedia.org/",
  "https://www.india.gov.in/",
  "https://assam.gov.in/",
  "https://www.python.org/",
  "https://www.w3.org/"
];

// ============================================================
// MEMORY
// ============================================================

const domainLastRequest =
  new Map();

// ============================================================
// BASIC HELPERS
// ============================================================

function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function nowISO() {
  return new Date().toISOString();
}

// ============================================================
// URL NORMALIZATION
// ============================================================

function normalizeUrl(input) {
  if (!input) {
    return null;
  }

  try {
    const url =
      new URL(input);

    if (
      url.protocol !== "http:" &&
      url.protocol !== "https:"
    ) {
      return null;
    }

    url.protocol =
      url.protocol.toLowerCase();

    url.hostname =
      url.hostname.toLowerCase();

    url.hash = "";

    /*
     * Remove common tracking parameters.
     */

    const trackingParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid",
      "dclid",
      "msclkid",
      "mc_cid",
      "mc_eid"
    ];

    for (
      const key of [
        ...url.searchParams.keys()
      ]
    ) {
      const lower =
        key.toLowerCase();

      if (
        trackingParams.includes(lower) ||
        lower.startsWith("utm_")
      ) {
        url.searchParams.delete(key);
      }
    }

    /*
     * Remove trailing slash except root.
     */

    if (
      url.pathname.length > 1
    ) {
      url.pathname =
        url.pathname.replace(
          /\/+$/,
          ""
        );
    }

    return url.toString();

  } catch {
    return null;
  }
}

// ============================================================
// URL FILTER
// ============================================================

function shouldCrawl(input) {
  const url =
    normalizeUrl(input);

  if (!url) {
    return false;
  }

  if (
    url.protocol !== "http:" &&
    url.protocol !== "https:"
  ) {
    return false;
  }

  const host =
    url.hostname.toLowerCase();

  let path =
    url.pathname || "";

  try {
    path =
      decodeURIComponent(path);
  } catch {
    // Keep original path.
  }

  const lowerPath =
    path.toLowerCase();

  /*
   * ------------------------------------------
   * URL SIZE
   * ------------------------------------------
   */

  if (
    url.toString().length > 1500
  ) {
    return false;
  }

  if (
    path.length > 600
  ) {
    return false;
  }

  /*
   * ------------------------------------------
   * BAD TRACKING PARAMETERS
   * ------------------------------------------
   */

  const blockedParameters = [
    "utm_",
    "fbclid",
    "gclid",
    "dclid",
    "msclkid",
    "mc_cid",
    "mc_eid"
  ];

  for (
    const key of url.searchParams.keys()
  ) {
    const lowerKey =
      key.toLowerCase();

    if (
      blockedParameters.some(
        item =>
          lowerKey === item ||
          lowerKey.startsWith(item)
      )
    ) {
      return false;
    }
  }

  /*
   * ------------------------------------------
   * LOGIN / ACCOUNT / USER ACTIONS
   * ------------------------------------------
   */

  const blockedPaths = [
    "/login",
    "/logout",
    "/signin",
    "/sign-in",
    "/signup",
    "/sign-up",
    "/register",
    "/createaccount",
    "/create-account",
    "/account",
    "/accounts",
    "/user/login",
    "/user/register",
    "/recentchanges",
    "/recent-changes",
    "/special/",
    "/special:",
    "/edit",
    "/history"
  ];

  for (
    const blocked of blockedPaths
  ) {
    if (
      lowerPath === blocked ||
      lowerPath.startsWith(
        blocked
      )
    ) {
      return false;
    }
  }

  /*
   * ------------------------------------------
   * SEARCH RESULT PAGES
   * ------------------------------------------
   */

  if (
    lowerPath === "/search" ||
    lowerPath.startsWith("/search/") ||
    lowerPath.includes("/search?")
  ) {
    return false;
  }

  /*
   * ------------------------------------------
   * ACTION PARAMETERS
   * ------------------------------------------
   */

  const action =
    url.searchParams
      .get("action");

  if (action) {
    const lowerAction =
      action.toLowerCase();

    if (
      lowerAction === "edit" ||
      lowerAction === "history" ||
      lowerAction === "raw" ||
      lowerAction === "delete"
    ) {
      return false;
    }
  }

  /*
   * ------------------------------------------
   * WIKIMEDIA NAMESPACES
   *
   * IMPORTANT:
   *
   * /wiki/Book
   * /wiki/Free_software
   * /wiki/Work_of_art
   *
   * ARE ALLOWED.
   * ------------------------------------------
   */

  if (
    host === "wikipedia.org" ||
    host.endsWith(".wikipedia.org") ||
    host.endsWith("wikimedia.org")
  ) {
    const match =
      lowerPath.match(
        /^\/wiki\/([^/?#]+)/
      );

    if (match) {
      let title =
        match[1];

      try {
        title =
          decodeURIComponent(title);
      } catch {
        // Keep original.
      }

      title =
        title.replace(
          /_/g,
          " "
        );

      const colonIndex =
        title.indexOf(":");

      if (colonIndex !== -1) {
        const namespace =
          title
            .slice(
              0,
              colonIndex
            )
            .trim()
            .toLowerCase();

        const blockedNamespaces =
          new Set([
            "special",
            "user",
            "user talk",
            "talk",
            "template",
            "template talk",
            "file",
            "file talk",
            "category",
            "category talk",
            "help",
            "portal",
            "mediawiki",
            "module",
            "module talk",
            "project",
            "project talk",
            "draft",
            "draft talk",
            "timedtext"
          ]);

        if (
          blockedNamespaces.has(
            namespace
          )
        ) {
          return false;
        }
      }
    }
  }

  /*
   * ------------------------------------------
   * FILE EXTENSIONS
   * ------------------------------------------
   */

  const blockedExtensions = [
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".svg",
    ".ico",
    ".bmp",
    ".tif",
    ".tiff",
    ".avif",

    ".mp3",
    ".wav",
    ".ogg",
    ".m4a",
    ".flac",

    ".mp4",
    ".avi",
    ".mov",
    ".mkv",
    ".webm",

    ".zip",
    ".rar",
    ".7z",
    ".tar",
    ".gz",
    ".bz2",

    ".exe",
    ".apk",
    ".dmg",
    ".iso",

    ".woff",
    ".woff2",
    ".ttf",
    ".otf"
  ];

  for (
    const extension of
      blockedExtensions
  ) {
    if (
      lowerPath.endsWith(
        extension
      )
    ) {
      return false;
    }
  }

  /*
   * ------------------------------------------
   * BAD URL CHARACTERS / PATTERNS
   * ------------------------------------------
   */

  if (
    lowerPath.includes(
      "/wp-admin/"
    )
  ) {
    return false;
  }

  if (
    lowerPath.includes(
      "/wp-login"
    )
  ) {
    return false;
  }

  /*
   * ------------------------------------------
   * ALLOW
   * ------------------------------------------
   */

  return true;
}

// ============================================================
// HTML ENTITY DECODER
// ============================================================

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(
      /&nbsp;/gi,
      " "
    )
    .replace(
      /&amp;/gi,
      "&"
    )
    .replace(
      /&lt;/gi,
      "<"
    )
    .replace(
      /&gt;/gi,
      ">"
    )
    .replace(
      /&quot;/gi,
      '"'
    )
    .replace(
      /&#39;/gi,
      "'"
    )
    .replace(
      /&#x27;/gi,
      "'"
    );
}

// ============================================================
// REMOVE COMMENTS
// ============================================================

function removeComments(html) {
  return String(html || "")
    .replace(
      /<!--[\s\S]*?-->/g,
      " "
    );
}

// ============================================================
// REMOVE ELEMENT BLOCKS
// ============================================================

function removeElementBlocks(
  html,
  tags
) {
  let result =
    String(html || "");

  for (
    const tag of tags
  ) {
    const regex =
      new RegExp(
        `<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`,
        "gi"
      );

    result =
      result.replace(
        regex,
        " "
      );
  }

  return result;
}

// ============================================================
// REMOVE WEBSITE NOISE
// ============================================================

function removeNoiseBlocks(html) {
  let result =
    String(html || "");

  const noiseWords = [
    "advert",
    "advertisement",
    "ad-container",
    "adbox",
    "cookie",
    "newsletter",
    "subscribe",
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
    "modal"
  ];

  for (
    const word of noiseWords
  ) {
    const regex =
      new RegExp(
        `<(?:div|section|aside|header|footer|nav)[^>]*(?:id|class)=[\"'][^\"']*${word}[^\"']*[\"'][^>]*>[\\s\\S]*?<\\/(?:div|section|aside|header|footer|nav)>`,
        "gi"
      );

    result =
      result.replace(
        regex,
        " "
      );
  }

  return result;
}

// ============================================================
// STRIP HTML
// ============================================================

function stripTags(html) {
  return String(html || "")
    .replace(
      /<br\s*\/?>/gi,
      "\n"
    )
    .replace(
      /<\/p>/gi,
      "\n"
    )
    .replace(
      /<\/div>/gi,
      "\n"
    )
    .replace(
      /<\/li>/gi,
      "\n"
    )
    .replace(
      /<\/h[1-6]>/gi,
      "\n"
    )
    .replace(
      /<[^>]+>/g,
      " "
    );
}

// ============================================================
// CLEAN TEXT
// ============================================================

function cleanText(text) {
  return decodeHtmlEntities(
    text
  )
    .replace(
      /\u00a0/g,
      " "
    )
    .replace(
      /[ \t]+/g,
      " "
    )
    .replace(
      /\n\s+/g,
      "\n"
    )
    .replace(
      /\n{3,}/g,
      "\n\n"
    )
    .trim();
}

// ============================================================
// EXTRACT MAIN CONTENT
// ============================================================

function extractMainContent(html) {
  let cleaned =
    removeComments(html);

  cleaned =
    removeElementBlocks(
      cleaned,
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

  cleaned =
    removeNoiseBlocks(
      cleaned
    );

  /*
   * Prefer ARTICLE.
   */

  let match =
    cleaned.match(
      /<article\b[^>]*>([\s\S]*?)<\/article>/i
    );

  /*
   * Then MAIN.
   */

  if (!match) {
    match =
      cleaned.match(
        /<main\b[^>]*>([\s\S]*?)<\/main>/i
      );
  }

  /*
   * Then BODY.
   */

  let content =
    match
      ? match[1]
      : cleaned;

  if (
    stripTags(content)
      .trim()
      .length < 200
  ) {
    const body =
      cleaned.match(
        /<body\b[^>]*>([\s\S]*?)<\/body>/i
      );

    if (body) {
      content =
        body[1];
    }
  }

  let text =
    stripTags(content);

  text =
    cleanText(text);

  if (
    text.length >
    MAX_CONTENT_LENGTH
  ) {
    text =
      text.slice(
        0,
        MAX_CONTENT_LENGTH
      );
  }

  return text;
}

// ============================================================
// TITLE
// ============================================================

function extractTitle(html) {
  const og =
    html.match(
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
    );

  if (og) {
    return cleanText(
      og[1]
    );
  }

  const title =
    html.match(
      /<title[^>]*>([\s\S]*?)<\/title>/i
    );

  if (!title) {
    return "";
  }

  return cleanText(
    stripTags(
      title[1]
    )
  );
}

// ============================================================
// DESCRIPTION
// ============================================================

function extractDescription(html) {
  const description =
    html.match(
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i
    );

  if (!description) {
    return "";
  }

  return cleanText(
    description[1]
  );
}

// ============================================================
// LANGUAGE
// ============================================================

function extractLanguage(html) {
  const htmlLang =
    html.match(
      /<html[^>]+lang=["']([^"']+)["']/i
    );

  if (htmlLang) {
    return (
      htmlLang[1]
        .trim()
        .toLowerCase()
    );
  }

  const contentLang =
    html.match(
      /<meta[^>]+http-equiv=["']content-language["'][^>]+content=["']([^"']+)["']/i
    );

  if (contentLang) {
    return (
      contentLang[1]
        .trim()
        .toLowerCase()
    );
  }

  return "unknown";
}

// ============================================================
// CANONICAL URL
// ============================================================

function extractCanonical(
  html,
  baseUrl
) {
  const canonical =
    html.match(
      /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i
    );

  if (!canonical) {
    return baseUrl;
  }

  try {
    const absolute =
      new URL(
        canonical[1],
        baseUrl
      ).toString();

    return (
      normalizeUrl(
        absolute
      ) ||
      baseUrl
    );

  } catch {
    return baseUrl;
  }
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
    /<a\b[^>]+href=["']([^"']+)["']/gi;

  let match;

  while (
    (match = regex.exec(html)) !== null
  ) {
    if (
      links.size >=
      MAX_LINKS_PER_PAGE
    ) {
      break;
    }

    try {
      const absolute =
        new URL(
          match[1],
          baseUrl
        ).toString();

      const normalized =
        normalizeUrl(
          absolute
        );

      if (
        normalized &&
        shouldCrawl(
          normalized
        )
      ) {
        links.add(
          normalized
        );
      }

    } catch {
      // Ignore invalid links.
    }
  }

  return [
    ...links
  ];
}

// ============================================================
// DOMAIN DELAY
// ============================================================

async function respectDomainDelay(
  url
) {
  try {
    const host =
      new URL(url)
        .hostname
        .toLowerCase();

    const previous =
      domainLastRequest.get(
        host
      );

    if (previous) {
      const elapsed =
        Date.now() -
        previous;

      if (
        elapsed <
        DOMAIN_DELAY
      ) {
        await sleep(
          DOMAIN_DELAY -
          elapsed
        );
      }
    }

    domainLastRequest.set(
      host,
      Date.now()
    );

  } catch {
    // Ignore.
  }
}

// ============================================================
// FETCH PAGE
// ============================================================

async function fetchPage(url) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => {
        controller.abort();
      },
      FETCH_TIMEOUT
    );

  try {
    const response =
      await fetch(
        url,
        {
          redirect: "follow",
          signal:
            controller.signal,

          headers: {
            "User-Agent":
              USER_AGENT,

            "Accept":
              "text/html,application/xhtml+xml"
          }
        }
      );

    if (
      !response.ok
    ) {
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

    const finalUrl =
      normalizeUrl(
        response.url
      ) ||
      url;

    return {
      html,
      finalUrl
    };

  } finally {
    clearTimeout(
      timeout
    );
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
  language
}) {
  const contentHash =
    crypto
      .createHash(
        "sha256"
      )
      .update(
        content
      )
      .digest(
        "hex"
      );

  const wordCount =
    content
      .split(/\s+/)
      .filter(Boolean)
      .length;

  const timestamp =
    nowISO();

  const row = {
    url,

    title:
      title ||
      url,

    description:
      description ||
      "",

    content,

    content_hash:
      contentHash,

    word_count:
      wordCount,

    language:
      language ||
      "unknown",

    updated_at:
      timestamp,

    last_crawled_at:
      timestamp
  };

  const {
    error
  } =
    await supabase
      .from("pages")
      .upsert(
        row,
        {
          onConflict:
            "url"
        }
      );

  if (error) {
    throw error;
  }

  return wordCount;
}

// ============================================================
// QUEUE LINKS
// ============================================================

async function queueLinks(
  links,
  sourceUrl = null
) {
  if (
    !Array.isArray(links) ||
    !links.length
  ) {
    return;
  }

  const rows =
    links.map(
      url => ({
        url,

        status:
          "queued",

        created_at:
          nowISO()
      })
    );

  const {
    error
  } =
    await supabase
      .from("crawl_queue")
      .upsert(
        rows,
        {
          onConflict:
            "url",

          ignoreDuplicates:
            true
        }
      );

  if (error) {
    console.error(
      "[HEXORA] Queue error:",
      error.message
    );
  } else {
    console.log(
      `[HEXORA] Queued ${links.length} links from ${sourceUrl || "page"}`
    );
  }
}

// ============================================================
// MARK DONE
// ============================================================

async function markDone(
  url
) {
  const {
    error
  } =
    await supabase
      .from("crawl_queue")
      .update({
        status:
          "done",

        last_crawled_at:
          nowISO(),

        last_error:
          null
      })
      .eq(
        "url",
        url
      );

  if (error) {
    console.error(
      "[HEXORA] markDone error:",
      error.message
    );
  }
}

// ============================================================
// MARK FAILED
// ============================================================

async function markFailed(
  url,
  error
) {
  const message =
    error?.message ||
    String(error);

  const {
    error: dbError
  } =
    await supabase
      .from("crawl_queue")
      .update({
        status:
          "failed",

        last_crawled_at:
          nowISO(),

        last_error:
          message
      })
      .eq(
        "url",
        url
      );

  if (dbError) {
    console.error(
      "[HEXORA] markFailed error:",
      dbError.message
    );
  }
}

// ============================================================
// GET QUEUED URLS
// ============================================================

async function getQueued(
  batchSize
) {
  const {
    data,
    error
  } =
    await supabase
      .from("crawl_queue")
      .select(
        "url"
      )
      .eq(
        "status",
        "queued"
      )
      .order(
        "created_at",
        {
          ascending:
            true
        }
      )
      .limit(
        batchSize
      );

  if (error) {
    throw error;
  }

  return data || [];
}

// ============================================================
// CRAWL ONE URL
// ============================================================

async function crawlOne(
  url
) {
  const normalized =
    normalizeUrl(url);

  if (!normalized) {
    console.log(
      `[HEXORA] Invalid URL: ${url}`
    );

    return {
      success:
        false,

      skipped:
        true
    };
  }

  /*
   * Filter before network request.
   */

  if (
    !shouldCrawl(
      normalized
    )
  ) {
    console.log(
      `[HEXORA] Filtered: ${normalized}`
    );

    await markDone(
      normalized
    );

    return {
      success:
        false,

      skipped:
        true
    };
  }

  console.log(
    `[HEXORA] Crawling: ${normalized}`
  );

  try {
    /*
     * Respect domain rate.
     */

    await respectDomainDelay(
      normalized
    );

    /*
     * Fetch.
     */

    const page =
      await fetchPage(
        normalized
      );

    const finalUrl =
      normalizeUrl(
        page.finalUrl
      ) ||
      normalized;

    /*
     * Redirect target
     * must also be crawlable.
     */

    if (
      !shouldCrawl(
        finalUrl
      )
    ) {
      console.log(
        `[HEXORA] Filtered redirect: ${finalUrl}`
      );

      await markDone(
        normalized
      );

      return {
        success:
          false,

        skipped:
          true
      };
    }

    /*
     * Extract data.
     */

    const title =
      extractTitle(
        page.html
      );

    const description =
      extractDescription(
        page.html
      );

    const language =
      extractLanguage(
        page.html
      );

    const canonical =
      extractCanonical(
        page.html,
        finalUrl
      );

    const content =
      extractMainContent(
        page.html
      );

    /*
     * Do not index empty pages.
     */

    if (
      !content ||
      content.length < 80
    ) {
      throw new Error(
        "No useful page content found"
      );
    }

    /*
     * Extract outgoing links.
     */

    const links =
      extractLinks(
        page.html,
        canonical
      );

    /*
     * Save indexed page.
     */

    const words =
      await savePage({
        url:
          canonical,

        title,

        description,

        content,

        language
      });

    /*
     * Add discovered URLs.
     */

    await queueLinks(
      links,
      canonical
    );

    /*
     * Mark original URL done.
     */

    await markDone(
      normalized
    );

    /*
     * Also mark final URL done
     * when different.
     */

    if (
      finalUrl !==
      normalized
    ) {
      await markDone(
        finalUrl
      );
    }

    console.log(
      `[HEXORA] Indexed: ${
        title ||
        canonical
      }`
    );

    console.log(
      `[HEXORA] Words: ${words} | Links: ${links.length}`
    );

    return {
      success:
        true,

      skipped:
        false
    };

  } catch (error) {
    console.error(
      `[HEXORA] Crawl failed: ${normalized} -> ${
        error?.message ||
        error
      }`
    );

    await markFailed(
      normalized,
      error
    );

    return {
      success:
        false,

      skipped:
        false
    };
  }
}

// ============================================================
// CRAWL BATCH
// ============================================================

export async function crawlBatch(
  options = DEFAULT_BATCH_SIZE
) {
  let batchSize;

  if (
    typeof options ===
    "number"
  ) {
    batchSize =
      options;
  } else if (
    options &&
    typeof options ===
    "object"
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
    !Number.isFinite(
      batchSize
    ) ||
    batchSize < 1
  ) {
    batchSize =
      DEFAULT_BATCH_SIZE;
  }

  batchSize =
    Math.floor(
      batchSize
    );

  console.log(
    `[HEXORA] Starting crawl batch: ${batchSize}`
  );

  const queued =
    await getQueued(
      batchSize
    );

  if (
    !queued.length
  ) {
    console.log(
      "[HEXORA] No queued URLs."
    );

    return {
      processed:
        0,

      successful:
        0,

      failed:
        0
    };
  }

  let processed =
    0;

  let successful =
    0;

  let failed =
    0;

  let index =
    0;

  /*
   * Worker pool.
   */

  async function worker() {
    while (true) {
      const current =
        index++;

      if (
        current >=
        queued.length
      ) {
        return;
      }

      const item =
        queued[current];

      /*
       * Try to reserve URL.
       *
       * This prevents two crawler
       * workers from taking the
       * same queued URL.
       */

      const {
        data: claimed,
        error: claimError
      } =
        await supabase
          .from("crawl_queue")
          .update({
            status:
              "processing"
          })
          .eq(
            "url",
            item.url
          )
          .eq(
            "status",
            "queued"
          )
          .select(
            "url"
          );

      if (
        claimError
      ) {
        console.error(
          "[HEXORA] Claim error:",
          claimError.message
        );

        failed++;
        processed++;

        continue;
      }

      if (
        !claimed ||
        !claimed.length
      ) {
        continue;
      }

      const result =
        await crawlOne(
          item.url
        );

      processed++;

      if (
        result.success
      ) {
        successful++;
      } else if (
        !result.skipped
      ) {
        failed++;
      }

      await sleep(
        100
      );
    }
  }

  const workers =
    Array.from(
      {
        length:
          Math.min(
            CONCURRENCY,
            queued.length
          )
      },
      () => worker()
    );

  await Promise.all(
    workers
  );

  console.log(
    `[HEXORA] Batch completed | processed: ${processed} | successful: ${successful} | failed: ${failed}`
  );

  return {
    processed,

    successful,

    failed
  };
}

// ============================================================
// SEED QUEUE
// ============================================================

async function seedQueue() {
  const rows =
    SEED_URLS
      .map(
        normalizeUrl
      )
      .filter(Boolean)
      .filter(
        shouldCrawl
      )
      .map(
        url => ({
          url,

          status:
            "queued",

          created_at:
            nowISO()
        })
      );

  if (
    !rows.length
  ) {
    return;
  }

  const {
    error
  } =
    await supabase
      .from("crawl_queue")
      .upsert(
        rows,
        {
          onConflict:
            "url",

          ignoreDuplicates:
            true
        }
      );

  if (error) {
    console.error(
      "[HEXORA] Seed error:",
      error.message
    );
  } else {
    console.log(
      `[HEXORA] Seed queue ready: ${rows.length} seed URLs`
    );
  }
}

// ============================================================
// RESET STUCK PROCESSING URLS
// ============================================================

async function resetStuckProcessing() {
  /*
   * URLs left in processing after a
   * Railway restart should become
   * crawlable again.
   *
   * We only reset records older
   * than 30 minutes.
   */

  const cutoff =
    new Date(
      Date.now() -
      30 * 60 * 1000
    ).toISOString();

  const {
    error
  } =
    await supabase
      .from("crawl_queue")
      .update({
        status:
          "queued"
      })
      .eq(
        "status",
        "processing"
      )
      .lt(
        "created_at",
        cutoff
      );

  if (error) {
    /*
     * Do not crash crawler if the
     * optional recovery operation
     * cannot run.
     */
    console.log(
      "[HEXORA] Processing recovery skipped:",
      error.message
    );
  }
}

// ============================================================
// RUN CRAWLER
// ============================================================

export async function runCrawler() {
  console.log(
    "[HEXORA] Crawler cycle starting..."
  );

  await resetStuckProcessing();

  await seedQueue();

  const result =
    await crawlBatch(
      DEFAULT_BATCH_SIZE
    );

  console.log(
    new Date().toISOString(),
    "crawl cycle",
    result
  );

  return result;
}

// ============================================================
// DIRECT EXECUTION
// ============================================================

if (
  process.argv[1] &&
  process.argv[1].endsWith(
    "crawler.mjs"
  )
) {
  runCrawler()
    .catch(
      error => {
        console.error(
          "[HEXORA] Fatal crawler error:",
          error
        );

        process.exit(
          1
        );
      }
    );
}
