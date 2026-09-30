```js
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

  if (
    qTokens.every((word) => titleText.includes(word))
  ) {
    score += 35;
  }

  if (
    qTokens.every((word) => descText.includ
```
