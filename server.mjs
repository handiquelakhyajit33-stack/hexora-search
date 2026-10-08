import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 8080);
const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();

const DB_POOL_MAX = Number(process.env.DB_POOL_MAX || 10);

const MAX_QUERY_LENGTH = 300;
const MAX_PAGE = 10000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// Fetch many candidates first, then rank the best ones.
const SEARCH_CANDIDATE_LIMIT = 5000;

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: DB_POOL_MAX,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false }
});

/* -------------------------------------------------------
   BASIC HELPERS
------------------------------------------------------- */

function sendJson(res, status, data) {
  const body = JSON.stringify(data);

  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body)
  });

  res.end(body);
}

function sendText(res, status, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(text)
  });

  res.end(text);
}

function normalizeQuery(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_QUERY_LENGTH);
}

function wordsOf(value) {
  return normalizeQuery(value)
    .toLowerCase()
    .split(/[^a-z0-9\u00C0-\u024F\u0370-\u052F\u0900-\u097F\u0980-\u09FF\u0A00-\u0AFF\u0B00-\u0B7F\u0C00-\u0C7F\u0D00-\u0D7F]+/i)
    .filter(Boolean)
    .slice(0, 30);
}

function safeInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);

  if (!Number.isFinite(n)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, n));
}

function detectIntent(query) {
  const q = query.toLowerCase();

  if (
    /\b(news|latest|today|breaking|current|update|updates)\b/i.test(q)
  ) {
    return "news";
  }

  if (
    /\b(image|images|photo|photos|picture|pictures)\b/i.test(q)
  ) {
    return "images";
  }

  if (
    /\b(video|videos|watch)\b/i.test(q)
  ) {
    return "videos";
  }

  if (
    /\b(map|maps|location|directions)\b/i.test(q)
  ) {
    return "maps";
  }

  return "web";
}

function modeCondition(mode) {
  if (mode === "news") {
    return "AND p.published_at IS NOT NULL";
  }

  return "";
}

function cleanSnippetText(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function makeSnippet(row) {
  const description = cleanSnippetText(row.description);

  if (description) {
    return description.slice(0, 300);
  }

  const excerpt = cleanSnippetText(row.excerpt);

  if (excerpt) {
    return excerpt.slice(0, 300);
  }

  const content = cleanSnippetText(row.content);

  if (content) {
    return content.slice(0, 300);
  }

  return "";
}

function resultFromRow(row) {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    canonical_url: row.canonical_url || row.url,
    domain: row.domain,
    source: row.source || row.domain,
    description: cleanSnippetText(row.description),
    snippet: makeSnippet(row),
    language: row.language,
    date: row.date,
    published_at: row.published_at,
    score: Number(row.final_score || row.score || 0),
    image: row.image || null,
    image_items: row.image_items || [],
    video_items: row.video_items || []
  };
}

function suggestQuery(query, rows) {
  if (!query || !rows?.length) {
    return [];
  }

  return rows
    .map(row => String(row.title || "").trim())
    .filter(Boolean)
    .slice(0, 5);
}

/* -------------------------------------------------------
   MAIN SEARCH
------------------------------------------------------- */

async function searchDatabase(query, mode, page, limit) {
  const queryWords = wordsOf(query);

  const offset = (page - 1) * limit;

  /*
    IMPORTANT

    $1 = query
    $2 = mode
    $3 = query words
    $4 = intent

    Explicit casts prevent PostgreSQL 42P18 errors.
  */

  const dataSql = `
    WITH params AS (
      SELECT
        lower(trim($1::text)) AS q,
        $2::text AS mode_param,
        $4::text AS intent_param,
        websearch_to_tsquery(
          'simple',
          $1::text
        ) AS tsq
    ),

    base AS (
      SELECT
        p.*,

        /*
          Full text relevance
        */
        ts_rank_cd(
          COALESCE(p.search_vector, ''::tsvector),
          params.tsq
        ) AS fts_rank,

        /*
          Similarity
        */
        similarity(
          lower(COALESCE(p.title, '')),
          params.q
        ) AS title_sim,

        similarity(
          lower(COALESCE(p.domain, '')),
          params.q
        ) AS domain_sim,

        similarity(
          lower(COALESCE(p.url, '')),
          params.q
        ) AS url_sim,

        /*
          EXACT TITLE
        */
        CASE
          WHEN lower(trim(COALESCE(p.title, ''))) = params.q
          THEN 1
          ELSE 0
        END AS exact_title,

        /*
          TITLE STARTS WITH QUERY
        */
        CASE
          WHEN lower(trim(COALESCE(p.title, ''))) LIKE params.q || '%'
          THEN 1
          ELSE 0
        END AS title_starts,

        /*
          TITLE CONTAINS COMPLETE QUERY
        */
        CASE
          WHEN lower(COALESCE(p.title, '')) LIKE '%' || params.q || '%'
          THEN 1
          ELSE 0
        END AS title_contains,

        /*
          DESCRIPTION PHRASE
        */
        CASE
          WHEN lower(COALESCE(p.description, ''))
            LIKE '%' || params.q || '%'
          THEN 1
          ELSE 0
        END AS description_phrase,

        /*
          EXCERPT PHRASE
        */
        CASE
          WHEN lower(COALESCE(p.excerpt, ''))
            LIKE '%' || params.q || '%'
          THEN 1
          ELSE 0
        END AS excerpt_phrase,

        /*
          URL MATCH
        */
        CASE
          WHEN lower(COALESCE(p.url, ''))
            LIKE '%' || params.q || '%'
          THEN 1
          ELSE 0
        END AS url_contains,

        /*
          Number of query words appearing in TITLE
        */
        (
          SELECT COUNT(*)
          FROM unnest($3::text[]) AS qw(word)
          WHERE lower(COALESCE(p.title, ''))
            LIKE '%' || lower(qw.word) || '%'
        ) AS title_word_matches,

        /*
          Number of query words appearing in DESCRIPTION
        */
        (
          SELECT COUNT(*)
          FROM unnest($3::text[]) AS qw(word)
          WHERE lower(COALESCE(p.description, ''))
            LIKE '%' || lower(qw.word) || '%'
        ) AS description_word_matches,

        /*
          Number of query words appearing in EXCERPT
        */
        (
          SELECT COUNT(*)
          FROM unnest($3::text[]) AS qw(word)
          WHERE lower(COALESCE(p.excerpt, ''))
            LIKE '%' || lower(qw.word) || '%'
        ) AS excerpt_word_matches,

        /*
          Number of query words appearing in CONTENT
        */
        (
          SELECT COUNT(*)
          FROM unnest($3::text[]) AS qw(word)
          WHERE lower(COALESCE(p.content, ''))
            LIKE '%' || lower(qw.word) || '%'
        ) AS content_word_matches

      FROM pages p
      CROSS JOIN params

      WHERE
        (
          /*
            Exact / phrase title match
          */
          lower(trim(COALESCE(p.title, ''))) = params.q

          OR lower(COALESCE(p.title, ''))
             LIKE params.q || '%'

          OR lower(COALESCE(p.title, ''))
             LIKE '%' || params.q || '%'

          /*
            Full text
          */
          OR COALESCE(p.search_vector, ''::tsvector)
             @@ params.tsq

          /*
            Description / excerpt phrase
          */
          OR lower(COALESCE(p.description, ''))
             LIKE '%' || params.q || '%'

          OR lower(COALESCE(p.excerpt, ''))
             LIKE '%' || params.q || '%'

          /*
            URL
          */
          OR lower(COALESCE(p.url, ''))
             LIKE '%' || params.q || '%'

          /*
            Word matching
          */
          OR EXISTS (
            SELECT 1
            FROM unnest($3::text[]) AS qw(word)
            WHERE lower(COALESCE(p.title, ''))
              LIKE '%' || lower(qw.word) || '%'
          )

          OR EXISTS (
            SELECT 1
            FROM unnest($3::text[]) AS qw(word)
            WHERE lower(COALESCE(p.description, ''))
              LIKE '%' || lower(qw.word) || '%'
          )

          OR EXISTS (
            SELECT 1
            FROM unnest($3::text[]) AS qw(word)
            WHERE lower(COALESCE(p.excerpt, ''))
              LIKE '%' || lower(qw.word) || '%'
          )

          OR EXISTS (
            SELECT 1
            FROM unnest($3::text[]) AS qw(word)
            WHERE lower(COALESCE(p.content, ''))
              LIKE '%' || lower(qw.word) || '%'
          )
        )

        ${modeCondition(mode)}
    ),

    scored AS (
      SELECT
        base.*,

        /*
          Query word count
        */
        GREATEST(
          COALESCE(array_length($3::text[], 1), 1),
          1
        ) AS query_word_count,

        /*
          TITLE FOCUS
        */
        (
          CASE
            WHEN exact_title = 1 THEN 100
            WHEN title_starts = 1 THEN 85
            WHEN title_contains = 1 THEN 70
            ELSE 0
          END
        ) AS title_focus,

        /*
          RELEVANCE TIER

          5 = exact title
          4 = title starts with query
          3 = strong title word match
          2 = title contains query
          1 = description / FTS
          0 = weak body/url match
        */
        CASE

          WHEN exact_title = 1
            THEN 5

          WHEN title_starts = 1
            THEN 4

          WHEN title_word_matches >=
            GREATEST(
              CEIL(
                COALESCE(array_length($3::text[], 1), 1) * 0.75
              ),
              1
            )
            THEN 3

          WHEN title_contains = 1
            THEN 2

          WHEN title_word_matches > 0
            THEN 2

          WHEN description_phrase = 1
            THEN 1

          WHEN excerpt_phrase = 1
            THEN 1

          WHEN fts_rank > 0
            THEN 1

          ELSE 0

        END AS relevance_tier

      FROM base
    ),

    final_scored AS (
      SELECT
        scored.*,

        /*
          FINAL SEARCH SCORE

          Exact title gets an extremely large boost.
          This makes exact answers appear before weak mentions.
        */

        (
          /*
            RELEVANCE TIER
          */
          CASE relevance_tier
            WHEN 5 THEN 100000
            WHEN 4 THEN 50000
            WHEN 3 THEN 25000
            WHEN 2 THEN 10000
            WHEN 1 THEN 1500
            ELSE 50
          END

          /*
            EXACT TITLE
          */
          + exact_title * 50000

          /*
            TITLE START
          */
          + title_starts * 15000

          /*
            TITLE WORD MATCH
          */
          + LEAST(
              title_word_matches * 5000,
              25000
            )

          /*
            TITLE FOCUS
          */
          + title_focus * 100

          /*
            FULL TEXT
          */
          + LEAST(
              fts_rank * 3000,
              15000
            )

          /*
            TITLE SIMILARITY
          */
          + title_sim * 5000

          /*
            DESCRIPTION
          */
          + description_phrase * 3000

          /*
            EXCERPT
          */
          + excerpt_phrase * 1500

          /*
            URL
          */
          + url_contains * 1000

          /*
            DOMAIN
          */
          + CASE
              WHEN lower(COALESCE(domain, '')) = params.q
              THEN 3000
              ELSE 0
            END

          /*
            Authority
          */
          + LEAST(
              GREATEST(COALESCE(authority_score, 0), 0),
              100
            ) * 20

          /*
            Quality
          */
          + LEAST(
              GREATEST(COALESCE(quality_score, 0), 0),
              100
            ) * 15

          /*
            Popularity
          */
          + LEAST(
              GREATEST(COALESCE(popularity_score, 0), 0),
              100
            ) * 10

          /*
            Inbound links
          */
          + LEAST(
              GREATEST(COALESCE(inbound_links, 0), 0),
              100
            ) * 5

          /*
            WEAK BODY ONLY PENALTY
          */
          - CASE
              WHEN relevance_tier = 0
                AND title_word_matches = 0
              THEN 5000
              ELSE 0
            END

        ) AS final_score

      FROM scored
      CROSS JOIN params
    )

    SELECT *
    FROM final_scored

    ORDER BY
      /*
        MOST IMPORTANT FIRST
      */
      relevance_tier DESC,

      exact_title DESC,
      title_starts DESC,
      title_word_matches DESC,
      title_contains DESC,

      /*
        Actual score
      */
      final_score DESC,

      /*
        Phrase relevance
      */
      description_phrase DESC,
      excerpt_phrase DESC,

      /*
        FTS
      */
      fts_rank DESC,

      /*
        Similarity
      */
      title_sim DESC,

      /*
        Authority / quality
      */
      authority_score DESC,
      quality_score DESC,
      popularity_score DESC,
      inbound_links DESC,

      id DESC

    LIMIT $5
    OFFSET $6
  `;

  const countSql = `
    SELECT COUNT(*)::int AS count
    FROM pages p
    WHERE
      (
        lower(trim(COALESCE(p.title, '')))
          = lower(trim($1::text))

        OR lower(COALESCE(p.title, ''))
          LIKE '%' || lower(trim($1::text)) || '%'

        OR lower(COALESCE(p.description, ''))
          LIKE '%' || lower(trim($1::text)) || '%'

        OR lower(COALESCE(p.excerpt, ''))
          LIKE '%' || lower(trim($1::text)) || '%'

        OR lower(COALESCE(p.url, ''))
          LIKE '%' || lower(trim($1::text)) || '%'

        OR COALESCE(p.search_vector, ''::tsvector)
          @@ websearch_to_tsquery(
            'simple',
            $1::text
          )

        OR EXISTS (
          SELECT 1
          FROM unnest($2::text[]) AS qw(word)
          WHERE lower(COALESCE(p.title, ''))
            LIKE '%' || lower(qw.word) || '%'
        )

        OR EXISTS (
          SELECT 1
          FROM unnest($2::text[]) AS qw(word)
          WHERE lower(COALESCE(p.description, ''))
            LIKE '%' || lower(qw.word) || '%'
        )

        OR EXISTS (
          SELECT 1
          FROM unnest($2::text[]) AS qw(word)
          WHERE lower(COALESCE(p.excerpt, ''))
            LIKE '%' || lower(qw.word) || '%'
        )
      )

      ${modeCondition(mode)}
  `;

  const candidateSql = `
    SELECT
      id,
      title,
      url,
      domain,
      similarity(
        lower(COALESCE(title, '')),
        lower($1::text)
      ) AS sim
    FROM pages
    WHERE
      lower(COALESCE(title, ''))
        LIKE '%' || lower($1::text) || '%'
    ORDER BY
      sim DESC,
      id DESC
    LIMIT 50
  `;

  const dataParams = [
    query,
    mode,
    queryWords,
    detectIntent(query),
    SEARCH_CANDIDATE_LIMIT,
    offset
  ];

  const countParams = [
    query,
    queryWords
  ];

  const [dataResult, countResult, candidateResult] =
    await Promise.all([
      pool.query(dataSql, dataParams),
      pool.query(countSql, countParams),
      pool.query(candidateSql, [query])
    ]);

  const rows = dataResult.rows || [];

  /*
    Domain diversification

    Do NOT allow one website to completely fill
    the first page.
  */

  const finalRows = [];

  const domainCount = new Map();

  for (const row of rows) {
    const domain = String(row.domain || "").toLowerCase();

    const current = domainCount.get(domain) || 0;

    /*
      Exact title results are always allowed.
    */
    if (row.exact_title === 1) {
      finalRows.push(row);
      domainCount.set(domain, current + 1);
      continue;
    }

    /*
      Maximum 4 normal results per domain.
    */
    if (current >= 4) {
      continue;
    }

    finalRows.push(row);
    domainCount.set(domain, current + 1);

    if (finalRows.length >= limit) {
      break;
    }
  }

  /*
    Make sure exact title rows are never lost
    because of diversification.
  */
  const exactRows = rows.filter(
    row => Number(row.exact_title) === 1
  );

  const merged = [
    ...exactRows,
    ...finalRows.filter(
      row => Number(row.exact_title) !== 1
    )
  ];

  const unique = [];
  const seen = new Set();

  for (const row of merged) {
    const key =
      row.canonical_url ||
      row.url ||
      String(row.id);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(row);

    if (unique.length >= limit) {
      break;
    }
  }

  return {
    query,
    mode,
    page,
    limit,

    total: Number(countResult.rows?.[0]?.count || 0),

    results: unique.map(resultFromRow),

    suggestions: suggestQuery(
      query,
      candidateResult.rows || []
    )
  };
}

/* -------------------------------------------------------
   NEWS
------------------------------------------------------- */

async function getNews(limit = 20) {
  const sql = `
    SELECT
      id,
      title,
      url,
      canonical_url,
      domain,
      source,
      description,
      excerpt,
      content,
      language,
      date,
      published_at,
      image,
      image_items,
      video_items
    FROM pages
    WHERE published_at IS NOT NULL
    ORDER BY published_at DESC NULLS LAST, id DESC
    LIMIT $1
  `;

  const result = await pool.query(sql, [limit]);

  return result.rows.map(resultFromRow);
}

/* -------------------------------------------------------
   MEDIA
------------------------------------------------------- */

async function getMedia(type, query, limit = 20) {
  const q = normalizeQuery(query);

  let sql;

  if (type === "images") {
    sql = `
      SELECT
        id,
        title,
        url,
        canonical_url,
        domain,
        source,
        description,
        excerpt,
        content,
        language,
        date,
        published_at,
        image,
        image_items,
        video_items
      FROM pages
      WHERE
        image IS NOT NULL
        OR image_items IS NOT NULL
      ORDER BY
        last_crawled_at DESC NULLS LAST,
        id DESC
      LIMIT $1
    `;
  } else {
    sql = `
      SELECT
        id,
        title,
        url,
        canonical_url,
        domain,
        source,
        description,
        excerpt,
        content,
        language,
        date,
        published_at,
        image,
        image_items,
        video_items
      FROM pages
      WHERE
        video_items IS NOT NULL
      ORDER BY
        last_crawled_at DESC NULLS LAST,
        id DESC
      LIMIT $1
    `;
  }

  const result = await pool.query(sql, [limit]);

  return result.rows.map(resultFromRow);
}

/* -------------------------------------------------------
   HEALTH
------------------------------------------------------- */

async function healthCheck() {
  try {
    const result = await pool.query(`
      SELECT
        NOW() AS now,
        COUNT(*)::bigint AS pages
      FROM pages
    `);

    return {
      ok: true,
      database: true,
      pages: Number(result.rows?.[0]?.pages || 0),
      time: result.rows?.[0]?.now || null
    };
  } catch (error) {
    return {
      ok: false,
      database: false,
      error: error.message
    };
  }
}

/* -------------------------------------------------------
   STATIC FILES
------------------------------------------------------- */

function safeStaticPath(urlPath) {
  const clean = decodeURIComponent(urlPath)
    .split("?")[0]
    .replace(/^\/+/, "");

  const filePath = path.join(__dirname, clean);

  const root = path.resolve(__dirname);
  const resolved = path.resolve(filePath);

  if (
    resolved !== root &&
    !resolved.startsWith(root + path.sep)
  ) {
    return null;
  }

  return resolved;
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon"
  };

  return types[ext] || "application/octet-stream";
}

function serveStatic(res, pathname) {
  let filePath = safeStaticPath(pathname);

  if (!filePath) {
    sendText(res, 403, "Forbidden");
    return true;
  }

  if (
    !fs.existsSync(filePath) ||
    !fs.statSync(filePath).isFile()
  ) {
    filePath = safeStaticPath("index.html");

    if (!filePath || !fs.existsSync(filePath)) {
      return false;
    }
  }

  try {
    const data = fs.readFileSync(filePath);

    res.writeHead(200, {
      "Content-Type": contentType(filePath),
      "Content-Length": data.length
    });

    res.end(data);

    return true;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------
   HTTP SERVER
------------------------------------------------------- */

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(
      req.url,
      `http://${req.headers.host || "localhost"}`
    );

    const pathname = requestUrl.pathname;

    /*
      HEALTH
    */
    if (
      pathname === "/health" ||
      pathname === "/api/health"
    ) {
      const health = await healthCheck();

      sendJson(
        res,
        health.ok ? 200 : 503,
        health
      );

      return;
    }

    /*
      SEARCH
    */
    if (
      pathname === "/search" ||
      pathname === "/api/search"
    ) {
      const query = normalizeQuery(
        requestUrl.searchParams.get("q")
      );

      const mode =
        String(
          requestUrl.searchParams.get("mode") || "web"
        ).toLowerCase();

      const page = safeInt(
        requestUrl.searchParams.get("page"),
        1,
        1,
        MAX_PAGE
      );

      const limit = safeInt(
        requestUrl.searchParams.get("limit"),
        DEFAULT_LIMIT,
        1,
        MAX_LIMIT
      );

      if (!query) {
        sendJson(res, 400, {
          ok: false,
          error: "Search query is required"
        });

        return;
      }

      const data = await searchDatabase(
        query,
        mode,
        page,
        limit
      );

      sendJson(res, 200, {
        ok: true,
        ...data
      });

      return;
    }

    /*
      NEWS
    */
    if (
      pathname === "/news" ||
      pathname === "/api/news"
    ) {
      const limit = safeInt(
        requestUrl.searchParams.get("limit"),
        DEFAULT_LIMIT,
        1,
        MAX_LIMIT
      );

      const results = await getNews(limit);

      sendJson(res, 200, {
        ok: true,
        results
      });

      return;
    }

    /*
      IMAGES
    */
    if (
      pathname === "/images" ||
      pathname === "/api/images"
    ) {
      const query = normalizeQuery(
        requestUrl.searchParams.get("q")
      );

      const limit = safeInt(
        requestUrl.searchParams.get("limit"),
        DEFAULT_LIMIT,
        1,
        MAX_LIMIT
      );

      const results = await getMedia(
        "images",
        query,
        limit
      );

      sendJson(res, 200, {
        ok: true,
        query,
        results
      });

      return;
    }

    /*
      VIDEOS
    */
    if (
      pathname === "/videos" ||
      pathname === "/api/videos"
    ) {
      const query = normalizeQuery(
        requestUrl.searchParams.get("q")
      );

      const limit = safeInt(
        requestUrl.searchParams.get("limit"),
        DEFAULT_LIMIT,
        1,
        MAX_LIMIT
      );

      const results = await getMedia(
        "videos",
        query,
        limit
      );

      sendJson(res, 200, {
        ok: true,
        query,
        results
      });

      return;
    }

    /*
      MAPS
    */
    if (
      pathname === "/maps" ||
      pathname === "/api/maps"
    ) {
      sendJson(res, 200, {
        ok: true,
        results: []
      });

      return;
    }

    /*
      STATIC FRONTEND
    */
    if (req.method === "GET") {
      if (serveStatic(res, pathname)) {
        return;
      }
    }

    sendText(res, 404, "Not Found");

  } catch (error) {
    console.error("SERVER ERROR:", error);

    sendJson(res, 500, {
      ok: false,
      error: "Internal server error",
      message: error.message
    });
  }
});

/* -------------------------------------------------------
   START
------------------------------------------------------- */

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `HEXORA server running on port ${PORT}`
  );
});

/* -------------------------------------------------------
   GRACEFUL SHUTDOWN
------------------------------------------------------- */

async function shutdown(signal) {
  console.log(`${signal} received. Shutting down...`);

  server.close(async () => {
    try {
      await pool.end();
    } catch {}

    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
