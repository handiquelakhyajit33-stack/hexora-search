// HEXORA - crawler.mjs
// Unified crawler for Railway Worker + Supabase
// Queue lifecycle: queued -> processing -> done / failed

import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL) throw new Error("SUPABASE_URL is missing");

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing");
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

const USER_AGENT =
  process.env.HEXORA_USER_AGENT ||
  "HEXORA-Bot/1.0 (+https://hexora-search-production.up.railway.app/)";

const BATCH_SIZE = Math.max(
  1,
  Number(process.env.CRAWLER_BATCH_SIZE || 12)
);

const CONCURRENCY = Math.max(
  1,
  Number(process.env.CRAWLER_CONCURRENCY || 2)
);

const FETCH_TIMEOUT = Math.max(
  5000,
  Number(process.env.CRAWL_TIMEOUT_MS || 15000)
);

const DOMAIN_DELAY = Math.max(
  0,
  Number(process.env.CRAWL_DOMAIN_DELAY_MS || 1500)
);

const MAX_CONTENT = Math.max(
  10000,
  Number(process.env.CRAWL_MAX_CONTENT || 100000)
);

const MAX_LINKS = Math.max(
  10,
  Number(process.env.CRAWL_MAX_LINKS || 100)
);

const SEEDS = [
  "https://www.wikipedia.org/",
  "https://www.india.gov.in/",
  "https://assam.gov.in/",
  "https://www.python.org/",
  "https://www.w3.org/"
];

const robotsCache = new Map();
const lastVisit = new Map();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function normalizeUrl(input, base = null) {
  try {
    const url = base
      ? new URL(input, base)
      : new URL(input);

    if (!["http:", "https:"].includes(url.protocol)) {
      return null;
    }

    url.hash = "";
    url.hostname = url.hostname.toLowerCase();

    for (const key of [...url.searchParams.keys()]) {
      const k = key.toLowerCase();

      if (
        k === "fbclid" ||
        k === "gclid" ||
        k === "mc_cid" ||
        k === "mc_eid" ||
        k.startsWith("utm_")
      ) {
        url.searchParams.delete(key);
      }
    }

    if (
      url.pathname.length > 1 &&
      url.pathname.endsWith("/")
    ) {
      url.pathname =
        url.pathname.replace(/\/+$/, "");
    }

    return url.toString();

  } catch {
    return null;
  }
}


/*
 * IMPORTANT:
 * Normal article/page URLs must NOT be blocked.
 */
export function shouldCrawl(input) {

  const normalized =
    normalizeUrl(input);

  if (!normalized) {
    return false;
  }

  const url =
    new URL(normalized);

  const host =
    url.hostname.toLowerCase();

  const path =
    decodeURIComponent(
      url.pathname
    ).toLowerCase();

  const query =
    url.searchParams;


  /*
   * Wikimedia / Wikipedia utility parameters
   */

  const blockedParams = [
    "action",
    "oldid",
    "diff",
    "veaction",
    "printable",
    "useparsoid",
    "wpformidentifier"
  ];

  for (
    const key of blockedParams
  ) {
    if (query.has(key)) {
      return false;
    }
  }


  /*
   * Wikimedia / Wikipedia namespaces
   */

  if (
    host.endsWith("wikipedia.org") ||
    host.endsWith("wikimedia.org") ||
    host.endsWith("wiktionary.org") ||
    host.endsWith("wikibooks.org") ||
    host.endsWith("wikiquote.org") ||
    host.endsWith("wikinews.org") ||
    host.endsWith("wikisource.org") ||
    host.endsWith("wikiversity.org") ||
    host.endsWith("wikivoyage.org")
  ) {

    const wikiIndex =
      path.indexOf("/wiki/");

    if (wikiIndex !== -1) {

      const title =
        path.slice(
          wikiIndex + 6
        );

      const blockedNamespaces = [
        "special:",
        "user:",
        "user_talk:",
        "talk:",
        "template:",
        "template_talk:",
        "file:",
        "file_talk:",
        "category:",
        "category_talk:",
        "help:",
        "portal:",
        "mediawiki:",
        "module:",
        "module_talk:",
        "project:",
        "project_talk:",
        "book:",
        "book_talk:",
        "draft:",
        "draft_talk:",
        "timedtext:"
      ];

      if (
        blockedNamespaces.some(
          ns => title.startsWith(ns)
        )
      ) {
        return false;
      }

      if (
        title.includes("special:") ||
        title.includes("recentchanges")
      ) {
        return false;
      }
    }


    /*
     * Wikimedia utility endpoint
     */

    if (
      path === "/w/index.php" ||
      path === "/w/index.php/"
    ) {
      return false;
    }
  }


  /*
   * Generic login/account endpoints
   */

  if (
    path === "/login" ||
    path === "/logout" ||
    path === "/register" ||
    path === "/signup" ||
    path === "/createaccount" ||
    path === "/account/login" ||
    path === "/account/logout" ||
    path.includes("/wp-login.php")
  ) {
    return false;
  }


  /*
   * Non-document file types
   */

  const badExtensions = [
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
    ".mp3",
    ".wav",
    ".ogg",
    ".m4a",
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
    ".exe",
    ".apk",
    ".dmg",
    ".iso",
    ".css",
    ".js",
    ".json",
    ".xml"
  ];

  if (
    badExtensions.some(
      ext => path.endsWith(ext)
    )
  ) {
    return false;
  }


  /*
   * Prevent huge URLs
   */

  if (
    normalized.length > 1600
  ) {
    return false;
  }

  if (
    path.length > 700
  ) {
    return false;
  }


  /*
   * Search result pages only
   */

  if (
    path === "/search" ||
    path === "/search/" ||
    path === "/search-results" ||
    path === "/search-results/"
  ) {
    return false;
  }


  /*
   * Invalid host
   */

  if (
    !host ||
    host.includes("..")
  ) {
    return false;
  }

  return true;
}


/* =========================================================
   TEXT HELPERS
========================================================= */

function decodeEntities(text) {

  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'");
}


function cleanText(text) {

  return decodeEntities(text)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}


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


function removeBlocks(html) {

  return String(html || "")
    .replace(
      /<!--[\s\S]*?-->/g,
      " "
    )
    .replace(
      /<(script|style|noscript|template|svg|canvas|iframe|object|embed|form)\b[^>]*>[\s\S]*?<\/\1>/gi,
      " "
    );
}


function extractBetween(
  html,
  tag
) {

  const re =
    new RegExp(
      `<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`,
      "i"
    );

  return (
    html.match(re)?.[1] ||
    ""
  );
}


function extractMeta(
  html,
  attr,
  value
) {

  const re1 =
    new RegExp(
      `<meta\\b[^>]*${attr}=["']${value}["'][^>]*content=["']([^"']*)["'][^>]*>`,
      "i"
    );

  const re2 =
    new RegExp(
      `<meta\\b[^>]*content=["']([^"']*)["'][^>]*${attr}=["']${value}["'][^>]*>`,
      "i"
    );

  return (
    re1.exec(html)?.[1] ||
    re2.exec(html)?.[1] ||
    ""
  );
}


/* =========================================================
   CANONICAL
========================================================= */

function extractCanonical(
  html,
  baseUrl
) {

  const match =
    /<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i.exec(html) ||
    /<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["'][^>]*>/i.exec(html);

  if (!match) {
    return baseUrl;
  }

  return (
    normalizeUrl(
      match[1],
      baseUrl
    ) ||
    baseUrl
  );
}


/* =========================================================
   MAIN CONTENT
========================================================= */

function extractMainContent(html) {

  const cleaned =
    removeBlocks(html);

  let content =
    extractBetween(
      cleaned,
      "article"
    ) ||
    extractBetween(
      cleaned,
      "main"
    ) ||
    extractBetween(
      cleaned,
      "body"
    ) ||
    cleaned;

  let text =
    cleanText(
      stripTags(content)
    );

  if (
    text.length < 200
  ) {
    text =
      cleanText(
        stripTags(cleaned)
      );
  }

  return text.slice(
    0,
    MAX_CONTENT
  );
}


/* =========================================================
   TITLE
========================================================= */

function extractTitle(html) {

  const og =
    extractMeta(
      html,
      "property",
      "og:title"
    );

  if (og) {
    return cleanText(og)
      .slice(0, 500);
  }

  const title =
    extractBetween(
      html,
      "title"
    );

  return cleanText(
    stripTags(title)
  ).slice(0, 500);
}


/* =========================================================
   DESCRIPTION
========================================================= */

function extractDescription(html) {

  const description =
    extractMeta(
      html,
      "name",
      "description"
    ) ||
    extractMeta(
      html,
      "property",
      "og:description"
    );

  return cleanText(
    description
  ).slice(
    0,
    1200
  );
}


/* =========================================================
   LANGUAGE
========================================================= */

function detectLanguage(text) {

  const sample =
    String(text || "")
      .slice(0, 8000);

  if (
    /[\u0C00-\u0C7F]/.test(sample)
  ) return "as";

  if (
    /[\u0900-\u097F]/.test(sample)
  ) return "hi";

  if (
    /[\u0980-\u09FF]/.test(sample)
  ) return "bn";

  if (
    /[\u0B80-\u0BFF]/.test(sample)
  ) return "ta";

  if (
    /[\u0A80-\u0AFF]/.test(sample)
  ) return "gu";

  if (
    /[\u0A00-\u0A7F]/.test(sample)
  ) return "pa";

  if (
    /[\u4E00-\u9FFF]/.test(sample)
  ) return "zh";

  if (
    /[\u3040-\u30FF]/.test(sample)
  ) return "ja";

  if (
    /[\uAC00-\uD7AF]/.test(sample)
  ) return "ko";

  return "en";
}


/* =========================================================
   LINKS
========================================================= */

function extractLinks(
  html,
  baseUrl
) {

  const links =
    new Set();

  const regex =
    /<a\b[^>]*href=["']([^"']+)["']/gi;

  let match;

  while (
    links.size < MAX_LINKS &&
    (match = regex.exec(html)) !== null
  ) {

    const normalized =
      normalizeUrl(
        match[1],
        baseUrl
      );

    if (
      normalized &&
      shouldCrawl(normalized)
    ) {
      links.add(
        normalized
      );
    }
  }

  return [
    ...links
  ];
}


/* =========================================================
   FETCH
========================================================= */

async function fetchPage(url) {

  const controller =
    new AbortController();

  const timer =
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
          redirect: "follow",

          signal:
            controller.signal,

          headers: {
            "User-Agent":
              USER_AGENT,

            "Accept":
              "text/html,application/xhtml+xml",

            "Accept-Language":
              "en-US,en;q=0.8"
          }
        }
      );

    const finalUrl =
      normalizeUrl(
        response.url
      ) ||
      url;

    if (
      !response.ok
    ) {

      return {
        ok: false,
        status:
          response.status,
        finalUrl,
        reason:
          `HTTP ${response.status}`
      };
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

      return {
        ok: false,
        status:
          response.status,
        finalUrl,
        reason:
          "not-html"
      };
    }

    return {
      ok: true,
      status:
        response.status,
      finalUrl,
      html:
        await response.text()
    };

  } catch (error) {

    return {
      ok: false,
      status: 0,
      finalUrl: url,
      reason:
        error?.name === "AbortError"
          ? "timeout"
          : String(
              error?.message ||
              error
            )
    };

  } finally {

    clearTimeout(
      timer
    );
  }
}


/* =========================================================
   ROBOTS.TXT
========================================================= */

function parseRobots(text) {

  const groups = [];

  let current = null;

  for (
    const raw of String(text || "")
      .split(/\r?\n/)
  ) {

    const line =
      raw
        .split("#")[0]
        .trim();

    if (!line) {
      continue;
    }

    const i =
      line.indexOf(":");

    if (i < 0) {
      continue;
    }

    const key =
      line
        .slice(0, i)
        .trim()
        .toLowerCase();

    const value =
      line
        .slice(i + 1)
        .trim();

    if (
      key === "user-agent"
    ) {

      current = {
        agents: [
          value.toLowerCase()
        ],
        allow: [],
        disallow: []
      };

      groups.push(
        current
      );

      continue;
    }

    if (!current) {
      continue;
    }

    if (
      key === "allow" &&
      value
    ) {
      current.allow.push(
        value
      );
    }

    if (
      key === "disallow" &&
      value
    ) {
      current.disallow.push(
        value
      );
    }
  }

  return groups.filter(
    group =>
      group.agents.includes("*") ||
      group.agents.includes(
        "hexora-bot"
      )
  );
}


function robotsAllowed(
  pathname,
  groups
) {

  if (!groups.length) {
    return true;
  }

  let bestLength = -1;
  let allowed = true;

  for (
    const group of groups
  ) {

    for (
      const rule of group.disallow
    ) {

      if (
        pathname.startsWith(rule) &&
        rule.length > bestLength
      ) {

        bestLength =
          rule.length;

        allowed = false;
      }
    }

    for (
      const rule of group.allow
    ) {

      if (
        pathname.startsWith(rule) &&
        rule.length >= bestLength
      ) {

        bestLength =
          rule.length;

        allowed = true;
      }
    }
  }

  return allowed;
}


async function canCrawl(url) {

  try {

    const target =
      new URL(url);

    const origin =
      target.origin;

    const cached =
      robotsCache.get(
        origin
      );

    if (
      cached &&
      cached.expires >
        Date.now()
    ) {
      return cached.allowed;
    }

    const robotsUrl =
      `${origin}/robots.txt`;

    const controller =
      new AbortController();

    const timer =
      setTimeout(
        () =>
          controller.abort(),
        8000
      );

    let response;

    try {

      response =
        await fetch(
          robotsUrl,
          {
            signal:
              controller.signal,

            headers: {
              "User-Agent":
                USER_AGENT
            }
          }
        );

    } finally {

      clearTimeout(
        timer
      );
    }

    if (
      !response.ok
    ) {

      robotsCache.set(
        origin,
        {
          allowed: true,
          expires:
            Date.now() +
            3600000
        }
      );

      return true;
    }

    const rules =
      parseRobots(
        await response.text()
      );

    const allowed =
      robotsAllowed(
        target.pathname,
        rules
      );

    robotsCache.set(
      origin,
      {
        allowed,
        expires:
          Date.now() +
          3600000
      }
    );

    return allowed;

  } catch {

    return false;
  }
}


/* =========================================================
   DOMAIN DELAY
========================================================= */

async function respectDomainDelay(
  url
) {

  const host =
    new URL(url)
      .hostname;

  const previous =
    lastVisit.get(host) ||
    0;

  const wait =
    DOMAIN_DELAY -
    (
      Date.now() -
      previous
    );

  if (
    wait > 0
  ) {
    await sleep(wait);
  }

  lastVisit.set(
    host,
    Date.now()
  );
}


/* =========================================================
   SAVE PAGE
========================================================= */

async function savePage({
  url,
  title,
  description,
  content,
  language
}) {

  const contentHash =
    crypto
      .createHash("sha256")
      .update(content)
      .digest("hex");

  const wordCount =
    content
      .split(/\s+/)
      .filter(Boolean)
      .length;

  const now =
    new Date()
      .toISOString();

  const record = {

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
      now
  };

  const { error } =
    await supabase
      .from("pages")
      .upsert(
        record,
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


/* =========================================================
   QUEUE LINKS
========================================================= */

async function queueLinks(
  links
) {

  if (
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
          new Date()
            .toISOString()
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
            true
        }
      );

  if (error) {

    console.error(
      "[HEXORA] Queue insert error:",
      error.message
    );
  }
}


/* =========================================================
   QUEUE STATUS
========================================================= */

async function markStatus(
  url,
  status,
  errorMessage = null
) {

  const patch = {

    status,

    last_crawled_at:
      status === "done" ||
      status === "failed"
        ? new Date()
            .toISOString()
        : undefined,

    last_error:
      errorMessage
  };

  if (
    patch.last_crawled_at ===
    undefined
  ) {
    delete patch.last_crawled_at;
  }

  const { error } =
    await supabase
      .from("crawl_queue")
      .update(patch)
      .eq(
        "url",
        url
      );

  if (error) {

    console.error(
      "[HEXORA] Queue status error:",
      error.message
    );
  }
}


/* =========================================================
   CRAWL ONE
========================================================= */

async function crawlOne(
  url
) {

  if (
    !shouldCrawl(url)
  ) {

    console.log(
      `[HEXORA] Filtered: ${url}`
    );

    await markStatus(
      url,
      "done",
      null
    );

    return {
      success: false,
      skipped: true
    };
  }

  console.log(
    `[HEXORA] Crawling: ${url}`
  );

  try {

    if (
      !(await canCrawl(url))
    ) {

      console.log(
        `[HEXORA] Robots blocked: ${url}`
      );

      await markStatus(
        url,
        "done",
        "robots-disallowed"
      );

      return {
        success: false,
        skipped: true
      };
    }

    await respectDomainDelay(
      url
    );

    const page =
      await fetchPage(
        url
      );

    if (!page.ok) {

      throw new Error(
        page.reason ||
        `HTTP ${page.status}`
      );
    }

    if (
      !shouldCrawl(
        page.finalUrl
      )
    ) {

      console.log(
        `[HEXORA] Filtered redirect: ${page.finalUrl}`
      );

      await markStatus(
        url,
        "done",
        "filtered-redirect"
      );

      return {
        success: false,
        skipped: true
      };
    }

    const title =
      extractTitle(
        page.html
      );

    const description =
      extractDescription(
        page.html
      );

    const content =
      extractMainContent(
        page.html
      );

    if (
      content.length < 80
    ) {

      throw new Error(
        "No useful page content found"
      );
    }

    const canonical =
      extractCanonical(
        page.html,
        page.finalUrl
      );

    const language =
      detectLanguage(
        content
      );

    const links =
      extractLinks(
        page.html,
        canonical
      );

    const words =
      await savePage({
        url: canonical,
        title,
        description,
        content,
        language
      });

    await queueLinks(
      links
    );

    await markStatus(
      url,
      "done",
      null
    );

    console.log(
      `[HEXORA] Indexed: ${title || canonical}`
    );

    console.log(
      `[HEXORA] Words: ${words} | Links: ${links.length} | Language: ${language}`
    );

    return {
      success: true,
      skipped: false
    };

  } catch (error) {

    const message =
      String(
        error?.message ||
        error
      );

    console.error(
      `[HEXORA] Crawl failed: ${url} -> ${message}`
    );

    await markStatus(
      url,
      "failed",
      message.slice(
        0,
        1000
      )
    );

    return {
      success: false,
      skipped: false
    };
  }
}


/* =========================================================
   GET QUEUED
========================================================= */

async function getQueued(
  batchSize
) {

  const { data, error } =
    await supabase
      .from("crawl_queue")
      .select("url")
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
    throw error;
  }

  return data || [];
}


/* =========================================================
   OLD QUEUE STATUS RECOVERY
========================================================= */

async function normalizeOldQueueStatuses() {

  const {
    error:
      pendingError
  } =
    await supabase
      .from("crawl_queue")
      .update({
        status:
          "queued"
      })
      .eq(
        "status",
        "pending"
      );

  if (
    pendingError
  ) {

    console.error(
      "[HEXORA] pending->queued migration:",
      pendingError.message
    );
  }


  const {
    error:
      processingError
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
      );

  if (
    processingError
  ) {

    console.error(
      "[HEXORA] processing->queued recovery:",
      processingError.message
    );
  }
}


/* =========================================================
   SEED QUEUE
========================================================= */

async function seedQueue() {

  const rows =
    SEEDS
      .filter(
        shouldCrawl
      )
      .map(
        url => ({
          url:
            normalizeUrl(
              url
            ),

          status:
            "queued",

          created_at:
            new Date()
              .toISOString()
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
            true
        }
      );

  if (error) {

    console.error(
      "[HEXORA] Seed error:",
      error.message
    );
  }
}


/* =========================================================
   CRAWL BATCH
========================================================= */

export async function crawlBatch(
  options = BATCH_SIZE
) {

  const batchSize =
    typeof options === "number"

      ? Math.max(
          1,
          Math.floor(options)
        )

      : Math.max(
          1,
          Math.floor(
            Number(
              options?.batchSize ||
              options?.batch ||
              BATCH_SIZE
            )
          )
        );

  console.log(
    `[HEXORA] Starting crawl batch: ${batchSize}`
  );

  const jobs =
    await getQueued(
      batchSize
    );

  if (
    !jobs.length
  ) {

    console.log(
      "[HEXORA] No queued URLs."
    );

    return {
      processed: 0,
      successful: 0,
      failed: 0
    };
  }


  /*
   * Claim URLs
   */

  const claimed = [];

  for (
    const job of jobs
  ) {

    const {
      data,
      error
    } =
      await supabase
        .from("crawl_queue")
        .update({
          status:
            "processing"
        })
        .eq(
          "url",
          job.url
        )
        .eq(
          "status",
          "queued"
        )
        .select("url");

    if (
      !error &&
      data?.length
    ) {
      claimed.push(
        job.url
      );
    }
  }


  let processed = 0;
  let successful = 0;
  let failed = 0;
  let index = 0;


  async function worker() {

    while (true) {

      const current =
        index++;

      if (
        current >=
        claimed.length
      ) {
        return;
      }

      const result =
        await crawlOne(
          claimed[current]
        );

      processed++;

      if (
        result.success
      ) {
        successful++;
      }

      else if (
        !result.skipped
      ) {
        failed++;
      }
    }
  }


  const workers =
    Array.from(
      {
        length:
          Math.min(
            CONCURRENCY,
            claimed.length
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


/* =========================================================
   RUN CRAWLER
========================================================= */

export async function runCrawler() {

  await normalizeOldQueueStatuses();

  await seedQueue();

  return crawlBatch(
    BATCH_SIZE
  );
}


/* =========================================================
   DIRECT EXECUTION
========================================================= */

if (
  process.argv[1] &&
  process.argv[1].endsWith(
    "crawler.mjs"
  )
) {

  runCrawler()
    .then(
      result => {

        console.log(
          new Date()
            .toISOString(),
          "crawl cycle",
          result
        );
      }
    )
    .catch(
      error => {

        console.error(
          "[HEXORA] Fatal crawler error:",
          error
        );

        process.exit(1);
      }
    );
}
