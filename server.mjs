import http from "http";
import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";
import crypto from "crypto";

const PORT = Number(process.env.PORT || 8080);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const USER_AGENT = "HEXORA-Bot/1.0";
const TIMEOUT_MS = Number(process.env.CRAWL_TIMEOUT_MS || 15000);
const BATCH_SIZE = Number(process.env.CRAWL_BATCH_SIZE || 10);
const CONCURRENCY = Number(process.env.CRAWL_CONCURRENCY || 2);
const CRAWL_INTERVAL_MS = Number(
  process.env.CRAWL_INTERVAL_MS || 30000
);

const MAX_DISCOVERED_LINKS = 200;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[HEXORA] Missing Supabase environment variables");
  process.exit(1);
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

/* =========================================================
   SMART SEEDS
========================================================= */

const GLOBAL_SEEDS = [

  /* ---------- GENERAL WEB ---------- */

  "https://www.wikipedia.org/",
  "https://en.wikipedia.org/",
  "https://www.reddit.com/",
  "https://github.com/",
  "https://stackoverflow.com/",
  "https://developer.mozilla.org/",

  /* ---------- NEWS / WORLD ---------- */

  "https://www.bbc.com/",
  "https://www.bbc.com/news",
  "https://apnews.com/",
  "https://www.aljazeera.com/",
  "https://www.theguardian.com/",
  "https://www.reuters.com/",

  /* ---------- INDIA ---------- */

  "https://www.ndtv.com/",
  "https://indianexpress.com/",
  "https://www.thehindu.com/",
  "https://www.hindustantimes.com/",
  "https://timesofindia.indiatimes.com/",
  "https://www.indiatoday.in/",
  "https://www.news18.com/",

  /* ---------- ASSAM / NORTHEAST ---------- */

  "https://assamtribune.com/",
  "https://www.sentinelassam.com/",
  "https://nenow.in/",
  "https://www.pratidintime.com/",
  "https://www.guwahatiplus.com/",
  "https://www.eastmojo.com/",
  "https://www.northeasttoday.in/",

  /* ---------- TECHNOLOGY ---------- */

  "https://techcrunch.com/",
  "https://www.theverge.com/",
  "https://www.wired.com/",
  "https://arstechnica.com/",
  "https://www.zdnet.com/",
  "https://www.techradar.com/",

  /* ---------- SCIENCE / SPACE ---------- */

  "https://www.nasa.gov/",
  "https://www.esa.int/",
  "https://www.nature.com/",
  "https://www.sciencedaily.com/",
  "https://www.sciencenews.org/",
  "https://www.who.int/",
  "https://www.un.org/"
];

/* =========================================================
   TRUSTED DOMAINS
========================================================= */

const TRUSTED_DOMAINS = new Set([

  "wikipedia.org",

  "bbc.com",
  "apnews.com",
  "aljazeera.com",
  "theguardian.com",
  "reuters.com",

  "ndtv.com",
  "indianexpress.com",
  "thehindu.com",
  "hindustantimes.com",
  "indiatoday.in",
  "news18.com",
  "timesofindia.indiatimes.com",

  "assamtribune.com",
  "sentinelassam.com",
  "nenow.in",
  "pratidintime.com",
  "guwahatiplus.com",
  "eastmojo.com",
  "northeasttoday.in",

  "github.com",
  "stackoverflow.com",
  "developer.mozilla.org",

  "techcrunch.com",
  "theverge.com",
  "wired.com",
  "arstechnica.com",
  "zdnet.com",
  "techradar.com",

  "nasa.gov",
  "esa.int",
  "nature.com",
  "sciencedaily.com",
  "sciencenews.org",
  "who.int",
  "un.org",

  "reddit.com"
]);

/* =========================================================
   DOMAIN CATEGORY
========================================================= */

function domainCategory(domain) {

  if (
    domain.includes("assam") ||
    domain.includes("nenow") ||
    domain.includes("eastmojo") ||
    domain.includes("northeast") ||
    domain.includes("guwahati")
  ) {
    return "assam";
  }

  if (
    domain.includes("ndtv") ||
    domain.includes("indianexpress") ||
    domain.includes("thehindu") ||
    domain.includes("hindustantimes") ||
    domain.includes("indiatoday") ||
    domain.includes("news18") ||
    domain.includes("timesofindia")
  ) {
    return "india";
  }

  if (
    domain.includes("bbc") ||
    domain.includes("reuters") ||
    domain.includes("apnews") ||
    domain.includes("aljazeera") ||
    domain.includes("guardian")
  ) {
    return "news";
  }

  if (
    domain.includes("techcrunch") ||
    domain.includes("theverge") ||
    domain.includes("wired") ||
    domain.includes("arstechnica") ||
    domain.includes("zdnet") ||
    domain.includes("techradar") ||
    domain.includes("github") ||
    domain.includes("stackoverflow") ||
    domain.includes("mozilla")
  ) {
    return "technology";
  }

  if (
    domain.includes("nasa") ||
    domain.includes("esa.int") ||
    domain.includes("nature") ||
    domain.includes("sciencedaily") ||
    domain.includes("sciencenews") ||
    domain.includes("who.int")
  ) {
    return "science";
  }

  return "general";
}

/* =========================================================
   HELPERS
========================================================= */

function cleanText(text = "") {
  return text
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

function normalizeUrl(rawUrl, baseUrl = null) {

  try {

    const u = new URL(rawUrl, baseUrl || undefined);

    if (!["http:", "https:"].includes(u.protocol)) {
      return null;
    }

    u.hash = "";

    const removeParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid",
      "ref",
      "ref_src"
    ];

    for (const p of removeParams) {
      u.searchParams.delete(p);
    }

    return u.toString();

  } catch {
    return null;
  }
}

function getDomain(url) {

  try {
    return new URL(url).hostname
      .replace(/^www\./, "")
      .toLowerCase();
  } catch {
    return "";
  }
}

function domainAuthority(domain) {

  if (!domain) return 0;

  if (domain === "wikipedia.org") return 7;

  if (TRUSTED_DOMAINS.has(domain)) return 10;

  for (const trusted of TRUSTED_DOMAINS) {

    if (
      domain.endsWith("." + trusted)
    ) {
      return 8;
    }
  }

  return 0;
}

function urlQuality(url) {

  let score = 0;

  try {

    const u = new URL(url);
    const path = u.pathname.toLowerCase();

    if (
      path.includes("/article/") ||
      path.includes("/news/") ||
      path.includes("/science/") ||
      path.includes("/technology/") ||
      path.includes("/world/") ||
      path.includes("/india/")
    ) {
      score += 8;
    }

    if (
      path.includes("/login") ||
      path.includes("/signup") ||
      path.includes("/register") ||
      path.includes("/cart") ||
      path.includes("/checkout") ||
      path.includes("/wp-admin") ||
      path.includes("/account")
    ) {
      score -= 20;
    }

    if (
      path.includes("/edit") ||
      path.includes("/history") ||
      path.includes("/special:")
    ) {
      score -= 25;
    }

  } catch {}

  return score;
}

function isProbablyWebPage(url) {

  try {

    const u = new URL(url);
    const path = u.pathname.toLowerCase();

    const badExtensions = [
      ".jpg",
      ".jpeg",
      ".png",
      ".gif",
      ".webp",
      ".svg",
      ".pdf",
      ".zip",
      ".rar",
      ".mp3",
      ".mp4",
      ".avi",
      ".mov",
      ".webm",
      ".exe",
      ".dmg",
      ".iso"
    ];

    if (
      badExtensions.some(ext =>
        path.endsWith(ext)
      )
    ) {
      return false;
    }

    const badPaths = [
      "/login",
      "/logout",
      "/signin",
      "/signup",
      "/register",
      "/cart",
      "/checkout",
      "/wp-admin",
      "/wp-login.php",
      "/account",
      "/user/login",
      "/edit",
      "/history",
      "/action=edit"
    ];

    if (
      badPaths.some(p =>
        path.includes(p)
      )
    ) {
      return false;
    }

    return true;

  } catch {
    return false;
  }
}

/* =========================================================
   PAGE EXTRACTION
========================================================= */

function extractPage(html, finalUrl) {

  const $ = cheerio.load(html);

  $(
    "script,style,noscript,iframe,svg,canvas,template"
  ).remove();

  const title = cleanText(
    $("title").first().text()
  );

  const description = cleanText(
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") ||
    ""
  );

  const canonical =
    normalizeUrl(
      $('link[rel="canonical"]').attr("href"),
      finalUrl
    ) || finalUrl;

  const bodyText = cleanText(
    $("body").text()
  );

  const links = [];

  $("a[href]").each((_, el) => {

    if (links.length >= MAX_DISCOVERED_LINKS) {
      return;
    }

    const href = $(el).attr("href");

    const normalized = normalizeUrl(
      href,
      finalUrl
    );

    if (!normalized) return;

    if (!isProbablyWebPage(normalized)) {
      return;
    }

    links.push(normalized);
  });

  return {
    title,
    description,
    content: bodyText.slice(0, 100000),
    canonical,
    links: [...new Set(links)],
    wordCount: bodyText
      ? bodyText.split(/\s+/).length
      : 0,
    contentHash: hashContent(bodyText)
  };
}

/* =========================================================
   ROBOTS
========================================================= */

async function canFetch(url) {

  try {

    const u = new URL(url);

    const robotsUrl =
      `${u.protocol}//${u.host}/robots.txt`;

    const controller =
      new AbortController();

    const timer = setTimeout(
      () => controller.abort(),
      5000
    );

    const response = await fetch(
      robotsUrl,
      {
        headers: {
          "User-Agent": USER_AGENT
        },
        signal: controller.signal
      }
    );

    clearTimeout(timer);

    if (!response.ok) {
      return true;
    }

    const text = await response.text();

    const lines = text
      .split(/\r?\n/)
      .map(x => x.trim());

    let applies = false;

    for (const line of lines) {

      const lower = line.toLowerCase();

      if (lower.startsWith("user-agent:")) {

        const agent =
          lower
            .split(":")
            .slice(1)
            .join(":")
            .trim();

        applies =
          agent === "*" ||
          agent === "hexora-bot";

        continue;
      }

      if (
        applies &&
        lower.startsWith("disallow:")
      ) {

        const path =
          line
            .split(":")
            .slice(1)
            .join(":")
            .trim();

        if (!path) continue;

        if (
          u.pathname.startsWith(path)
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

/* =========================================================
   FETCH
========================================================= */

async function fetchPage(url) {

  const controller =
    new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    TIMEOUT_MS
  );

  try {

    const response = await fetch(
      url,
      {
        redirect: "follow",
        headers: {
          "User-Agent": USER_AGENT,
          "Accept":
            "text/html,application/xhtml+xml"
        },
        signal: controller.signal
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
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml")
    ) {
      throw new Error(
        `Not HTML: ${contentType}`
      );
    }

    const html =
      await response.text();

    return {
      html,
      finalUrl: response.url || url
    };

  } finally {

    clearTimeout(timer);
  }
}

/* =========================================================
   FAILURE
========================================================= */

async function markFailure(url) {

  try {

    await supabase
      .from("crawl_queue")
      .update({
        status: "pending"
      })
      .eq("url", url);

  } catch (error) {

    console.error(
      "[HEXORA] Queue reset error:",
      error.message
    );
  }
}

/* =========================================================
   CRAWL ONE URL
========================================================= */

async function crawlUrl(url) {

  console.log(
    `[HEXORA] Crawling: ${url}`
  );

  try {

    if (!isProbablyWebPage(url)) {
      await markFailure(url);
      return;
    }

    const allowed =
      await canFetch(url);

    if (!allowed) {

      console.log(
        `[HEXORA] robots.txt blocked: ${url}`
      );

      await markFailure(url);
      return;
    }

    const page =
      await fetchPage(url);

    const finalUrl =
      normalizeUrl(
        page.finalUrl
      ) || url;

    const extracted =
      extractPage(
        page.html,
        finalUrl
      );

    if (!extracted.title &&
        !extracted.content) {

      await markFailure(url);
      return;
    }

    const pageRecord = {
      url: finalUrl,
      title: extracted.title,
      description: extracted.description,
      content: extracted.content,
      canonical: extracted.canonical,
      word_count: extracted.wordCount,
      content_hash: extracted.contentHash
    };

    const { error } =
      await supabase
        .from("pages")
        .upsert(
          pageRecord,
          {
            onConflict: "url"
          }
        );

    if (error) {
      throw error;
    }

    /* ---------- DISCOVER LINKS ---------- */

    const discovered =
      extracted.links;

    for (const link of discovered) {

      if (!isProbablyWebPage(link)) {
        continue;
      }

      const { error: queueError } =
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

      if (queueError) {
        console.error(
          "[HEXORA] Queue insert:",
          queueError.message
        );
      }
    }

    await supabase
      .from("crawl_queue")
      .update({
        status: "done"
      })
      .eq("url", url);

    if (finalUrl !== url) {

      await supabase
        .from("crawl_queue")
        .update({
          status: "done"
        })
        .eq("url", finalUrl);
    }

    console.log(
      `[HEXORA] Crawled successfully: ${finalUrl} | links: ${discovered.length}`
    );

  } catch (error) {

    console.error(
      `[HEXORA] Crawl failed: ${url} | ${error.message}`
    );

    await markFailure(url);
  }
}

/* =========================================================
   SMART SEED REFRESH
========================================================= */

async function refreshSeeds() {

  for (const url of GLOBAL_SEEDS) {

    try {

      if (!isProbablyWebPage(url)) {
        continue;
      }

      await supabase
        .from("crawl_queue")
        .upsert(
          {
            url,
            status: "pending"
          },
          {
            onConflict: "url",
            ignoreDuplicates: true
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
    `[HEXORA] Smart seed refresh completed | seeds: ${GLOBAL_SEEDS.length}`
  );
}

/* =========================================================
   CRAWL PRIORITY
========================================================= */

function crawlPriority(url) {

  let score = 0;

  const domain =
    getDomain(url);

  const category =
    domainCategory(domain);

  /* Trusted domain */

  score +=
    domainAuthority(domain) * 10;

  /* Category diversity */

  if (category === "assam") {
    score += 45;
  }

  if (category === "india") {
    score += 35;
  }

  if (category === "news") {
    score += 30;
  }

  if (category === "technology") {
    score += 25;
  }

  if (category === "science") {
    score += 25;
  }

  /* URL quality */

  score += urlQuality(url);

  /* Avoid Wikipedia over-priority */

  if (domain === "wikipedia.org") {
    score -= 30;
  }

  try {

    const path =
      new URL(url)
        .pathname
        .toLowerCase();

    if (
      path.includes("/news") ||
      path.includes("/article") ||
      path.includes("/technology") ||
      path.includes("/science") ||
      path.includes("/india") ||
      path.includes("/assam")
    ) {
      score += 20;
    }

  } catch {}

  return score;
}

/* =========================================================
   DIVERSIFIED CRAWL BATCH
========================================================= */

async function crawlBatch() {

  try {

    await refreshSeeds();

    const { data, error } =
      await supabase
        .from("crawl_queue")
        .select("url")
        .eq("status", "pending")
        .limit(500);

    if (error) {
      throw error;
    }

    if (!data || !data.length) {

      console.log(
        "[HEXORA] No pending URLs"
      );

      return 0;
    }

    const sorted =
      data
        .map(row => row.url)
        .filter(isProbablyWebPage)
        .sort(
          (a, b) =>
            crawlPriority(b) -
            crawlPriority(a)
        );

    /* ---------- DOMAIN DIVERSITY ---------- */

    const selected = [];
    const domainCounts = new Map();

    for (const url of sorted) {

      const domain =
        getDomain(url);

      const count =
        domainCounts.get(domain) || 0;

      /*
        Maximum 2 URLs per domain
        in one batch.
      */

      if (count >= 2) {
        continue;
      }

      selected.push(url);

      domainCounts.set(
        domain,
        count + 1
      );

      if (
        selected.length >= BATCH_SIZE
      ) {
        break;
      }
    }

    /* ---------- FALLBACK ---------- */

    if (!selected.length) {

      selected.push(
        ...sorted.slice(0, BATCH_SIZE)
      );
    }

    let index = 0;

    async function worker() {

      while (true) {

        const current =
          index++;

        if (
          current >= selected.length
        ) {
          break;
        }

        await crawlUrl(
          selected[current]
        );
      }
    }

    const workers = [];

    for (
      let i = 0;
      i < Math.min(
        CONCURRENCY,
        selected.length
      );
      i++
    ) {
      workers.push(worker());
    }

    await Promise.all(workers);

    console.log(
      `[HEXORA] Crawl cycle completed | processed: ${selected.length}`
    );

    return selected.length;

  } catch (error) {

    console.error(
      "[HEXORA] Crawl cycle error:",
      error.message
    );

    return 0;
  }
}

/* =========================================================
   SEARCH
========================================================= */

function normalizeSearchText(text = "") {

  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function countWordMatches(text, words) {

  const lower =
    normalizeSearchText(text);

  let count = 0;

  for (const word of words) {

    if (
      lower.includes(word)
    ) {
      count++;
    }
  }

  return count;
}

function freshnessScore(row) {

  const date =
    row.updated_at ||
    row.created_at;

  if (!date) return 0;

  const time =
    new Date(date).getTime();

  if (!Number.isFinite(time)) {
    return 0;
  }

  const days =
    (Date.now() - time) /
    86400000;

  if (days <= 1) return 12;
  if (days <= 7) return 8;
  if (days <= 30) return 5;
  if (days <= 180) return 2;

  return 0;
}

async function searchPages(q) {

  const query =
    normalizeSearchText(q);

  if (!query) {
    return [];
  }

  const words =
    query
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 12);

  const candidates = new Map();

  /* ---------- FTS ---------- */

  try {

    const { data } =
      await supabase
        .from("pages")
        .select(
          "url,title,description,content,word_count,updated_at,created_at"
        )
        .textSearch(
          "search_vector",
          query,
          {
            type: "websearch",
            config: "simple"
          }
        )
        .limit(300);

    for (const row of data || []) {

      if (row.url) {
        candidates.set(
          row.url,
          row
        );
      }
    }

  } catch (error) {

    console.error(
      "[HEXORA] FTS error:",
      error.message
    );
  }

  /* ---------- TITLE FALLBACK ---------- */

  for (const word of words) {

    try {

      const { data } =
        await supabase
          .from("pages")
          .select(
            "url,title,description,content,word_count,updated_at,created_at"
          )
          .ilike(
            "title",
            `%${word}%`
          )
          .limit(100);

      for (const row of data || []) {

        if (row.url) {
          candidates.set(
            row.url,
            row
          );
        }
      }

    } catch {}
  }

  /* ---------- DESCRIPTION FALLBACK ---------- */

  for (const word of words) {

    try {

      const { data } =
        await supabase
          .from("pages")
          .select(
            "url,title,description,content,word_count,updated_at,created_at"
          )
          .ilike(
            "description",
            `%${word}%`
          )
          .limit(100);

      for (const row of data || []) {

        if (row.url) {
          candidates.set(
            row.url,
            row
          );
        }
      }

    } catch {}
  }

  /* ---------- SCORE ---------- */

  const results = [];

  for (const row of candidates.values()) {

    const title =
      normalizeSearchText(
        row.title || ""
      );

    const description =
      normalizeSearchText(
        row.description || ""
      );

    const content =
      normalizeSearchText(
        row.content || ""
      );

    const url =
      normalizeSearchText(
        row.url || ""
      );

    const domain =
      getDomain(row.url);

    const category =
      domainCategory(domain);

    let score = 0;

    /* Exact phrase */

    if (
      title === query
    ) {
      score += 2000;
    }

    if (
      title.includes(query)
    ) {
      score += 900;
    }

    if (
      description.includes(query)
    ) {
      score += 300;
    }

    if (
      url.includes(query)
    ) {
      score += 250;
    }

    /* Individual words */

    let titleMatches = 0;
    let descriptionMatches = 0;
    let contentMatches = 0;

    for (const word of words) {

      if (title.includes(word)) {
        titleMatches++;
        score += 150;
      }

      if (description.includes(word)) {
        descriptionMatches++;
        score += 45;
      }

      if (content.includes(word)) {
        contentMatches++;
        score += 5;
      }

      if (url.includes(word)) {
        score += 40;
      }
    }

    /* Coverage */

    if (words.length) {

      score +=
        (titleMatches / words.length) *
        600;

      score +=
        (descriptionMatches / words.length) *
        200;

      score +=
        (contentMatches / words.length) *
        100;
    }

    /* Domain authority */

    score +=
      domainAuthority(domain);

    /* Category relevance */

    if (
      query.includes("assam") &&
      category === "assam"
    ) {
      score += 300;
    }

    if (
      query.includes("india") &&
      category === "india"
    ) {
      score += 250;
    }

    if (
      query.includes("news") &&
      category === "news"
    ) {
      score += 200;
    }

    if (
      query.includes("technology") &&
      category === "technology"
    ) {
      score += 200;
    }

    if (
      query.includes("tech") &&
      category === "technology"
    ) {
      score += 150;
    }

    if (
      query.includes("science") &&
      category === "science"
    ) {
      score += 200;
    }

    /* Quality */

    score +=
      urlQuality(row.url);

    if (
      Number(row.word_count || 0) > 300
    ) {
      score += 8;
    }

    if (
      Number(row.word_count || 0) > 1000
    ) {
      score += 5;
    }

    /* Freshness */

    score +=
      freshnessScore(row);

    /* Wikipedia penalty for generic searches */

    if (
      domain === "wikipedia.org" &&
      !title.includes(query)
    ) {
      score -= 250;
    }

    /* Weak match penalty */

    if (
      titleMatches === 0 &&
      descriptionMatches === 0 &&
      contentMatches < 2
    ) {
      score -= 200;
    }

    results.push({
      ...row,
      score
    });
  }

  results.sort(
    (a, b) =>
      b.score - a.score
  );

  return results
    .slice(0, 20)
    .map(row => ({
      url: row.url,
      title:
        row.title ||
        row.url,
      description:
        row.description ||
        "",
      score:
        Math.round(row.score)
    }));
}

/* =========================================================
   HTTP SERVER
========================================================= */

const server =
  http.createServer(
    async (req, res) => {

      try {

        const requestUrl =
          new URL(
            req.url,
            `http://${req.headers.host || "localhost"}`
          );

        /* ---------- SEARCH ---------- */

        if (
          requestUrl.pathname === "/search"
        ) {

          const q =
            requestUrl.searchParams
              .get("q")
              ?.trim();

          if (!q) {

            res.writeHead(
              400,
              {
                "Content-Type":
                  "application/json"
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

          console.log(
            `[HEXORA SEARCH] ${q}`
          );

          const results =
            await searchPages(q);

          res.writeHead(
            200,
            {
              "Content-Type":
                "application/json",
              "Cache-Control":
                "no-store",
              "Access-Control-Allow-Origin":
                "*"
            }
          );

          res.end(
            JSON.stringify({
              query: q,
              count: results.length,
              results
            })
          );

          return;
        }

        /* ---------- HEALTH ---------- */

        if (
          requestUrl.pathname === "/health"
        ) {

          res.writeHead(
            200,
            {
              "Content-Type":
                "application/json"
            }
          );

          res.end(
            JSON.stringify({
              ok: true,
              service: "HEXORA",
              crawler: "running"
            })
          );

          return;
        }

        /* ---------- ROOT ---------- */

        if (
          requestUrl.pathname === "/"
        ) {

          res.writeHead(
            200,
            {
              "Content-Type":
                "text/html; charset=utf-8"
            }
          );

          res.end(`
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>HEXORA Search</title>
</head>
<body>
  <h1>HEXORA Search Engine</h1>
  <p>Search: <code>/search?q=your-query</code></p>
  <p>Health: <code>/health</code></p>
</body>
</html>
          `);

          return;
        }

        /* ---------- 404 ---------- */

        res.writeHead(
          404,
          {
            "Content-Type":
              "application/json"
          }
        );

        res.end(
          JSON.stringify({
            error: "Not found"
          })
        );

      } catch (error) {

        console.error(
          "[HEXORA] HTTP error:",
          error.message
        );

        res.writeHead(
          500,
          {
            "Content-Type":
              "application/json"
          }
        );

        res.end(
          JSON.stringify({
            error:
              "Internal server error"
          })
        );
      }
    }
  );

/* =========================================================
   START SERVER
========================================================= */

server.listen(
  PORT,
  () => {

    console.log(
      "================================"
    );

    console.log(
      "HEXORA SEARCH ENGINE"
    );

    console.log(
      `HTTP server: ${PORT}`
    );

    console.log(
      "Search: /search?q=your-query"
    );

    console.log(
      "Health: /health"
    );

    console.log(
      "================================"
    );
  }
);

/* =========================================================
   CRAWLER WORKER
========================================================= */

async function startCrawler() {

  console.log(
    "HEXORA crawler worker started"
  );

  console.log(
    "HEXORA Smart Web Coverage enabled"
  );

  console.log(
    "Assam + India + News + Technology + Science + General Web"
  );

  while (true) {

    await crawlBatch();

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          CRAWL_INTERVAL_MS
        )
    );
  }
}

startCrawler().catch(
  error => {

    console.error(
      "[HEXORA] Crawler fatal error:",
      error
    );
  }
);
