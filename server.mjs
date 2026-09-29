// ============================================================
// HEXORA SEARCH ENGINE - SERVER
// ============================================================

import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

// ============================================================
// CONFIG
// ============================================================

const PORT = Number(process.env.PORT || 8080);

const SUPABASE_URL = process.env.SUPABASE_URL;

const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_KEY;

if (!SUPABASE_URL) {
  console.error("[HEXORA] SUPABASE_URL is missing");
}

if (!SUPABASE_KEY) {
  console.error("[HEXORA] SUPABASE key is missing");
}

const supabase =
  SUPABASE_URL && SUPABASE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_KEY)
    : null;

// ============================================================
// PATH
// ============================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// BASIC HELPERS
// ============================================================

function cleanQuery(value) {
  if (!value) return "";

  return String(value)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text) {
  return normalizeText(text)
    .split(/\s+/)
    .filter(Boolean);
}

function uniqueTokens(tokens) {
  return [...new Set(tokens)];
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasWholeWord(text, word) {
  if (!text || !word) return false;

  const regex = new RegExp(
    `(^|\\s)${escapeRegex(word)}(?=\\s|$)`,
    "i"
  );

  return regex.test(normalizeText(text));
}

function hasExactPhrase(text, phrase) {
  if (!text || !phrase) return false;

  return normalizeText(text).includes(normalizeText(phrase));
}

function countWholeWordOccurrences(text, word) {
  if (!text || !word) return 0;

  const normalized = normalizeText(text);
  const target = normalizeText(word);

  if (!target) return 0;

  const regex = new RegExp(
    `(^|\\s)${escapeRegex(target)}(?=\\s|$)`,
    "gi"
  );

  const matches = normalized.match(regex);

  return matches ? matches.length : 0;
}

// ============================================================
// SEARCH MODE
// ============================================================

function detectMode(query) {
  const q = normalizeText(query);

  if (
    q.startsWith("news ") ||
    q.endsWith(" news") ||
    q === "news"
  ) {
    return "news";
  }

  if (
    q.startsWith("image ") ||
    q.startsWith("images ") ||
    q.endsWith(" images")
  ) {
    return "images";
  }

  if (
    q.startsWith("video ") ||
    q.startsWith("videos ") ||
    q.endsWith(" videos")
  ) {
    return "videos";
  }

  if (
    q.startsWith("map ") ||
    q.startsWith("maps ") ||
    q.endsWith(" map")
  ) {
    return "maps";
  }

  return "web";
}

// ============================================================
// QUERY QUALITY
// ============================================================

function isShortQuery(query) {
  const tokens = uniqueTokens(tokenize(query));

  return tokens.length <= 2;
}

function queryTerms(query) {
  return uniqueTokens(
    tokenize(query).filter((word) => word.length >= 2)
  );
}

// ============================================================
// WEB SEARCH SCORING
// ============================================================

function calculateProximityScore(query, title, description, content) {
  const qTokens = queryTerms(query);

  if (!qTokens.length) return 0;

  const titleText = normalizeText(title);
  const descText = normalizeText(description);
  const contentText = normalizeText(content);

  let score = 0;

  // All query words close together in title
  if (
    qTokens.every((word) => titleText.includes(word))
  ) {
    score += 35;
  }

  // All query words in description
  if (
    qTokens.every((word) => descText.includes(word))
  ) {
    score += 20;
  }

  // Exact phrase
  if (qTokens.length > 1) {
    const phrase = qTokens.join(" ");

    if (titleText.includes(phrase)) {
      score += 45;
    }

    if (descText.includes(phrase)) {
      score += 25;
    }

    if (contentText.includes(phrase)) {
      score += 15;
    }
  }

  return score;
}

function calculateAuthorityBonus(row) {
  const authority = Number(row.authority_score || 0);

  if (!Number.isFinite(authority)) return 0;

  return Math.min(20, Math.max(0, authority));
}

function calculateFreshnessBonus(row) {
  const date =
    row.published_at ||
    row.updated_at ||
    row.last_crawled_at;

  if (!date) return 0;

  const time = new Date(date).getTime();

  if (!Number.isFinite(time)) return 0;

  const ageDays =
    (Date.now() - time) / (1000 * 60 * 60 * 24);

  if (ageDays <= 1) return 12;
  if (ageDays <= 7) return 10;
  if (ageDays <= 30) return 7;
  if (ageDays <= 90) return 4;
  if (ageDays <= 365) return 2;

  return 0;
}

// ============================================================
// IMPORTANT RELEVANCE FILTER
// ============================================================

function calculateScore(row, query) {
  const title = String(row.title || "");
  const description = String(row.description || "");
  const url = String(row.url || "");
  const content = String(row.content || "");

  const q = normalizeText(query);
  const qTokens = queryTerms(query);

  const titleText = normalizeText(title);
  const descText = normalizeText(description);
  const urlText = normalizeText(url);
  const contentText = normalizeText(content);

  if (!q || !qTokens.length) {
    return 0;
  }

  let score = 0;

  let matchedWords = 0;

  for (const word of qTokens) {
    let found = false;

    if (hasWholeWord(titleText, word)) {
      score += 60;
      found = true;
    } else if (hasWholeWord(descText, word)) {
      score += 30;
      found = true;
    } else if (hasWholeWord(urlText, word)) {
      score += 12;
      found = true;
    } else if (hasWholeWord(contentText, word)) {
      score += 4;
      found = true;
    }

    if (found) {
      matchedWords++;
    }
  }

  // ==========================================================
  // EXACT PHRASE
  // ==========================================================

  if (hasExactPhrase(titleText, q)) {
    score += 160;
  }

  if (hasExactPhrase(descText, q)) {
    score += 70;
  }

  if (hasExactPhrase(urlText, q)) {
    score += 35;
  }

  if (hasExactPhrase(contentText, q)) {
    score += 25;
  }

  // ==========================================================
  // TITLE MATCH
  // ==========================================================

  if (titleText === q) {
    score += 300;
  }

  if (titleText.startsWith(q)) {
    score += 100;
  }

  // ==========================================================
  // WORD COVERAGE
  // ==========================================================

  const coverage =
    qTokens.length > 0
      ? matchedWords / qTokens.length
      : 0;

  if (coverage === 1) {
    score += 40;
  }

  if (coverage >= 0.75) {
    score += 20;
  }

  // ==========================================================
  // PROXIMITY
  // ==========================================================

  score += calculateProximityScore(
    query,
    title,
    description,
    content
  );

  // ==========================================================
  // FREQUENCY
  // ==========================================================

  for (const word of qTokens) {
    const titleCount = countWholeWordOccurrences(
      title,
      word
    );

    const descCount = countWholeWordOccurrences(
      description,
      word
    );

    const contentCount = countWholeWordOccurrences(
      content,
      word
    );

    score += Math.min(titleCount * 12, 36);
    score += Math.min(descCount * 5, 15);
    score += Math.min(contentCount * 1, 8);
  }

  // ==========================================================
  // AUTHORITY + FRESHNESS
  // ==========================================================

  score += calculateAuthorityBonus(row);
  score += calculateFreshnessBonus(row);

  // ==========================================================
  // WEAK RESULT PENALTY
  // ==========================================================

  if (
    matchedWords === 1 &&
    qTokens.length > 1
  ) {
    score -= 60;
  }

  // Generic pages penalty
  const genericPatterns = [
    "encyclopedia index",
    "category:",
    "latest headlines",
    "news",
    "directory",
    "homepage",
    "home page",
    "tag:",
    "search results"
  ];

  const genericTitle = titleText;

  for (const pattern of genericPatterns) {
    if (
      genericTitle.includes(pattern) &&
      !genericTitle.includes(q)
    ) {
      score -= 25;
      break;
    }
  }

  return Math.round(score);
}

// ============================================================
// STRICT RELEVANCE CHECK
// ============================================================

function isRelevantResult(row, query, score) {
  const qTokens = queryTerms(query);

  const title = normalizeText(row.title);
  const description = normalizeText(row.description);
  const content = normalizeText(row.content);
  const url = normalizeText(row.url);

  if (!qTokens.length) return false;

  let matched = 0;

  for (const word of qTokens) {
    if (
      hasWholeWord(title, word) ||
      hasWholeWord(description, word) ||
      hasWholeWord(url, word) ||
      hasWholeWord(content, word)
    ) {
      matched++;
    }
  }

  const coverage =
    matched / qTokens.length;

  // Multi-word query must have reasonable coverage
  if (qTokens.length >= 2 && coverage < 0.5) {
    return false;
  }

  // Single-word query:
  // do not allow extremely weak content-only matches
  if (qTokens.length === 1) {
    const word = qTokens[0];

    const inTitle = hasWholeWord(title, word);
    const inDescription =
      hasWholeWord(description, word);
    const inUrl = hasWholeWord(url, word);
    const inContent =
      hasWholeWord(content, word);

    if (
      !inTitle &&
      !inDescription &&
      !inUrl &&
      (!inContent || score < 18)
    ) {
      return false;
    }
  }

  if (score < 15) {
    return false;
  }

  return true;
}

// ============================================================
// WEB SEARCH
// ============================================================

async function searchWeb(
  query,
  pageNumber = 1,
  limit = 20
) {
  if (!supabase) {
    throw new Error("Supabase is not configured");
  }

  const q = cleanQuery(query);

  if (!q) {
    return {
      ok: true,
      mode: "web",
      query: "",
      total: 0,
      page: pageNumber,
      limit,
      sponsored: [],
      results: []
    };
  }

  let rows = [];

  // ==========================================================
  // FIRST: DATABASE FULL TEXT SEARCH
  // ==========================================================

  try {
    const { data, error } = await supabase
      .from("pages")
      .select(`
        id,
        url,
        title,
        description,
        content,
        author,
        image_url,
        published_at,
        last_crawled_at,
        updated_at,
        authority_score,
        popularity_score
      `)
      .textSearch(
        "search_vector",
        q,
        {
          type: "websearch",
          config: "english"
        }
      )
      .limit(500);

    if (!error && Array.isArray(data)) {
      rows = data;
    }
  } catch (error) {
    console.log(
      "[HEXORA] Full text search unavailable:",
      error.message
    );
  }

  // ==========================================================
  // SECOND: FALLBACK ILIKE SEARCH
  // ==========================================================

  if (!rows.length) {
    const words = queryTerms(q);

    const orParts = [];

    for (const word of words.slice(0, 8)) {
      const safe = word
        .replace(/[%_]/g, "");

      if (!safe) continue;

      orParts.push(
        `title.ilike.%${safe}%`,
        `description.ilike.%${safe}%`,
        `url.ilike.%${safe}%`,
        `content.ilike.%${safe}%`
      );
    }

    if (orParts.length) {
      try {
        const { data, error } = await supabase
          .from("pages")
          .select(`
            id,
            url,
            title,
            description,
            content,
            author,
            image_url,
            published_at,
            last_crawled_at,
            updated_at,
            authority_score,
            popularity_score
          `)
          .or(orParts.join(","))
          .limit(1000);

        if (!error && Array.isArray(data)) {
          rows = data;
        }
      } catch (error) {
        console.log(
          "[HEXORA] Fallback search error:",
          error.message
        );
      }
    }
  }

  // ==========================================================
  // DEDUPE
  // ==========================================================

  const unique = new Map();

  for (const row of rows) {
    const key =
      String(row.url || "").toLowerCase().trim() ||
      String(row.id);

    if (!unique.has(key)) {
      unique.set(key, row);
    }
  }

  // ==========================================================
  // SCORE + FILTER
  // ==========================================================

  const ranked = [];

  for (const row of unique.values()) {
    const score = calculateScore(row, q);

    if (!isRelevantResult(row, q, score)) {
      continue;
    }

    const qTokens = queryTerms(q);

    let matchedWords = 0;

    const allText = normalizeText(
      `${row.title || ""} ${row.description || ""} ${
        row.url || ""
      } ${row.content || ""}`
    );

    for (const word of qTokens) {
      if (hasWholeWord(allText, word)) {
        matchedWords++;
      }
    }

    ranked.push({
      ...row,
      score,
      matched_words: matchedWords,
      coverage:
        qTokens.length
          ? Number(
              (matchedWords / qTokens.length).toFixed(2)
            )
          : 0
    });
  }

  // ==========================================================
  // SORT
  // ==========================================================

  ranked.sort((a, b) => {
    // Score first
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    // Title match
    const at = normalizeText(a.title);
    const bt = normalizeText(b.title);
    const nq = normalizeText(q);

    const aTitle = at.includes(nq) ? 1 : 0;
    const bTitle = bt.includes(nq) ? 1 : 0;

    if (bTitle !== aTitle) {
      return bTitle - aTitle;
    }

    // Freshness
    const ad = new Date(
      a.published_at ||
      a.updated_at ||
      a.last_crawled_at ||
      0
    ).getTime();

    const bd = new Date(
      b.published_at ||
      b.updated_at ||
      b.last_crawled_at ||
      0
    ).getTime();

    return bd - ad;
  });

  // ==========================================================
  // PAGINATION
  // ==========================================================

  const total = ranked.length;

  const start =
    (pageNumber - 1) * limit;

  const results =
    ranked.slice(
      start,
      start + limit
    );

  // ==========================================================
  // CLEAN RESPONSE
  // ==========================================================

  return {
    ok: true,
    mode: "web",
    query: q,
    total,
    page: pageNumber,
    limit,
    sponsored: [],
    results
  };
}

// ============================================================
// IMAGE SEARCH
// ============================================================

function calculateImageScore(row, query) {
  const q = normalizeText(query);

  const title = normalizeText(row.title);
  const alt = normalizeText(row.alt_text);
  const page = normalizeText(row.page_url);
  const image = normalizeText(row.image_url);
  const domain = normalizeText(row.source_domain);

  let score = 0;

  if (title === q) score += 200;
  if (title.includes(q)) score += 100;
  if (alt.includes(q)) score += 70;
  if (page.includes(q)) score += 25;
  if (image.includes(q)) score += 15;
  if (domain.includes(q)) score += 10;

  for (const word of queryTerms(q)) {
    if (title.includes(word)) score += 20;
    if (alt.includes(word)) score += 10;
  }

  return score;
}

async function searchImages(
  query,
  pageNumber = 1,
  limit = 20
) {
  if (!supabase) {
    throw new Error("Supabase is not configured");
  }

  const q = cleanQuery(query);

  const { data, error } = await supabase
    .from("images")
    .select("*")
    .limit(1000);

  if (error) {
    return {
      ok: false,
      mode: "images",
      query: q,
      total: 0,
      results: [],
      error: error.message
    };
  }

  const rows = Array.isArray(data) ? data : [];

  const ranked = rows
    .map((row) => ({
      ...row,
      score: calculateImageScore(row, q)
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);

  const total = ranked.length;

  const start =
    (pageNumber - 1) * limit;

  return {
    ok: true,
    mode: "images",
    query: q,
    total,
    page: pageNumber,
    limit,
    results: ranked.slice(
      start,
      start + limit
    )
  };
}

// ============================================================
// VIDEO SEARCH
// ============================================================

function calculateVideoScore(row, query) {
  const q = normalizeText(query);

  const title = normalizeText(row.title);
  const description = normalizeText(row.description);
  const url = normalizeText(row.video_url || row.url);

  let score = 0;

  if (title === q) score += 250;
  if (title.includes(q)) score += 120;
  if (description.includes(q)) score += 50;
  if (url.includes(q)) score += 20;

  for (const word of queryTerms(q)) {
    if (title.includes(word)) score += 25;
    if (description.includes(word)) score += 8;
  }

  return score;
}

async function searchVideos(
  query,
  pageNumber = 1,
  limit = 20
) {
  if (!supabase) {
    throw new Error("Supabase is not configured");
  }

  const q = cleanQuery(query);

  const { data, error } = await supabase
    .from("videos")
    .select("*")
    .limit(1000);

  if (error) {
    return {
      ok: false,
      mode: "videos",
      query: q,
      total: 0,
      results: [],
      error: error.message
    };
  }

  const rows = Array.isArray(data) ? data : [];

  const ranked = rows
    .map((row) => ({
      ...row,
      score: calculateVideoScore(row, q)
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);

  const total = ranked.length;

  const start =
    (pageNumber - 1) * limit;

  return {
    ok: true,
    mode: "videos",
    query: q,
    total,
    page: pageNumber,
    limit,
    results: ranked.slice(
      start,
      start + limit
    )
  };
}

// ============================================================
// MAP / PLACES SEARCH
// ============================================================

function calculatePlaceScore(row, query) {
  const q = normalizeText(query);

  const name = normalizeText(
    row.name || row.title
  );

  const address = normalizeText(
    row.address
  );

  const city = normalizeText(
    row.city
  );

  const state = normalizeText(
    row.state
  );

  const country = normalizeText(
    row.country
  );

  let score = 0;

  if (name === q) score += 300;
  if (name.includes(q)) score += 150;
  if (address.includes(q)) score += 70;
  if (city.includes(q)) score += 40;
  if (state.includes(q)) score += 30;
  if (country.includes(q)) score += 20;

  return score;
}

async function searchMaps(
  query,
  pageNumber = 1,
  limit = 20
) {
  if (!supabase) {
    throw new Error("Supabase is not configured");
  }

  const q = cleanQuery(query);

  const { data, error } = await supabase
    .from("places")
    .select("*")
    .limit(1000);

  if (error) {
    return {
      ok: false,
      mode: "maps",
      query: q,
      total: 0,
      results: [],
      error: error.message
    };
  }

  const rows = Array.isArray(data) ? data : [];

  const ranked = rows
    .map((row) => ({
      ...row,
      score: calculatePlaceScore(row, q)
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);

  const total = ranked.length;

  const start =
    (pageNumber - 1) * limit;

  return {
    ok: true,
    mode: "maps",
    query: q,
    total,
    page: pageNumber,
    limit,
    results: ranked.slice(
      start,
      start + limit
    )
  };
}

// ============================================================
// NEWS SEARCH
// ============================================================

function calculateNewsScore(row, query) {
  const q = normalizeText(query);

  const title = normalizeText(row.title);
  const description = normalizeText(row.description);
  const content = normalizeText(row.content);
  const source = normalizeText(
    row.source || row.source_domain
  );

  let score = 0;

  if (title === q) score += 300;
  if (title.includes(q)) score += 160;
  if (description.includes(q)) score += 70;
  if (content.includes(q)) score += 25;
  if (source.includes(q)) score += 15;

  for (const word of queryTerms(q)) {
    if (title.includes(word)) score += 25;
    if (description.includes(word)) score += 10;
  }

  const published =
    row.published_at;

  if (published) {
    const ageDays =
      (Date.now() -
        new Date(published).getTime()) /
      (1000 * 60 * 60 * 24);

    if (ageDays <= 1) score += 30;
    else if (ageDays <= 7) score += 20;
    else if (ageDays <= 30) score += 10;
  }

  return score;
}

async function searchNews(
  query,
  pageNumber = 1,
  limit = 20
) {
  if (!supabase) {
    throw new Error("Supabase is not configured");
  }

  const q = cleanQuery(query);

  const { data, error } = await supabase
    .from("news")
    .select("*")
    .order("published_at", {
      ascending: false
    })
    .limit(500);

  if (error) {
    return {
      ok: false,
      mode: "news",
      query: q,
      total: 0,
      results: [],
      error: error.message
    };
  }

  const rows = Array.isArray(data) ? data : [];

  const ranked = rows
    .map((row) => ({
      ...row,
      score: calculateNewsScore(row, q)
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return (
        new Date(b.published_at || 0) -
        new Date(a.published_at || 0)
      );
    });

  const total = ranked.length;

  const start =
    (pageNumber - 1) * limit;

  return {
    ok: true,
    mode: "news",
    query: q,
    total,
    page: pageNumber,
    limit,
    results: ranked.slice(
      start,
      start + limit
    )
  };
}

// ============================================================
// HTTP RESPONSE
// ============================================================

function jsonResponse(
  res,
  status,
  data
) {
  const body = JSON.stringify(data);

  res.writeHead(status, {
    "Content-Type":
      "application/json; charset=utf-8",

    "Access-Control-Allow-Origin": "*",

    "Access-Control-Allow-Methods":
      "GET,POST,OPTIONS",

    "Access-Control-Allow-Headers":
      "Content-Type, Authorization",

    "Cache-Control":
      "no-store"
  });

  res.end(body);
}

// ============================================================
// STATIC FILE
// ============================================================

function sendFile(
  res,
  filePath
) {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const ext =
    path.extname(filePath)
      .toLowerCase();

  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon"
  };

  const contentType =
    contentTypes[ext] ||
    "application/octet-stream";

  res.writeHead(200, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*"
  });

  res.end(
    fs.readFileSync(filePath)
  );

  return true;
}

// ============================================================
// SERVER
// ============================================================

const server = http.createServer(
  async (req, res) => {
    try {
      // ======================================================
      // CORS
      // ======================================================

      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods":
            "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers":
            "Content-Type, Authorization"
        });

        res.end();
        return;
      }

      const requestUrl =
        new URL(
          req.url,
          `http://${req.headers.host || "localhost"}`
        );

      const pathname =
        requestUrl.pathname;

      // ======================================================
      // HEALTH
      // ======================================================

      if (
        pathname === "/health" ||
        pathname === "/api/health"
      ) {
        return jsonResponse(
          res,
          200,
          {
            status: "ok",
            engine: "HEXORA",
            crawler: "active",
            search: "active",
            timestamp:
              new Date().toISOString()
          }
        );
      }

      // ======================================================
      // SEARCH
      // ======================================================

      if (
        pathname === "/search" ||
        pathname === "/api/search"
      ) {
        const query =
          cleanQuery(
            requestUrl.searchParams.get("q") ||
            requestUrl.searchParams.get("query") ||
            ""
          );

        const requestedMode =
          requestUrl.searchParams.get(
            "mode"
          );

        const mode =
          requestedMode ||
          detectMode(query);

        const pageNumber = Math.max(
          1,
          Number(
            requestUrl.searchParams.get(
              "page"
            ) || 1
          )
        );

        const limit = Math.min(
          50,
          Math.max(
            1,
            Number(
              requestUrl.searchParams.get(
                "limit"
              ) || 20
            )
          )
        );

        if (!query) {
          return jsonResponse(
            res,
            400,
            {
              ok: false,
              error:
                "Search query is required"
            }
          );
        }

        let result;

        if (mode === "images") {
          result =
            await searchImages(
              query,
              pageNumber,
              limit
            );
        } else if (mode === "videos") {
          result =
            await searchVideos(
              query,
              pageNumber,
              limit
            );
        } else if (mode === "maps") {
          result =
            await searchMaps(
              query,
              pageNumber,
              limit
            );
        } else if (mode === "news") {
          result =
            await searchNews(
              query,
              pageNumber,
              limit
            );
        } else {
          result =
            await searchWeb(
              query,
              pageNumber,
              limit
            );
        }

        return jsonResponse(
          res,
          200,
          result
        );
      }

      // ======================================================
      // NEWS
      // ======================================================

      if (
        pathname === "/news" ||
        pathname === "/api/news"
      ) {
        const query =
          cleanQuery(
            requestUrl.searchParams.get(
              "q"
            ) || ""
          );

        if (!query) {
          return jsonResponse(
            res,
            400,
            {
              ok: false,
              error:
                "News query is required"
            }
          );
        }

        const result =
          await searchNews(
            query,
            1,
            20
          );

        return jsonResponse(
          res,
          200,
          result
        );
      }

      // ======================================================
      // STATIC FILES
      // ======================================================

      let requestedPath =
        decodeURIComponent(pathname);

      if (
        requestedPath === "/" ||
        requestedPath === ""
      ) {
        requestedPath = "/index.html";
      }

      // Prevent path traversal
      const safePath =
        path.normalize(
          path.join(
            __dirname,
            requestedPath
          )
        );

      if (
        !safePath.startsWith(
          path.normalize(__dirname)
        )
      ) {
        return jsonResponse(
          res,
          403,
          {
            ok: false,
            error: "Forbidden"
          }
        );
      }

      if (
        fs.existsSync(safePath) &&
        fs.statSync(safePath).isFile()
      ) {
        if (
          sendFile(
            res,
            safePath
          )
        ) {
          return;
        }
      }

      // ======================================================
      // SPA FALLBACK
      // ======================================================

      const indexPath =
        path.join(
          __dirname,
          "index.html"
        );

      if (
        fs.existsSync(indexPath)
      ) {
        sendFile(
          res,
          indexPath
        );
        return;
      }

      // ======================================================
      // 404
      // ======================================================

      return jsonResponse(
        res,
        404,
        {
          ok: false,
          error: "Not found"
        }
      );

    } catch (error) {
      console.error(
        "[HEXORA] Server error:",
        error
      );

      return jsonResponse(
        res,
        500,
        {
          ok: false,
          error:
            error?.message ||
            "Internal server error"
        }
      );
    }
  }
);

// ============================================================
// START
// ============================================================

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `[HEXORA] Search server running on http://0.0.0.0:${PORT}`
    );

    console.log(
      `[HEXORA] Search API: /search?q=tractor`
    );
  }
);

// ============================================================
// ERROR HANDLING
// ============================================================

process.on(
  "unhandledRejection",
  (error) => {
    console.error(
      "[HEXORA] Unhandled rejection:",
      error
    );
  }
);

process.on(
  "uncaughtException",
  (error) => {
    console.error(
      "[HEXORA] Uncaught exception:",
      error
    );
  }
);
