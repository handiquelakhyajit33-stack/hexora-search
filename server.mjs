import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 8080);
const DATABASE_URL = String(
  process.env.DATABASE_URL || ""
).trim();

const DB_POOL_MAX = Number(
  process.env.DB_POOL_MAX || 10
);

const MAX_QUERY_LENGTH = 300;
const MAX_PAGE = 10000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const SEARCH_CANDIDATE_LIMIT = 10000;

/* =========================================================
   DATABASE
========================================================= */

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: DB_POOL_MAX,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false }
});

pool.on("error", (error) => {
  console.error(
    "[HEXORA] PostgreSQL pool error:",
    error?.message || error
  );
});

/* =========================================================
   HELPERS
========================================================= */

function sendJson(res, status, data) {
  const body = JSON.stringify(data);

  res.writeHead(status, {
    "Content-Type":
      "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length":
      Buffer.byteLength(body)
  });

  res.end(body);
}

function sendText(
  res,
  status,
  text,
  contentType = "text/plain; charset=utf-8"
) {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(text)
  });

  res.end(text);
}

function normalizeQuery(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_QUERY_LENGTH);
}

function wordsOf(value) {
  return normalizeQuery(value)
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 40);
}

function safeInt(
  value,
  fallback,
  min,
  max
) {
  const n = Number.parseInt(value, 10);

  if (!Number.isFinite(n)) {
    return fallback;
  }

  return Math.min(
    max,
    Math.max(min, n)
  );
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;

      if (body.length > 1024 * 1024) {
        reject(
          new Error(
            "Request body too large"
          )
        );

        req.destroy();
      }
    });

    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(
          new Error(
            "Invalid JSON body"
          )
        );
      }
    });

    req.on("error", reject);
  });
}

function cleanAdText(
  value,
  max = 500
) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function normalizeAdKeywords(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        cleanAdText(
          item,
          100
        ).toLowerCase()
      )
      .filter(Boolean)
      .slice(0, 50);
  }

  return String(value || "")
    .split(",")
    .map((item) =>
      cleanAdText(
        item,
        100
      ).toLowerCase()
    )
    .filter(Boolean)
    .slice(0, 50);
}

function detectIntent(query) {
  const q =
    query.toLocaleLowerCase();

  if (
    /\b(news|latest|today|breaking|current|update|updates)\b/i.test(
      q
    )
  ) {
    return "news";
  }

  if (
    /\b(image|images|photo|photos|picture|pictures)\b/i.test(
      q
    )
  ) {
    return "images";
  }

  if (
    /\b(video|videos|watch)\b/i.test(
      q
    )
  ) {
    return "videos";
  }

  if (
    /\b(map|maps|location|directions)\b/i.test(
      q
    )
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
    .replace(
      /<script[\s\S]*?<\/script>/gi,
      " "
    )
    .replace(
      /<style[\s\S]*?<\/style>/gi,
      " "
    )
    .replace(
      /<noscript[\s\S]*?<\/noscript>/gi,
      " "
    )
    .replace(
      /<[^>]+>/g,
      " "
    )
    .replace(
      /&nbsp;/gi,
      " "
    )
    .replace(
      /&amp;/gi,
      "&"
    )
    .replace(
      /&quot;/gi,
      '"'
    )
    .replace(
      /&#39;/gi,
      "'"
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

function makeSnippet(row) {
  const description =
    cleanSnippetText(
      row.description
    );

  if (description) {
    return description.slice(
      0,
      320
    );
  }

  const excerpt =
    cleanSnippetText(
      row.excerpt
    );

  if (excerpt) {
    return excerpt.slice(
      0,
      320
    );
  }

  const content =
    cleanSnippetText(
      row.content
    );

  if (content) {
    return content.slice(
      0,
      320
    );
  }

  return "";
}

function resultFromRow(row) {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    canonical_url:
      row.canonical_url ||
      row.url,
    domain: row.domain,
    source:
      row.source ||
      row.domain,
    description:
      cleanSnippetText(
        row.description
      ),
    snippet:
      makeSnippet(row),
    language: row.language,
    date: row.date,
    published_at:
      row.published_at,
    score:
      Number(
        row.final_score || 0
      ),
    image:
      row.image || null,
    image_items:
      row.image_items || [],
    video_items:
      row.video_items || []
  };
}

/* =========================================================
   SEARCH DEMAND
========================================================= */

async function recordSearchDemand(
  query
) {
  const normalized =
    normalizeQuery(query)
      .toLocaleLowerCase();

  if (
    !normalized ||
    normalized.length < 2
  ) {
    return;
  }

  try {
    await pool.query(
      `
      INSERT INTO search_queries (
        query,
        normalized_query,
        search_count,
        crawl_priority,
        first_searched_at,
        last_searched_at,
        status,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        1,
        1,
        NOW(),
        NOW(),
        'pending',
        NOW(),
        NOW()
      )

      ON CONFLICT (normalized_query)

      DO UPDATE SET
        query =
          EXCLUDED.query,

        search_count =
          search_queries.search_count + 1,

        crawl_priority =
          LEAST(
            search_queries.crawl_priority + 1,
            100000
          ),

        last_searched_at =
          NOW(),

        status =
          CASE
            WHEN search_queries.status = 'done'
            THEN 'pending'
            ELSE search_queries.status
          END,

        updated_at =
          NOW()
      `,
      [
        query,
        normalized
      ]
    );
  } catch (error) {
    console.error(
      "[HEXORA] Search demand log failed:",
      error?.message || error
    );
  }
}

/* =========================================================
   SEARCH
========================================================= */

async function searchDatabase(
  query,
  mode,
  page,
  limit
) {
  const queryWords =
    wordsOf(query);

  const wordCount =
    Math.max(
      queryWords.length,
      1
    );

  const offset =
    (page - 1) * limit;

  const intent =
    detectIntent(query);

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

    candidate AS (
      SELECT
        p.*,

        CASE
          WHEN lower(
            trim(
              coalesce(
                p.title,
                ''
              )
            )
          ) = params.q
          THEN 1
          ELSE 0
        END AS exact_title,

        CASE
          WHEN lower(
            trim(
              coalesce(
                p.title,
                ''
              )
            )
          )
          LIKE params.q || '%'
          THEN 1
          ELSE 0
        END AS title_starts,

        CASE
          WHEN lower(
            coalesce(
              p.title,
              ''
            )
          )
          LIKE '%' ||
            params.q ||
            '%'
          THEN 1
          ELSE 0
        END AS title_phrase,

        CASE
          WHEN lower(
            coalesce(
              p.description,
              ''
            )
          )
          LIKE '%' ||
            params.q ||
            '%'
          THEN 1
          ELSE 0
        END AS description_phrase,

        CASE
          WHEN lower(
            coalesce(
              p.excerpt,
              ''
            )
          )
          LIKE '%' ||
            params.q ||
            '%'
          THEN 1
          ELSE 0
        END AS excerpt_phrase,

        CASE
          WHEN lower(
            coalesce(
              p.url,
              ''
            )
          )
          LIKE '%' ||
            params.q ||
            '%'
          THEN 1
          ELSE 0
        END AS url_phrase,

        CASE
          WHEN lower(
            coalesce(
              p.domain,
              ''
            )
          ) = params.q
          THEN 1
          ELSE 0
        END AS exact_domain,

        (
          SELECT count(*)
          FROM unnest(
            $3::text[]
          ) AS w(word)
          WHERE lower(
            coalesce(
              p.title,
              ''
            )
          )
          LIKE '%' ||
            lower(w.word) ||
            '%'
        ) AS title_word_matches,

        (
          SELECT count(*)
          FROM unnest(
            $3::text[]
          ) AS w(word)
          WHERE lower(
            coalesce(
              p.description,
              ''
            )
          )
          LIKE '%' ||
            lower(w.word) ||
            '%'
        ) AS description_word_matches,

        (
          SELECT count(*)
          FROM unnest(
            $3::text[]
          ) AS w(word)
          WHERE lower(
            coalesce(
              p.excerpt,
              ''
            )
          )
          LIKE '%' ||
            lower(w.word) ||
            '%'
        ) AS excerpt_word_matches,

        (
          SELECT count(*)
          FROM unnest(
            $3::text[]
          ) AS w(word)
          WHERE lower(
            coalesce(
              p.content,
              ''
            )
          )
          LIKE '%' ||
            lower(w.word) ||
            '%'
        ) AS content_word_matches,

        ts_rank_cd(
          coalesce(
            p.search_vector,
            ''::tsvector
          ),
          params.tsq,
          32
        ) AS fts_rank,

        similarity(
          lower(
            coalesce(
              p.title,
              ''
            )
          ),
          params.q
        ) AS title_similarity,

        similarity(
          lower(
            coalesce(
              p.domain,
              ''
            )
          ),
          params.q
        ) AS domain_similarity,

        CASE
          WHEN p.published_at IS NULL
            THEN 0.0

          WHEN p.published_at >=
            NOW() - INTERVAL '1 day'
            THEN 1.0

          WHEN p.published_at >=
            NOW() - INTERVAL '7 days'
            THEN 0.85

          WHEN p.published_at >=
            NOW() - INTERVAL '30 days'
            THEN 0.65

          WHEN p.published_at >=
            NOW() - INTERVAL '180 days'
            THEN 0.40

          WHEN p.published_at >=
            NOW() - INTERVAL '1 year'
            THEN 0.20

          ELSE 0.05
        END AS freshness

      FROM pages p

      CROSS JOIN params

      WHERE
        (
          lower(
            trim(
              coalesce(
                p.title,
                ''
              )
            )
          ) = params.q

          OR lower(
            coalesce(
              p.title,
              ''
            )
          )
          LIKE params.q || '%'

          OR lower(
            coalesce(
              p.title,
              ''
            )
          )
          LIKE '%' ||
            params.q ||
            '%'

          OR (
            array_length(
              $3::text[],
              1
            ) > 1

            AND coalesce(
              p.search_vector,
              ''::tsvector
            ) @@ params.tsq
          )

          OR lower(
            coalesce(
              p.description,
              ''
            )
          )
          LIKE '%' ||
            params.q ||
            '%'

          OR lower(
            coalesce(
              p.excerpt,
              ''
            )
          )
          LIKE '%' ||
            params.q ||
            '%'

          OR lower(
            coalesce(
              p.url,
              ''
            )
          )
          LIKE '%' ||
            params.q ||
            '%'

          OR EXISTS (
            SELECT 1
            FROM unnest(
              $3::text[]
            ) AS w(word)

            WHERE lower(
              coalesce(
                p.title,
                ''
              )
            )
            LIKE '%' ||
              lower(w.word) ||
              '%'
          )

          OR (
            array_length(
              $3::text[],
              1
            ) > 1

            AND (
              SELECT count(*)
              FROM unnest(
                $3::text[]
              ) AS w(word)

              WHERE lower(
                coalesce(
                  p.description,
                  ''
                )
              )
              LIKE '%' ||
                lower(w.word) ||
                '%'
            ) >= 2
          )

          OR (
            array_length(
              $3::text[],
              1
            ) > 1

            AND (
              SELECT count(*)
              FROM unnest(
                $3::text[]
              ) AS w(word)

              WHERE lower(
                coalesce(
                  p.excerpt,
                  ''
                )
              )
              LIKE '%' ||
                lower(w.word) ||
                '%'
            ) >= 2
          )

          OR (
            array_length(
              $3::text[],
              1
            ) > 1

            AND (
              SELECT count(*)
              FROM unnest(
                $3::text[]
              ) AS w(word)

              WHERE lower(
                coalesce(
                  p.content,
                  ''
                )
              )
              LIKE '%' ||
                lower(w.word) ||
                '%'
            )::numeric

            >= GREATEST(
              CEIL(
                array_length(
                  $3::text[],
                  1
                ) * 0.5
              ),
              2
            )
          )
        )

        ${modeCondition(mode)}

      LIMIT $5
    ),

    scored AS (
      SELECT
        candidate.*,

        LEAST(
          title_word_matches::numeric /
          ${wordCount}::numeric,
          1
        ) AS title_coverage,

        LEAST(
          description_word_matches::numeric /
          ${wordCount}::numeric,
          1
        ) AS description_coverage,

        LEAST(
          content_word_matches::numeric /
          ${wordCount}::numeric,
          1
        ) AS content_coverage

      FROM candidate
    ),

    ranked AS (
      SELECT
        scored.*,

        (
          exact_title * 10000000

          +

          title_starts * 1500000

          +

          title_phrase * 800000

          +

          title_coverage * 700000

          +

          LEAST(
            title_word_matches,
            ${wordCount}
          ) * 150000

          +

          title_similarity * 150000

          +

          LEAST(
            fts_rank * 100000,
            500000
          )

          +

          description_phrase * 50000

          +

          description_coverage * 50000

          +

          excerpt_phrase * 25000

          +

          url_phrase * 15000

          +

          exact_domain * 100000

          +

          domain_similarity * 10000

          +

          LEAST(
            GREATEST(
              coalesce(
                authority_score,
                0
              ),
              0
            ),
            100
          ) * 1000

          +

          LEAST(
            GREATEST(
              coalesce(
                quality_score,
                0
              ),
              0
            ),
            100
          ) * 600

          +

          LEAST(
            GREATEST(
              coalesce(
                popularity_score,
                0
              ),
              0
            ),
            100
          ) * 300

          +

          LEAST(
            GREATEST(
              coalesce(
                inbound_links,
                0
              ),
              0
            ),
            100
          ) * 200

          +

          freshness * 5000

          +

          LEAST(
            content_word_matches,
            ${wordCount}
          ) * 300

          -

          CASE
            WHEN
              title_word_matches = 0
              AND title_phrase = 0
              AND exact_title = 0
              AND title_starts = 0
              AND description_phrase = 0
              AND excerpt_phrase = 0
              AND url_phrase = 0
            THEN 250000
            ELSE 0
          END

          -

          CASE
            WHEN
              title_word_matches = 0
              AND length(
                coalesce(
                  title,
                  ''
                )
              ) > 100
            THEN 50000
            ELSE 0
          END

        ) AS final_score

      FROM scored
    )

    SELECT *
    FROM ranked

    ORDER BY
      final_score DESC,

      exact_title DESC,
      title_starts DESC,
      title_phrase DESC,
      title_coverage DESC,
      title_word_matches DESC,

      fts_rank DESC,
      title_similarity DESC,

      description_phrase DESC,
      description_coverage DESC,

      exact_domain DESC,
      authority_score DESC,
      quality_score DESC,
      popularity_score DESC,
      inbound_links DESC,

      freshness DESC,

      id DESC

    LIMIT $5
    OFFSET $6
  `;

  const countSql = `
    SELECT
      COUNT(*)::int AS count

    FROM pages p

    WHERE
      (
        lower(
          trim(
            coalesce(
              p.title,
              ''
            )
          )
        )
        =
        lower(
          trim(
            $1::text
          )
        )

        OR

        lower(
          coalesce(
            p.title,
            ''
          )
        )
        LIKE '%' ||
          lower(
            trim(
              $1::text
            )
          ) ||
          '%'

        OR

        lower(
          coalesce(
            p.description,
            ''
          )
        )
        LIKE '%' ||
          lower(
            trim(
              $1::text
            )
          ) ||
          '%'

        OR

        lower(
          coalesce(
            p.excerpt,
            ''
          )
        )
        LIKE '%' ||
          lower(
            trim(
              $1::text
            )
          ) ||
          '%'

        OR

        lower(
          coalesce(
            p.url,
            ''
          )
        )
        LIKE '%' ||
          lower(
            trim(
              $1::text
            )
          ) ||
          '%'

        OR

        coalesce(
          p.search_vector,
          ''::tsvector
        )
        @@ websearch_to_tsquery(
          'simple',
          $1::text
        )

        OR EXISTS (
          SELECT 1
          FROM unnest(
            $2::text[]
          ) AS w(word)

          WHERE lower(
            coalesce(
              p.title,
              ''
            )
          )
          LIKE '%' ||
            lower(w.word) ||
            '%'
        )

        OR (
          array_length(
            $2::text[],
            1
          ) > 1

          AND (
            SELECT count(*)
            FROM unnest(
              $2::text[]
            ) AS w(word)

            WHERE lower(
              coalesce(
                p.description,
                ''
              )
            )
            LIKE '%' ||
              lower(w.word) ||
              '%'
          ) >= 2
        )

        OR (
          array_length(
            $2::text[],
            1
          ) > 1

          AND (
            SELECT count(*)
            FROM unnest(
              $2::text[]
            ) AS w(word)

            WHERE lower(
              coalesce(
                p.content,
                ''
              )
            )
            LIKE '%' ||
              lower(w.word) ||
              '%'
          ) >= 2
        )
      )

      ${modeCondition(mode)}
  `;

  const suggestionSql = `
    SELECT
      id,
      title,
      url,
      domain,

      similarity(
        lower(
          coalesce(
            title,
            ''
          )
        ),
        lower(
          $1::text
        )
      ) AS similarity_score

    FROM pages

    WHERE
      lower(
        coalesce(
          title,
          ''
        )
      )
      LIKE '%' ||
        lower(
          $1::text
        ) ||
        '%'

    ORDER BY
      similarity_score DESC,
      id DESC

    LIMIT 50
  `;

  const dataParams = [
    query,
    mode,
    queryWords,
    intent,
    SEARCH_CANDIDATE_LIMIT,
    offset
  ];

  const [
    dataResult,
    countResult,
    suggestionResult
  ] = await Promise.all([
    pool.query(
      dataSql,
      dataParams
    ),

    pool.query(
      countSql,
      [
        query,
        queryWords
      ]
    ),

    pool.query(
      suggestionSql,
      [query]
    )
  ]);

  const rows =
    dataResult.rows || [];

  const exact =
    rows.filter(
      (r) =>
        Number(
          r.exact_title
        ) === 1
    );

  const nonExact =
    rows.filter(
      (r) =>
        Number(
          r.exact_title
        ) !== 1
    );

  const finalRows = [];
  const seenUrls = new Set();
  const domainCount = new Map();

  for (const row of exact) {
    const key =
      String(
        row.canonical_url ||
        row.url ||
        row.id
      );

    if (seenUrls.has(key)) {
      continue;
    }

    seenUrls.add(key);
    finalRows.push(row);

    if (
      finalRows.length >=
      limit
    ) {
      break;
    }
  }

  if (
    finalRows.length <
    limit
  ) {
    for (const row of nonExact) {
      if (
        finalRows.length >=
        limit
      ) {
        break;
      }

      const key =
        String(
          row.canonical_url ||
          row.url ||
          row.id
        );

      if (seenUrls.has(key)) {
        continue;
      }

      const domain =
        String(
          row.domain || ""
        ).toLocaleLowerCase();

      const count =
        domainCount.get(
          domain
        ) || 0;

      if (count >= 3) {
        continue;
      }

      seenUrls.add(key);
      finalRows.push(row);

      domainCount.set(
        domain,
        count + 1
      );
    }
  }

  return {
    query,
    mode,
    intent,
    page,
    limit,

    total:
      Number(
        countResult.rows?.[0]?.count ||
        0
      ),

    results:
      finalRows
        .slice(0, limit)
        .map(resultFromRow),

    suggestions:
      buildSuggestions(
        suggestionResult.rows ||
          []
      )
  };
}

/* =========================================================
   SUGGESTIONS
========================================================= */

function buildSuggestions(
  rows
) {
  const seen = new Set();
  const output = [];

  for (const row of rows) {
    const title =
      String(
        row.title || ""
      ).trim();

    if (!title) {
      continue;
    }

    const key =
      title.toLocaleLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(title);

    if (
      output.length >= 5
    ) {
      break;
    }
  }

  return output;
}

/* =========================================================
   HEXORA ADS / INCOME SYSTEM
========================================================= */

async function createAdvertiser(
  data
) {
  const name =
    cleanAdText(
      data.name,
      150
    );

  const email =
    cleanAdText(
      data.email,
      200
    ).toLowerCase();

  const companyName =
    cleanAdText(
      data.company_name,
      200
    );

  const website =
    cleanAdText(
      data.website,
      1000
    );

  if (!name || !email) {
    throw new Error(
      "Name and email are required"
    );
  }

  const result =
    await pool.query(
      `
      INSERT INTO advertisers (
        name,
        email,
        company_name,
        website
      )
      VALUES (
        $1,
        $2,
        $3,
        $4
      )
      RETURNING
        id,
        name,
        email,
        company_name,
        website,
        balance,
        total_spent,
        status,
        created_at
      `,
      [
        name,
        email,
        companyName ||
          null,
        website ||
          null
      ]
    );

  return result.rows[0];
}

async function createCampaign(
  data
) {
  const advertiserId =
    safeInt(
      data.advertiser_id,
      0,
      1,
      Number.MAX_SAFE_INTEGER
    );

  const name =
    cleanAdText(
      data.name,
      200
    );

  const dailyBudget =
    Math.max(
      0,
      Number(
        data.daily_budget || 0
      )
    );

  const totalBudget =
    Math.max(
      0,
      Number(
        data.total_budget || 0
      )
    );

  if (
    !advertiserId ||
    !name
  ) {
    throw new Error(
      "advertiser_id and campaign name are required"
    );
  }

  const advertiser =
    await pool.query(
      `
      SELECT id
      FROM advertisers
      WHERE id = $1
        AND status = 'active'
      `,
      [advertiserId]
    );

  if (
    !advertiser.rows.length
  ) {
    throw new Error(
      "Advertiser not found"
    );
  }

  const result =
    await pool.query(
      `
      INSERT INTO ad_campaigns (
        advertiser_id,
        name,
        daily_budget,
        total_budget,
        status
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        'draft'
      )
      RETURNING *
      `,
      [
        advertiserId,
        name,
        dailyBudget,
        totalBudget
      ]
    );

  return result.rows[0];
}

async function createAd(
  data
) {
  const campaignId =
    safeInt(
      data.campaign_id,
      0,
      1,
      Number.MAX_SAFE_INTEGER
    );

  const title =
    cleanAdText(
      data.title,
      150
    );

  const description =
    cleanAdText(
      data.description,
      500
    );

  const destinationUrl =
    cleanAdText(
      data.destination_url,
      2000
    );

  const keywords =
    normalizeAdKeywords(
      data.keywords
    );

  const bidPerClick =
    Math.max(
      0.01,
      Number(
        data.bid_per_click ||
          0.10
      )
    );

  if (
    !campaignId ||
    !title ||
    !destinationUrl
  ) {
    throw new Error(
      "campaign_id, title and destination_url are required"
    );
  }

  try {
    new URL(
      destinationUrl
    );
  } catch {
    throw new Error(
      "Invalid destination URL"
    );
  }

  const campaign =
    await pool.query(
      `
      SELECT id
      FROM ad_campaigns
      WHERE id = $1
      `,
      [campaignId]
    );

  if (
    !campaign.rows.length
  ) {
    throw new Error(
      "Campaign not found"
    );
  }

  const result =
    await pool.query(
      `
      INSERT INTO ads (
        campaign_id,
        title,
        description,
        destination_url,
        keywords,
        bid_per_click,
        status
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        'pending'
      )
      RETURNING *
      `,
      [
        campaignId,
        title,
        description ||
          null,
        destinationUrl,
        keywords,
        bidPerClick
      ]
    );

  return result.rows[0];
}

async function approveAd(
  adId
) {
  const result =
    await pool.query(
      `
      UPDATE ads
      SET
        status = 'active',
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [adId]
    );

  if (
    !result.rows.length
  ) {
    throw new Error(
      "Advertisement not found"
    );
  }

  return result.rows[0];
}

async function getAdvertiserDashboard(
  advertiserId
) {
  const advertiserResult =
    await pool.query(
      `
      SELECT
        id,
        name,
        email,
        company_name,
        website,
        balance,
        total_spent,
        status,
        created_at
      FROM advertisers
      WHERE id = $1
      `,
      [advertiserId]
    );

  if (
    !advertiserResult.rows.length
  ) {
    throw new Error(
      "Advertiser not found"
    );
  }

  const campaigns =
    await pool.query(
      `
      SELECT
        c.*,

        COALESCE(
          SUM(a.impressions),
          0
        )::bigint AS impressions,

        COALESCE(
          SUM(a.clicks),
          0
        )::bigint AS clicks

      FROM ad_campaigns c

      LEFT JOIN ads a
        ON a.campaign_id =
          c.id

      WHERE
        c.advertiser_id =
          $1

      GROUP BY c.id

      ORDER BY
        c.created_at DESC
      `,
      [advertiserId]
    );

  return {
    advertiser:
      advertiserResult.rows[0],

    campaigns:
      campaigns.rows
  };
}

async function getSponsoredAds(
  query,
  limit = 3
) {
  const normalized =
    normalizeQuery(query)
      .toLowerCase();

  if (!normalized) {
    return [];
  }

  const words =
    wordsOf(normalized);

  const result =
    await pool.query(
      `
      SELECT
        a.id,
        a.title,
        a.description,
        a.destination_url,
        a.bid_per_click,
        a.keywords,

        c.id AS campaign_id,
        c.name AS campaign_name

      FROM ads a

      INNER JOIN ad_campaigns c
        ON c.id =
          a.campaign_id

      INNER JOIN advertisers adv
        ON adv.id =
          c.advertiser_id

      WHERE
        a.status = 'active'

        AND c.status = 'active'

        AND adv.status = 'active'

        AND (
          cardinality(
            a.keywords
          ) = 0

          OR EXISTS (
            SELECT 1

            FROM unnest(
              a.keywords
            ) AS keyword

            WHERE
              lower(keyword)
                = ANY(
                  $2::text[]
                )

              OR lower(keyword)
                LIKE '%' ||
                  lower($1::text) ||
                  '%'

              OR lower($1::text)
                LIKE '%' ||
                  lower(keyword) ||
                  '%'
          )
        )

        AND (
          c.total_budget <= 0

          OR c.spent <
            c.total_budget
        )

      ORDER BY
        a.bid_per_click DESC,
        a.id DESC

      LIMIT $3
      `,
      [
        normalized,
        words,
        limit
      ]
    );

  return result.rows;
}

async function recordAdImpression(
  adId,
  query
) {
  const client =
    await pool.connect();

  try {
    await client.query(
      "BEGIN"
    );

    const ad =
      await client.query(
        `
        UPDATE ads
        SET
          impressions =
            impressions + 1,
          updated_at = NOW()

        WHERE
          id = $1
          AND status = 'active'

        RETURNING id
        `,
        [adId]
      );

    if (
      !ad.rows.length
    ) {
      await client.query(
        "ROLLBACK"
      );

      return false;
    }

    await client.query(
      `
      INSERT INTO ad_events (
        ad_id,
        event_type,
        query,
        cost
      )
      VALUES (
        $1,
        'impression',
        $2,
        0
      )
      `,
      [
        adId,
        cleanAdText(
          query,
          300
        )
      ]
    );

    await client.query(
      "COMMIT"
    );

    return true;
  } catch (error) {
    try {
      await client.query(
        "ROLLBACK"
      );
    } catch {}

    throw error;
  } finally {
    client.release();
  }
}

async function recordAdClick(
  adId,
  query
) {
  const client =
    await pool.connect();

  try {
    await client.query(
      "BEGIN"
    );

    const adResult =
      await client.query(
        `
        SELECT
          a.id,
          a.bid_per_click,
          c.id AS campaign_id,
          c.advertiser_id,
          c.total_budget,
          c.spent,
          adv.balance

        FROM ads a

        INNER JOIN ad_campaigns c
          ON c.id =
            a.campaign_id

        INNER JOIN advertisers adv
          ON adv.id =
            c.advertiser_id

        WHERE
          a.id = $1

          AND a.status =
            'active'

          AND c.status =
            'active'

          AND adv.status =
            'active'

        FOR UPDATE
        `,
        [adId]
      );

    if (
      !adResult.rows.length
    ) {
      throw new Error(
        "Advertisement is not active"
      );
    }

    const ad =
      adResult.rows[0];

    const cost =
      Math.max(
        0.01,
        Number(
          ad.bid_per_click || 0
        )
      );

    const currentBalance =
      Number(
        ad.balance || 0
      );

    if (
      currentBalance <
      cost
    ) {
      await client.query(
        `
        UPDATE ads
        SET
          status = 'paused',
          updated_at = NOW()
        WHERE id = $1
        `,
        [adId]
      );

      throw new Error(
        "Advertiser balance is too low"
      );
    }

    if (
      Number(
        ad.total_budget || 0
      ) > 0 &&

      Number(
        ad.spent || 0
      ) + cost >

      Number(
        ad.total_budget
      )
    ) {
      await client.query(
        `
        UPDATE ad_campaigns
        SET
          status = 'paused',
          updated_at = NOW()
        WHERE id = $1
        `,
        [ad.campaign_id]
      );

      throw new Error(
        "Campaign budget exhausted"
      );
    }

    await client.query(
      `
      UPDATE advertisers

      SET
        balance =
          balance - $1,

        total_spent =
          total_spent + $1,

        updated_at =
          NOW()

      WHERE id = $2
      `,
      [
        cost,
        ad.advertiser_id
      ]
    );

    await client.query(
      `
      UPDATE ad_campaigns

      SET
        spent =
          spent + $1,

        updated_at =
          NOW()

      WHERE id = $2
      `,
      [
        cost,
        ad.campaign_id
      ]
    );

    await client.query(
      `
      UPDATE ads

      SET
        clicks =
          clicks + 1,

        updated_at =
          NOW()

      WHERE id = $1
      `,
      [adId]
    );

    await client.query(
      `
      INSERT INTO ad_events (
        ad_id,
        event_type,
        query,
        cost
      )
      VALUES (
        $1,
        'click',
        $2,
        $3
      )
      `,
      [
        adId,
        cleanAdText(
          query,
          300
        ),
        cost
      ]
    );

    await client.query(
      `
      INSERT INTO ad_transactions (
        advertiser_id,
        amount,
        transaction_type,
        reference,
        status
      )
      VALUES (
        $1,
        $2,
        'ad_click',
        $3,
        'completed'
      )
      `,
      [
        ad.advertiser_id,
        cost,
        `ad:${adId}`
      ]
    );

    await client.query(
      "COMMIT"
    );

    return {
      ok: true,
      ad_id: adId,
      charged: cost
    };
  } catch (error) {
    try {
      await client.query(
        "ROLLBACK"
      );
    } catch {}

    throw error;
  } finally {
    client.release();
  }
}

/* =========================================================
   NEWS
========================================================= */

async function getNews(
  limit = 20
) {
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

    WHERE
      published_at IS NOT NULL

    ORDER BY
      published_at DESC NULLS LAST,
      id DESC

    LIMIT $1
  `;

  const result =
    await pool.query(
      sql,
      [limit]
    );

  return result.rows.map(
    resultFromRow
  );
}

/* =========================================================
   MEDIA
========================================================= */

async function getMedia(
  type,
  query,
  limit = 20
) {
  let sql;

  if (
    type === "images"
  ) {
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
        last_crawled_at
          DESC NULLS LAST,
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
        last_crawled_at
          DESC NULLS LAST,
        id DESC

      LIMIT $1
    `;
  }

  const result =
    await pool.query(
      sql,
      [limit]
    );

  return result.rows.map(
    resultFromRow
  );
}

/* =========================================================
   HEALTH
========================================================= */

async function healthCheck() {
  try {
    const result =
      await pool.query(
        `
        SELECT
          NOW() AS now,
          COUNT(*)::bigint AS pages
        FROM pages
        `
      );

    return {
      ok: true,
      database: true,
      pages:
        Number(
          result.rows?.[0]?.pages ||
            0
        ),
      time:
        result.rows?.[0]?.now ||
        null
    };
  } catch (error) {
    return {
      ok: false,
      database: false,
      error:
        error.message
    };
  }
}

/* =========================================================
   STATIC FILES
========================================================= */

function safeStaticPath(
  urlPath
) {
  const clean =
    decodeURIComponent(
      urlPath
    )
      .split("?")[0]
      .replace(/^\/+/, "");

  const filePath =
    path.join(
      __dirname,
      clean
    );

  const root =
    path.resolve(
      __dirname
    );

  const resolved =
    path.resolve(
      filePath
    );

  if (
    resolved !== root &&
    !resolved.startsWith(
      root + path.sep
    )
  ) {
    return null;
  }

  return resolved;
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

    ".ico":
      "image/x-icon"
  };

  return (
    types[ext] ||
    "application/octet-stream"
  );
}

function serveStatic(
  res,
  pathname
) {
  let filePath =
    safeStaticPath(
      pathname
    );

  if (!filePath) {
    sendText(
      res,
      403,
      "Forbidden"
    );

    return true;
  }

  if (
    !fs.existsSync(
      filePath
    ) ||
    !fs.statSync(
      filePath
    ).isFile()
  ) {
    filePath =
      safeStaticPath(
        "index.html"
      );

    if (
      !filePath ||
      !fs.existsSync(
        filePath
      )
    ) {
      return false;
    }
  }

  try {
    const data =
      fs.readFileSync(
        filePath
      );

    res.writeHead(
      200,
      {
        "Content-Type":
          contentType(
            filePath
          ),

        "Content-Length":
          data.length
      }
    );

    res.end(data);

    return true;
  } catch {
    return false;
  }
}

/* =========================================================
   SERVER
========================================================= */

const server =
  http.createServer(
    async (
      req,
      res
    ) => {
      try {
        const requestUrl =
          new URL(
            req.url,
            `http://${
              req.headers.host ||
              "localhost"
            }`
          );

        const pathname =
          requestUrl.pathname;

        /* =================================================
           HEALTH
        ================================================= */

        if (
          pathname ===
            "/health" ||

          pathname ===
            "/api/health"
        ) {
          const health =
            await healthCheck();

          sendJson(
            res,
            health.ok
              ? 200
              : 503,
            health
          );

          return;
        }

        /* =================================================
           SEARCH
        ================================================= */

        if (
          pathname ===
            "/search" ||

          pathname ===
            "/api/search"
        ) {
          const query =
            normalizeQuery(
              requestUrl.searchParams.get(
                "q"
              )
            );

          const mode =
            String(
              requestUrl.searchParams.get(
                "mode"
              ) || "web"
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
            sendJson(
              res,
              400,
              {
                ok: false,
                error:
                  "Search query is required"
              }
            );

            return;
          }

          const data =
            await searchDatabase(
              query,
              mode,
              page,
              limit
            );

          /*
           * Sponsored ads.
           *
           * If the ads database has a problem,
           * normal search must still work.
           */

          let sponsoredAds = [];

          try {
            sponsoredAds =
              await getSponsoredAds(
                query,
                3
              );
          } catch (error) {
            console.error(
              "[HEXORA] Sponsored ads failed:",
              error?.message ||
                error
            );
          }

          recordSearchDemand(
            query
          ).catch(
            (error) => {
              console.error(
                "[HEXORA] Demand tracking error:",
                error?.message ||
                  error
              );
            }
          );

          sendJson(
            res,
            200,
            {
              ok: true,
              ...data,
              sponsored_ads:
                sponsoredAds
            }
          );

          return;
        }

        /* =================================================
           ADS — CREATE ADVERTISER
        ================================================= */

        if (
          pathname ===
            "/api/ads/advertisers" &&

          req.method === "POST"
        ) {
          try {
            const body =
              await parseJsonBody(
                req
              );

            const advertiser =
              await createAdvertiser(
                body
              );

            sendJson(
              res,
              201,
              {
                ok: true,
                advertiser
              }
            );
          } catch (error) {
            sendJson(
              res,
              400,
              {
                ok: false,
                error:
                  error?.message ||
                  "Could not create advertiser"
              }
            );
          }

          return;
        }

        /* =================================================
           ADS — CREATE CAMPAIGN
        ================================================= */

        if (
          pathname ===
            "/api/ads/campaigns" &&

          req.method === "POST"
        ) {
          try {
            const body =
              await parseJsonBody(
                req
              );

            const campaign =
              await createCampaign(
                body
              );

            sendJson(
              res,
              201,
              {
                ok: true,
                campaign
              }
            );
          } catch (error) {
            sendJson(
              res,
              400,
              {
                ok: false,
                error:
                  error?.message ||
                  "Could not create campaign"
              }
            );
          }

          return;
        }

        /* =================================================
           ADS — CREATE AD
        ================================================= */

        if (
          pathname ===
            "/api/ads" &&

          req.method === "POST"
        ) {
          try {
            const body =
              await parseJsonBody(
                req
              );

            const ad =
              await createAd(
                body
              );

            sendJson(
              res,
              201,
              {
                ok: true,
                ad
              }
            );
          } catch (error) {
            sendJson(
              res,
              400,
              {
                ok: false,
                error:
                  error?.message ||
                  "Could not create advertisement"
              }
            );
          }

          return;
        }

        /* =================================================
           ADS — APPROVE
        ================================================= */

        if (
          pathname ===
            "/api/ads/approve" &&

          req.method === "POST"
        ) {
          try {
            const body =
              await parseJsonBody(
                req
              );

            const adId =
              safeInt(
                body.ad_id,
                0,
                1,
                Number.MAX_SAFE_INTEGER
              );

            if (!adId) {
              throw new Error(
                "ad_id is required"
              );
            }

            const ad =
              await approveAd(
                adId
              );

            sendJson(
              res,
              200,
              {
                ok: true,
                ad
              }
            );
          } catch (error) {
            sendJson(
              res,
              400,
              {
                ok: false,
                error:
                  error?.message ||
                  "Could not approve advertisement"
              }
            );
          }

          return;
        }

        /* =================================================
           ADS — SERVE
        ================================================= */

        if (
          pathname ===
            "/api/ads/serve" &&

          req.method === "GET"
        ) {
          try {
            const query =
              normalizeQuery(
                requestUrl.searchParams.get(
                  "q"
                )
              );

            const limit =
              safeInt(
                requestUrl.searchParams.get(
                  "limit"
                ),
                3,
                1,
                3
              );

            const ads =
              await getSponsoredAds(
                query,
                limit
              );

            sendJson(
              res,
              200,
              {
                ok: true,
                query,
                ads
              }
            );
          } catch (error) {
            sendJson(
              res,
              500,
              {
                ok: false,
                error:
                  error?.message ||
                  "Could not serve ads"
              }
            );
          }

          return;
        }

        /* =================================================
           ADS — IMPRESSION
        ================================================= */

        if (
          pathname ===
            "/api/ads/impression" &&

          req.method === "POST"
        ) {
          try {
            const body =
              await parseJsonBody(
                req
              );

            const adId =
              safeInt(
                body.ad_id,
                0,
                1,
                Number.MAX_SAFE_INTEGER
              );

            if (!adId) {
              throw new Error(
                "ad_id is required"
              );
            }

            const recorded =
              await recordAdImpression(
                adId,
                body.query
              );

            sendJson(
              res,
              200,
              {
                ok: recorded
              }
            );
          } catch (error) {
            sendJson(
              res,
              400,
              {
                ok: false,
                error:
                  error?.message ||
                  "Could not record impression"
              }
            );
          }

          return;
        }

        /* =================================================
           ADS — CLICK
        ================================================= */

        if (
          pathname ===
            "/api/ads/click" &&

          req.method === "POST"
        ) {
          try {
            const body =
              await parseJsonBody(
                req
              );

            const adId =
              safeInt(
                body.ad_id,
                0,
                1,
                Number.MAX_SAFE_INTEGER
              );

            if (!adId) {
              throw new Error(
                "ad_id is required"
              );
            }

            const result =
              await recordAdClick(
                adId,
                body.query
              );

            sendJson(
              res,
              200,
              result
            );
          } catch (error) {
            sendJson(
              res,
              400,
              {
                ok: false,
                error:
                  error?.message ||
                  "Could not record click"
              }
            );
          }

          return;
        }

        /* =================================================
           ADS — DASHBOARD
        ================================================= */

        if (
          pathname ===
            "/api/ads/dashboard" &&

          req.method === "GET"
        ) {
          try {
            const advertiserId =
              safeInt(
                requestUrl.searchParams.get(
                  "advertiser_id"
                ),
                0,
                1,
                Number.MAX_SAFE_INTEGER
              );

            if (!advertiserId) {
              throw new Error(
                "advertiser_id is required"
              );
            }

            const dashboard =
              await getAdvertiserDashboard(
                advertiserId
              );

            sendJson(
              res,
              200,
              {
                ok: true,
                ...dashboard
              }
            );
          } catch (error) {
            sendJson(
              res,
              400,
              {
                ok: false,
                error:
                  error?.message ||
                  "Could not load dashboard"
              }
            );
          }

          return;
        }

        /* =================================================
           NEWS
        ================================================= */

        if (
          pathname ===
            "/news" ||

          pathname ===
            "/api/news"
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

          sendJson(
            res,
            200,
            {
              ok: true,
              results
            }
          );

          return;
        }

        /* =================================================
           IMAGES
        ================================================= */

        if (
          pathname ===
            "/images" ||

          pathname ===
            "/api/images"
        ) {
          const query =
            normalizeQuery(
              requestUrl.searchParams.get(
                "q"
              )
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

          sendJson(
            res,
            200,
            {
              ok: true,
              query,
              results
            }
          );

          return;
        }

        /* =================================================
           VIDEOS
        ================================================= */

        if (
          pathname ===
            "/videos" ||

          pathname ===
            "/api/videos"
        ) {
          const query =
            normalizeQuery(
              requestUrl.searchParams.get(
                "q"
              )
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

          sendJson(
            res,
            200,
            {
              ok: true,
              query,
              results
            }
          );

          return;
        }

        /* =================================================
           MAPS
        ================================================= */

        if (
          pathname ===
            "/maps" ||

          pathname ===
            "/api/maps"
        ) {
          sendJson(
            res,
            200,
            {
              ok: true,
              results: []
            }
          );

          return;
        }

        /* =================================================
           STATIC FRONTEND
        ================================================= */

        if (
          req.method === "GET"
        ) {
          if (
            serveStatic(
              res,
              pathname
            )
          ) {
            return;
          }
        }

        sendText(
          res,
          404,
          "Not Found"
        );

      } catch (error) {
        console.error(
          "[HEXORA] SERVER ERROR:",
          error
        );

        sendJson(
          res,
          500,
          {
            ok: false,
            error:
              "Internal server error",
            message:
              error?.message ||
              "Unknown error"
          }
        );
      }
    }
  );

/* =========================================================
   START
========================================================= */

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `HEXORA server running on port ${PORT}`
    );

    console.log(
      "[HEXORA] Search-demand tracking enabled"
    );

    console.log(
      "[HEXORA] Ads / Income API enabled"
    );
  }
);

/* =========================================================
   SHUTDOWN
========================================================= */

async function shutdown(
  signal
) {
  console.log(
    `${signal} received. Shutting down...`
  );

  server.close(
    async () => {
      try {
        await pool.end();
      } catch {}

      process.exit(0);
    }
  );
}

process.on(
  "SIGTERM",
  () =>
    shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () =>
    shutdown("SIGINT")
);
