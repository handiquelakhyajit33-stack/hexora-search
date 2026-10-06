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

const DB_POOL_MAX = Math.max(2, Number(process.env.DB_POOL_MAX || 8));

const MAX_QUERY_LENGTH = 300;
const MAX_PAGE = 10000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const SEARCH_CANDIDATE_LIMIT = 2500;

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      max: DB_POOL_MAX,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      ssl: /neon\.tech|neon\.com|neon\./i.test(DATABASE_URL)
        ? { rejectUnauthorized: false }
        : undefined,
    })
  : null;

function sendJson(res, status, data, cache = "no-store") {
  if (res.headersSent) return;

  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": cache,
  });

  res.end(JSON.stringify(data));
}

function normalizeQuery(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_QUERY_LENGTH);
}

function wordsOf(query) {
  return normalizeQuery(query)
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s._-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 16);
}

function safeInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);

  if (!Number.isFinite(n)) return fallback;

  return Math.min(max, Math.max(min, n));
}

function detectIntent(query) {
  const q = query.toLocaleLowerCase();

  if (
    /\b(news|latest|today|breaking|update|recent)\b/.test(q)
  ) {
    return "news";
  }

  if (
    /\b(near me|nearby|map|maps|location|directions|restaurant|restaurants|hotel|hotels)\b/.test(
      q
    )
  ) {
    return "local";
  }

  if (
    /\b(how|what|why|when|where|who|which|guide|tutorial|meaning|explain)\b/.test(
      q
    ) ||
    /[?]$/.test(q)
  ) {
    return "informational";
  }

  if (
    /\b(buy|price|download|login|sign in|official|website|open|contact)\b/.test(
      q
    )
  ) {
    return "transactional";
  }

  return "navigational";
}

function modeCondition(mode) {
  if (mode === "images") {
    return "jsonb_array_length(COALESCE(image_items, '[]'::jsonb)) > 0";
  }

  if (mode === "videos") {
    return "jsonb_array_length(COALESCE(video_items, '[]'::jsonb)) > 0";
  }

  if (mode === "news") {
    return `
      (
        published_at IS NOT NULL
        OR COALESCE(crawl_status, '') = 'news'
      )
    `;
  }

  return "TRUE";
}

function makeSnippet(text, words, max = 320) {
  const value = String(text || "")
    .replace(/\{\{[\s\S]*?\}\}/g, " ")
    .replace(/\[\[Category:[^\]]*\]\]/gi, " ")
    .replace(/\[\[File:[^\]]*\]\]/gi, " ")
    .replace(/\[\[Image:[^\]]*\]\]/gi, " ")
    .replace(/\{\|[\s\S]*?\|\}/g, " ")
    .replace(/<ref[\s\S]*?<\/ref>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\\n/g, " ")
    .replace(/\\+"/g, '"')
    .replace(/\s+/g, " ")
    .trim();

  if (!value) return "";

  if (!words.length) {
    return value.slice(0, max);
  }

  const lower = value.toLocaleLowerCase();

  let position = -1;

  for (const word of words) {
    const p = lower.indexOf(word);

    if (p >= 0) {
      position = p;
      break;
    }
  }

  if (position < 0) {
    return value.slice(0, max);
  }

  const start = Math.max(0, position - 110);
  const end = Math.min(value.length, start + max);

  return `${start ? "… " : ""}${value.slice(start, end)}${
    end < value.length ? " …" : ""
  }`;
}

function resultFromRow(row, mode, words) {
  const images = Array.isArray(row.image_items)
    ? row.image_items
    : [];

  const videos = Array.isArray(row.video_items)
    ? row.video_items
    : [];

  const image =
    images[0]?.url ||
    images[0]?.src ||
    "";

  const video =
    videos[0]?.url ||
    videos[0]?.src ||
    "";

  const content =
    row.content ||
    row.excerpt ||
    row.description ||
    "";

  const title = String(
    row.title ||
    row.url ||
    "Untitled"
  );

  const result = {
    id: row.id,
    title,
    url: row.url,
    canonical_url: row.canonical_url || row.url,
    domain: row.domain || "",
    source: row.domain || "",
    description:
      row.description ||
      row.excerpt ||
      "",
    snippet: makeSnippet(
      content,
      words
    ),
    language:
      row.language ||
      "unknown",
    date:
      row.published_at ||
      row.updated_at ||
      row.last_crawled_at ||
      null,
    published_at:
      row.published_at ||
      null,
    score: Number(
      Number(row.score || 0).toFixed(5)
    ),
  };

  if (image) {
    result.image = image;
  }

  if (video) {
    result.video_url = video;
  }

  if (mode === "images") {
    result.image_url = image;
  }

  return result;
}

async function suggestQuery(query) {
  if (!pool || !query || query.length < 3) {
    return null;
  }

  try {
    const { rows } = await pool.query(
      `
        SELECT title
        FROM pages
        WHERE title % $1
        ORDER BY similarity(title, $1) DESC
        LIMIT 1
      `,
      [query]
    );

    const suggestion =
      rows[0]?.title?.trim();

    if (
      !suggestion ||
      suggestion.toLocaleLowerCase() ===
        query.toLocaleLowerCase()
    ) {
      return null;
    }

    return suggestion.slice(0, 160);
  } catch {
    return null;
  }
}

async function searchDatabase(
  query,
  {
    mode = "web",
    page = 1,
    limit = DEFAULT_LIMIT,
    language = "",
  } = {}
) {
  if (!pool) {
    throw new Error(
      "DATABASE_URL is missing"
    );
  }

  const q = normalizeQuery(query);
  const words = wordsOf(q);

  if (!words.length) {
    return {
      results: [],
      total: 0,
      suggestion: null,
    };
  }

  const tsQuery = q;
  const offset = (page - 1) * limit;
  const intent = detectIntent(q);

  const languageFilter =
    language &&
    /^[a-zA-Z-]{2,12}$/.test(language)
      ? language
      : "";

  const condition = modeCondition(mode);

  const sql = `
    WITH candidate AS (
      SELECT
        p.id,
        p.url,
        p.canonical_url,
        p.title,
        p.description,
        p.excerpt,
        p.content,
        p.domain,
        p.language,
        p.updated_at,
        p.published_at,
        p.last_crawled_at,
        p.authority_score,
        p.quality_score,
        p.popularity_score,
        p.inbound_links,
        p.search_vector,
        p.image_items,
        p.video_items,

        ts_rank_cd(
          p.search_vector,
          websearch_to_tsquery(
            'simple',
            $1
          ),
          32
        ) AS fts_rank,

        similarity(
          COALESCE(p.title, ''),
          $2
        ) AS title_sim,

        similarity(
          COALESCE(p.url, ''),
          $2
        ) AS url_sim,

        similarity(
          COALESCE(p.domain, ''),
          $2
        ) AS domain_sim,

        CASE
          WHEN lower(trim(COALESCE(p.title, ''))) =
               lower(trim($2))
          THEN 1
          ELSE 0
        END AS exact_title,

        CASE
          WHEN lower(trim(COALESCE(p.title, ''))) LIKE
               lower(trim($2)) || '%'
          THEN 1
          ELSE 0
        END AS title_starts,

        CASE
          WHEN lower(trim(COALESCE(p.title, ''))) LIKE
               '%' || lower(trim($2)) || '%'
          THEN 1
          ELSE 0
        END AS title_contains,

        CASE
          WHEN lower(trim(COALESCE(p.domain, ''))) =
               lower(trim($2))
          THEN 1
          ELSE 0
        END AS exact_domain,

        CASE
          WHEN lower(COALESCE(p.domain, '')) LIKE
               '%' || lower(trim($2)) || '%'
          THEN 1
          ELSE 0
        END AS domain_contains,

        CASE
          WHEN lower(COALESCE(p.url, '')) LIKE
               '%' || lower(trim($2)) || '%'
          THEN 1
          ELSE 0
        END AS url_contains,

        CASE
          WHEN lower(COALESCE(p.title, '')) LIKE
               '%' || lower(trim($2)) || '%'
          THEN 1
          ELSE 0
        END AS title_exact_phrase,

        (
          SELECT COUNT(*)::double precision
          FROM unnest($3::text[]) AS w
          WHERE lower(COALESCE(p.title, ''))
                ILIKE '%' || w || '%'
        ) AS title_word_matches,

        (
          SELECT COUNT(*)::double precision
          FROM unnest($3::text[]) AS w
          WHERE lower(
            COALESCE(p.description, '') || ' ' ||
            COALESCE(p.excerpt, '')
          ) ILIKE '%' || w || '%'
        ) AS description_word_matches,

        (
          SELECT COUNT(*)::double precision
          FROM unnest($3::text[]) AS w
          WHERE lower(COALESCE(p.content, ''))
                ILIKE '%' || w || '%'
        ) AS content_word_matches,

        (
          SELECT
            CASE
              WHEN cardinality($3::text[]) = 0
              THEN 0
              ELSE
                COUNT(*)::double precision /
                cardinality($3::text[])::double precision
            END
          FROM unnest($3::text[]) AS w
          WHERE
            lower(COALESCE(p.title, '')) ILIKE '%' || w || '%'
            OR lower(COALESCE(p.description, '')) ILIKE '%' || w || '%'
            OR lower(COALESCE(p.excerpt, '')) ILIKE '%' || w || '%'
            OR lower(COALESCE(p.content, '')) ILIKE '%' || w || '%'
        ) AS word_coverage,

        (
          SELECT
            CASE
              WHEN cardinality($3::text[]) = 0
              THEN 0
              ELSE
                COUNT(*)::double precision /
                cardinality($3::text[])::double precision
            END
          FROM unnest($3::text[]) AS w
          WHERE
            lower(COALESCE(p.title, '')) ILIKE '%' || w || '%'
        ) AS title_coverage,

        CASE
          WHEN $6 = 'news'
           AND p.published_at IS NOT NULL
          THEN GREATEST(
            0,
            30 -
            (
              EXTRACT(
                EPOCH FROM (
                  NOW() - p.published_at
                )
              ) / 86400.0
            ) * 0.75
          )
          ELSE 0
        END AS news_freshness

      FROM pages p

      WHERE (${condition})

        AND (
          $5 = ''
          OR COALESCE(p.language, '') = $5
        )

        AND (
          p.search_vector @@ websearch_to_tsquery(
            'simple',
            $1
          )

          OR p.title % $2
          OR p.url % $2
          OR p.domain % $2

          OR EXISTS (
            SELECT 1
            FROM unnest($3::text[]) w
            WHERE
              p.title ILIKE '%' || w || '%'
              OR p.description ILIKE '%' || w || '%'
              OR p.excerpt ILIKE '%' || w || '%'
              OR p.content ILIKE '%' || w || '%'
          )
        )

      ORDER BY
        exact_title DESC,
        title_starts DESC,
        title_coverage DESC,
        title_word_matches DESC,
        title_contains DESC,
        description_word_matches DESC,
        fts_rank DESC,
        title_sim DESC,
        exact_domain DESC,
        domain_contains DESC,
        authority_score DESC NULLS LAST

      LIMIT ${SEARCH_CANDIDATE_LIMIT}
    ),

    scored AS (
      SELECT
        candidate.*,

        /*
         * RELEVANCE TIER
         *
         * 5 = exact title
         * 4 = title starts with query
         * 3 = strong title match
         * 2 = description/excerpt match
         * 1 = content/FTS-only match
         */
        CASE
          WHEN exact_title = 1
            THEN 5

          WHEN title_starts = 1
            THEN 4

          WHEN title_word_matches > 0
            THEN 3

          WHEN title_contains = 1
            THEN 3

          WHEN description_word_matches > 0
            THEN 2

          ELSE 1
        END AS relevance_tier,

        (
          /* Exact title */
          (exact_title * 1800.0)

          /* Title starts with query */
          + (title_starts * 800.0)

          /* Full phrase in title */
          + (title_exact_phrase * 450.0)

          /* Query appears in title */
          + (title_contains * 300.0)

          /* Query words in title */
          + (
              CASE
                WHEN cardinality($3::text[]) > 0
                THEN
                  (
                    title_word_matches /
                    cardinality($3::text[])::double precision
                  ) * 850.0
                ELSE 0
              END
            )

          /* Title coverage */
          + (title_coverage * 450.0)

          /* Description */
          + (
              CASE
                WHEN cardinality($3::text[]) > 0
                THEN
                  (
                    description_word_matches /
                    cardinality($3::text[])::double precision
                  ) * 180.0
                ELSE 0
              END
            )

          /* FTS */
          + LEAST(
              180.0,
              fts_rank * 100.0
            )

          /* Overall coverage */
          + (word_coverage * 70.0)

          /* Content is weak */
          + (
              CASE
                WHEN cardinality($3::text[]) > 0
                THEN
                  (
                    content_word_matches /
                    cardinality($3::text[])::double precision
                  ) * 8.0
                ELSE 0
              END
            )

          /* Fuzzy title */
          + (title_sim * 160.0)

          /* Domain */
          + (exact_domain * 350.0)
          + (domain_contains * 100.0)
          + (domain_sim * 60.0)

          /* URL */
          + (url_contains * 50.0)
          + (url_sim * 30.0)

          /* Authority */
          + LEAST(
              40.0,
              GREATEST(
                0.0,
                COALESCE(
                  authority_score,
                  0
                )
              )
            )

          /* Quality */
          + LEAST(
              25.0,
              GREATEST(
                0.0,
                COALESCE(
                  quality_score,
                  0
                ) * 0.4
              )
            )

          /* Popularity */
          + LEAST(
              15.0,
              GREATEST(
                0.0,
                COALESCE(
                  popularity_score,
                  0
                )
              )
            )

          /* Inbound links */
          + LEAST(
              12.0,
              GREATEST(
                0.0,
                COALESCE(
                  inbound_links,
                  0
                )::double precision * 0.3
              )
            )

          /* News freshness */
          + CASE
              WHEN $6 = 'news'
              THEN LEAST(
                30.0,
                GREATEST(
                  0.0,
                  news_freshness
                )
              )
              ELSE 0
            END

          /* Navigational */
          + CASE
              WHEN $6 = 'navigational'
               AND (
                 exact_title = 1
                 OR exact_domain = 1
                 OR title_starts = 1
               )
              THEN 180.0
              ELSE 0
            END

          /* Transactional */
          + CASE
              WHEN $6 = 'transactional'
               AND (
                 exact_domain = 1
                 OR exact_title = 1
                 OR title_starts = 1
               )
              THEN 100.0
              ELSE 0
            END

          /* Informational */
          + CASE
              WHEN $6 = 'informational'
               AND (
                 title_contains = 1
                 OR title_word_matches > 0
                 OR description_word_matches > 0
               )
              THEN 60.0
              ELSE 0
            END

          /*
           * BODY-ONLY PENALTY
           *
           * If the query is not in title/description,
           * the page is treated as a weak result.
           */
          - CASE
              WHEN title_word_matches = 0
               AND description_word_matches = 0
               AND content_word_matches > 0
              THEN 500.0
              ELSE 0
            END

          /*
           * No title/description match at all.
           */
          - CASE
              WHEN title_word_matches = 0
               AND title_contains = 0
               AND description_word_matches = 0
              THEN 250.0
              ELSE 0
            END

        ) AS score

      FROM candidate
    )

    SELECT *
    FROM scored

    ORDER BY
      /*
       * MOST IMPORTANT:
       * relevance tier comes BEFORE raw score.
       *
       * This prevents a high-authority page that only
       * mentions "India" in references from beating a
       * genuinely relevant title page.
       */
      relevance_tier DESC,

      score DESC,

      exact_title DESC,

      title_coverage DESC,

      title_word_matches DESC,

      title_starts DESC,

      title_contains DESC,

      description_word_matches DESC,

      word_coverage DESC,

      fts_rank DESC,

      title_sim DESC,

      exact_domain DESC,

      authority_score DESC NULLS LAST,

      quality_score DESC NULLS LAST,

      popularity_score DESC NULLS LAST,

      inbound_links DESC NULLS LAST

    LIMIT $4
    OFFSET ${offset};
  `;

  const countSql = `
    SELECT COUNT(*)::bigint AS total
    FROM pages p

    WHERE (${condition})

      AND (
        $4 = ''
        OR COALESCE(p.language, '') = $4
      )

      AND (
        p.search_vector @@ websearch_to_tsquery(
          'simple',
          $1
        )

        OR p.title % $2
        OR p.url % $2
        OR p.domain % $2

        OR EXISTS (
          SELECT 1
          FROM unnest($3::text[]) w
          WHERE
            p.title ILIKE '%' || w || '%'
            OR p.description ILIKE '%' || w || '%'
            OR p.excerpt ILIKE '%' || w || '%'
            OR p.content ILIKE '%' || w || '%'
        )
      );
  `;

  const [result, count, suggestion] =
    await Promise.all([
      pool.query(sql, [
        tsQuery,
        q,
        words,
        limit,
        languageFilter,
        intent,
      ]),

      pool.query(countSql, [
        tsQuery,
        q,
        words,
        languageFilter,
      ]),

      page === 1
        ? suggestQuery(q)
        : Promise.resolve(null),
    ]);

  let rows = result.rows.map(
    (row) =>
      resultFromRow(
        row,
        mode,
        words
      )
  );

  /*
   * Domain diversification
   */
  const seenDomains = new Map();
  const diversified = [];
  const deferred = [];

  for (const item of rows) {
    let domain = String(
      item.domain || ""
    ).toLocaleLowerCase();

    if (!domain && item.url) {
      try {
        domain = new URL(
          item.url
        ).hostname.toLocaleLowerCase();
      } catch {
        domain = String(
          item.url
        ).toLocaleLowerCase();
      }
    }

    if (!domain) {
      domain = "unknown";
    }

    const countForDomain =
      seenDomains.get(domain) || 0;

    if (countForDomain < 3) {
      diversified.push(item);

      seenDomains.set(
        domain,
        countForDomain + 1
      );
    } else {
      deferred.push(item);
    }
  }

  rows = [
    ...diversified,
    ...deferred,
  ].slice(0, limit);

  return {
    results: rows,
    total: Number(
      count.rows[0]?.total || 0
    ),
    suggestion,
  };
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

function serveFile(res, pathname) {
  let decoded;

  try {
    decoded = decodeURIComponent(
      pathname || "/"
    );
  } catch {
    return sendJson(res, 400, {
      success: false,
      error: "Invalid path",
    });
  }

  if (decoded.includes("\0")) {
    return sendJson(res, 403, {
      success: false,
      error: "Invalid path",
    });
  }

  if (decoded === "/") {
    decoded = "/index.html";
  }

  const root = path.resolve(
    __dirname
  );

  const filePath = path.resolve(
    root,
    `.${decoded}`
  );

  if (
    filePath !== root &&
    !filePath.startsWith(
      `${root}${path.sep}`
    )
  ) {
    return sendJson(res, 403, {
      success: false,
      error: "Forbidden",
    });
  }

  let target = filePath;

  if (
    !fs.existsSync(target) ||
    !fs.statSync(target).isFile()
  ) {
    target = path.join(
      root,
      "index.html"
    );

    if (!fs.existsSync(target)) {
      return sendJson(res, 404, {
        success: false,
        error: "HEXORA page not found",
      });
    }
  }

  res.writeHead(200, {
    "Content-Type":
      contentTypes[
        path.extname(
          target
        ).toLowerCase()
      ] ||
      "application/octet-stream",

    "Cache-Control":
      path.basename(target) ===
      "index.html"
        ? "no-cache"
        : "public, max-age=300",
  });

  fs.createReadStream(
    target
  ).pipe(res);
}

async function handle(req, res) {
  const u = new URL(
    req.url || "/",
    `http://${req.headers.host || "localhost"}`
  );

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods":
        "GET,OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type",
    });

    return res.end();
  }

  if (req.method !== "GET") {
    return sendJson(res, 405, {
      success: false,
      error: "Method not allowed",
    });
  }

  if (
    u.pathname === "/health" ||
    u.pathname === "/api/health"
  ) {
    let databaseStatus = "missing";

    if (pool) {
      try {
        await pool.query(
          "SELECT 1"
        );

        databaseStatus =
          "connected";
      } catch (error) {
        databaseStatus =
          `error: ${error.message}`;
      }
    }

    return sendJson(res, 200, {
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
        "HEXORA indexed data in Neon",

      raw_storage:
        "Cloudflare R2",
    });
  }

  const searchRoutes =
    new Set([
      "/search",
      "/api/search",
      "/news",
      "/api/news",
      "/images",
      "/api/images",
      "/videos",
      "/api/videos",
    ]);

  if (
    searchRoutes.has(
      u.pathname
    )
  ) {
    const query =
      normalizeQuery(
        u.searchParams.get("q") ||
        u.searchParams.get("query") ||
        ""
      );

    const routeMode =
      u.pathname.includes("news")
        ? "news"
        : u.pathname.includes(
            "images"
          )
        ? "images"
        : u.pathname.includes(
            "videos"
          )
        ? "videos"
        : u.searchParams.get(
            "mode"
          ) || "web";

    const mode = [
      "web",
      "news",
      "images",
      "videos",
    ].includes(routeMode)
      ? routeMode
      : "web";

    const page = safeInt(
      u.searchParams.get(
        "page"
      ),
      1,
      1,
      MAX_PAGE
    );

    const limit = safeInt(
      u.searchParams.get(
        "limit"
      ),
      DEFAULT_LIMIT,
      1,
      MAX_LIMIT
    );

    const language =
      String(
        u.searchParams.get(
          "language"
        ) || ""
      ).trim();

    if (!query) {
      return sendJson(res, 200, {
        success: true,
        engine: "HEXORA",
        query: "",
        mode,
        page,
        limit,
        total: 0,
        suggestion: null,
        results: [],
      });
    }

    try {
      const data =
        await searchDatabase(
          query,
          {
            mode,
            page,
            limit,
            language,
          }
        );

      return sendJson(
        res,
        200,
        {
          success: true,
          engine: "HEXORA",
          query,
          mode,
          page,
          limit,
          total: data.total,
          suggestion:
            data.suggestion,
          results:
            data.results,
        },
        "public, max-age=15, stale-while-revalidate=30"
      );
    } catch (error) {
      console.error(
        "[HEXORA] Search error:",
        error
      );

      return sendJson(
        res,
        503,
        {
          success: false,
          engine: "HEXORA",
          query,
          mode,
          page,
          limit,
          total: 0,
          results: [],
          error: DATABASE_URL
            ? "Search database temporarily unavailable"
            : "DATABASE_URL is not configured",
        }
      );
    }
  }

  if (
    u.pathname ===
      "/api/maps" ||
    u.pathname === "/maps"
  ) {
    return sendJson(res, 200, {
      success: true,
      mode: "maps",
      message:
        "Maps is handled by the HEXORA map interface. No fabricated map search results are returned.",
      results: [],
    });
  }

  return serveFile(
    res,
    u.pathname
  );
}

const server =
  http.createServer(
    (req, res) => {
      handle(req, res).catch(
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
                  "Internal server error",
              }
            );
          } else {
            res.end();
          }
        }
      );
    }
  );

async function shutdown(
  signal
) {
  console.log(
    `[HEXORA] ${signal} received`
  );

  server.close(() => {
    if (pool) {
      pool
        .end()
        .catch(() => {})
        .finally(() =>
          process.exit(0)
        );
    } else {
      process.exit(0);
    }
  });

  setTimeout(
    () => process.exit(1),
    8000
  ).unref();
}

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);

process.on(
  "unhandledRejection",
  (error) =>
    console.error(
      "[HEXORA] Unhandled rejection:",
      error
    )
);

process.on(
  "uncaughtException",
  (error) =>
    console.error(
      "[HEXORA] Uncaught exception:",
      error
    )
);

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `[HEXORA] Search server listening on 0.0.0.0:${PORT}`
    );

    console.log(
      `[HEXORA] DATABASE_URL: ${
        DATABASE_URL
          ? "configured"
          : "missing"
      }`
    );
  }
);
