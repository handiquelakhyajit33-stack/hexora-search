// HEXORA - Web Crawler
// Full crawler.mjs
// Compatible with worker/worker.mjs

import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

/* =========================================================
   ENVIRONMENT
========================================================= */

const SUPABASE_URL = process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL) {
  throw new Error("SUPABASE_URL is missing");
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "SUPABASE_SERVICE_ROLE_KEY is missing"
  );
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

/* =========================================================
   CONFIG
========================================================= */

const USER_AGENT =
  "HEXORA-Bot/1.0 (+https://hexora-search-production.up.railway.app/)";

const DEFAULT_BATCH_SIZE = 12;

const CONCURRENCY = Number(
  process.env.CRAWLER_CONCURRENCY || 2
);

const FETCH_TIMEOUT = Number(
  process.env.CRAWLER_TIMEOUT || 15000
);

const MAX_CONTENT_LENGTH = 100000;

const MAX_LINKS_PER_PAGE = 100;

/* =========================================================
   SEED WEBSITES
========================================================= */

const SEED_URLS = [
  "https://www.wikipedia.org/",
  "https://www.india.gov.in/",
  "https://assam.gov.in/",
  "https://www.python.org/",
  "https://www.w3.org/"
];

/* =========================================================
   HELPERS
========================================================= */

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


/* =========================================================
   URL NORMALIZATION
========================================================= */

function normalizeUrl(input) {
  try {
    const url = new URL(input);

    url.hash = "";

    url.protocol =
      url.protocol.toLowerCase();

    url.hostname =
      url.hostname.toLowerCase();

    if (
      url.pathname.length > 1
    ) {
      url.pathname =
        url.pathname.replace(/\/+$/, "");
    }

    return url.toString();
  } catch {
    return null;
  }
}


/* =========================================================
   URL FILTER
========================================================= */

function shouldCrawl(input) {
  const url = normalizeUrl(input);

  if (!url) {
    return false;
  }

  /* Only HTTP/HTTPS */

  if (
    url.protocol !== "http:" &&
    url.protocol !== "https:"
  ) {
    return false;
  }

  const host =
    url.hostname.toLowerCase();

  const path =
    decodeURIComponent(
      url.pathname
    ).toLowerCase();

  const fullUrl =
    url.toString().toLowerCase();


  /* -----------------------------------------
     Tracking parameters
  ----------------------------------------- */

  const blockedParams = [
    "utm_",
    "fbclid",
    "gclid",
    "mc_cid",
    "mc_eid"
  ];

  for (
    const key of url.searchParams.keys()
  ) {
    const lowerKey =
      key.toLowerCase();

    if (
      blockedParams.some(
        blocked =>
          lowerKey === blocked ||
          lowerKey.startsWith(blocked)
      )
    ) {
      return false;
    }
  }


  /* -----------------------------------------
     Bad Wikimedia namespaces
  ----------------------------------------- */

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

  for (
    const namespace of blockedNamespaces
  ) {
    if (
      path.includes(namespace)
    ) {
      return false;
    }
  }


  /* -----------------------------------------
     Login / account / editing / search
  ----------------------------------------- */

  const blockedWords = [
    "createaccount",
    "create-account",
    "login",
    "logout",
    "register",
    "recentchanges",
    "recent-changes",
    "action=edit",
    "action=history",
    "/edit",
    "/history",
    "/search"
  ];

  for (
    const word of blockedWords
  ) {
    if (
      path.includes(word) ||
      fullUrl.includes(word)
    ) {
      return false;
    }
  }


  /* -----------------------------------------
     Common unwanted files
  ----------------------------------------- */

  const badExtensions = [
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".svg",
    ".ico",
    ".bmp",
    ".tiff",
    ".mp3",
    ".wav",
    ".ogg",
    ".mp4",
    ".avi",
    ".mov",
    ".mkv",
    ".zip",
    ".rar",
    ".7z",
    ".tar",
    ".gz",
    ".exe",
    ".apk",
    ".dmg",
    ".iso"
  ];

  for (
    const extension of badExtensions
  ) {
    if (
      path.endsWith(extension)
    ) {
      return false;
    }
  }


  /* -----------------------------------------
     Avoid extremely long URLs
  ----------------------------------------- */

  if (
    url.toString().length > 1200
  ) {
    return false;
  }

  if (
    path.length > 500
  ) {
    return false;
  }


  /* -----------------------------------------
     Wikimedia special subdomains
  ----------------------------------------- */

  if (
    host.endsWith("wikimedia.org")
  ) {
    if (
      path.includes("/special:") ||
      path.includes("/user:") ||
      path.includes("/user_talk:") ||
      path.includes("/talk:") ||
      path.includes("/template:") ||
      path.includes("/file:") ||
      path.includes("/category:") ||
      path.includes("/module:")
    ) {
      return false;
    }
  }


  return true;
}


/* =========================================================
   HTML ENTITY DECODER
========================================================= */

function decodeHtmlEntities(text) {
  return text
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


/* =========================================================
   REMOVE HTML COMMENTS
========================================================= */

function removeComments(html) {
  return html.replace(
    /<!--[\s\S]*?-->/g,
    " "
  );
}


/* =========================================================
   REMOVE ELEMENT BLOCKS
========================================================= */

function removeElementBlocks(
  html,
  tags
) {
  let result = html;

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


/* =========================================================
   REMOVE WEBSITE NOISE
========================================================= */

function removeNoiseBlocks(html) {
  return html.replace(
    /<(div|section|aside|header|footer|nav)[^>]*(?:id|class)=["'][^"']*(?:advert|advertisement|ads|ad-container|adbox|cookie|newsletter|subscribe|social-share|share-buttons|comments-section|related-posts|related-content|recommended-posts|recommendations|trending-posts|most-read|popular-posts|popup|modal)[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi,
    " "
  );
}


/* =========================================================
   STRIP HTML TAGS
========================================================= */

function stripTags(html) {
  return html
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


/* =========================================================
   CLEAN TEXT
========================================================= */

function cleanText(text) {
  return decodeHtmlEntities(text)
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


/* =========================================================
   EXTRACT MAIN CONTENT
========================================================= */

function extractMainContent(html) {
  let cleaned =
    removeComments(html);


  /* Remove definitely useless elements */

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


  /* Remove obvious advertisement/noise blocks */

  cleaned =
    removeNoiseBlocks(
      cleaned
    );


  /* -----------------------------------------
     Prefer ARTICLE
  ----------------------------------------- */

  let match =
    cleaned.match(
      /<article\b[^>]*>([\s\S]*?)<\/article>/i
    );


  /* -----------------------------------------
     Then MAIN
  ----------------------------------------- */

  if (!match) {
    match =
      cleaned.match(
        /<main\b[^>]*>([\s\S]*?)<\/main>/i
      );
  }


  /* -----------------------------------------
     Then BODY
  ----------------------------------------- */

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


  /* Limit size */

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


/* =========================================================
   EXTRACT TITLE
========================================================= */

function extractTitle(html) {
  const ogTitle =
    html.match(
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
    );

  if (ogTitle) {
    return cleanText(
      ogTitle[1]
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


/* =========================================================
   EXTRACT DESCRIPTION
========================================================= */

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


/* =========================================================
   EXTRACT CANONICAL
========================================================= */

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
      ) || baseUrl
    );
  } catch {
    return baseUrl;
  }
}


/* =========================================================
   EXTRACT LINKS
========================================================= */

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
      // Ignore invalid URLs
    }
  }

  return [
    ...links
  ];
}


/* =========================================================
   FETCH PAGE
========================================================= */

async function fetchPage(url) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
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


    const finalUrl =
      normalizeUrl(
        response.url
      ) || url;


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


/* =========================================================
   SAVE PAGE TO SUPABASE
========================================================= */

async function savePage({
  url,
  title,
  description,
  content
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


  const now =
    new Date()
      .toISOString();


  const { error } =
    await supabase
      .from("pages")
      .upsert(
        {
          url,

          title:
            title || url,

          description:
            description || "",

          content,

          content_hash:
            contentHash,

          word_count:
            wordCount,

          language:
            "unknown",

          updated_at:
            now,

          last_crawled_at:
            now
        },
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
   ADD LINKS TO CRAWL QUEUE
========================================================= */

async function queueLinks(
  links
) {
  if (
    !links ||
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
      "[HEXORA] Queue error:",
      error.message
    );
  }
}


/* =========================================================
   MARK URL DONE
========================================================= */

async function markDone(
  url
) {
  await supabase
    .from("crawl_queue")
    .update(
      {
        status:
          "done",

        last_crawled_at:
          new Date()
            .toISOString(),

        last_error:
          null
      }
    )
    .eq(
      "url",
      url
    );
}


/* =========================================================
   MARK URL FAILED
========================================================= */

async function markFailed(
  url,
  error
) {
  await supabase
    .from("crawl_queue")
    .update(
      {
        status:
          "failed",

        last_crawled_at:
          new Date()
            .toISOString(),

        last_error:
          String(
            error?.message ||
            error
          )
      }
    )
    .eq(
      "url",
      url
    );
}


/* =========================================================
   GET PENDING URLS
========================================================= */

async function getPending(
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


/* =========================================================
   CRAWL ONE URL
========================================================= */

async function crawlOne(
  url
) {
  /* First URL filter */

  if (
    !shouldCrawl(url)
  ) {
    console.log(
      `[HEXORA] Skipped filtered URL: ${url}`
    );

    await markDone(
      url
    );

    return {
      success:
        false,

      skipped:
        true
    };
  }


  console.log(
    `[HEXORA] Crawling: ${url}`
  );


  try {
    const page =
      await fetchPage(
        url
      );


    const finalUrl =
      page.finalUrl;


    /* Check redirect URL */

    if (
      !shouldCrawl(
        finalUrl
      )
    ) {
      console.log(
        `[HEXORA] Skipped redirect URL: ${finalUrl}`
      );

      await markDone(
        url
      );

      return {
        success:
          false,

        skipped:
          true
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


    const canonical =
      extractCanonical(
        page.html,
        finalUrl
      );


    const content =
      extractMainContent(
        page.html
      );


    /* Need useful content */

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
        page.html,
        canonical
      );


    const words =
      await savePage(
        {
          url:
            canonical,

          title,

          description,

          content
        }
      );


    await queueLinks(
      links
    );


    await markDone(
      url
    );


    console.log(
      `[HEXORA] Indexed: ${title || canonical}`
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
      `[HEXORA] Crawl failed: ${url} -> ${error.message}`
    );


    await markFailed(
      url,
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


/* =========================================================
   CRAWL BATCH
   IMPORTANT:
   worker/worker.mjs imports this function
========================================================= */

export async function crawlBatch(
  options = DEFAULT_BATCH_SIZE
) {
  let batchSize;


  /* worker can pass number */

  if (
    typeof options ===
    "number"
  ) {
    batchSize =
      options;
  }


  /* worker can pass object */

  else if (
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
  }


  else {
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


  const pending =
    await getPending(
      batchSize
    );


  /* No URLs */

  if (
    !pending.length
  ) {
    console.log(
      "[HEXORA] No pending URLs."
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


  /* -----------------------------------------
     Worker pool
  ----------------------------------------- */

  async function worker() {

    while (true) {

      const current =
        index++;


      if (
        current >=
        pending.length
      ) {
        return;
      }


      const result =
        await crawlOne(
          pending[current].url
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
            pending.length
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
   SEED QUEUE
========================================================= */

async function seedQueue() {

  const rows =
    SEED_URLS
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


  if (
    !rows.length
  ) {
    return;
  }


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
   RUN CRAWLER
========================================================= */

export async function runCrawler() {

  await seedQueue();


  const result =
    await crawlBatch(
      DEFAULT_BATCH_SIZE
    );


  console.log(
    new Date()
      .toISOString(),
    "crawl cycle",
    result
  );


  return result;
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
