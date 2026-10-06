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
const SEARCH_CANDIDATE_LIMIT = 2500;

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: DB_POOL_MAX,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false }
});

function sendJson(res, status, data) {
  const body = JSON.stringify(data);

  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS"
  });

  res.end(body);
}

function sendText(
  res,
  status,
  text,
  type = "text/plain; charset=utf-8"
) {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
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
    .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
    .split(/\s+/)
    .map(x => x.trim())
    .filter(Boolean)
    .filter((x, i, arr) => arr.indexOf(x) === i);
}

function safeInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);

  if (!Number.isFinite(n)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, n));
}

function detectIntent(query) {
  const q = query.toLowerCase();

  if (
    /\b(news|latest|today|breaking|recent|updates|update)\b/i.test(q)
  ) {
    return "news";
  }

  if (
    /\b(image|images|photo|photos|picture|pictures|wallpaper)\b/i.test(q)
  ) {
    return "images";
  }

  if (
    /\b(video|videos|watch|youtube)\b/i.test(q)
  ) {
    return "videos";
  }

  if (
    /\b(map|maps|location|directions|where is)\b/i.test(q)
  ) {
    return "maps";
  }

  return "web";
}

/*
 * Current Neon schema does not have is_news/content_type.
 *
 * For now news mode uses published_at / recent crawl data
 * instead of requiring a news-specific column.
 */
function modeCondition(mode) {
  if (mode === "news") {
    return `
      AND p.published_at IS NOT NULL
    `;
  }

  return "";
}

function cleanSnippetText(value) {
  let text = String(value || "");

  text = text
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\{\{[^{}]*\}\}/g, " ")
    .replace(/\\["']/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return text;
}

function makeSnippet(row, query) {
  const source = [
    row.description,
    row.excerpt,
    row.content
  ]
    .map(cleanSnippetText)
    .filter(Boolean)
    .join(" ");

  if (!source) {
    return "";
  }

  const qWords = wordsOf(query);

  let bestPosition = -1;

  for (const word of qWords) {
    const pos = source.toLowerCase().indexOf(word);

    if (
      pos >= 0 &&
      (bestPosition === -1 || pos < bestPosition)
    ) {
      bestPosition = pos;
    }
  }

  let start = 0;

  if (bestPosition > 0) {
    start = Math.max(0, bestPosition - 140);
  }

  let snippet = source
    .slice(start, start + 320)
    .trim();

  if (start > 0) {
    snippet = "… " + snippet;
  }

  if (start + 320 < source.length) {
    snippet += " …";
  }

  return snippet;
}

function resultFromRow(row, query) {
  return {
    id: String(row.id),
    title: row.title || "",
    url: row.url || "",
    canonical_url:
      row.canonical_url ||
      row.url ||
      "",
    domain: row.domain || "",
    source:
      row.domain ||
      "",
    description:
      row.description ||
      "",
    snippet:
      makeSnippet(row, query),
    language:
      row.language ||
      "unknown",
    date:
      row.updated_at ||
      row.last_crawled_at ||
      row.created_at ||
      null,
    published_at:
      row.published_at ||
      null,
    score:
      Number(
        Number(row.final_score || 0).toFixed(5)
      ),
    image:
      row.image_url ||
      null,
    image_items:
      row.image_items ||
      null,
    video_items:
      row.video_items ||
      null
  };
}

function suggestQuery(rows, query) {
  const q = normalizeQuery(query);

  if (!q || q.length < 3) {
    return null;
  }

  const candidate = rows.find(row => {
    const title = String(row.title || "").trim();

    if (!title) {
      return false;
    }

    const similarity = Number(
      row.title_sim || 0
    );

    if (similarity < 0.55) {
      return false;
    }

    const titleWords = wordsOf(title);
    const queryWords = wordsOf(q);

    if (!queryWords.length) {
      return false;
    }

    const matched = queryWords.filter(word =>
      titleWords.includes(word)
    ).length;

    return (
      matched >=
      Math.max(
        1,
        Math.ceil(queryWords.length / 2)
      )
    );
  });

  return candidate
    ? candidate.title
    : null;
}

async function searchDatabase(
  query,
  mode,
  page,
  limit
) {
  const offset = (page - 1) * limit;

  const queryWords = wordsOf(query);

  if (!queryWords.length) {
    return {
      total: 0,
      rows: [],
      suggestion: null
    };
  }

  const intent = detectIntent(query);

  /*
   * Main ranking query.
   *
   * IMPORTANT:
   * Only columns that actually exist in the
   * current Neon pages table are used.
   */
  const sql = `
    WITH params AS (
      SELECT
        lower(trim($1::text)) AS q,
        websearch_to_tsquery(
          'simple',
          $1::text
        ) AS tsq
    ),

    base AS (
      SELECT
        p.*,

        ts_rank_cd(
          COALESCE(
            p.search_vector,
            ''::tsvector
          ),
          params.tsq
        ) AS fts_rank,

        similarity(
          lower(COALESCE(p.title, '')),
          lower(params.q)
        ) AS title_sim,

        similarity(
          lower(COALESCE(p.domain, '')),
          lower(params.q)
        ) AS domain_sim,

        similarity(
          lower(COALESCE(p.url, '')),
          lower(params.q)
        ) AS url_sim,

        CASE
          WHEN lower(
            trim(COALESCE(p.title, ''))
          ) = lower(params.q)
          THEN 1
          ELSE 0
        END AS exact_title,

        CASE
          WHEN lower(
            trim(COALESCE(p.domain, ''))
          ) = lower(params.q)
          THEN 1
          ELSE 0
        END AS exact_domain,

        CASE
          WHEN lower(
            COALESCE(p.title, '')
          ) LIKE lower(params.q) || '%'
          THEN 1
          ELSE 0
        END AS title_starts,

        CASE
          WHEN strpos(
            lower(COALESCE(p.title, '')),
            lower(params.q)
          ) > 0
          THEN 1
          ELSE 0
        END AS title_contains,

        strpos(
          lower(COALESCE(p.title, '')),
          lower(params.q)
        ) AS title_position,

        CASE
          WHEN lower(
            COALESCE(p.description, '')
          ) LIKE
            '%' || lower(params.q) || '%'
          THEN 1
          ELSE 0
        END AS description_phrase,

        CASE
          WHEN lower(
            COALESCE(p.url, '')
          ) LIKE
            '%' || lower(params.q) || '%'
          THEN 1
          ELSE 0
        END AS url_contains,

        (
          SELECT count(*)
          FROM unnest($3::text[]) AS qw(word)
          WHERE
            lower(
              COALESCE(p.title, '')
            ) ~ (
              '(^|[^[:alnum:]])' ||
              regexp_replace(
                lower(qw.word),
                '[^[:alnum:]]',
                '',
                'g'
              ) ||
              '([^[:alnum:]]|$)'
            )
        ) AS title_word_matches,

        (
          SELECT count(*)
          FROM unnest($3::text[]) AS qw(word)
          WHERE
            lower(
              COALESCE(p.description, '')
            ) LIKE
              '%' || lower(qw.word) || '%'
        ) AS description_word_matches,

        (
          SELECT count(*)
          FROM unnest($3::text[]) AS qw(word)
          WHERE
            lower(
              COALESCE(p.excerpt, '')
            ) LIKE
              '%' || lower(qw.word) || '%'
        ) AS excerpt_word_matches,

        (
          SELECT count(*)
          FROM unnest($3::text[]) AS qw(word)
          WHERE
            lower(
              COALESCE(p.content, '')
            ) LIKE
              '%' || lower(qw.word) || '%'
        ) AS content_word_matches

      FROM pages p

      CROSS JOIN params

      WHERE
        (
          COALESCE(
            p.search_vector,
            ''::tsvector
          ) @@ params.tsq

          OR lower(
            COALESCE(p.title, '')
          ) LIKE
            '%' || lower(params.q) || '%'

          OR lower(
            COALESCE(p.description, '')
          ) LIKE
            '%' || lower(params.q) || '%'

          OR lower(
            COALESCE(p.excerpt, '')
          ) LIKE
            '%' || lower(params.q) || '%'

          OR lower(
            COALESCE(p.url, '')
          ) LIKE
            '%' || lower(params.q) || '%'

          OR EXISTS (
            SELECT 1
            FROM unnest($3::text[]) AS qw(word)
            WHERE
              lower(
                COALESCE(p.title, '')
              ) LIKE
                '%' || lower(qw.word) || '%'

              OR lower(
                COALESCE(p.description, '')
              ) LIKE
                '%' || lower(qw.word) || '%'

              OR lower(
                COALESCE(p.excerpt, '')
              ) LIKE
                '%' || lower(qw.word) || '%'

              OR lower(
                COALESCE(p.content, '')
              ) LIKE
                '%' || lower(qw.word) || '%'
          )
        )

        ${modeCondition(mode)}
    ),

    scored AS (
      SELECT
        base.*,

        GREATEST(
          0.0,
          LEAST(
            1.0,

            CASE
              WHEN title_position > 0
              THEN
                1.0 -
                (
                  (
                    title_position - 1
                  )::double precision
                  /
                  GREATEST(
                    length(
                      COALESCE(
                        title,
                        ''
                      )
                    ),
                    1
                  )::double precision
                )

              ELSE 0.0
            END
          )
        ) AS title_focus,

        CASE

          /*
           * TIER 4
           * Exact title.
           */
          WHEN exact_title = 1
          THEN 4

          /*
           * TIER 3
           * Query begins the title.
           */
          WHEN title_starts = 1
          THEN 3

          /*
           * TIER 3
           * Most query words are in title.
           */
          WHEN title_word_matches >=
            GREATEST(
              1,
              CEIL(
                array_length(
                  $3::text[],
                  1
                ) * 0.75
              )
            )
          THEN 3

          /*
           * TIER 2
           *
           * Normal title match.
           *
           * Secondary parenthetical matches
           * are not treated as strong matches.
           */
          WHEN title_contains = 1
            AND NOT (
              lower(
                COALESCE(title, '')
              ) ~ (
                '[[(|:-][[:space:]]*' ||
                regexp_replace(
                  lower(params.q),
                  '[^[:alnum:]]',
                  '',
                  'g'
                ) ||
                '[[:space:]]*[)\\]|:]'
              )
            )
          THEN 2

          WHEN title_word_matches > 0
          THEN 2

          /*
           * TIER 1
           * Description / excerpt / FTS.
           */
          WHEN
            description_phrase = 1
            OR description_word_matches > 0
            OR excerpt_word_matches > 0
            OR fts_rank > 0
          THEN 1

          /*
           * TIER 0
           * Weak/body/reference matches.
           */
          ELSE 0

        END AS relevance_tier

      FROM base

      CROSS JOIN params
    ),

    final_scored AS (
      SELECT
        scored.*,

        (
          CASE
            WHEN relevance_tier = 4
            THEN 5000

            WHEN relevance_tier = 3
            THEN 3000

            WHEN relevance_tier = 2
            THEN 1800

            WHEN relevance_tier = 1
            THEN 600

            ELSE 50
          END

          +

          CASE
            WHEN exact_title = 1
            THEN 2500
            ELSE 0
          END

          +

          CASE
            WHEN title_starts = 1
            THEN 1200
            ELSE 0
          END

          +

          CASE
            WHEN relevance_tier >= 2
            THEN title_word_matches * 500
            ELSE 0
          END

          +

          CASE
            WHEN relevance_tier >= 2
            THEN LEAST(
              title_focus * 700,
              700
            )
            ELSE 0
          END

          +

          LEAST(
            fts_rank * 300,
            300
          )

          +

          LEAST(
            title_sim * 250,
            250
          )

          +

          CASE
            WHEN exact_domain = 1
            THEN 400
            ELSE 0
          END

          +

          CASE
            WHEN url_contains = 1
            THEN 100
            ELSE 0
          END

          +

          LEAST(
            COALESCE(
              authority_score,
              0
            ) * 2,
            100
          )

          +

          LEAST(
            COALESCE(
              quality_score,
              0
            ) * 2,
            80
          )

          +

          LEAST(
            COALESCE(
              popularity_score,
              0
            ) * 2,
            60
          )

          +

          LEAST(
            COALESCE(
              inbound_links,
              0
            ) * 1.5,
            50
          )

          /*
           * Body/reference-only penalty.
           */
          +

          CASE
            WHEN relevance_tier = 0
              AND title_word_matches = 0
              AND description_word_matches = 0
              AND excerpt_word_matches = 0
            THEN -1000
            ELSE 0
          END

          /*
           * Secondary title match penalty.
           *
           * Example:
           * "Punjabi (India) translation..."
           */
          +

          CASE
            WHEN title_contains = 1
              AND title_starts = 0
              AND exact_title = 0
              AND title_word_matches > 0
              AND title_focus < 0.65
            THEN -900
            ELSE 0
          END

          /*
           * Long title / weak focus penalty.
           */
          +

          CASE
            WHEN
              array_length(
                $3::text[],
                1
              ) = 1

              AND title_word_matches > 0

              AND title_focus < 0.45

            THEN -700
            ELSE 0
          END

        ) AS final_score

      FROM scored
    )

    SELECT *
    FROM final_scored

    ORDER BY
      relevance_tier DESC,

      final_score DESC,

      exact_title DESC,

      title_starts DESC,

      title_word_matches DESC,

      title_focus DESC,

      description_word_matches DESC,

      fts_rank DESC,

      title_sim DESC,

      exact_domain DESC,

      authority_score DESC,

      quality_score DESC,

      popularity_score DESC,

      inbound_links DESC,

      id DESC

    LIMIT $5
    OFFSET $6
  `;

  /*
   * Count query.
   */
  const countSql = `
    WITH params AS (
      SELECT
        lower(trim($1::text)) AS q,

        websearch_to_tsquery(
          'simple',
          $1::text
        ) AS tsq
    )

    SELECT COUNT(*)::int AS total

    FROM pages p

    CROSS JOIN params

    WHERE
      (
        COALESCE(
          p.search_vector,
          ''::tsvector
        ) @@ params.tsq

        OR lower(
          COALESCE(p.title, '')
        ) LIKE
          '%' || lower(params.q) || '%'

        OR lower(
          COALESCE(p.description, '')
        ) LIKE
          '%' || lower(params.q) || '%'

        OR lower(
          COALESCE(p.excerpt, '')
        ) LIKE
          '%' || lower(params.q) || '%'

        OR lower(
          COALESCE(p.url, '')
        ) LIKE
          '%' || lower(params.q) || '%'

        OR EXISTS (
          SELECT 1

          FROM unnest($2::text[]) AS qw(word)

          WHERE
            lower(
              COALESCE(p.title, '')
            ) LIKE
              '%' || lower(qw.word) || '%'

            OR lower(
              COALESCE(p.description, '')
            ) LIKE
              '%' || lower(qw.word) || '%'

            OR lower(
              COALESCE(p.excerpt, '')
            ) LIKE
              '%' || lower(qw.word) || '%'

            OR lower(
              COALESCE(p.content, '')
            ) LIKE
              '%' || lower(qw.word) || '%'
        )
      )

      ${modeCondition(mode)}
  `;

  const client = await pool.connect();

  try {
    const countResult = await client.query(
      countSql,
      [
        query,
        queryWords
      ]
    );

    const total = Number(
      countResult.rows[0]?.total || 0
    );

    /*
     * Suggestion candidates.
     */
    const candidateSql = `
      SELECT
        p.id,
        p.title,

        similarity(
          lower(COALESCE(p.title, '')),
          lower($1)
        ) AS title_sim

      FROM pages p

      WHERE
        lower(
          COALESCE(p.title, '')
        ) LIKE
          '%' || lower($1) || '%'

      ORDER BY
        similarity(
          lower(COALESCE(p.title, '')),
          lower($1)
        ) DESC

      LIMIT 50
    `;

    const candidateResult =
      await client.query(
        candidateSql,
        [query]
      );

    const suggestion =
      suggestQuery(
        candidateResult.rows,
        query
      );

    const dataResult =
      await client.query(
        sql,
        [
          query,
          mode,
          queryWords,
          intent,
          Math.min(
            SEARCH_CANDIDATE_LIMIT,
            limit
          ),
          offset
        ]
      );

    /*
     * Domain diversification.
     *
     * Maximum 3 results per domain.
     */
    const diversified = [];
    const domainCounts = new Map();

    for (
      const row of dataResult.rows
    ) {
      let domain =
        String(
          row.domain || ""
        ).toLowerCase();

      if (!domain) {
        try {
          domain =
            new URL(
              row.url || ""
            ).hostname.toLowerCase();
        } catch {
          domain = "unknown";
        }
      }

      const count =
        domainCounts.get(domain) || 0;

      if (count >= 3) {
        continue;
      }

      domainCounts.set(
        domain,
        count + 1
      );

      diversified.push(row);

      if (
        diversified.length >= limit
      ) {
        break;
      }
    }

    return {
      total,
      rows: diversified,
      suggestion
    };

  } finally {
    client.release();
  }
}

async function getNews(limit = 20) {
  /*
   * No is_news/content_type column exists.
   *
   * Use pages having published_at as the current
   * news candidate source.
   */
  const sql = `
    SELECT *
    FROM pages

    WHERE
      published_at IS NOT NULL

    ORDER BY
      published_at DESC NULLS LAST,

      updated_at DESC NULLS LAST,

      COALESCE(
        quality_score,
        0
      ) DESC

    LIMIT $1
  `;

  const result =
    await pool.query(
      sql,
      [limit]
    );

  return result.rows.map(
    row =>
      resultFromRow(
        row,
        ""
      )
  );
}

async function getMedia(
  type,
  query,
  limit
) {
  const q =
    normalizeQuery(query);

  if (!q) {
    return [];
  }

  let condition = "";

  if (type === "images") {
    condition = `
      AND (
        COALESCE(
          image_url,
          ''
        ) <> ''

        OR image_items IS NOT NULL
      )
    `;
  }

  if (type === "videos") {
    condition = `
      AND video_items IS NOT NULL
    `;
  }

  const sql = `
    SELECT *
    FROM pages

    WHERE
      (
        lower(
          COALESCE(title, '')
        ) LIKE
          '%' || lower($1) || '%'

        OR lower(
          COALESCE(description, '')
        ) LIKE
          '%' || lower($1) || '%'

        OR lower(
          COALESCE(content, '')
        ) LIKE
          '%' || lower($1) || '%'
      )

      ${condition}

    ORDER BY

      CASE
        WHEN lower(
          COALESCE(title, '')
        ) = lower($1)
        THEN 1
        ELSE 0
      END DESC,

      COALESCE(
        quality_score,
        0
      ) DESC,

      COALESCE(
        popularity_score,
        0
      ) DESC,

      COALESCE(
        authority_score,
        0
      ) DESC

    LIMIT $2
  `;

  const result =
    await pool.query(
      sql,
      [
        q,
        limit
      ]
    );

  return result.rows.map(
    row => ({
      id: String(row.id),

      title:
        row.title || "",

      url:
        row.url || "",

      canonical_url:
        row.canonical_url ||
        row.url ||
        "",

      domain:
        row.domain || "",

      description:
        row.description || "",

      image:
        row.image_url ||
        null,

      image_items:
        row.image_items ||
        null,

      video_items:
        row.video_items ||
        null,

      date:
        row.updated_at ||
        row.last_crawled_at ||
        row.created_at ||
        null
    })
  );
}

async function healthCheck() {
  try {
    await pool.query(
      "SELECT 1"
    );

    return {
      success: true,
      status: "ok",
      engine:
        "HEXORA Independent Search Engine",
      database:
        "Neon PostgreSQL",
      database_status:
        "connected",
      index_source:
        "HEXORA indexed data in Neon",
      raw_storage:
        "Cloudflare R2"
    };

  } catch (error) {
    return {
      success: false,
      status: "error",
      engine:
        "HEXORA Independent Search Engine",
      database:
        "Neon PostgreSQL",
      database_status:
        "disconnected",
      error:
        error.message
    };
  }
}

function safeFilePath(
  urlPath
) {
  let pathname =
    decodeURIComponent(
      urlPath
    );

  if (pathname === "/") {
    pathname =
      "/index.html";
  }

  pathname =
    pathname.replace(
      /\0/g,
      ""
    );

  const filePath =
    path.normalize(
      path.join(
        __dirname,
        pathname
      )
    );

  const root =
    path.normalize(
      __dirname
    );

  if (
    filePath !== root &&
    !filePath.startsWith(
      root + path.sep
    )
  ) {
    return null;
  }

  return filePath;
}

function contentType(
  filePath
) {
  const ext =
    path.extname(
      filePath
    ).toLowerCase();

  const types = {
    ".html":
      "text/html; charset=utf-8",

    ".js":
      "text/javascript; charset=utf-8",

    ".mjs":
      "text/javascript; charset=utf-8",

    ".css":
      "text/css; charset=utf-8",

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

    ".gif":
      "image/gif",

    ".ico":
      "image/x-icon",

    ".txt":
      "text/plain; charset=utf-8"
  };

  return (
    types[ext] ||
    "application/octet-stream"
  );
}

async function serveStatic(
  req,
  res,
  pathname
) {
  const filePath =
    safeFilePath(
      pathname
    );

  if (!filePath) {
    return sendText(
      res,
      403,
      "Forbidden"
    );
  }

  try {
    const stat =
      await fs.promises.stat(
        filePath
      );

    if (!stat.isFile()) {
      return sendText(
        res,
        404,
        "Not Found"
      );
    }

    res.writeHead(
      200,
      {
        "Content-Type":
          contentType(filePath),

        "Cache-Control":
          "public, max-age=300",

        "Access-Control-Allow-Origin":
          "*"
      }
    );

    fs.createReadStream(
      filePath
    ).pipe(res);

  } catch {
    const indexPath =
      path.join(
        __dirname,
        "index.html"
      );

    try {
      const data =
        await fs.promises.readFile(
          indexPath
        );

      res.writeHead(
        200,
        {
          "Content-Type":
            "text/html; charset=utf-8",

          "Cache-Control":
            "no-cache",

          "Access-Control-Allow-Origin":
            "*"
        }
      );

      res.end(data);

    } catch {
      sendText(
        res,
        404,
        "HEXORA page not found"
      );
    }
  }
}

const server =
  http.createServer(
    async (req, res) => {
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

              "Access-Control-Allow-Headers":
                "Content-Type",

              "Access-Control-Allow-Methods":
                "GET, OPTIONS"
            }
          );

          return res.end();
        }

        const requestUrl =
          new URL(
            req.url || "/",
            `http://${req.headers.host || "localhost"}`
          );

        const pathname =
          requestUrl.pathname;

        /*
         * HEALTH
         */
        if (
          pathname === "/health" ||
          pathname === "/api/health"
        ) {
          const health =
            await healthCheck();

          return sendJson(
            res,
            health.success
              ? 200
              : 503,
            health
          );
        }

        /*
         * SEARCH
         */
        if (
          pathname === "/search" ||
          pathname === "/api/search"
        ) {
          const query =
            normalizeQuery(
              requestUrl.searchParams.get(
                "q"
              ) ||
              requestUrl.searchParams.get(
                "query"
              ) ||
              ""
            );

          const mode =
            String(
              requestUrl.searchParams.get(
                "mode"
              ) ||
              "web"
            ).toLowerCase();

          const page =
            safeInt(
              requestUrl.searchParams.get(
                "page"
              ),
              1,
              1,
              MAX_PAGE
            );

          const limit =
            safeInt(
              requestUrl.searchParams.get(
                "limit"
              ),
              DEFAULT_LIMIT,
              1,
              MAX_LIMIT
            );

          if (!query) {
            return sendJson(
              res,
              400,
              {
                success: false,
                error:
                  "Search query is required"
              }
            );
          }

          const safeMode =
            [
              "web",
              "news",
              "images",
              "videos",
              "maps"
            ].includes(mode)
              ? mode
              : "web";

          if (
            safeMode ===
            "images"
          ) {
            const results =
              await getMedia(
                "images",
                query,
                limit
              );

            return sendJson(
              res,
              200,
              {
                success: true,
                engine: "HEXORA",
                query,
                mode: "images",
                page,
                limit,
                total:
                  results.length,
                results
              }
            );
          }

          if (
            safeMode ===
            "videos"
          ) {
            const results =
              await getMedia(
                "videos",
                query,
                limit
              );

            return sendJson(
              res,
              200,
              {
                success: true,
                engine: "HEXORA",
                query,
                mode: "videos",
                page,
                limit,
                total:
                  results.length,
                results
              }
            );
          }

          if (
            safeMode ===
            "news"
          ) {
            const results =
              await searchDatabase(
                query,
                "news",
                page,
                limit
              );

            return sendJson(
              res,
              200,
              {
                success: true,
                engine: "HEXORA",
                query,
                mode: "news",
                page,
                limit,
                total:
                  results.total,
                suggestion:
                  results.suggestion,
                results:
                  results.rows.map(
                    row =>
                      resultFromRow(
                        row,
                        query
                      )
                  )
              }
            );
          }

          if (
            safeMode ===
            "maps"
          ) {
            const results =
              await searchDatabase(
                query,
                "web",
                page,
                limit
              );

            return sendJson(
              res,
              200,
              {
                success: true,
                engine: "HEXORA",
                query,
                mode: "maps",
                page,
                limit,
                total:
                  results.total,
                suggestion:
                  results.suggestion,
                results:
                  results.rows.map(
                    row =>
                      resultFromRow(
                        row,
                        query
                      )
                  )
              }
            );
          }

          const results =
            await searchDatabase(
              query,
              "web",
              page,
              limit
            );

          return sendJson(
            res,
            200,
            {
              success: true,
              engine: "HEXORA",
              query,
              mode: "web",
              page,
              limit,
              total:
                results.total,
              suggestion:
                results.suggestion,
              results:
                results.rows.map(
                  row =>
                    resultFromRow(
                      row,
                      query
                    )
                )
            }
          );
        }

        /*
         * NEWS
         */
        if (
          pathname === "/news" ||
          pathname === "/api/news"
        ) {
          const limit =
            safeInt(
              requestUrl.searchParams.get(
                "limit"
              ),
              DEFAULT_LIMIT,
              1,
              MAX_LIMIT
            );

          const results =
            await getNews(
              limit
            );

          return sendJson(
            res,
            200,
            {
              success: true,
              engine: "HEXORA",
              mode: "news",
              total:
                results.length,
              results
            }
          );
        }

        /*
         * IMAGES
         */
        if (
          pathname === "/images" ||
          pathname === "/api/images"
        ) {
          const query =
            normalizeQuery(
              requestUrl.searchParams.get(
                "q"
              ) || ""
            );

          const limit =
            safeInt(
              requestUrl.searchParams.get(
                "limit"
              ),
              DEFAULT_LIMIT,
              1,
              MAX_LIMIT
            );

          const results =
            await getMedia(
              "images",
              query,
              limit
            );

          return sendJson(
            res,
            200,
            {
              success: true,
              engine: "HEXORA",
              mode: "images",
              query,
              total:
                results.length,
              results
            }
          );
        }

        /*
         * VIDEOS
         */
        if (
          pathname === "/videos" ||
          pathname === "/api/videos"
        ) {
          const query =
            normalizeQuery(
              requestUrl.searchParams.get(
                "q"
              ) || ""
            );

          const limit =
            safeInt(
              requestUrl.searchParams.get(
                "limit"
              ),
              DEFAULT_LIMIT,
              1,
              MAX_LIMIT
            );

          const results =
            await getMedia(
              "videos",
              query,
              limit
            );

          return sendJson(
            res,
            200,
            {
              success: true,
              engine: "HEXORA",
              mode: "videos",
              query,
              total:
                results.length,
              results
            }
          );
        }

        /*
         * MAPS
         */
        if (
          pathname === "/maps" ||
          pathname === "/api/maps"
        ) {
          const query =
            normalizeQuery(
              requestUrl.searchParams.get(
                "q"
              ) || ""
            );

          if (!query) {
            return sendJson(
              res,
              400,
              {
                success: false,
                error:
                  "Search query is required"
              }
            );
          }

          const results =
            await searchDatabase(
              query,
              "web",
              1,
              20
            );

          return sendJson(
            res,
            200,
            {
              success: true,
              engine: "HEXORA",
              mode: "maps",
              query,
              total:
                results.total,
              results:
                results.rows.map(
                  row =>
                    resultFromRow(
                      row,
                      query
                    )
                )
            }
          );
        }

        /*
         * STATIC FRONTEND
         */
        return await serveStatic(
          req,
          res,
          pathname
        );

      } catch (error) {
        console.error(
          "HEXORA SERVER ERROR:",
          error
        );

        return sendJson(
          res,
          500,
          {
            success: false,
            engine: "HEXORA",
            error:
              "Internal server error",
            message:
              error.message
          }
        );
      }
    }
  );

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `HEXORA server running on port ${PORT}`
    );
  }
);

process.on(
  "SIGTERM",
  async () => {
    console.log(
      "SIGTERM received"
    );

    try {
      await pool.end();
    } catch {}

    server.close(
      () => {
        process.exit(0);
      }
    );
  }
);

process.on(
  "SIGINT",
  async () => {
    console.log(
      "SIGINT received"
    );

    try {
      await pool.end();
    } catch {}

    server.close(
      () => {
        process.exit(0);
      }
    );
  }
);
