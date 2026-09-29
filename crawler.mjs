// ============================================================
// HEXORA SEARCH ENGINE - CRAWLER
// ============================================================

import crypto from "node:crypto";
import * as cheerio from "cheerio";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const { Pool } = pg;


// ============================================================
// CONFIG
// ============================================================

const USER_AGENT =
  process.env.HEXORA_USER_AGENT ||
  "HEXORA-Bot/1.0 (+https://hexorasearch.com/)";

const REQUEST_TIMEOUT =
  Number(process.env.CRAWL_TIMEOUT_MS || 15000);

const DOMAIN_DELAY =
  Number(process.env.CRAWL_DOMAIN_DELAY_MS || 1500);

const MAX_CONTENT =
  Number(process.env.CRAWL_MAX_CONTENT || 100000);

const MAX_LINKS =
  Number(process.env.CRAWL_MAX_LINKS || 100);

const BATCH_SIZE =
  Number(process.env.CRAWL_BATCH_SIZE || 12);

const CONCURRENCY =
  Number(process.env.CRAWL_CONCURRENCY || 2);


// ============================================================
// ENVIRONMENT
// ============================================================

const DATABASE_URL =
  process.env.DATABASE_URL;

const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_KEY;


// ============================================================
// DATABASE
// ============================================================

if (!DATABASE_URL) {

  throw new Error(
    "[HEXORA] DATABASE_URL is missing."
  );
}


const neon =
  new Pool({
    connectionString: DATABASE_URL,

    ssl: {
      rejectUnauthorized: false
    },

    max: 5,

    idleTimeoutMillis: 30000,

    connectionTimeoutMillis: 10000
  });


let supabase = null;


if (
  SUPABASE_URL &&
  SUPABASE_SERVICE_ROLE_KEY
) {

  supabase =
    createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      }
    );

} else {

  console.warn(
    "[HEXORA] Supabase credentials are missing."
  );
}


// ============================================================
// SEEDS
// ============================================================

const SEED_URLS = [

  "https://en.wikipedia.org/wiki/Search_engine",

  "https://www.india.gov.in/",

  "https://assam.gov.in/",

  "https://python.org/",

  "https://www.w3.org/"

];


// ============================================================
// MEMORY
// ============================================================

const domainLastRequest =
  new Map();

const robotsCache =
  new Map();


// ============================================================
// BASIC HELPERS
// ============================================================

function sleep(ms) {

  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
  );
}


function cleanText(value) {

  return String(
    value || ""
  )
    .replace(/\s+/g, " ")
    .trim();
}


// ============================================================
// URL NORMALIZATION
// ============================================================

function normalizeUrl(input) {

  try {

    if (!input) {
      return null;
    }

    const url =
      new URL(
        String(input)
      );


    if (
      url.protocol !== "http:" &&
      url.protocol !== "https:"
    ) {

      return null;
    }


    url.hash = "";

    url.username = "";
    url.password = "";


    let pathname =
      url.pathname || "/";


    pathname =
      pathname.replace(
        /\/{2,}/g,
        "/"
      );


    if (
      pathname.length > 1 &&
      pathname.endsWith("/")
    ) {

      pathname =
        pathname.slice(
          0,
          -1
        );
    }


    url.pathname =
      pathname;


    const trackingParams = [

      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "gclid",
      "fbclid",
      "msclkid",
      "ref",
      "ref_src"

    ];


    for (
      const param
      of trackingParams
    ) {

      url.searchParams.delete(
        param
      );
    }


    return url.toString();

  } catch {

    return null;
  }
}


// ============================================================
// DOMAIN
// ============================================================

function getDomain(url) {

  try {

    return new URL(
      url
    ).hostname
      .toLowerCase()
      .replace(
        /^www\./,
        ""
      );

  } catch {

    return "";
  }
}


// ============================================================
// URL VALIDATION
// ============================================================

function isValidCrawlUrl(url) {

  try {

    const parsed =
      new URL(
        url
      );


    if (
      parsed.protocol !== "http:" &&
      parsed.protocol !== "https:"
    ) {

      return false;
    }


    const hostname =
      parsed.hostname
        .toLowerCase();


    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1"
    ) {

      return false;
    }


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
      ".ogg",

      ".mp4",
      ".webm",
      ".avi",
      ".mov",

      ".zip",
      ".rar",
      ".7z",
      ".tar",
      ".gz",

      ".pdf",
      ".doc",
      ".docx",
      ".xls",
      ".xlsx",
      ".ppt",
      ".pptx",

      ".exe",
      ".apk",
      ".dmg",
      ".iso"

    ];


    const pathname =
      parsed.pathname
        .toLowerCase();


    if (
      blockedExtensions.some(
        extension =>
          pathname.endsWith(
            extension
          )
      )
    ) {

      return false;
    }


    return true;

  } catch {

    return false;
  }
}


// ============================================================
// LANGUAGE
// ============================================================

function detectLanguage(text) {

  const value =
    String(
      text || ""
    );


  if (!value) {
    return "unknown";
  }


  /*
    Assamese/Bengali block.
  */

  if (
    /[\u0980-\u09FF]/.test(
      value
    )
  ) {

    return "assamese/bengali";
  }


  /*
    Devanagari.
  */

  if (
    /[\u0900-\u097F]/.test(
      value
    )
  ) {

    return "hindi";
  }


  /*
    Chinese.
  */

  if (
    /[\u4E00-\u9FFF]/.test(
      value
    )
  ) {

    return "chinese";
  }


  /*
    Japanese.
  */

  if (
    /[\u3040-\u30FF]/.test(
      value
    )
  ) {

    return "japanese";
  }


  /*
    Korean.
  */

  if (
    /[\uAC00-\uD7AF]/.test(
      value
    )
  ) {

    return "korean";
  }


  /*
    English / Latin.
  */

  if (
    /[A-Za-z]/.test(
      value
    )
  ) {

    return "english";
  }


  return "unknown";
}


// ============================================================
// LINK EXTRACTION
// ============================================================

function extractLinks(
  $,
  baseUrl
) {

  const results =
    new Set();


  $("a[href]").each(
    (_, element) => {

      if (
        results.size >=
        MAX_LINKS
      ) {

        return;
      }


      const href =
        $(element)
          .attr("href");


      if (!href) {
        return;
      }


      try {

        const absolute =
          normalizeUrl(
            new URL(
              href,
              baseUrl
            ).toString()
          );


        if (
          absolute &&
          isValidCrawlUrl(
            absolute
          )
        ) {

          results.add(
            absolute
          );
        }

      } catch {

        // Ignore invalid links.
      }
    }
  );


  return [
    ...results
  ];
}


// ============================================================
// HTML EXTRACTION
// ============================================================

function extractPage(
  html,
  pageUrl
) {

  const $ =
    cheerio.load(
      html
    );


  $(
    "script, style, noscript, iframe, svg, canvas, nav, footer, header, form"
  ).remove();


  const title =
    cleanText(
      $("title")
        .first()
        .text()
    );


  const description =
    cleanText(
      $('meta[name="description"]')
        .attr("content") ||

      $('meta[property="og:description"]')
        .attr("content") ||

      ""
    );


  let content =
    cleanText(
      $("main").text() ||

      $("article").text() ||

      $("body").text()
    );


  if (
    content.length >
    MAX_CONTENT
  ) {

    content =
      content.slice(
        0,
        MAX_CONTENT
      );
  }


  const language =
    detectLanguage(
      `${title} ${description} ${content}`
    );


  const canonicalRaw =
    $('link[rel="canonical"]')
      .attr("href");


  let canonical =
    pageUrl;


  if (
    canonicalRaw
  ) {

    try {

      canonical =
        normalizeUrl(
          new URL(
            canonicalRaw,
            pageUrl
          ).toString()
        ) ||
        pageUrl;

    } catch {

      canonical =
        pageUrl;
    }
  }


  const links =
    extractLinks(
      $,
      pageUrl
    );


  return {

    title,

    description,

    content,

    language,

    canonical,

    links

  };
}


// ============================================================
// FETCH PAGE
// ============================================================

async function fetchPage(url) {

  const controller =
    new AbortController();


  const timer =
    setTimeout(
      () =>
        controller.abort(),
      REQUEST_TIMEOUT
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

            "Accept":
              "text/html,application/xhtml+xml",

            "Accept-Language":
              "en-US,en;q=0.8"

          },

          redirect:
            "follow",

          signal:
            controller.signal
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
      response.headers
        .get(
          "content-type"
        ) ||
      "";


    if (
      !contentType.includes(
        "text/html"
      ) &&
      !contentType.includes(
        "application/xhtml+xml"
      )
    ) {

      throw new Error(
        `Unsupported content-type: ${contentType}`
      );
    }


    const finalUrl =
      normalizeUrl(
        response.url
      ) ||
      url;


    const html =
      await response.text();


    return {

      html,

      finalUrl

    };

  } finally {

    clearTimeout(
      timer
    );
  }
}


// ============================================================
// DOMAIN DELAY
// ============================================================

async function respectDomainDelay(url) {

  const domain =
    getDomain(
      url
    );


  if (!domain) {
    return;
  }


  const previous =
    domainLastRequest.get(
      domain
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
    domain,
    Date.now()
  );
}


// ============================================================
// ROBOTS
// ============================================================

function robotsAllows(
  robotsText,
  targetUrl
) {

  const lines =
    String(
      robotsText || ""
    )
      .split(/\r?\n/)
      .map(
        line =>
          line.trim()
      );


  let applies =
    false;


  const rules =
    [];


  for (
    const line
    of lines
  ) {

    if (
      !line ||
      line.startsWith("#")
    ) {

      continue;
    }


    const parts =
      line.split(
        ":"
      );


    if (
      parts.length < 2
    ) {

      continue;
    }


    const key =
      parts.shift()
        .trim()
        .toLowerCase();


    const value =
      parts
        .join(":")
        .trim();


    if (
      key ===
      "user-agent"
    ) {

      applies =
        value === "*" ||
        value
          .toLowerCase()
          .includes(
            "hexora"
          );

      continue;
    }


    if (
      applies &&
      key ===
      "disallow"
    ) {

      rules.push({

        type:
          "disallow",

        path:
          value

      });
    }


    if (
      applies &&
      key ===
      "allow"
    ) {

      rules.push({

        type:
          "allow",

        path:
          value

      });
    }
  }


  let pathname =
    "/";


  try {

    pathname =
      new URL(
        targetUrl
      ).pathname || "/";

  } catch {

    return true;
  }


  let matched =
    null;


  for (
    const rule
    of rules
  ) {

    if (!rule.path) {
      continue;
    }


    if (
      pathname.startsWith(
        rule.path
      )
    ) {

      if (
        !matched ||
        rule.path.length >
        matched.path.length
      ) {

        matched =
          rule;
      }
    }
  }


  if (!matched) {
    return true;
  }


  return (
    matched.type ===
    "allow"
  );
}


async function canCrawl(url) {

  const domain =
    getDomain(
      url
    );


  if (!domain) {
    return false;
  }


  if (
    robotsCache.has(
      domain
    )
  ) {

    return robotsAllows(
      robotsCache.get(
        domain
      ),
      url
    );
  }


  try {

    const robotsUrl =
      `https://${domain}/robots.txt`;


    const controller =
      new AbortController();


    const timer =
      setTimeout(
        () =>
          controller.abort(),
        10000
      );


    const response =
      await fetch(
        robotsUrl,
        {
          headers: {

            "User-Agent":
              USER_AGENT

          },

          signal:
            controller.signal
        }
      );


    clearTimeout(
      timer
    );


    if (
      !response.ok
    ) {

      robotsCache.set(
        domain,
        ""
      );

      return true;
    }


    const text =
      await response.text();


    robotsCache.set(
      domain,
      text
    );


    return robotsAllows(
      text,
      url
    );

  } catch {

    robotsCache.set(
      domain,
      ""
    );

    return true;
  }
}


// ============================================================
// DATABASE CHECK
// ============================================================

async function checkNeon() {

  const result =
    await neon.query(
      "SELECT 1 AS ok"
    );


  return (
    result.rows?.[0]?.ok === 1
  );
}


async function checkSupabase() {

  if (!supabase) {
    return false;
  }


  try {

    const {
      error
    } =
      await supabase
        .from("pages")
        .select("id")
        .limit(1);


    if (error) {

      console.warn(
        "[HEXORA] Supabase check failed:",
        error.message
      );

      return false;
    }


    return true;

  } catch (error) {

    console.warn(
      "[HEXORA] Supabase connection error:",
      error?.message || error
    );

    return false;
  }
}


// ============================================================
// SUPABASE DUPLICATE CHECK
// ============================================================

async function pageExistsInSupabase(url) {

  if (!supabase) {
    return false;
  }


  try {

    const {
      data,
      error
    } =
      await supabase
        .from("pages")
        .select("id")
        .eq(
          "url",
          url
        )
        .limit(1);


    if (error) {

      console.warn(
        `[HEXORA] Supabase duplicate check failed: ${url}`,
        error.message
      );


      /*
        Fail closed.

        If Supabase cannot be checked,
        we do NOT insert into Neon.
      */

      throw new Error(
        `Supabase duplicate check failed: ${error.message}`
      );
    }


    return (
      Array.isArray(data) &&
      data.length > 0
    );

  } catch (error) {

    throw new Error(
      error?.message ||
      "Supabase duplicate check failed"
    );
  }
}


// ============================================================
// NEON DUPLICATE CHECK
// ============================================================

async function pageExistsInNeon(url) {

  const result =
    await neon.query(
      `
        SELECT id
        FROM pages
        WHERE url = $1
        LIMIT 1
      `,
      [
        url
      ]
    );


  return (
    result.rows?.length > 0
  );
}


// ============================================================
// CHECK BOTH DATABASES
// ============================================================

async function pageExistsAnywhere(url) {

  const normalized =
    normalizeUrl(
      url
    );


  if (!normalized) {
    return true;
  }


  /*
    FIRST:
    Existing Supabase index.
  */

  const existsInSupabase =
    await pageExistsInSupabase(
      normalized
    );


  if (
    existsInSupabase
  ) {

    console.log(
      `[HEXORA] Already exists in Supabase - Neon skipped: ${normalized}`
    );


    return true;
  }


  /*
    SECOND:
    New Neon index.
  */

  const existsInNeon =
    await pageExistsInNeon(
      normalized
    );


  if (
    existsInNeon
  ) {

    console.log(
      `[HEXORA] Already exists in Neon: ${normalized}`
    );


    return true;
  }


  return false;
}


// ============================================================
// SAVE PAGE - NEON ONLY
// ============================================================

async function savePage({
  url,
  title,
  description,
  content,
  language
}) {

  const normalizedUrl =
    normalizeUrl(
      url
    );


  if (!normalizedUrl) {

    return {

      saved:
        false,

      duplicate:
        false,

      wordCount:
        0

    };
  }


  /*
    Check Supabase FIRST,
    then Neon.
  */

  const alreadyExists =
    await pageExistsAnywhere(
      normalizedUrl
    );


  if (
    alreadyExists
  ) {

    return {

      saved:
        false,

      duplicate:
        true,

      wordCount:
        0

    };
  }


  const cleanContent =
    cleanText(
      content
    );


  const contentHash =
    crypto
      .createHash(
        "sha256"
      )
      .update(
        cleanContent
      )
      .digest(
        "hex"
      );


  const wordCount =
    cleanContent
      .split(/\s+/)
      .filter(Boolean)
      .length;


  const now =
    new Date()
      .toISOString();


  /*
    Insert NEW page into Neon only.

    ON CONFLICT prevents duplicate URLs
    even if two crawler workers race.
  */

  const result =
    await neon.query(
      `
        INSERT INTO pages (
          url,
          title,
          description,
          content,
          content_hash,
          word_count,
          language,
          updated_at,
          last_crawled_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $8
        )
        ON CONFLICT (url)
        DO NOTHING
        RETURNING url
      `,
      [

        normalizedUrl,

        cleanText(
          title
        ) ||
        normalizedUrl,

        cleanText(
          description
        ),

        cleanContent,

        contentHash,

        wordCount,

        language ||
        "unknown",

        now

      ]
    );


  /*
    Another crawler may have inserted
    the same URL at exactly the same time.
  */

  if (
    !result.rows?.length
  ) {

    console.log(
      `[HEXORA] Neon duplicate prevented: ${normalizedUrl}`
    );


    return {

      saved:
        false,

      duplicate:
        true,

      wordCount:
        0

    };
  }


  console.log(
    `[HEXORA] NEW PAGE -> NEON: ${normalizedUrl}`
  );


  return {

    saved:
      true,

    duplicate:
      false,

    wordCount

  };
}


// ============================================================
// QUEUE
// ============================================================

async function queueLink(url) {

  const normalized =
    normalizeUrl(
      url
    );


  if (!normalized) {
    return;
  }


  if (
    !isValidCrawlUrl(
      normalized
    )
  ) {

    return;
  }


  try {

    await neon.query(
      `
        INSERT INTO crawl_queue (
          url,
          status
        )
        VALUES (
          $1,
          'queued'
        )
        ON CONFLICT (url)
        DO NOTHING
      `,
      [
        normalized
      ]
    );

  } catch (error) {

    console.warn(
      `[HEXORA] Queue failed: ${normalized}`,
      error?.message || error
    );
  }
}


async function queueLinks(links) {

  if (
    !Array.isArray(links)
  ) {

    return;
  }


  for (
    const link
    of links
  ) {

    await queueLink(
      link
    );
  }
}


// ============================================================
// SEED QUEUE
// ============================================================

async function seedQueue() {

  for (
    const seed
    of SEED_URLS
  ) {

    await queueLink(
      seed
    );
  }


  console.log(
    `[HEXORA] Seed URLs queued: ${SEED_URLS.length}`
  );
}


// ============================================================
// NORMALIZE OLD QUEUE STATUSES
// ============================================================

async function normalizeOldQueueStatuses() {

  try {

    /*
      If Railway crashed while processing,
      put processing URLs back into queued state.
    */

    const result =
      await neon.query(
        `
          UPDATE crawl_queue
          SET status = 'queued'
          WHERE status = 'processing'
          RETURNING id
        `
      );


    console.log(
      `[HEXORA] Queue recovery completed: reset ${result.rowCount || 0} processing URLs`
    );


  } catch (error) {

    console.error(
      "[HEXORA] Queue recovery failed:",
      error?.message || error
    );


    throw error;
  }
}


// ============================================================
// GET QUEUE
// ============================================================

async function getQueueBatch(
  limit = BATCH_SIZE
) {

  const safeLimit =
    Math.max(
      1,
      Number(limit) || BATCH_SIZE
    );


  const result =
    await neon.query(
      `
        SELECT
          id,
          url
        FROM crawl_queue
        WHERE status = 'queued'
        ORDER BY id ASC
        LIMIT $1
      `,
      [
        safeLimit
      ]
    );


  return (
    result.rows || []
  );
}


// ============================================================
// CLAIM URL
// ============================================================

async function claimUrl(
  id,
  url
) {

  const result =
    await neon.query(
      `
        UPDATE crawl_queue
        SET status = 'processing'
        WHERE id = $1
          AND status = 'queued'
        RETURNING id, url
      `,
      [
        id
      ]
    );


  return (
    result.rows?.[0] ||
    null
  );
}


// ============================================================
// MARK STATUS
// ============================================================

async function markStatus(
  url,
  status,
  errorMessage = null
) {

  try {

    await neon.query(
      `
        UPDATE crawl_queue
        SET
          status = $2,

          last_crawled_at =
            CASE
              WHEN $2 = 'done'
              THEN NOW()
              ELSE last_crawled_at
            END,

          error = $3

        WHERE url = $1
      `,
      [

        url,

        status,

        errorMessage
          ? String(
              errorMessage
            ).slice(
              0,
              2000
            )
          : null

      ]
    );

  } catch (error) {

    console.warn(
      `[HEXORA] Queue status update failed: ${url}`,
      error?.message || error
    );
  }
}


// ============================================================
// CRAWL ONE
// ============================================================

async function crawlOne(row) {

  const id =
    row.id;


  const originalUrl =
    normalizeUrl(
      row.url
    );


  if (!originalUrl) {

    await markStatus(
      row.url,
      "done",
      "Invalid URL"
    );


    return {

      success:
        false,

      skipped:
        true,

      duplicate:
        false,

      error:
        "Invalid URL"

    };
  }


  const claimed =
    await claimUrl(
      id,
      originalUrl
    );


  if (!claimed) {

    return {

      success:
        false,

      skipped:
        true,

      duplicate:
        false

    };
  }


  try {

    /*
      Domain delay.
    */

    await respectDomainDelay(
      originalUrl
    );


    /*
      Robots.
    */

    const allowed =
      await canCrawl(
        originalUrl
      );


    if (!allowed) {

      console.log(
        `[HEXORA] robots.txt blocked: ${originalUrl}`
      );


      await markStatus(
        originalUrl,
        "done",
        "Blocked by robots.txt"
      );


      return {

        success:
          false,

        skipped:
          true,

        duplicate:
          false,

        error:
          "Blocked by robots.txt"

      };
    }


    /*
      Fetch.
    */

    const fetched =
      await fetchPage(
        originalUrl
      );


    const finalUrl =
      fetched.finalUrl ||
      originalUrl;


    /*
      Extract.
    */

    const page =
      extractPage(
        fetched.html,
        finalUrl
      );


    const canonical =
      normalizeUrl(
        page.canonical ||
        finalUrl
      ) ||
      finalUrl;


    /*
      Add discovered URLs
      to the crawl queue.
    */

    await queueLinks(
      page.links
    );


    /*
      Save new page to Neon.
    */

    const saveResult =
      await savePage({

        url:
          canonical,

        title:
          page.title,

        description:
          page.description,

        content:
          page.content,

        language:
          page.language

      });


    /*
      Existing page.
    */

    if (
      saveResult.duplicate
    ) {

      await markStatus(
        originalUrl,
        "done",
        null
      );


      console.log(
        `[HEXORA] Existing page skipped: ${canonical}`
      );


      return {

        success:
          false,

        skipped:
          true,

        duplicate:
          true

      };
    }


    /*
      New page.
    */

    await markStatus(
      originalUrl,
      "done",
      null
    );


    console.log(
      `[HEXORA] Indexed NEW page: ${
        page.title ||
        canonical
      }`
    );


    console.log(
      `[HEXORA] Words: ${
        saveResult.wordCount
      } | Links: ${
        page.links.length
      } | Language: ${
        page.language
      }`
    );


    return {

      success:
        true,

      skipped:
        false,

      duplicate:
        false

    };

  } catch (error) {

    const message =
      error?.message ||
      String(error);


    console.error(
      `[HEXORA] Crawl failed: ${originalUrl}`,
      message
    );


    await markStatus(
      originalUrl,
      "error",
      message
    );


    return {

      success:
        false,

      skipped:
        false,

      duplicate:
        false,

      error:
        message

    };
  }
}


// ============================================================
// CONCURRENT CRAWLING
// ============================================================

async function runConcurrent(rows) {

  let index = 0;


  async function worker() {

    while (true) {

      const current =
        index++;


      if (
        current >=
        rows.length
      ) {

        return;
      }


      await crawlOne(
        rows[current]
      );
    }
  }


  const workers =
    Math.min(
      CONCURRENCY,
      rows.length
    );


  await Promise.all(
    Array.from(
      {
        length:
          workers
      },
      () =>
        worker()
    )
  );
}


// ============================================================
// PUBLIC CRAWL BATCH
// ============================================================

async function crawlBatch(
  requestedBatchSize = BATCH_SIZE
) {

  const rows =
    await getQueueBatch(
      requestedBatchSize
    );


  if (
    rows.length === 0
  ) {

    return {

      processed:
        0,

      successful:
        0,

      failed:
        0

    };
  }


  console.log(
    `[HEXORA] Processing ${rows.length} URLs`
  );


  const results =
    [];


  /*
    Run concurrently while preserving
    individual results.
  */

  let index = 0;


  async function worker() {

    while (true) {

      const current =
        index++;


      if (
        current >=
        rows.length
      ) {

        return;
      }


      const result =
        await crawlOne(
          rows[current]
        );


      results.push(
        result
      );
    }
  }


  const workerCount =
    Math.min(
      CONCURRENCY,
      rows.length
    );


  await Promise.all(
    Array.from(
      {
        length:
          workerCount
      },
      () =>
        worker()
    )
  );


  const successful =
    results.filter(
      result =>
        result?.success === true
    ).length;


  const failed =
    results.filter(
      result =>
        result?.error
    ).length;


  return {

    processed:
      rows.length,

    successful,

    failed

  };
}


// ============================================================
// RESET STUCK QUEUE
// ============================================================

async function resetStuckJobs() {

  try {

    const result =
      await neon.query(
        `
          UPDATE crawl_queue
          SET status = 'queued'
          WHERE status = 'processing'
          RETURNING id
        `
      );


    if (
      result.rowCount
    ) {

      console.log(
        `[HEXORA] Reset ${result.rowCount} stuck crawler jobs`
      );
    }

  } catch (error) {

    console.warn(
      "[HEXORA] Could not reset stuck jobs:",
      error?.message || error
    );
  }
}


// ============================================================
// RUN CRAWLER
// ============================================================

async function runCrawler() {

  console.log(
    "============================================================"
  );

  console.log(
    "HEXORA WORLDWIDE CRAWLER"
  );

  console.log(
    "============================================================"
  );


  /*
    Neon connection.
  */

  try {

    const neonOK =
      await checkNeon();


    if (!neonOK) {

      throw new Error(
        "Neon database check failed"
      );
    }


    console.log(
      "[HEXORA] Neon: CONNECTED"
    );

  } catch (error) {

    console.error(
      "[HEXORA] Neon connection failed:",
      error?.message || error
    );


    throw error;
  }


  /*
    Supabase connection.
  */

  const supabaseOK =
    await checkSupabase();


  if (
    supabaseOK
  ) {

    console.log(
      "[HEXORA] Supabase: CONNECTED"
    );

  } else {

    console.warn(
      "[HEXORA] Supabase: NOT AVAILABLE"
    );
  }


  /*
    Recover queue.
  */

  await normalizeOldQueueStatuses();


  /*
    Seed URLs.
  */

  await seedQueue();


  /*
    Continuous crawler.
  */

  let cycle =
    0;


  while (true) {

    cycle++;


    console.log(
      `[HEXORA] Crawl cycle #${cycle}`
    );


    const result =
      await crawlBatch(
        BATCH_SIZE
      );


    console.log(
      `[HEXORA] Batch completed | processed: ${
        result.processed
      } | successful: ${
        result.successful
      } | failed: ${
        result.failed
      }`
    );


    if (
      result.processed === 0
    ) {

      console.log(
        "[HEXORA] Queue empty. Waiting 10 seconds..."
      );


      await sleep(
        10000
      );

    } else {

      await sleep(
        1000
      );
    }
  }
}


// ============================================================
// ERROR HANDLING
// ============================================================

process.on(
  "unhandledRejection",
  error => {

    console.error(
      "[HEXORA] Unhandled rejection:",
      error
    );
  }
);


process.on(
  "uncaughtException",
  error => {

    console.error(
      "[HEXORA] Uncaught exception:",
      error
    );
  }
);


// ============================================================
// SHUTDOWN
// ============================================================

async function shutdown(signal) {

  console.log(
    `[HEXORA] ${signal} received. Shutting down...`
  );


  try {

    await neon.end();

  } catch {
    // Ignore shutdown errors.
  }


  process.exit(
    0
  );
}


process.on(
  "SIGTERM",
  () =>
    shutdown(
      "SIGTERM"
    )
);


process.on(
  "SIGINT",
  () =>
    shutdown(
      "SIGINT"
    )
);


// ============================================================
// EXPORTS FOR worker/worker.mjs
// ============================================================

export {

  runCrawler,

  crawlBatch,

  normalizeOldQueueStatuses,

  seedQueue

};


// ============================================================
// IMPORTANT
// ============================================================

/*
  DO NOT automatically call runCrawler() here.

  worker/worker.mjs imports the functions above
  and controls the crawling interval itself.
*/
