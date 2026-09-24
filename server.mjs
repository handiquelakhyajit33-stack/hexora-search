import http from "node:http";
import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
  );
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

const PORT = Number(process.env.PORT || 8080);

const USER_AGENT =
  process.env.HEXORA_USER_AGENT ||
  "HEXORA-Bot/1.0";

const TIMEOUT_MS =
  Number(process.env.CRAWL_TIMEOUT_MS || 15000);

const BATCH_SIZE =
  Number(process.env.CRAWL_BATCH_SIZE || 10);

const CONCURRENCY =
  Number(process.env.CRAWL_CONCURRENCY || 2);

const CRAWL_INTERVAL_MS =
  Number(process.env.CRAWL_INTERVAL_MS || 30000);


// =====================================================
// HEXORA SMART WEB COVERAGE
// =====================================================

const SEED_URLS = [
  // -------------------------
  // ASSAM / NORTHEAST
  // -------------------------
  "https://assamtribune.com/",
  "https://www.sentinelassam.com/",
  "https://www.pratidintime.com/",
  "https://newslivetv.com/",
  "https://www.guwahatiplus.com/",
  "https://www.eastmojo.com/",
  "https://northeasttoday.in/",

  // -------------------------
  // INDIA
  // -------------------------
  "https://www.ndtv.com/",
  "https://indianexpress.com/",
  "https://www.thehindu.com/",
  "https://www.hindustantimes.com/",
  "https://www.indiatoday.in/",
  "https://www.livemint.com/",
  "https://www.moneycontrol.com/",
  "https://www.news18.com/",

  // -------------------------
  // WORLD NEWS
  // -------------------------
  "https://www.bbc.com/",
  "https://apnews.com/",
  "https://www.aljazeera.com/",
  "https://www.reuters.com/",
  "https://www.theguardian.com/",

  // -------------------------
  // TECHNOLOGY
  // -------------------------
  "https://techcrunch.com/",
  "https://www.theverge.com/",
  "https://arstechnica.com/",
  "https://www.wired.com/",
  "https://www.techradar.com/",
  "https://github.com/",
  "https://developer.mozilla.org/",
  "https://web.dev/",
  "https://docs.python.org/3/",
  "https://stackoverflow.com/",

  // -------------------------
  // SCIENCE / SPACE
  // -------------------------
  "https://www.nasa.gov/",
  "https://www.esa.int/",
  "https://www.noaa.gov/",
  "https://www.who.int/",
  "https://www.un.org/",
  "https://www.nature.com/",
  "https://www.scientificamerican.com/",
  "https://phys.org/",
  "https://www.sciencedaily.com/",

  // -------------------------
  // GENERAL WEB
  // -------------------------
  "https://www.wikipedia.org/",
  "https://en.wikipedia.org/",
  "https://www.britannica.com/",
  "https://www.nationalgeographic.com/",
  "https://www.imdb.com/",
  "https://www.reddit.com/"
];

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src"
]);

const BLOCKED_PATH_PARTS = [
  "/wp-admin",
  "/wp-login",
  "/login",
  "/signin",
  "/signup",
  "/register",
  "/account",
  "/cart",
  "/checkout",
  "action=edit",
  "action=history",
  "/w/index.php",
  "/api/",
  "/feed",
  "/rss",
  "/sitemap",
  "/robots.txt"
];

const ASSAM_DOMAINS = [
  "assamtribune.com",
  "sentinelassam.com",
  "pratidintime.com",
  "newslivetv.com",
  "guwahatiplus.com",
  "eastmojo.com",
  "northeasttoday.in"
];

const INDIA_DOMAINS = [
  "ndtv.com",
  "indianexpress.com",
  "thehindu.com",
  "hindustantimes.com",
  "indiatoday.in",
  "livemint.com",
  "moneycontrol.com",
  "news18.com"
];

const NEWS_DOMAINS = [
  "bbc.com",
  "apnews.com",
  "aljazeera.com",
  "reuters.com",
  "theguardian.com"
];

const TECH_DOMAINS = [
  "techcrunch.com",
  "theverge.com",
  "arstechnica.com",
  "wired.com",
  "techradar.com",
  "github.com",
  "developer.mozilla.org",
  "web.dev",
  "docs.python.org",
  "stackoverflow.com"
];

const SCIENCE_DOMAINS = [
  "nasa.gov",
  "esa.int",
  "noaa.gov",
  "who.int",
  "un.org",
  "nature.com",
  "scientificamerican.com",
  "phys.org",
  "sciencedaily.com"
];

const WIKIPEDIA_DOMAINS = [
  "wikipedia.org"
];


// =====================================================
// HELPERS
// =====================================================

function cleanText(text = "") {
  return String(text)
    .replace(/\s+/g, " ")
    .replace(/\u00a0/g, " ")
    .trim();
}


function hashContent(text = "") {
  return crypto
    .createHash("sha256")
    .update(text)
    .digest("hex");
}


function getDomain(url) {
  try {
    return new URL(url)
      .hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return "";
  }
}


function domainMatches(domain, list) {
  return list.some(
    item =>
      domain === item ||
      domain.endsWith("." + item)
  );
}


function isWikipedia(url) {
  return domainMatches(
    getDomain(url),
    WIKIPEDIA_DOMAINS
  );
}


function isBlockedUrl(url) {
  const value = String(url).toLowerCase();

  return BLOCKED_PATH_PARTS.some(
    part => value.includes(part)
  );
}


function normalizeUrl(url, baseUrl) {
  try {
    const parsed = new URL(url, baseUrl);

    if (
      !["http:", "https:"].includes(
        parsed.protocol
      )
    ) {
      return null;
    }

    parsed.hash = "";

    for (
      const key of [...parsed.searchParams.keys()]
    ) {
      if (
        TRACKING_PARAMS.has(
          key.toLowerCase()
        )
      ) {
        parsed.searchParams.delete(key);
      }
    }

    const normalized =
      parsed.toString();

    if (isBlockedUrl(normalized)) {
      return null;
    }

    return normalized;

  } catch {
    return null;
  }
}


// =====================================================
// CATEGORY
// =====================================================

function getCategory(url) {
  const domain = getDomain(url);

  if (
    domainMatches(
      domain,
      ASSAM_DOMAINS
    )
  ) {
    return "assam";
  }

  if (
    domainMatches(
      domain,
      INDIA_DOMAINS
    )
  ) {
    return "india";
  }

  if (
    domainMatches(
      domain,
      NEWS_DOMAINS
    )
  ) {
    return "news";
  }

  if (
    domainMatches(
      domain,
      TECH_DOMAINS
    )
  ) {
    return "technology";
  }

  if (
    domainMatches(
      domain,
      SCIENCE_DOMAINS
    )
  ) {
    return "science";
  }

  if (isWikipedia(url)) {
    return "wikipedia";
  }

  return "general";
}


// =====================================================
// CRAWL PRIORITY
// =====================================================

function crawlPriority(url) {
  const category =
    getCategory(url);

  let score = 50;

  if (category === "assam") {
    score = 150;
  }

  if (category === "india") {
    score = 135;
  }

  if (category === "news") {
    score = 125;
  }

  if (category === "technology") {
    score = 115;
  }

  if (category === "science") {
    score = 110;
  }

  if (category === "general") {
    score = 80;
  }

  if (category === "wikipedia") {
    score = 20;
  }

  try {
    const pathname =
      new URL(url)
        .pathname
        .toLowerCase();

    if (
      /assam|guwahati|northeast|india|news|world|technology|tech|science|space|ai|python|article|story|business/.test(
        pathname
      )
    ) {
      score += 20;
    }

    if (
      /\.(pdf|zip|rar|exe|mp4|mp3|jpg|jpeg|png|gif|webp)$/i.test(
        pathname
      )
    ) {
      score -= 100;
    }

  } catch {}

  return score;
}


// =====================================================
// HTML EXTRACTION
// =====================================================

function extractPage(html, pageUrl) {
  const $ = cheerio.load(html);

  $(
    "script, style, noscript, iframe, svg, canvas"
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
        .attr("content") || ""
    );

  const canonical =
    normalizeUrl(
      $('link[rel="canonical"]')
        .attr("href") ||
        pageUrl,
      pageUrl
    ) || pageUrl;

  const content =
    cleanText(
      $("body")
        .text()
    );

  const links =
    new Set();

  $("a[href]").each(
    (_, element) => {
      const href =
        $(element)
          .attr("href");

      if (!href) {
        return;
      }

      const normalized =
        normalizeUrl(
          href,
          pageUrl
        );

      if (
        normalized &&
        !isBlockedUrl(normalized)
      ) {
        links.add(normalized);
      }
    }
  );

  return {
    title,
    description,
    canonical,
    content,
    links: [...links],
    contentHash:
      hashContent(content)
  };
}


// =====================================================
// ROBOTS
// =====================================================

async function canFetch(url) {
  try {
    const parsed =
      new URL(url);

    const robotsUrl =
      `${parsed.origin}/robots.txt`;

    const response =
      await fetch(
        robotsUrl,
        {
          headers: {
            "User-Agent":
              USER_AGENT
          },
          signal:
            AbortSignal.timeout(10000)
        }
      );

    if (!response.ok) {
      return true;
    }

    const robots =
      await response.text();

    const lines =
      robots
        .split(/\r?\n/)
        .map(line =>
          line.trim()
        );

    let applies = false;

    for (const raw of lines) {
      const line =
        raw.toLowerCase();

      if (
        line.startsWith(
          "user-agent:"
        )
      ) {
        const value =
          line
            .split(":")
            .slice(1)
            .join(":")
            .trim();

        applies =
          value === "*" ||
          value === "hexora-bot";

        continue;
      }

      if (
        applies &&
        line.startsWith(
          "disallow:"
        )
      ) {
        const blockedPath =
          line
            .split(":")
            .slice(1)
            .join(":")
            .trim();

        if (!blockedPath) {
          continue;
        }

        const currentPath =
          new URL(url)
            .pathname;

        if (
          currentPath.startsWith(
            blockedPath
          )
        ) {
          return false;
        }
      }
    }

    return true;

  } catch {
    return true;
  }
}


// =====================================================
// FETCH
// =====================================================

async function fetchPage(url) {
  return fetch(
    url,
    {
      headers: {
        "User-Agent":
          USER_AGENT,

        "Accept":
          "text/html,application/xhtml+xml"
      },

      redirect: "follow",

      signal:
        AbortSignal.timeout(
          TIMEOUT_MS
        )
    }
  );
}


// =====================================================
// QUEUE FAILURE
// =====================================================

async function markFailure(
  id,
  error
) {
  try {
    await supabase
      .from("crawl_queue")
      .update({
        last_error:
          String(error)
            .slice(0, 1000),

        last_crawled_at:
          new Date()
            .toISOString()
      })
      .eq(
        "id",
        id
      );
  } catch (dbError) {
    console.error(
      "[HEXORA] Queue error:",
      dbError.message
    );
  }
}


// =====================================================
// CRAWL URL
// =====================================================

async function crawlUrl(item) {
  const originalUrl =
    item.url;

  console.log(
    `[HEXORA] Crawling: ${originalUrl}`
  );

  try {
    const allowed =
      await canFetch(
        originalUrl
      );

    if (!allowed) {
      console.log(
        `[HEXORA] robots.txt blocked: ${originalUrl}`
      );

      await markFailure(
        item.id,
        "Blocked by robots.txt"
      );

      return;
    }

    const response =
      await fetchPage(
        originalUrl
      );

    if (!response.ok) {
      await markFailure(
        item.id,
        `HTTP ${response.status}`
      );

      return;
    }

    const contentType =
      response.headers.get(
        "content-type"
      ) || "";

    if (
      !contentType.includes(
        "text/html"
      )
    ) {
      await markFailure(
        item.id,
        "Non-HTML content"
      );

      return;
    }

    const finalUrl =
      response.url ||
      originalUrl;

    const html =
      await response.text();

    if (
      !html ||
      html.length < 100
    ) {
      await markFailure(
        item.id,
        "Empty HTML"
      );

      return;
    }

    const page =
      extractPage(
        html,
        finalUrl
      );

    if (
      !page.content ||
      page.content.length < 50
    ) {
      await markFailure(
        item.id,
        "Insufficient page content"
      );

      return;
    }

    const now =
      new Date()
        .toISOString();

    // IMPORTANT:
    // Only use columns that are part of
    // the basic HEXORA pages table.
    const pageData = {
      url: finalUrl,

      title:
        page.title ||
        finalUrl,

      description:
        page.description ||
        "",

      content:
        page.content || "",

      last_crawled_at:
        now
    };

    const {
      error: pageError
    } =
      await supabase
        .from("pages")
        .upsert(
          pageData,
          {
            onConflict: "url"
          }
        );

    if (pageError) {
      throw pageError;
    }

    // ---------------------------------
    // DISCOVER LINKS
    // ---------------------------------

    const MAX_LINKS_PER_PAGE = 80;

    const discovered =
      page.links
        .filter(
          link =>
            link !== finalUrl &&
            !isBlockedUrl(link)
        )
        .sort(
          (a, b) =>
            crawlPriority(b) -
            crawlPriority(a)
        )
        .slice(
          0,
          MAX_LINKS_PER_PAGE
        );

    for (
      const link of discovered
    ) {
      try {
        await supabase
          .from("crawl_queue")
          .upsert(
            {
              url: link,
              status: "pending"
            },
            {
              onConflict: "url",
              ignoreDuplicates: true
            }
          );
      } catch {}
    }

    await supabase
      .from("crawl_queue")
      .update({
        status: "done",

        last_error: null,

        last_crawled_at:
          now
      })
      .eq(
        "id",
        item.id
      );

    console.log(
      `[HEXORA] Crawled successfully: ${finalUrl} | category: ${getCategory(
        finalUrl
      )} | links: ${discovered.length}`
    );

  } catch (error) {
    console.error(
      `[HEXORA] Crawl failed: ${originalUrl}`,
      error.message
    );

    await markFailure(
      item.id,
      error.message
    );
  }
}


// =====================================================
// SEED REFRESH
// =====================================================

async function refreshSeeds() {
  for (
    const url of SEED_URLS
  ) {
    try {
      const normalized =
        normalizeUrl(url);

      if (!normalized) {
        continue;
      }

      // Explicitly put important seeds
      // back into the pending queue.
      await supabase
        .from("crawl_queue")
        .upsert(
          {
            url: normalized,
            status: "pending",
            last_error: null
          },
          {
            onConflict: "url"
          }
        );

    } catch (error) {
      console.error(
        "[HEXORA] Seed error:",
        url,
        error.message
      );
    }
  }

  console.log(
    `[HEXORA] Smart seeds refreshed: ${SEED_URLS.length}`
  );
}


// =====================================================
// GET IMPORTANT PENDING SEEDS
// This prevents Wikipedia starvation.
// =====================================================

async function getSeedQueueItems() {
  const {
    data,
    error
  } =
    await supabase
      .from("crawl_queue")
      .select("*")
      .eq(
        "status",
        "pending"
      )
      .in(
        "url",
        SEED_URLS
      );

  if (error) {
    console.error(
      "[HEXORA] Seed queue error:",
      error.message
    );

    return [];
  }

  return data || [];
}


// =====================================================
// GET GENERAL PENDING QUEUE
// =====================================================

async function getGeneralQueueItems() {
  const {
    data,
    error
  } =
    await supabase
      .from("crawl_queue")
      .select("*")
      .eq(
        "status",
        "pending"
      )
      .order(
        "created_at",
        {
          ascending: true
        }
      )
      .limit(500);

  if (error) {
    throw error;
  }

  return data || [];
}


// =====================================================
// BALANCED CRAWL BATCH
// =====================================================

async function crawlBatch() {
  const seedItems =
    await getSeedQueueItems();

  const generalItems =
    await getGeneralQueueItems();

  const all =
    new Map();

  for (
    const item of seedItems
  ) {
    all.set(
      item.id,
      item
    );
  }

  for (
    const item of generalItems
  ) {
    all.set(
      item.id,
      item
    );
  }

  const available =
    [...all.values()];

  if (!available.length) {
    console.log(
      "[HEXORA] No pending URLs."
    );

    return 0;
  }

  // ---------------------------------
  // CATEGORY BALANCE
  // ---------------------------------

  const groups = {
    assam: [],
    india: [],
    news: [],
    technology: [],
    science: [],
    general: [],
    wikipedia: []
  };

  for (
    const item of available
  ) {
    const category =
      getCategory(item.url);

    if (
      groups[category]
    ) {
      groups[category].push(
        item
      );
    } else {
      groups.general.push(
        item
      );
    }
  }

  for (
    const key of Object.keys(groups)
  ) {
    groups[key].sort(
      (a, b) =>
        crawlPriority(b.url) -
        crawlPriority(a.url)
    );
  }

  const selected = [];
  const usedIds =
    new Set();

  // Reserve one slot for each
  // major category when available.
  const categoryOrder = [
    "assam",
    "india",
    "news",
    "technology",
    "science",
    "general"
  ];

  for (
    const category of categoryOrder
  ) {
    const item =
      groups[category][0];

    if (
      item &&
      !usedIds.has(item.id) &&
      selected.length < BATCH_SIZE
    ) {
      selected.push(item);
      usedIds.add(item.id);
    }
  }

  // Fill remaining slots by priority.
  const remaining =
    available
      .filter(
        item =>
          !usedIds.has(item.id)
      )
      .sort(
        (a, b) =>
          crawlPriority(b.url) -
          crawlPriority(a.url)
      );

  for (
    const item of remaining
  ) {
    if (
      selected.length >=
      BATCH_SIZE
    ) {
      break;
    }

    // Keep Wikipedia from consuming
    // the entire batch.
    if (
      isWikipedia(item.url)
    ) {
      continue;
    }

    selected.push(item);
    usedIds.add(item.id);
  }

  // If still empty/short, use Wikipedia
  // only for leftover capacity.
  if (
    selected.length < BATCH_SIZE
  ) {
    for (
      const item of available
    ) {
      if (
        selected.length >=
        BATCH_SIZE
      ) {
        break;
      }

      if (
        usedIds.has(item.id)
      ) {
        continue;
      }

      selected.push(item);
      usedIds.add(item.id);
    }
  }

  // ---------------------------------
  // DOMAIN LIMIT
  // ---------------------------------

  const domainCounts =
    new Map();

  const finalBatch = [];

  for (
    const item of selected
  ) {
    const domain =
      getDomain(item.url);

    const current =
      domainCounts.get(domain) ||
      0;

    // Max 2 pages/domain/batch.
    if (
      current >= 2
    ) {
      continue;
    }

    domainCounts.set(
      domain,
      current + 1
    );

    finalBatch.push(item);

    if (
      finalBatch.length >=
      BATCH_SIZE
    ) {
      break;
    }
  }

  let index = 0;

  async function worker() {
    while (true) {
      const currentIndex =
        index++;

      if (
        currentIndex >=
        finalBatch.length
      ) {
        return;
      }

      const item =
        finalBatch[currentIndex];

      await supabase
        .from("crawl_queue")
        .update({
          status:
            "processing"
        })
        .eq(
          "id",
          item.id
        );

      await crawlUrl(item);
    }
  }

  const workers = [];

  for (
    let i = 0;
    i <
    Math.min(
      CONCURRENCY,
      finalBatch.length
    );
    i++
  ) {
    workers.push(
      worker()
    );
  }

  await Promise.all(
    workers
  );

  return finalBatch.length;
}


// =====================================================
// SEARCH ENGINE
// =====================================================

function scorePage(
  page,
  query
) {
  const q =
    query.toLowerCase();

  const words =
    q
      .split(/\s+/)
      .filter(Boolean);

  const title =
    String(
      page.title || ""
    ).toLowerCase();

  const description =
    String(
      page.description || ""
    ).toLowerCase();

  const content =
    String(
      page.content || ""
    ).toLowerCase();

  const url =
    String(
      page.url || ""
    ).toLowerCase();

  let score = 0;

  // Exact title
  if (
    title === q
  ) {
    score += 180;
  }

  // Phrase in title
  if (
    title.includes(q)
  ) {
    score += 100;
  }

  // Phrase in description
  if (
    description.includes(q)
  ) {
    score += 45;
  }

  // Phrase in URL
  if (
    url.includes(q)
  ) {
    score += 35;
  }

  // Word matches
  let matched = 0;

  for (
    const word of words
  ) {
    if (
      title.includes(word)
    ) {
      score += 25;
      matched++;
    }

    if (
      description.includes(word)
    ) {
      score += 10;
    }

    if (
      url.includes(word)
    ) {
      score += 8;
    }

    if (
      content.includes(word)
    ) {
      score += 3;
    }
  }

  // Query coverage
  if (
    words.length &&
    matched === words.length
  ) {
    score += 35;
  }

  // Category boost
  const category =
    getCategory(
      page.url || ""
    );

  const queryLower =
    q;

  if (
    queryLower.includes(
      "assam"
    ) &&
    category === "assam"
  ) {
    score += 60;
  }

  if (
    queryLower.includes(
      "guwahati"
    ) &&
    category === "assam"
  ) {
    score += 45;
  }

  if (
    queryLower.includes(
      "india"
    ) &&
    category === "india"
  ) {
    score += 45;
  }

  if (
    queryLower.includes(
      "news"
    ) &&
    (
      category === "news" ||
      category === "india" ||
      category === "assam"
    )
  ) {
    score += 40;
  }

  if (
    (
      queryLower.includes(
        "technology"
      ) ||
      queryLower.includes(
        "tech"
      ) ||
      queryLower.includes(
        "ai"
      )
    ) &&
    category === "technology"
  ) {
    score += 45;
  }

  if (
    queryLower.includes(
      "science"
    ) &&
    category === "science"
  ) {
    score += 45;
  }

  // Wikipedia is useful,
  // but should not dominate.
  if (
    category === "wikipedia"
  ) {
    score -= 25;
  }

  // Freshness
  if (
    page.last_crawled_at
  ) {
    const age =
      Date.now() -
      new Date(
        page.last_crawled_at
      ).getTime();

    const days =
      age /
      (
        1000 *
        60 *
        60 *
        24
      );

    if (
      days <= 1
    ) {
      score += 15;
    } else if (
      days <= 7
    ) {
      score += 10;
    } else if (
      days <= 30
    ) {
      score += 5;
    }
  }

  return score;
}


async function searchPages(
  query
) {
  const q =
    cleanText(query);

  if (!q) {
    return [];
  }

  console.log(
    `[HEXORA SEARCH] ${q}`
  );

  let data = [];
  let ftsError = null;

  // ---------------------------------
  // FTS
  // ---------------------------------

  const fts =
    await supabase
      .from("pages")
      .select(
        "id,url,title,description,content,last_crawled_at"
      )
      .textSearch(
        "search_vector",
        q,
        {
          type:
            "websearch",
          config:
            "simple"
        }
      )
      .limit(100);

  data =
    fts.data || [];

  ftsError =
    fts.error;

  // ---------------------------------
  // Fallback
  // ---------------------------------

  if (
    ftsError ||
    data.length === 0
  ) {
    console.log(
      "[HEXORA] Using search fallback"
    );

    const pattern =
      `%${q}%`;

    const fallback =
      await supabase
        .from("pages")
        .select(
          "id,url,title,description,content,last_crawled_at"
        )
        .or(
          `title.ilike.${pattern},description.ilike.${pattern},url.ilike.${pattern}`
        )
        .limit(100);

    if (
      fallback.error
    ) {
      throw fallback.error;
    }

    data =
      fallback.data || [];
  }

  const results =
    data
      .map(page => ({
        ...page,
        relevance_score:
          Number(
            scorePage(
              page,
              q
            ).toFixed(2)
          )
      }))
      .sort(
        (a, b) =>
          b.relevance_score -
          a.relevance_score
      )
      .slice(
        0,
        20
      )
      .map(
        ({
          content,
          ...page
        }) =>
          page
      );

  return results;
}


// =====================================================
// MIME TYPES
// =====================================================

const MIME_TYPES = {
  ".html":
    "text/html; charset=utf-8",

  ".js":
    "application/javascript; charset=utf-8",

  ".mjs":
    "application/javascript; charset=utf-8",

  ".css":
    "text/css; charset=utf-8",

  ".json":
    "application/json; charset=utf-8",

  ".png":
    "image/png",

  ".jpg":
    "image/jpeg",

  ".jpeg":
    "image/jpeg",

  ".gif":
    "image/gif",

  ".svg":
    "image/svg+xml",

  ".webp":
    "image/webp",

  ".ico":
    "image/x-icon",

  ".txt":
    "text/plain; charset=utf-8",

  ".woff":
    "font/woff",

  ".woff2":
    "font/woff2"
};


// =====================================================
// STATIC FILE SERVER
// =====================================================

function serveStatic(
  reqPath,
  res
) {
  try {
    const decoded =
      decodeURIComponent(
        reqPath
      );

    if (
      decoded.includes("..") ||
      decoded.includes("\\")
    ) {
      return false;
    }

    const relativePath =
      decoded === "/"
        ? "index.html"
        : decoded.replace(
            /^\/+/,
            ""
          );

    const filePath =
      path.resolve(
        process.cwd(),
        relativePath
      );

    const root =
      path.resolve(
        process.cwd()
      );

    if (
      !filePath.startsWith(
        root
      )
    ) {
      return false;
    }

    if (
      !fs.existsSync(
        filePath
      )
    ) {
      return false;
    }

    if (
      !fs.statSync(
        filePath
      ).isFile()
    ) {
      return false;
    }

    const ext =
      path
        .extname(
          filePath
        )
        .toLowerCase();

    res.writeHead(
      200,
      {
        "Content-Type":
          MIME_TYPES[ext] ||
          "application/octet-stream"
      }
    );

    fs.createReadStream(
      filePath
    ).pipe(res);

    return true;

  } catch {
    return false;
  }
}


// =====================================================
// HTTP SERVER
// =====================================================

const server =
  http.createServer(
    async (
      req,
      res
    ) => {
      try {
        const url =
          new URL(
            req.url,
            `http://localhost:${PORT}`
          );

        // ---------------------------------
        // HEALTH
        // ---------------------------------

        if (
          req.method === "GET" &&
          url.pathname ===
            "/health"
        ) {
          res.writeHead(
            200,
            {
              "Content-Type":
                "application/json; charset=utf-8"
            }
          );

          res.end(
            JSON.stringify({
              ok: true,
              service:
                "HEXORA",
              crawler:
                "running"
            })
          );

          return;
        }

        // ---------------------------------
        // SEARCH
        // ---------------------------------

        if (
          req.method === "GET" &&
          url.pathname ===
            "/search"
        ) {
          const q =
            url.searchParams.get(
              "q"
            );

          if (
            !q ||
            !q.trim()
          ) {
            res.writeHead(
              400,
              {
                "Content-Type":
                  "application/json; charset=utf-8",
                "Access-Control-Allow-Origin":
                  "*"
              }
            );

            res.end(
              JSON.stringify({
                error:
                  "Missing search query"
              })
            );

            return;
          }

          const results =
            await searchPages(
              q
            );

          res.writeHead(
            200,
            {
              "Content-Type":
                "application/json; charset=utf-8",

              "Access-Control-Allow-Origin":
                "*",

              "Cache-Control":
                "no-store"
            }
          );

          res.end(
            JSON.stringify({
              query:
                q,

              count:
                results.length,

              results
            })
          );

          return;
        }

        // ---------------------------------
        // STATIC WEBSITE
        // ---------------------------------

        if (
          req.method === "GET"
        ) {
          const served =
            serveStatic(
              url.pathname,
              res
            );

          if (served) {
            return;
          }
        }

        // ---------------------------------
        // 404
        // ---------------------------------

        res.writeHead(
          404,
          {
            "Content-Type":
              "application/json; charset=utf-8"
          }
        );

        res.end(
          JSON.stringify({
            error:
              "Not found"
          })
        );

      } catch (error) {
        console.error(
          "[HEXORA SERVER ERROR]",
          error
        );

        if (!res.headersSent) {
          res.writeHead(
            500,
            {
              "Content-Type":
                "application/json; charset=utf-8"
            }
          );
        }

        res.end(
          JSON.stringify({
            error:
              "Internal server error"
          })
        );
      }
    }
  );


// =====================================================
// START HTTP SERVER
// =====================================================

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      "======================================"
    );

    console.log(
      "        HEXORA SEARCH ENGINE"
    );

    console.log(
      "======================================"
    );

    console.log(
      `HTTP server running on port ${PORT}`
    );

    console.log(
      "Homepage: /"
    );

    console.log(
      "Search: /search?q=your-query"
    );

    console.log(
      "Health: /health"
    );

    console.log(
      "Crawler: ACTIVE"
    );

    console.log(
      "Coverage: Assam + India + News + Technology + Science + General Web"
    );

    console.log(
      "Wikipedia priority: LOW"
    );

    console.log(
      "======================================"
    );
  }
);


// =====================================================
// CRAWLER WORKER
// =====================================================

async function startCrawler() {
  console.log(
    "[HEXORA] Crawler worker started"
  );

  console.log(
    "[HEXORA] Smart Web Coverage enabled"
  );

  console.log(
    "[HEXORA] Assam + India + News + Technology + Science + General Web"
  );

  console.log(
    "[HEXORA] Wikipedia will NOT dominate the queue"
  );

  while (true) {
    try {
      await refreshSeeds();

      const processed =
        await crawlBatch();

      console.log(
        `[HEXORA] Crawl cycle completed | processed: ${processed}`
      );

    } catch (error) {
      console.error(
        "[HEXORA] Crawl cycle error:",
        error.message
      );
    }

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          CRAWL_INTERVAL_MS
        )
    );
  }
}


startCrawler()
  .catch(error => {
    console.error(
      "[HEXORA] Fatal crawler error:",
      error
    );

    process.exit(1);
  });
