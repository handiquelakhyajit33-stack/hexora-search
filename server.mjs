import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 8080);
const DATABASE_URL = process.env.DATABASE_URL || "";

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      max: Number(process.env.DB_POOL_MAX || 5),
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      ssl:
        DATABASE_URL.includes("neon.tech") ||
        DATABASE_URL.includes("neon.")
          ? { rejectUnauthorized: false }
          : undefined
    })
  : null;

if (!pool) {
  console.error("[HEXORA] DATABASE_URL is missing");
} else {
  pool.on("error", (error) => {
    console.error(
      "[HEXORA] PostgreSQL pool error:",
      error.message
    );
  });
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);

  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store"
  });

  res.end(body);
}

function getWords(query) {
  return String(query || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s.-]/gu, " ")
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

    if (found !== -1) {
      position = found;
      break;
    }
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
    result += " ...";
  }

  return result;
}

function scoreResult(row, words, query) {
  const title = String(row.title || "").toLowerCase();
  const description = String(
    row.description || ""
  ).toLowerCase();
  const content = String(
    row.content || ""
  ).toLowerCase();
  const url = String(row.url || "").toLowerCase();

  const fullQuery = String(query || "")
    .trim()
    .toLowerCase();

  let score = 0;

  for (const word of words) {
    if (title.includes(word)) {
      score += 60;
    }

    if (description.includes(word)) {
      score += 25;
    }

    if (url.includes(word)) {
      score += 12;
    }

    if (content.includes(word)) {
      score += 3;
    }
  }

  if (
    fullQuery &&
    title.includes(fullQuery)
  ) {
    score += 140;
  }

  if (
    fullQuery &&
    description.includes(fullQuery)
  ) {
    score += 45;
  }

  if (
    fullQuery &&
    url.includes(fullQuery)
  ) {
    score += 30;
  }

  return score;
}

async function searchDatabase(
  query,
  limit = 20
) {
  if (!pool) {
    throw new Error(
      "DATABASE_URL is missing"
    );
  }

  const words = getWords(query);

  if (!words.length) {
    return [];
  }

  const values = [];
  const conditions = [];

  for (let i = 0; i < words.length; i++) {
    const parameter = i + 1;

    values.push(
      "%" + words[i] + "%"
    );

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
  }

  const safeLimit = Math.min(
    Math.max(
      Number(limit) || 20,
      1
    ),
    100
  );

  values.push(safeLimit);

  const sql = `
    SELECT
      id,
      url,
      title,
      description,
      content,
      language,
      word_count,
      updated_at,
      published_at,
      last_crawled_at
    FROM pages
    WHERE ${conditions.join(" AND ")}
    ORDER BY
      updated_at DESC NULLS LAST
    LIMIT $${values.length}
  `;

  const result =
    await pool.query(
      sql,
      values
    );

  return result.rows
    .map((row) => ({
      ...row,

      title:
        row.title ||
        row.url ||
        "Untitled",

      description:
        row.description ||
        makeSnippet(
          row.content,
          words
        ),

      snippet:
        makeSnippet(
          row.content,
          words
        ),

      score:
        scoreResult(
          row,
          words,
          query
        )
    }))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return (
        new Date(
          b.updated_at || 0
        ) -
        new Date(
          a.updated_at || 0
        )
      );
    })
    .slice(0, 20);
}

function getContentType(
  filePath
) {
  const ext =
    path.extname(
      filePath
    ).toLowerCase();

  const types = {
    ".html":
      "text/html; charset=utf-8",

    ".htm":
      "text/html; charset=utf-8",

    ".css":
      "text/css; charset=utf-8",

    ".js":
      "application/javascript; charset=utf-8",

    ".json":
      "application/json; charset=utf-8",

    ".svg":
      "image/svg+xml",

    ".png":
      "image/png",

    ".jpg":
      "image/jpeg",

    ".jpeg":
      "image/jpeg",

    ".webp":
      "image/webp",

    ".ico":
      "image/x-icon"
  };

  return (
    types[ext] ||
    "application/octet-stream"
  );
}

function serveFile(
  res,
  pathname
) {
  let decodedPath;

  try {
    decodedPath =
      decodeURIComponent(
        pathname
      );
  } catch {
    return sendJson(
      res,
      400,
      {
        success: false,
        error: "Invalid path"
      }
    );
  }

  if (
    decodedPath.includes("\0")
  ) {
    return sendJson(
      res,
      400,
      {
        success: false,
        error: "Invalid path"
      }
    );
  }

  if (
    decodedPath === "/"
  ) {
    decodedPath =
      "/index.html";
  }

  const root =
    path.resolve(
      __dirname
    );

  const filePath =
    path.resolve(
      root,
      "." + decodedPath
    );

  if (
    filePath !== root &&
    !filePath.startsWith(
      root + path.sep
    )
  ) {
    return sendJson(
      res,
      403,
      {
        success: false,
        error: "Forbidden"
      }
    );
  }

  if (
    !fs.existsSync(
      filePath
    ) ||
    !fs.statSync(
      filePath
    ).isFile()
  ) {
    const fallback =
      path.join(
        root,
        "index.html"
      );

    if (
      fs.existsSync(
        fallback
      )
    ) {
      res.writeHead(
        200,
        {
          "Content-Type":
            "text/html; charset=utf-8",
          "Cache-Control":
            "no-cache"
        }
      );

      return fs
        .createReadStream(
          fallback
        )
        .pipe(res);
    }

    return sendJson(
      res,
      404,
      {
        success: false,
        error:
          "HEXORA page not found"
      }
    );
  }

  res.writeHead(
    200,
    {
      "Content-Type":
        getContentType(
          filePath
        ),
      "Cache-Control":
        "no-cache"
    }
  );

  fs.createReadStream(
    filePath
  ).pipe(res);
}

async function handleRequest(
  req,
  res
) {
  const requestUrl =
    new URL(
      req.url || "/",
      `http://${
        req.headers.host ||
        "localhost"
      }`
    );

  const pathname =
    requestUrl.pathname;

  if (
    req.method ===
    "OPTIONS"
  ) {
    res.writeHead(
      204,
      {
        "Access-Control-Allow-Origin":
          "*",
        "Access-Control-Allow-Methods":
          "GET,OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type"
      }
    );

    return res.end();
  }

  if (
    pathname === "/health" ||
    pathname === "/api/health"
  ) {
    let databaseStatus =
      "missing";

    if (pool) {
      try {
        await pool.query(
          "SELECT 1"
        );

        databaseStatus =
          "connected";
      } catch (error) {
        databaseStatus =
          "error: " +
          error.message;
      }
    }

    return sendJson(
      res,
      200,
      {
        success: true,

        status:
          databaseStatus ===
          "connected"
            ? "ok"
            : "degraded",

        engine:
          "HEXORA Independent Search Engine",

        database:
          "Neon PostgreSQL",

        database_status:
          databaseStatus,

        index_source:
          "Neon",

        supabase_v2:
          "separate services"
      }
    );
  }

  const searchRoutes = [
    "/search",
    "/api/search",
    "/news",
    "/api/news",
    "/images",
    "/api/images",
    "/videos",
    "/api/videos",
    "/maps",
    "/api/maps"
  ];

  if (
    searchRoutes.includes(
      pathname
    )
  ) {
    const query =
      requestUrl.searchParams.get(
        "q"
      ) ||
      requestUrl.searchParams.get(
        "query"
      ) ||
      "";

    if (!query.trim()) {
      return sendJson(
        res,
        200,
        {
          success: true,
          query: "",
          total: 0,
          results: []
        }
      );
    }

    try {
      const results =
        await searchDatabase(
          query,
          requestUrl.searchParams.get(
            "limit"
          )
        );

      return sendJson(
        res,
        200,
        {
          success: true,
          engine: "HEXORA",
          query,
          total:
            results.length,
          results
        }
      );
    } catch (error) {
      console.error(
        "[HEXORA] Search error:",
        error
      );

      return sendJson(
        res,
        500,
        {
          success: false,
          query,
          total: 0,
          results: [],
          error:
            error.message
        }
      );
    }
  }

  return serveFile(
    res,
    pathname
  );
}

const server =
  http.createServer(
    (req, res) => {
      handleRequest(
        req,
        res
      ).catch(
        (error) => {
          console.error(
            "[HEXORA] Request error:",
            error
          );

          if (
            !res.headersSent
          ) {
            sendJson(
              res,
              500,
              {
                success: false,
                error:
                  "Internal server error"
              }
            );
          } else {
            res.end();
          }
        }
      );
    }
  );

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

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      "======================================"
    );

    console.log(
      "       HEXORA SEARCH ENGINE"
    );

    console.log(
      "======================================"
    );

    console.log(
      `[HEXORA] HTTP server listening on ${PORT}`
    );

    console.log(
      `[HEXORA] Neon database: ${
        pool
          ? "configured"
          : "MISSING DATABASE_URL"
      }`
    );
  }
);
