import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 8080);
const DATABASE_URL = process.env.DATABASE_URL || "";

if (!DATABASE_URL) {
console.error("[HEXORA] ERROR: DATABASE_URL is missing");
}

const pool = DATABASE_URL
? new Pool({
connectionString: DATABASE_URL,
max: 5,
idleTimeoutMillis: 30000,
connectionTimeoutMillis: 10000
})
: null;

pool?.on("error", function (err) {
console.error("[HEXORA] PostgreSQL pool error:", err.message);
});

function sendJSON(res, status, data) {
const body = JSON.stringify(data);

res.writeHead(status, {
"Content-Type": "application/json; charset=utf-8",
"Cache-Control": "no-store",
"Access-Control-Allow-Origin": "*"
});

res.end(body);
}

function sendHTML(res, html) {
res.writeHead(200, {
"Content-Type": "text/html; charset=utf-8",
"Cache-Control": "no-cache"
});

res.end(html);
}

function sendText(res, status, text) {
res.writeHead(status, {
"Content-Type": "text/plain; charset=utf-8"
});

res.end(text);
}

function tokenize(value) {
return String(value || "")
.toLowerCase()
.normalize("NFKC")
.replace(/[^\p{L}\p{N}\s._-]/gu, " ")
.split(/\s+/)
.map(function (x) {
return x.trim();
})
.filter(function (x) {
return x.length > 0;
})
.slice(0, 20);
}

function makeSearchPattern(term) {
return "%" + term + "%";
}

function calculateScore(row, terms) {
const title = String(row.title || "").toLowerCase();
const description = String(row.description || "").toLowerCase();
const content = String(row.content || "").toLowerCase();
const url = String(row.url || "").toLowerCase();

let score = 0;

for (const term of terms) {
if (!term) continue;

```
if (title.includes(term)) {
  score += 30;
}

if (description.includes(term)) {
  score += 15;
}

if (url.includes(term)) {
  score += 10;
}

if (content.includes(term)) {
  score += 3;
}
```

}

if (terms.length > 0) {
const joined = terms.join(" ");

```
if (title.includes(joined)) {
  score += 35;
}

if (description.includes(joined)) {
  score += 20;
}

if (url.includes(joined)) {
  score += 15;
}
```

}

return score;
}

function makeSnippet(content, terms) {
const text = String(content || "")
.replace(/\s+/g, " ")
.trim();

if (!text) {
return "";
}

if (!terms.length) {
return text.slice(0, 300);
}

const lower = text.toLowerCase();

let position = -1;

for (const term of terms) {
const found = lower.indexOf(term.toLowerCase());

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

const start = Math.max(0, position - 120);
const end = Math.min(text.length, position + 220);

let snippet = text.slice(start, end);

if (start > 0) {
snippet = "... " + snippet;
}

if (end < text.length) {
snippet += " ...";
}

return snippet;
}

function getContentType(filePath) {
const ext = path.extname(filePath).toLowerCase();

const types = {
".html": "text/html; charset=utf-8",
".htm": "text/html; charset=utf-8",
".css": "text/css; charset=utf-8",
".js": "application/javascript; charset=utf-8",
".json": "application/json; charset=utf-8",
".svg": "image/svg+xml",
".png": "image/png",
".jpg": "image/jpeg",
".jpeg": "image/jpeg",
".webp": "image/webp",
".ico": "image/x-icon",
".txt": "text/plain; charset=utf-8"
};

return types[ext] || "application/octet-stream";
}

function safeFilePath(requestPath) {
let decoded;

try {
decoded = decodeURIComponent(requestPath);
} catch {
return null;
}

if (!decoded || decoded.includes("\0")) {
return null;
}

const cleanPath = decoded === "/" ? "/index.html" : decoded;

const filePath = path.resolve(
__dirname,
"." + cleanPath
);

const root = path.resolve(__dirname);

if (filePath !== root && !filePath.startsWith(root + path.sep)) {
return null;
}

return filePath;
}

async function databaseHealth() {
if (!pool) {
return {
connected: false,
error: "DATABASE_URL is missing"
};
}

try {
const result = await pool.query("SELECT NOW() AS now");

```
return {
  connected: true,
  time: result.rows[0].now
};
```

} catch (error) {
return {
connected: false,
error: error.message
};
}
}

async function searchDatabase(query, mode) {
if (!pool) {
throw new Error("DATABASE_URL is missing");
}

const terms = tokenize(query);

if (!terms.length) {
return [];
}

const conditions = [];
const values = [];

let parameter = 1;

for (const term of terms) {
const pattern = makeSearchPattern(term);

```
conditions.push(
  "(LOWER(COALESCE(title, '')) LIKE $" +
    parameter +
    " OR LOWER(COALESCE(description, '')) LIKE $" +
    parameter +
    " OR LOWER(COALESCE(content, '')) LIKE $" +
    parameter +
    " OR LOWER(COALESCE(url, '')) LIKE $" +
    parameter +
    ")"
);

values.push(pattern);
parameter += 1;
```

}

const whereClause = conditions.join(" AND ");

let sql =
"SELECT * FROM pages WHERE " +
whereClause +
" ORDER BY updated_at DESC NULLS LAST LIMIT $" +
parameter;

values.push(100);

const result = await pool.query(sql, values);

let rows = result.rows.map(function (row) {
return {
...row,
_score: calculateScore(row, terms)
};
});

rows.sort(function (a, b) {
if (b._score !== a._score) {
return b._score - a._score;
}

```
const aDate = new Date(a.updated_at || 0).getTime();
const bDate = new Date(b.updated_at || 0).getTime();

return bDate - aDate;
```

});

rows = rows.slice(0, 20);

return rows.map(function (row) {
return {
title: row.title || row.url || "Untitled",
url: row.url || "",
description:
row.description ||
