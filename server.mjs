import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const Pool = pg.Pool;

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

const PORT = Number(process.env.PORT || 8080);
const DATABASE_URL = process.env.DATABASE_URL || "";

let pool = null;

if (DATABASE_URL) {
pool = new Pool({
connectionString: DATABASE_URL,
max: 5,
connectionTimeoutMillis: 10000,
idleTimeoutMillis: 30000
});

pool.on("error", function (error) {
console.error("[HEXORA] Database error:", error.message);
});
} else {
console.error("[HEXORA] DATABASE_URL is missing");
}

function sendJson(res, status, data) {
const body = JSON.stringify(data);

res.writeHead(status, {
"Content-Type": "application/json; charset=utf-8",
"Access-Control-Allow-Origin": "*",
"Cache-Control": "no-store"
});

res.end(body);
}

function getWords(text) {
return String(text || "")
.toLowerCase()
.normalize("NFKC")
.replace(/[^\p{L}\p{N}\s]/gu, " ")
.split(/\s+/)
.filter(Boolean)
.slice(0, 12);
}

function makeSnippet(content, words) {
const text = String(content || "")
.replace(/\s+/g, " ")
.trim();

if (!text) {
return "";
}

if (!words.length) {
return text.slice(0, 300);
}

const lower = text.toLowerCase();

let position = -1;

for (const word of words) {
const found = lower.indexOf(word);

```
if (found >= 0) {
  position = found;
  break;
}
```

}

if (position < 0) {
return text.slice(0, 300);
}

const start = Math.max(0, position - 100);
const end = Math.min(text.length, position + 250);

let result = text.slice(start, end);

if (start > 0) {
result = "... " + result;
}

if (end < text.length) {
result = result + " ...";
}

return result;
}

function calculateScore(row, words) {
const title = String(row.title || "").toLowerCase();
const description = String(row.description || "").toLowerCase();
const content = String(row.content || "").toLowerCase();
const url = String(row.url || "").toLowerCase();

let score = 0;

for (const word of words) {
if (title.includes(word)) {
score = score + 40;
}

```
if (description.includes(word)) {
  score = score + 20;
}

if (url.includes(word)) {
  score = score + 15;
}

if (content.includes(word)) {
  score = score + 5;
}
```

}

const fullQuery = words.join(" ");

if (fullQuery.length > 0 && title.includes(fullQuery)) {
score = score + 50;
}

if (
fullQuery.length > 0 &&
description.includes(fullQuery)
) {
score = score + 25;
}

if (fullQuery.length > 0 && url.includes(fullQuery)) {
score = score + 20;
}

return score;
}

async function searchDatabase(query) {
if (!pool) {
throw new Error("DATABASE_URL is missing");
}

const words = getWords(query);

if (!words.length) {
return [];
}

const conditions = [];
const values = [];

for (let i = 0; i < words.length; i = i + 1) {
const parameter = i + 1;
const value = "%" + words[i] + "%";

```
conditions.push(
  "(LOWER(COALESCE(title,'')) LIKE $" +
    parameter +
    " OR LOWER(COALESCE(description,'')) LIKE $" +
    parameter +
    " OR LOWER(COALESCE(content,'')) LIKE $" +
    parameter +
    " OR LOWER(COALESCE(url,'')) LIKE $" +
    parameter +
    ")"
);

values.push(value);
```

}

const limitParameter = words.length + 1;

const sql =
"SELEC
