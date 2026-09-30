```javascript
// ============================================================
// HEXORA SEARCH ENGINE - SERVER
// Neon PostgreSQL search + existing HEXORA UI
// Supabase is NOT used by the search server.
// ============================================================

import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Pool } = pg;

// ============================================================
// CONFIG
// ============================================================

const PORT = Number(process.env.PORT || 8080);
const DATABASE_URL = process.env.DATABASE_URL || "";
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;
const MAX_QUERY_LENGTH = 300;

if (!DATABASE_URL) {
  console.error("[HEXORA] DATABASE_URL is missing");
}

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      max: Number(process.env.DB_POOL_MAX || 5),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: { rejectUnauthorized: false }
    })
  : null;

// ============================================================
// PATH
// ============================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// TEXT HELPERS
// ============================================================

function cleanQuery(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_QUERY_LENGTH);
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  const text = normalizeText(value);

  if (!text) {
    return [];
  }

  return text.split(" ").filter(Boolean);
}

function uniqueTokens(values) {
  return [...new Set(values)];
}

function countWord(text, word) {
  const target = normalizeText(word);

  if (!target) {
    return 0;
  }

  const tokens = tokenize(text);

  let count = 0;

  for (const token of tokens) {
    if (token === target) {
      count++;
    }
  }

  return count;
}

function hasWord(text, word) {
  return countWord(text, word) > 0;
}

function queryTerms(query) {
  return uniqueTokens(tokenize(query)).slice(0, 12);
}

function excerpt(text, query, maxLength = 260) {
  const source = String(text || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!source) {
    return "";
  }

  if (source.length <= maxLength) {
    return source;
  }

  const words = queryTerms(query);
  const lower = source.toLocaleLowerCase();

  let position = -1;

  for (const word of words) {
    const p = lower.indexOf(
      word.toLocaleLowerCase()
    );

    if (p >= 0) {
      position = p;
      break;
    }
  }

  if (position < 0) {
    return source.slice(0, maxLength) + "…";
  }

  const start = Math.max(
    0,
    position - 80
  );

  const end = Math.min(
    source.length,
    start + maxLength
  );

  const prefix =
    start > 0 ? "…" : "";

  const suffix =
    end < source.length ? "…" : "";

  return (
    prefix +
    source.slice(start, end).trim() +
    suffix
  );
}

function hostname(url) {
  try {
    return new URL(url)
      .hostname
      .replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function detectMode(query, requestedMode) {
  const mode = String(
    requestedMode || "web"
  ).toLowerCase();

  if (
    [
      "web",
      "images",
      "videos",
      "news",
      "maps"
    ].includes(mode)
  ) {
    return mode;
  }

  const q = String(query || "")
    .toLowerCase();

  if (
    /\b(news|latest|breaking)\b/.test(q)
  ) {
    return "news";
  }

  if (
    /\b(images?|photos?|pictures?)\b/.test(q)
  ) {
    return "images";
  }

  if (
    /\b(videos?|youtube)\b/.test(q)
  ) {
    return "videos";
  }

  if (
    /\b(map|maps|near me|nearby|location)\b/.test(q)
  ) {
    return "maps";
  }

  return "web";
}

// ============================================================
// SCORING
// ============================================================

function authorityBonus(url) {
  const host = hostname(url).toLowerCase();

  if (!host) {
    return 0;
  }

  const trusted = [
    ".gov",
    ".gov.in",
    ".edu",
    ".ac.in",
    ".nic.in",
    "wikipedia.org",
    "who.int",
    "un.org",
    "python.org",
    "w3.org",
    "mozilla.org"
  ];

  for (const item of trusted) {
    if (
      host.endsWith(item) ||
      host.includes(item)
    ) {
      return 18;
    }
  }

  return 0;
}

function freshnessBonus(row) {
  const date = new Date(
    row.updated_at ||
    row.last_crawled_at ||
    0
  ).getTime();

  if (!date) {
    return 0;
  }

  const ageDays = Math.max(
    0,
    (Date.now() - date) / 86400000
  );

  if (ageDays <= 1) {
    return 12;
  }

  if (ageDays <= 7) {
    return 8;
  }

  if (ageDays <= 30) {
    return 5;
  }

  if (ageDays <= 180) {
    return 2;
  }

  return 0;
}

function calculateScore(row, query) {
  const title = normalizeText(row.title);
  const description =
    normalizeText(row.description);

  const content =
    normalizeText(row.content);

  const url =
    normalizeText(row.url);

  const terms = queryTerms(query);

  if (!terms.length) {
    return 0;
  }

  let score = 0;
  let matched = 0;

  const normalizedQuery =
    normalizeText(query);

  const titleExact =
    title === normalizedQuery;

  const titleContains =
    title.includes(normalizedQuery);

  if (titleExact) {
    score += 100;
  } else if (titleContains) {
    score += 70;
  }

  for (const term of terms) {
    const inTitle =
      hasWord(title, term);

    const inDescription =
      hasWord(description, term);

    const inUrl =
      hasWord(url, term);

    const inContent =
      hasWord(content, term);

    if (
      inTitle ||
      inDescription ||
      inUrl ||
      inContent
    ) {
      matched++;
    }

    if (inTitle) {
      score += Math.min(
        countWord(title, term) * 18,
        45
      );
    }

    if (inDescription) {
      score += Math.min(
        countWord(description, term) * 7,
        14
      );
    }

    if (inUrl) {
      score += 5;
    }

    if (inContent) {
      score += Math.min(
        countWord(content, term) * 1.5,
        12
      );
    }
  }

  score +=
    (matched / terms.length) * 35;

  score += authorityBonus(row.url);

  score += freshnessBonus(row);

  if (title.lengt
```
