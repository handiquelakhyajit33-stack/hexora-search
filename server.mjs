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

function json(res, status, data) {
const body = JSON.stringify(data);

res.writeHead(status, {
"Content-Type": "application/json; charset=utf-8",
"Access-Control-Allow-Origin": "*",
"Cache-Control": "no-store"
});

res.end(body);
}

function tokens(text) {
return String(text || "")
.toLowerCase()
.normalize("NFKC")
.replace(/[^\p{L}\p{N}\s]/gu, " ")
.split(/\s+/)
.filter(Boolean)
.slice(0, 12);
}

function pattern(term) {
return "%" + term + "%";
}

function score(row, words) {
const title = String(row.title || "").toLowerCase();
const description = String(row.description || "").toLowerCase();
const content = String(row.content || "").toLowerCase();
const url = String(row.url || "").toLowerCase();

let value = 0;

for (const word of words) {
if (title.includes(word)) value += 40;
if (description.includes(word)) value += 20;
if (url.includes(word)) value += 15;
if (content.includes(word)) value += 5;
}

const full = words.join(" ");

if (full && title.includes(full)) value += 50;
if (full && description.includes(full)) value += 25;
if (full && url.includes(full)) value += 20;

return value;
}

function snippet(content, words) {
const text = String(content || "").replace(/\s+/g, " ").trim();

if (!text) return "";

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

if (start > 0) result = "... " + result;
if (end < text.length) result += " ...";

return result;
}

async function search(query) {
if (!pool) {
throw new Error("DATABASE_URL is missing");
}

const words = tokens(query);

if (!words.length) {
return [];
}

const conditions = [];
const values = [];

for (let i = 0; i < words.length; i++) {
const n = i + 1;
const value = pattern(words[i]);

```
conditions.push(
  "(LOWER(COALESCE(title,'')) LIKE $" +
    n +
    " OR LOWER(COALESCE(description,'')) LIKE $" +
    n +
    " OR LOWER(COALESCE(content,'')) LIKE $" +
    n +
    " OR LOWER(COALESCE(url,'')) LIKE $" +
    n +
    ")"
);

values.push(value);
```

}

const limitNumber = words.length + 1;

const sql =
"SELECT * FROM pages WHERE " +
conditions.join(" AND ") +
" ORDER BY updated_at DESC NULLS LAST LIMIT $" +
limitNumber;

values.push(100);

const result = await pool.query(sql, values);

const rows = result.rows.map(function (row) {
return {
row: row,
score: score(row, words)
};
});

rows.sort(function (a, b) {
if (b.score !== a.score) {
return b.score - a.score;
}

```
return (
  new Date(b.row.updated_at || 0).getTime() -
  new Date(a.row.updated_at || 0).getTime()
);
```

});

return rows.slice(0, 20).map(function (item) {
const row = item.row;

```
return {
  title: row.title || row.url || "Untitled",
  url: row.url || "",
  description:
    row.description ||
    snippet(row.content, words),
  snippet: snippet(row.content, words),
  language: row.language || "unknown",
  word_count: row.word_count || 0,
  updated_at: row.updated_at || null,
  score: item.score
};
```

});
}

function contentType(file) {
const ext = path.extname(file).toLowerCase();

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

function serveFile(res, requestPath) {
let decoded;

try {
decoded = decodeURIComponent(requestPath);
} catch {
json(res, 400, {
success: false,
error: "Invalid path"
});

```
return;
```

}

if (decoded.includes("\0")) {
json(res, 400, {
success: false,
error: "Invalid path"
});

```
return;
```

}

let relative = decoded;

if (relative === "/") {
relative = "/index.html";
}

const file = path.resolve(__dirname, "." + relative);
const root = path.resolve(__dirname);

if (file !== root && !file.startsWith(root + path.sep)) {
json(res, 403, {
success: false,
error: "Forbidden"
});

```
return;
```

}

if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
const index = path.join(__dirname, "index.html");

```
if (fs.existsSync(index)) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache"
  });

  fs.createReadStream(index).pipe(res);
  return;
}

json(res, 404, {
  success: false,
  error: "HEXORA page not found"
});

return;
```

}

res.writeHead(200, {
"Content-Type": contentType(file),
"Cache-Control": relative === "/index.html"
? "no-cache"
: "public, max-age=3600"
});

fs.createReadStream(file).pipe(res);
}

async function requestHandler(req, res) {
try {
const url = new URL(
req.url || "/",
"http://" + (req.headers.host || "localhost")
);

```
const pathname = url.pathname;

if (req.method === "OPTIONS") {
  res.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });

  res.end();
  return;
}

if (pathname === "/health" || pathname === "/api/health") {
  let database = "not connected";

  if (pool) {
    try {
      await pool.query("SELECT 1");
      database = "connected";
    } catch (error) {
      database = "error: " + error.message;
    }
  } else {
    database = "DATABASE_URL missing";
  }

  json(res, 200, {
    status: database === "connected" ? "ok" : "degraded",
    engine: "HEXORA",
    database: "Neon PostgreSQL",
    database_status: database,
    supabase_search: false,
    r2_search: false
  });

  return;
}

if (pathname === "/search" || pathname === "/api/search") {
  const query =
    url.searchParams.get("q") ||
    url.searchParams.get("query") ||
    "";

  if (!query.trim()) {
    json(res, 200, {
      success: true,
      query: "",
      total: 0,
      results: []
    });

    return;
  }

  try {
    const results = await search(query);

    json(res, 200, {
      success: true,
      query: query,
      total: results.length,
      results: results
    });
  } catch (error) {
    console.error("[HEXORA] Search error:", error.message);

    json(res, 500, {
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
    url.searchParams.get("q") ||
    url.searchParams.get("query") ||
    "";

  try {
    const results = query.trim()
      ? await search(query)
      : [];

    json(res, 200, {
      success: true,
      query: query,
      total: results.length,
      results: results
    });
  } catch (error) {
    json(res, 500, {
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
console.error("[HEXORA] Request error:", error.message);

```
if (!res.headersSent) {
  json(res, 500, {
    success: false,
    error: "Internal server error"
  });
} else {
  res.end();
}
```

}
}

const server = http.createServer(requestHandler);

server.on("error", function (error) {
console.error("[HEXORA] Server error:", error.message);
});

process.on("unhandledRejection", function (error) {
console.error("[HEXORA] Unhandled rejection:", error);
});

process.on("uncaughtException", function (error) {
console.error("[HEXORA] Uncaught exception:", error);
});

server.listen(PORT, "0.0.0.0", function () {
console.log("======================================");
console.log("       HEXORA SEARCH ENGINE");
console.log("======================================");
console.log("[HEXORA] HTTP server: " + PORT);
console.log("[HEXORA] Database: Neon PostgreSQL");
console.log("[HEXORA] Supabase search: disabled");
console.log("[HEXORA] R2: crawler storage only");
console.log("[HEXORA] Existing UI: enabled");
console.log("======================================");
});
