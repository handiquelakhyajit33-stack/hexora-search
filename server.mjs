```javascript
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

// ============================================================
// REGEX-SAFE ESCAPER
// ============================================================
// IMPORTANT:
// Do NOT replace this with the old regex version.
// The old version caused Railway syntax error near ${}.
// ============================================================

function escapeRegex(text) {
  const input = String(text);
  let output = "";

  for (const ch of input) {
    if (
      ch === "." ||
      ch === "*" ||
      ch === "+" ||
      ch === "?" ||
      ch === "^" ||
      ch === "$" ||
      ch === "{" ||
      ch === "}" ||
      ch === "(" ||
      ch === ")" ||
      ch === "|" ||
      ch === "[" ||
      ch === "]" ||
      ch === "\\"
    ) {
      output += "\\" + ch;
    } else {
      output += ch;
    }
  }

  return output;
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

  return normalizeText(text).includes(
    normalizeText(phrase)
  );
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

function calculateProximityScore(
  query,
  title,
  description,
  content
) {
  const qTokens = queryTerms(query);

  if (!qTokens.length) return 0;

  const titleText = normalizeText(title);
  const descText = normalizeText(description);
  const contentText = normalizeText(content);

  let score = 0;

  if (
    qTokens.every((word) =>
      titleText.includes(word)
    )
  ) {
    score += 35;
  }

  if (
    qTokens.every((word) =>
      descText.includes(word)
    )
  ) {
    score += 20;
  }

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
  const authority = Number(
    row.authority_score || 0
  );

  if (!Number.isFinite(authority)) {
    return 0;
  }

  return Math.min(
    20,
    Math.max(0, authority)
  );
}

function calculateFreshnessBonus(row) {
  const date =
    row.published_at ||
    row.updated_at ||
    row.last_crawled_at;

  if (!date) return 0;

  const time = new Date(date).getTime();

  if (!Number.isFinite(time)) {
    return 0;
  }

  const ageDays =
    (Date.now() - time) /
    (1000 * 60 * 60 * 24);

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
  const description = String(
    row.description || ""
  );
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
    } else if (
      hasWholeWord(descText, word)
    ) {
      score += 30;
      found = true;
    } else if (
      hasWholeWord(urlText, word)
    ) {
      score += 12;
      found = true;
    } else if (
      hasWholeWord(contentText, word)
    ) {
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
    const titleCount =
      countWholeWordOccurrences(
        title,
        word
      );

    const descCount =
      countWholeWordOccurrences(
        description,
        word
      );

    const contentCount =
      countWholeWordOccurrences(
        content,
        word
      );

    score += Math.min(
      titleCount * 12,
      36
    );

    score += Math.min(
      descCount * 5,
      15
    );

    score += Math.min(
      contentCount * 1,
      8
    );
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

function isRelevantResult(
  row,
  query,
  score
) {
  const qTokens = queryTerms(query);

  const title = normalizeText(
    row.title
  );

  const description = normalizeText(
    row.description
  );

  const content = normalizeText(
    row.content
  );

  const url = normalizeText(
    row.url
  );

  if (!qTokens.length) {
    return false;
  }

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

  if (
    qTokens.length >= 2 &&
    coverage < 0.5
  ) {
    return false;
  }

  if (qTokens.length === 1) {
    const word = qTokens[0];

    const inTitle =
      hasWholeWord(title, word);

    const inDescription =
      hasWholeWord(
        description,
        word
      );

    const inUrl =
      hasWholeWord(url, word);

    const inContent =
      hasWholeWord(
        content,
        word
      );

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
    throw new Error(
      "Supabase is not configured"
    );
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

  const words = queryTerms(q);

  if (!words.length) {
    return {
      ok: true,
      mode: "web",
      query: q,
      total: 0,
      page: pageNumber,
      limit,
      sponsored: [],
      results: []
    };
  }

  // ==========================================================
  // HEXORA MULTILINGUAL SEARCH
  // ==========================================================

  const selectFields = `
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
  `;

  const safeWords = words
    .slice(0, 8)
    .map((word) =>
      word
        .replace(/[%_]/g, "")
        .replace(/[,()]/g, " ")
        .trim()
    )
    .filter(Boolean);

  const rowsByKey = new Map();

  function addRows(data) {
    if (!Array.isArray(data)) {
      return;
    }

    for (const row of data) {
      const key =
        String(
          row.url || ""
        )
          .toLowerCase()
          .trim() ||
        String(row.id || "");

      if (
        key &&
        !rowsByKey.has(key)
      ) {
        rowsByKey.set(
          key,
          row
        );
      }
    }
  }

  async function searchColumn(
    column,
    limitPerTerm = 300
  ) {
    for (const word of safeWords) {
      try {
        const {
          data,
          error
        } = await supabase
          .from("pages")
          .select(selectFields)
          .ilike(
            column,
            `%${word}%`
          )
          .limit(
            limitPerTerm
          );

        if (error) {
          console.log(
            `[HEXORA] ${column} search error:`,
            error.message
          );

          continue;
        }

        addRows(data);
      } catch (error) {
        console.log(
          `[HEXORA] ${column} search exception:`,
          error?.message ||
            error
        );
      }
    }
  }

  await Promise.all([
    searchColumn(
      "title",
      500
    ),
    searchColumn(
      "description",
      300
    ),
    searchColumn(
      "url",
      300
    )
  ]);

  await searchColumn(
    "content",
    500
  );

  // ==========================================================
  // OPTIONAL FULL-TEXT SEARCH
  // ==========================================================

  try {
    const {
      data,
      error
    } = await supabase
      .from("pages")
      .select(selectFields)
      .textSearch(
        "search_vector",
        q,
        {
          type: "websearch",
          config: "simple"
        }
      )
      .limit(500);

    if (!error) {
      addRows(data);
    } else {
      console.log(
        "[HEXORA] Optional full-text search skipped:",
        error.message
      );
    }
  } catch (error) {
    console.log(
      "[HEXORA] Optional full-text search unavailable:",
      error?.message ||
        error
    );
  }

  // ==========================================================
  // SCORE + FILTER
  // ==========================================================

  const ranked = [];

  for (const row of rowsByKey.values()) {
    const score =
      calculateScore(
        row,
        q
      );

    if (
      !isRelevantResult(
        row,
        q,
        score
      )
    ) {
      continue;
    }

    let matchedWords = 0;

    const allText =
      normalizeText(
        `${row.title || ""} ${
          row.description || ""
        } ${row.url || ""} ${
          row.content || ""
        }`
      );

    for (const word of words) {
      if (
        allText.includes(
          normalizeText(word)
        )
      ) {
        matchedWords++;
      }
    }

    ranked.push({
      ...row,
      score,
      matched_words:
        matchedWords,
      coverage: words.length
        ? Number(
            (
              matchedWords /
              words.length
            ).toFixed(2)
          )
        : 0
    });
  }

  // ==========================================================
  // SORT
  // ==========================================================

  ranked.sort((a, b) => {
    if (
      b.score !== a.score
    ) {
      return (
        b.score -
        a.score
      );
    }

    const at =
      normalizeText(
        a.title
      );

    const bt =
      normalizeText(
        b.title
      );

    const nq =
      normalizeText(q);

    const aTitle =
      at.includes(nq)
        ? 1
        : 0;

    const bTitle =
      bt.includes(nq)
        ? 1
        : 0;

    if (
      bTitle !== aTitle
    ) {
      return (
        bTitle -
        aTitle
      );
    }

    const ad =
      new Date(
        a.published_at ||
          a.updated_at ||
          a.last_crawled_at ||
          0
      ).getTime();

    const bd =
      new Date(
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

  const total =
    ranked.length;

  const start =
    (pageNumber - 1) *
    limit;

  const results =
    ranked.slice(
      start,
      start + limit
    );

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

function calculateImageScore(
  row,
  query
) {
  const q =
    normalizeText(query);

  const title =
    normalizeText(
      row.title
    );

  const alt =
    normalizeText(
      row.alt_text
    );

  const page =
    normalizeText(
      row.page_url
    );

  const image =
    normalizeText(
      row.image_url
    );

  const domain =
    normalizeText(
      row.source_domain
    );

  let score = 0;

  if (title === q) {
    score += 200;
  }

  if (title.includes(q)) {
    score += 100;
  }

  if (alt.includes(q)) {
    score += 70;
  }

  if (page.includes(q)) {
    score += 25;
  }

  if (image.includes(q)) {
    score += 15;
  }

  if (domain.includes(q)) {
    score += 10;
  }

  for (
    const word of queryTerms(q)
  ) {
    if (
      title.includes(word)
    ) {
      score += 20;
    }

    if (
      alt.includes(word)
    ) {
      score += 10;
    }
  }

  return score;
}

async function searchImages(
  query,
  pageNumber = 1,
  limit = 20
) {
  if (!supabase) {
    throw new Error(
      "Supabase is not configured"
    );
  }

  const q =
    cleanQuery(query);

  const {
    data,
    error
  } = await supabase
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

  const rows =
    Array.isArray(data)
      ? data
      : [];

  const ranked =
    rows
      .map((row) => ({
        ...row,
        score:
          calculateImageScore(
            row,
            q
          )
      }))
      .filter(
        (row) =>
          row.score > 0
      )
      .sort(
        (a, b) =>
          b.score -
          a.score
      );

  const total =
    ranked.length;

  const start =
    (pageNumber - 1) *
    limit;

  return {
    ok: true,
    mode: "images",
    query: q,
    total,
    page: pageNumber,
    limit,
    results:
      ranked.slice(
        start,
        start + limit
      )
  };
}

// ============================================================
// VIDEO SEARCH
// ============================================================

function calculateVideoScore(
  row,
  query
) {
  const q =
    normalizeText(query);

  const title =
    normalizeText(
      row.title
    );

  const description =
    normalizeText(
      row.description
    );

  const url =
    normalizeText(
      row.video_url ||
        row.url
    );

  let score = 0;

  if (title === q) {
    score += 250;
  }

  if (title.includes(q)) {
    score += 120;
  }

  if (
    description.includes(q)
  ) {
    score += 50;
  }

  if (url.includes(q)) {
    score += 20;
  }

  for (
    const word of queryTerms(q)
  ) {
    if (
      title.includes(word)
    ) {
      score += 25;
    }

    if (
      description.includes(word)
    ) {
      score += 8;
    }
  }

  return score;
}

async function searchVideos(
  query,
  pageNumber = 1,
  limit = 20
) {
  if (!supabase) {
    throw new Error(
      "Supabase is not configured"
    );
  }

  const q =
    cleanQuery(query);

  const {
    data,
    error
  } = await supabase
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

  const rows =
    Array.isArray(data)
      ? data
      : [];

  const ranked =
    rows
      .map((row) => ({
        ...row,
        score:
          calculateVideoScore(
            row,
            q
          )
      }))
      .filter(
        (row) =>
          row.score > 0
      )
      .sort(
        (a, b) =>
          b.score -
          a.score
      );

  const total =
    ranked.length;

  const start =
    (pageNumber -
```
