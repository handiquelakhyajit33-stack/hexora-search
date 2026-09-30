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

  if (title.length < 3) {
    score -= 10;
  }

  if (
    !row.content &&
    !row.description
  ) {
    score -= 15;
  }

  return Math.round(score);
}

function isRelevant(row, query, score) {
  const terms = queryTerms(query);

  if (!terms.length) {
    return false;
  }

  const title =
    row.title || "";

  const description =
    row.description || "";

  const content =
    row.content || "";

  const url =
    row.url || "";

  let matched = 0;

  for (const term of terms) {
    if (
      hasWord(title, term) ||
      hasWord(description, term) ||
      hasWord(content, term) ||
      hasWord(url, term)
    ) {
      matched++;
    }
  }

  const coverage =
    matched / terms.length;

  if (
    terms.length >= 2 &&
    coverage < 0.5
  ) {
    return false;
  }

  if (
    terms.length === 1 &&
    score < 12
  ) {
    return false;
  }

  if (score < 10) {
    return false;
  }

  return true;
}

// ============================================================
// DATABASE SEARCH
// ============================================================

async function queryDatabase(
  query,
  limit = DEFAULT_LIMIT
) {
  if (!pool) {
    throw new Error(
      "DATABASE_URL is not configured"
    );
  }

  const terms =
    queryTerms(query);

  if (!terms.length) {
    return [];
  }

  const searchTerms =
    terms.slice(0, 8);

  const conditions = [];
  const values = [];

  for (const term of searchTerms) {
    const pattern =
      `%${term}%`;

    values.push(pattern);

    const p =
      `$${values.length}`;

    conditions.push(`
      (
        COALESCE(title, '') ILIKE ${p}
        OR COALESCE(description, '') ILIKE ${p}
        OR COALESCE(url, '') ILIKE ${p}
        OR COALESCE(content, '') ILIKE ${p}
      )
    `);
  }

  const sql = `
    SELECT
      id,
      url,
      title,
      description,
      content,
      content_hash,
      word_count,
      language,
      updated_at,
      last_crawled_at
    FROM pages
    WHERE ${conditions.join(" OR ")}
    ORDER BY updated_at DESC NULLS LAST
    LIMIT $${values.length + 1}
  `;

  values.push(
    Math.min(
      1000,
      Math.max(
        100,
        limit * 40
      )
    )
  );

  const result =
    await pool.query(
      sql,
      values
    );

  return Array.isArray(result.rows)
    ? result.rows
    : [];
}

// ============================================================
// RESULT FORMAT
// ============================================================

function formatResult(
  row,
  query,
  score
) {
  const text =
    row.content ||
    row.description ||
    "";

  return {
    id: row.id,

    url: row.url,

    title:
      row.title ||
      row.url,

    description:
      row.description ||
      excerpt(
        text,
        query,
        260
      ),

    snippet:
      excerpt(
        text,
        query,
        300
      ),

    domain:
      hostname(row.url),

    language:
      row.language ||
      "unknown",

    image_url: null,

    published_at: null,

    updated_at:
      row.updated_at ||
      row.last_crawled_at ||
      null,

    score
  };
}

// ============================================================
// WEB SEARCH
// ============================================================

async function searchWeb(
  query,
  page = 1,
  limit = DEFAULT_LIMIT
) {
  const q =
    cleanQuery(query);

  if (!q) {
    return {
      ok: true,
      mode: "web",
      query: "",
      total: 0,
      page,
      limit,
      results: []
    };
  }

  const candidates =
    await queryDatabase(
      q,
      limit
    );

  const ranked = [];

  for (const row of candidates) {
    const score =
      calculateScore(
        row,
        q
      );

    if (
      !isRelevant(
        row,
        q,
        score
      )
    ) {
      continue;
    }

    ranked.push({
      row,
      score,
      formatted:
        formatResult(
          row,
          q,
          score
        )
    });
  }

  ranked.sort(
    (a, b) => {
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
          a.row.title
        );

      const bt =
        normalizeText(
          b.row.title
        );

      const nq =
        normalizeText(q);

      const ae =
        at.includes(nq)
          ? 1
          : 0;

      const be =
        bt.includes(nq)
          ? 1
          : 0;

      if (be !== ae) {
        return be - ae;
      }

      return String(
        a.row.url || ""
      ).localeCompare(
        String(
          b.row.url || ""
        )
      );
    }
  );

  const total =
    ranked.length;

  const start =
    (page - 1) *
    limit;

  const results =
    ranked
      .slice(
        start,
        start + limit
      )
      .map(
        (item) =>
          item.formatted
      );

  return {
    ok: true,
    engine: "HEXORA",
    mode: "web",
    query: q,
    total,
    page,
    limit,
    results
  };
}

// ============================================================
// SPECIAL SEARCH TABS
// ============================================================

async function searchSpecial(
  query,
  mode,
  page,
  limit
) {
  const base =
    await searchWeb(
      query,
      page,
      limit
    );

  const results =
    base.results.map(
      (item) => ({
        ...item,
        type: mode
      })
    );

  return {
    ...base,
    mode,
    results
  };
}

// ============================================================
// HTTP HELPERS
// ============================================================

function jsonResponse(
  res,
  status,
  data
) {
  const body =
    JSON.stringify(data);

  res.writeHead(
    status,
    {
      "Content-Type":
        "application/json; charset=utf-8",

      "Content-Length":
        Buffer.byteLength(body),

      "Cache-Control":
        "no-store",

      "Access-Control-Allow-Origin":
        "*",

      "Access-Control-Allow-Methods":
        "GET,POST,OPTIONS",

      "Access-Control-Allow-Headers":
        "Content-Type, Authorization"
    }
  );

  res.end(body);
}

function contentType(file) {
  const ext =
    path.extname(file)
      .toLowerCase();

  const types = {
    ".html":
      "text/html; charset=utf-8",

    ".css":
      "text/css; charset=utf-8",

    ".js":
      "application/javascript; charset=utf-8",

    ".mjs":
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
      "image/x-icon",

    ".txt":
      "text/plain; charset=utf-8",

    ".woff":
      "font/woff",

    ".woff2":
      "font/woff2"
  };

  return (
    types[ext] ||
    "application/octet-stream"
  );
}

function sendFile(
  res,
  file
) {
  try {
    if (
      !fs.existsSync(file)
    ) {
      return false;
    }

    if (
      !fs.statSync(file).isFile()
    ) {
      return false;
    }

    const data =
      fs.readFileSync(file);

    res.writeHead(
      200,
      {
        "Content-Type":
          contentType(file),

        "Content-Length":
          data.length,

        "Cache-Control":
          file.endsWith(
            "index.html"
          )
            ? "no-cache"
            : "public, max-age=3600"
      }
    );

    res.end(data);

    return true;
  } catch (error) {
    console.error(
      "[HEXORA] Static file error:",
      error?.message ||
        error
    );

    return false;
  }
}

function safeStaticPath(
  pathname
) {
  let decoded;

  try {
    decoded =
      decodeURIComponent(
        pathname
      );
  } catch {
    return null;
  }

  if (
    decoded.includes(
      "\\0"
    )
  ) {
    return null;
  }

  const relative =
    decoded.replace(
      /^[/\\]+/,
      ""
    );

  const root =
    path.resolve(
      __dirname
    );

  const target =
    path.resolve(
      root,
      relative
    );

  if (
    target !== root &&
    !target.startsWith(
      root + path.sep
    )
  ) {
    return null;
  }

  return target;
}

// ============================================================
// SERVER
// ============================================================

const server =
  http.createServer(
    async (
      req,
      res
    ) => {
      try {
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
                "GET,POST,OPTIONS",

              "Access-Control-Allow-Headers":
                "Content-Type, Authorization"
            }
          );

          res.end();
          return;
        }

        const requestUrl =
          new URL(
            req.url ||
              "/",
            `http://${
              req.headers.host ||
              "localhost"
            }`
          );

        const pathname =
          requestUrl.pathname;

        // ======================================================
        // HEALTH
        // ======================================================

        if (
          pathname ===
            "/health" ||
          pathname ===
            "/api/health"
        ) {
          let database =
            "not_configured";

          if (pool) {
            try {
              await pool.query(
                "SELECT 1"
              );

              database =
                "connected";
            } catch {
              database =
                "error";
            }
          }

          return jsonResponse(
            res,
            200,
            {
              status: "ok",
              engine: "HEXORA",
              search: "active",
              database,
              crawler: "active",
              timestamp:
                new Date()
                  .toISOString()
            }
          );
        }

        // ======================================================
        // SEARCH
        // ======================================================

        if (
          pathname ===
            "/search" ||
          pathname ===
            "/api/search"
        ) {
          const query =
            cleanQuery(
              requestUrl
                .searchParams
                .get("q") ||

              requestUrl
                .searchParams
                .get("query") ||

              ""
            );

          const mode =
            detectMode(
              query,
              requestUrl
                .searchParams
                .get(
                  "mode"
                )
            );

          const page =
            Math.max(
              1,
              Number(
                requestUrl
                  .searchParams
                  .get(
                    "page"
                  ) || 1
              ) || 1
            );

          const limit =
            Math.min(
              MAX_LIMIT,
              Math.max(
                1,
                Number(
                  requestUrl
                    .searchParams
                    .get(
                      "limit"
                    ) ||
                    DEFAULT_LIMIT
                ) ||
                  DEFAULT_LIMIT
              )
            );

          if (!query) {
            return jsonResponse(
              res,
              400,
              {
                ok: false,
                error:
                  "Search query is required"
              }
            );
          }

          const result =
            mode === "web"
              ? await searchWeb(
                  query,
                  page,
                  limit
                )
              : await searchSpecial(
                  query,
                  mode,
                  page,
                  limit
                );

          return jsonResponse(
            res,
            200,
            result
          );
        }

        // ======================================================
        // NEWS
        // ======================================================

        if (
          pathname ===
            "/news" ||
          pathname ===
            "/api/news"
        ) {
          const query =
            cleanQuery(
              requestUrl
                .searchParams
                .get("q") ||
                ""
            );

          if (!query) {
            return jsonResponse(
              res,
              400,
              {
                ok: false,
                error:
                  "News query is required"
              }
            );
          }

          return jsonResponse(
            res,
            200,
            await searchSpecial(
              query,
              "news",
              1,
              DEFAULT_LIMIT
            )
          );
        }

        // ======================================================
        // STATIC FILES
        // ======================================================

        let requested =
          pathname;

        if (
          requested === "/" ||
          requested === ""
        ) {
          requested =
            "/index.html";
        }

        const file =
          safeStaticPath(
            requested
          );

        if (
          file &&
          sendFile(
            res,
            file
          )
        ) {
          return;
        }

        // ======================================================
        // SPA FALLBACK
        // ======================================================

        const indexPath =
          path.join(
            __dirname,
            "index.html"
          );

        if (
          sendFile(
            res,
            indexPath
          )
        ) {
          return;
        }

        // ======================================================
        // 404
        // ======================================================

        return jsonResponse(
          res,
          404,
          {
            ok: false,
            error:
              "Not found"
          }
        );
      } catch (error) {
        console.error(
          "[HEXORA] Server error:",
          error?.stack ||
            error
        );

        return jsonResponse(
          res,
          500,
          {
            ok: false,
            error:
              error?.message ||
              "Internal server error"
          }
        );
      }
    }
  );

// ============================================================
// SERVER ERROR
// ============================================================

server.on(
  "error",
  (error) => {
    console.error(
      "[HEXORA] HTTP server error:",
      error?.stack ||
        error
    );
  }
);

// ============================================================
// SHUTDOWN
// ============================================================

process.on(
  "SIGTERM",
  async () => {
    console.log(
      "[HEXORA] SIGTERM received"
    );

    server.close(
      async () => {
        if (pool) {
          await pool
            .end()
            .catch(
              () => {}
            );
        }

        process.exit(0);
      }
    );
  }
);

process.on(
  "SIGINT",
  async () => {
    console.log(
      "[HEXORA] SIGINT received"
    );

    server.close(
      async () => {
        if (pool) {
          await pool
            .end()
            .catch(
              () => {}
            );
        }

        process.exit(0);
      }
    );
  }
);

// ============================================================
// START
// ============================================================

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      "============================================================"
    );

    console.log(
      "HEXORA SEARCH ENGINE"
    );

    console.log(
      "============================================================"
    );

    console.log(
      `[HEXORA] HTTP server: ${PORT}`
    );

    console.log(
      "[HEXORA] Search: /search?q=your-query"
    );

    console.log(
      "[HEXORA] Database: Neon PostgreSQL"
    );

    console.log(
      "[HEXORA] Supabase search: disabled"
    );
  }
);
```
