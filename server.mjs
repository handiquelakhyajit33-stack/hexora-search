import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const Pool = pg.Pool;

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

function getTokens(text) {
const value = String(text || "");

return value
.toLowerCase()
.normalize("NFKC")
.replace(/[^\p{L}\p{N}\s]/gu, " ")
.split(/\s+/)
.filter(Boolean)
.slice(0, 12);
}

function makePattern(word) {
return "%" + word + "%";
}

function calculateScore(row, words) {
const title = String(row.title || "").toLowerCase();
const description = String(row.description || "").toLowerCase();
const content = String(row.content || "").toLowerCase();
const url = String(row.url || "").toLowerCase();

let score = 0;

for (const word of words) {
if (title.includes(word)) {
score += 40;
}

```
if (description.includes(word)) {
  score += 20;
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

if (fullQuery.length > 0 && title.includes(fullQuery)) {
score += 50;
}

if (fullQuery.length > 0 && description.includes(fullQuery)) {
score += 25;
}

if (fullQuery.length > 0 && url.includes(fullQuery)) {
score += 20;
}

return score;
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

async function runSearch(query) {
if (!pool) {
throw new Error("DATABASE_URL is missing");
}

const words = getTokens(query);

if (!words.length) {
return [];
}

const conditions = [];
const values = [];

for (let i = 0; i < words.length; i++) {
const parameter = i + 1;
const pattern = makePattern(words[i]);

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

values.push(pattern);
```

}

const limitParameter = words.length + 1;

const sql =
"SELECT * FROM pages WHERE " +
conditions.join(" AND ") +
" ORDER BY updated_at DESC NULLS LAST LIMIT $" +
limitParameter;

values.push(100);

const result = await pool.query(sql, values);

const scored = [];

for (const row of result.rows) {
scored.push({
row: row,
score: calculateScore(row, words)
});
}

scored.sort(function (a, b) {
if (b.score !== a.score) {
return b.score - a.score;
}

```
const firstDate = new Date(
  a.row.updated_at || 0
).getTime();

const secondDate = new Date(
  b.row.updated_at || 0
).getTime();

return secondDate - firstDate;
```

});

return scored.slice(0, 20).map(function (item) {
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
  word_count: row.word_count || 0,
  updated_at: row.updated_at || null,
  score: item.score
};
```

});
}

function getContentType(file) {
const extension = path.extname(file).toLowerCase();

if (extension === ".html" || extension === ".htm") {
return "text/html; charset=utf-8";
}

if (extension === ".css") {
return "text/css; charset=utf-8";
}

if (extension === ".js") {
return "application/javascript; charset=utf-8";
}

if (extension === ".json") {
return "application/json; charset=utf-8";
}

if (extension === ".svg") {
return "image/svg+xml";
}

if (extension === ".png") {
return "image/png";
}

if (extension === ".jpg" || extension === ".jpeg") {
return "image/jpeg";
}

if (extension === ".webp") {
return "image/webp";
}

if (extension === ".ico") {
return "image/x-icon";
}

return "application/octet-stream";
}

function serveFile(res, requestPath) {
let decodedPath;

try {
decodedPath = decodeURIComponent(requestPath);
} catch (error) {
sendJson(res, 400, {
success: false,
error: "Invalid path"
});

```
return;
```

}

if (decodedPath.indexOf("\0") >= 0) {
sendJson(res, 400, {
success: false,
error: "Invalid path"
});

```
return;
```

}

let relativePath = decodedPath;

if (relativePath === "/") {
relativePath = "/index.html";
}

const root = path.resolve(__dirname);
const filePath = path.resolve(
__dirname,
"." + relativePath
);

if (
filePath !== root &&
!filePath.startsWith(root + path.sep)
) {
sendJson(res, 403, {
success: false,
error: "Forbidden"
});

```
return;
```

}

if (
!fs.existsSync(filePath) ||
!fs.statSync(filePath).isFile()
) {
const indexFile = path.join(
__dirname,
"index.html"
);

```
if (fs.existsSync(indexFile)) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache"
  });

  fs.createReadStream(indexFile).pipe(res);

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
"Cache-Control":
relativePath === "/index.html"
? "no-cache"
: "public, max-age=3600"
});

fs.createReadStream(filePath).pipe(res);
}

async function requestHandler(req, res) {
try {
const requestUrl = new URL(
req.url || "/",
"http://" + (req.headers.host || "localhost")
);

```
const pathname = requestUrl.pathname;

if (req.method === "OPTIONS") {
  res.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });

  res.end();

  return;
}

if (
  pathname === "/health" ||
  pathname === "/api/health"
) {
  let databaseStatus = "not connected";

  if (pool) {
    try {
      await pool.query("SELECT 1");
      databaseStatus = "connected";
    } catch (error) {
      databaseStatus =
        "error: " + error.message;
    }
  } else {
    databaseStatus = "DATABASE_URL missing";
  }

  sendJson(res, 200, {
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
}

if (
  pathname === "/search" ||
  pathname === "/api/search"
) {
  const query =
    requestUrl.searchParams.get("q") ||
    requestUrl.searchParams.get("query") ||
    "";

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
    const results = await runSearch(query);

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
    const results = await runSearch(query);

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
}

serveFile(res, pathname);
```

} catch (error) {
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
```

}
}

const server = http.createServer(
requestHandler
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
console.log(
"======================================"
);

```
console.log(
  "       HEXORA SEARCH ENGINE"
);

console.log(
  "======================================"
);

console.log(
  "[HEXORA] HTTP server: " + PORT
);

console.log(
  "[HEXORA] Database: Neon PostgreSQL"
);

console.log(
  "[HEXORA] Supabase search: disabled"
);

console.log(
  "[HEXORA] R2: crawler storage only"
);

console.log(
  "[HEXORA] Existing UI: enabled"
);

console.log(
  "======================================"
);
```

}
);
