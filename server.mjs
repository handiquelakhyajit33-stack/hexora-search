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

let pool = null;

if (DATABASE_URL) {
pool = new Pool({
connectionString: DATABASE_URL,
max: 5,
connectionTimeoutMillis: 10000,
idleTimeoutMillis: 30000
});

pool.on("error", function (error) {
console.error("[HEXORA] PostgreSQL error:", error.message);
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
if (found !== -1) {
  position = found;
  break;
}
```

}

if (position === -1) {
return text.slice(0, 300);
}

const start = Math.max(0, position - 120);
const end = Math.min(text.length, position + 280);

let result = text.slice(start, end);

if (start > 0) {
result = "... " + result;
}

if (end < text.length) {
result = result + " ...";
}

return result;
}

function scoreResult(row, words) {
const title = String(row.title || "").toLowerCase();
const description = String(row.description || "").toLowerCase();
const content = String(row.content || "").toLowerCase();
const url = String(row.url || "").toLowerCase();

let score = 0;

for (const word of words) {
if (title.includes(word)) {
score += 50;
}

```
if (description.includes(word)) {
  score += 25;
}

if (url.includes(word)) {
  score += 15;
}

if (content.includes(word)) {
  score += 5;
}
```

}

const fullQuery = words.join(" ");

if (fullQuery && title.includes(fullQuery)) {
score += 100;
}

if (fullQuery && description.includes(fullQuery)) {
score += 40;
}

if (fullQuery && url.includes(fullQuery)) {
score += 25;
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

for (let i = 0; i < words.length; i += 1) {
const parameter = i + 1;
const value = "%" + words[i] + "%";

```
conditions.push(
  "(" +
    "LOWER(COALESCE(title,'')) LIKE $" +
    parameter +
    " OR " +
    "LOWER(COALESCE(description,'')) LIKE $" +
    parameter +
    " OR " +
    "LOWER(COALESCE(content,'')) LIKE $" +
    parameter +
    " OR " +
    "LOWER(COALESCE(url,'')) LIKE $" +
    parameter +
    ")"
);

values.push(value);
```

}

const limitParameter = words.length + 1;

const sql =
"SELECT * FROM pages " +
"WHERE " +
conditions.join(" AND ") +
" ORDER BY updated_at DESC NULLS LAST " +
"LIMIT $" +
limitParameter;

values.push(100);

const result = await pool.query(sql, values);

const ranked = result.rows.map(function (row) {
return {
row: row,
score: scoreResult(row, words)
};
});

ranked.sort(function (a, b) {
if (b.score !== a.score) {
return b.score - a.score;
}

```
const aTime = new Date(a.row.updated_at || 0).getTime();
const bTime = new Date(b.row.updated_at || 0).getTime();

return bTime - aTime;
```

});

return ranked.slice(0, 20).map(function (item) {
const row = item.row;

```
return {
  title: row.title || row.url || "Untitled",
  url: row.url || "",
  description:
    row.description ||
    makeSnippet(row.content, words),
  snippet: makeSnippet(row.content, words),
  language: row.language || "unknown",
  word_count: Number(row.word_count || 0),
  updated_at: row.updated_at || null,
  score: item.score
};
```

});
}

function getContentType(filePath) {
const ext = path.extname(filePath).toLowerCase();

if (ext === ".html" || ext === ".htm") {
return "text/html; charset=utf-8";
}

if (ext === ".css") {
return "text/css; charset=utf-8";
}

if (ext === ".js") {
return "application/javascript; charset=utf-8";
}

if (ext === ".json") {
return "application/json; charset=utf-8";
}

if (ext === ".svg") {
return "image/svg+xml";
}

if (ext === ".png") {
return "image/png";
}

if (ext === ".jpg" || ext === ".jpeg") {
return "image/jpeg";
}

if (ext === ".webp") {
return "image/webp";
}

if (ext === ".ico") {
return "image/x-icon";
}

return "application/octet-stream";
}

function serveFile(res, pathname) {
let decodedPath;

try {
decodedPath = decodeURIComponent(pathname);
} catch (error) {
sendJson(res, 400, {
success: false,
error: "Invalid path"
});
return;
}

if (decodedPath.includes("\0")) {
sendJson(res, 400, {
success: false,
error: "Invalid path"
});
return;
}

if (decodedPath === "/") {
decodedPath = "/index.html";
}

const root = path.resolve(__dirname);

const filePath = path.resolve(
__dirname,
"." + decodedPath
);

if (
filePath !== root &&
!filePath.startsWith(root + path.sep)
) {
sendJson(res, 403, {
success: false,
error: "Forbidden"
});
return;
}

if (
!fs.existsSync(filePath) ||
!fs.statSync(filePath).isFile()
) {
const fallback = path.join(__dirname, "index.html");

```
if (fs.existsSync(fallback)) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache"
  });

  fs.createReadStream(fallback).pipe(res);
  return;
}

sendJson(res, 404, {
  success: false,
  error: "HEXORA page not found"
});

return;
```

}

res.writeHead(200, {
"Content-Type": getContentType(filePath),
"Cache-Control": "no-cache"
});

fs.createReadStream(filePath).pipe(res);
}

async function handleRequest(req, res) {
const requestUrl = new URL(
req.url || "/",
"http://" + (req.headers.host || "localhost")
);

const pathname = requestUrl.pathname;

if (req.method === "OPTIONS") {
res.writeHead(204, {
"Access-Control-Allow-Origin": "*",
"Access-Control-Allow-Methods": "GET,OPTIONS",
"Access-Control-Allow-Headers": "Content-Type"
});

```
res.end();
return;
```

}

if (
pathname === "/health" ||
pathname === "/api/health"
) {
let databaseStatus = "missing";

```
if (pool) {
  try {
    await pool.query("SELECT 1");
    databaseStatus = "connected";
  } catch (error) {
    databaseStatus = "error: " + error.message;
  }
}

sendJson(res, 200, {
  success: true,
  status:
    databaseStatus === "connected"
      ? "ok"
      : "degraded",
  engine: "HEXORA",
  database: "Neon PostgreSQL",
  database_status: databaseStatus,
  supabase_search: false,
  r2_search: false
});

return;
```

}

if (
pathname === "/search" ||
pathname === "/api/search"
) {
const query =
requestUrl.searchParams.get("q") ||
requestUrl.searchParams.get("query") ||
"";

```
if (!query.trim()) {
  sendJson(res, 200, {
    success: true,
    query: "",
    total: 0,
    results: []
  });

  return;
}

try {
  const results = await searchDatabase(query);

  sendJson(res, 200, {
    success: true,
    query: query,
    total: results.length,
    results: results
  });
} catch (error) {
  console.error(
    "[HEXORA] Search error:",
    error.message
  );

  sendJson(res, 500, {
    success: false,
    query: query,
    total: 0,
    results: [],
    error: error.message
  });
}

return;
```

}

if (
pathname === "/news" ||
pathname === "/api/news" ||
pathname === "/images" ||
pathname === "/api/images" ||
pathname === "/videos" ||
pathname === "/api/videos" ||
pathname === "/maps" ||
pathname === "/api/maps"
) {
const query =
requestUrl.searchParams.get("q") ||
requestUrl.searchParams.get("query") ||
"";

```
if (!query.trim()) {
  sendJson(res, 200, {
    success: true,
    query: "",
    total: 0,
    results: []
  });

  return;
}

try {
  const results = await searchDatabase(query);

  sendJson(res, 200, {
    success: true,
    query: query,
    total: results.length,
    results: results
  });
} catch (error) {
  console.error(
    "[HEXORA] Tab search error:",
    error.message
  );

  sendJson(res, 500, {
    success: false,
    query: query,
    total: 0,
    results: [],
    error: error.message
  });
}

return;
```

}

serveFile(res, pathname);
}

const server = http.createServer(
function (req, res) {
handleRequest(req, res).catch(
function (error) {
console.error(
"[HEXORA] Request error:",
error.message
);

```
    if (!res.headersSent) {
      sendJson(res, 500, {
        success: false,
        error: "Internal server error"
      });
    } else {
      res.end();
    }
  }
);
```

}
);

server.on("error", function (error) {
console.error(
"[HEXORA] Server error:",
error.message
);
});

process.on(
"unhandledRejection",
function (error) {
console.error(
"[HEXORA] Unhandled rejection:",
error
);
}
);

process.on(
"uncaughtException",
function (error) {
console.error(
"[HEXORA] Uncaught exception:",
error
);
}
);

server.listen(
PORT,
"0.0.0.0",
function () {
console.log("======================================");
console.log("       HEXORA SEARCH ENGINE");
console.log("======================================");
console.log("[HEXORA] HTTP server: " + PORT);
console.log("[HEXORA] Database: Neon PostgreSQL");
console.log("[HEXORA] Supabase search: disabled");
console.log("[HEXORA] R2: crawler storage only");
console.log("[HEXORA] Existing UI: enabled");
console.log("======================================");
}
);
