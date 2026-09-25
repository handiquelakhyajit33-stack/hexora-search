import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);

const SUPABASE_URL = process.env.SUPABASE_URL;

const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    "Missing SUPABASE_URL or Supabase key"
  );
}

const supabase = createClient(
  SUPABASE_URL || "",
  SUPABASE_KEY || ""
);

/* =======================================================
   BASIC HELPERS
======================================================= */

function cleanQuery(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  return normalizeText(value)
    .split(" ")
    .map(x => x.trim())
    .filter(Boolean);
}

function uniqueTokens(value) {
  return [...new Set(tokenize(value))];
}

function countWholeWordOccurrences(text, word) {
  const source = normalizeText(text);
  const target = normalizeText(word);

  if (!source || !target) return 0;

  return source
    .split(" ")
    .filter(part => part === target)
    .length;
}

function hasWholeWord(text, word) {
  return countWholeWordOccurrences(text, word) > 0;
}

function hasExactPhrase(text, phrase) {
  const source = normalizeText(text);
  const target = normalizeText(phrase);

  if (!source || !target) return false;

  return source.includes(target);
}

function detectMode(mode) {
  const value =
    String(mode || "web").toLowerCase();

  const allowed = [
    "web",
    "images",
    "news
