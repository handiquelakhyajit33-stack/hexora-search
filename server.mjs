import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* =========================================================
   CONFIG
========================================================= */

const PORT = Number(process.env.PORT || 8080);

const DATABASE_URL =
  String(process.env.DATABASE_URL || "").trim();

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is missing");
}

const DB_POOL_MAX =
  Number(process.env.DB_POOL_MAX || 10);

const MAX_QUERY_LENGTH = 300;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const SEARCH_CANDIDATE_LIMIT = 10000;

const RAZORPAY_KEY_ID =
  String(process.env.RAZORPAY_KEY_ID || "").trim();

const RAZORPAY_KEY_SECRET =
  String(process.env.RAZORPAY_KEY_SECRET || "").trim();

const RAZORPAY_WEBHOOK_SECRET =
  String(
    process.env.RAZORPAY_WEBHOOK_SECRET || ""
  ).trim();

const ADS_ADMIN_KEY =
  String(process.env.HEXORA_ADS_ADMIN_KEY || "").trim();

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: DB_POOL_MAX,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false }
});

console.log(
  "[HEXORA] Neon database configured."
);

/* =========================================================
   BASIC HELPERS
========================================================= */

function sendJson(res, status, data) {
  const body = JSON.stringify(data);

  res.writeHead(status, {
    "Content-Type":
      "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "Content-Type, X-HEXORA-ADVERTISER-KEY, X-HEXORA-ADMIN-KEY",
    "Access-Control-Allow-Methods":
      "GET,POST,OPTIONS",
    "Content-Length":
      Buffer.byteLength(body)
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

function safeNumber(
  value,
  fallback = 0
) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : fallback;
}

function cleanText(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", chunk => {
      body += chunk.toString();

      if (body.length > 2 * 1024 * 1024) {
        reject(
          new Error("Request body too large")
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
          new Error("Invalid JSON body")
        );
      }
    });

    req.on("error", reject);
  });
}

function validHttpUrl(value) {
  try {
    const url = new URL(String(value));

    return (
      url.protocol === "http:" ||
      url.protocol === "https:"
    );
  } catch {
    return false;
  }
}

/* =========================================================
   DEMAND TRACKING
========================================================= */

async function recordSearchDemand(query) {
  const normalized = normalizeQuery(query);

  if (!normalized) return;

  try {
    await pool.query(
      `
      INSERT INTO search_queries
      (
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
      VALUES
      (
        $1,
        lower($1),
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
        query = EXCLUDED.query,
        search_count =
          search_queries.search_count + 1,
        crawl_priority =
          LEAST(
            1000000,
            GREATEST(
              1,
              search_queries.crawl_priority
            ) + 1
          ),
        last_searched_at = NOW(),
        status =
          CASE
            WHEN search_queries.status = 'completed'
            THEN 'pending'
            ELSE search_queries.status
          END,
        updated_at = NOW()
      `,
      [normalized]
    );
  } catch (error) {
    console.error(
      "[HEXORA] Search demand error:",
      error.message
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
  const queryWords = wordsOf(query);

  const wordCount =
    Math.max(queryWords.length, 1);

  const offset =
    (page - 1) * limit;

  const dataSql = `
    WITH params AS (
      SELECT
        lower(trim($1::text)) AS q,
        websearch_to_tsquery(
          'simple',
          $1::text
        ) AS tsq
    ),

    candidate AS (
      SELECT
        p.*,

        CASE
          WHEN lower(trim(coalesce(p.title,''))) =
               params.q
          THEN 1 ELSE 0
        END AS exact_title,

        CASE
          WHEN lower(coalesce(p.title,'')) LIKE
               params.q || '%'
          THEN 1 ELSE 0
        END AS title_starts,

        CASE
          WHEN lower(coalesce(p.title,'')) LIKE
               '%' || params.q || '%'
          THEN 1 ELSE 0
        END AS title_phrase,

        CASE
          WHEN lower(coalesce(p.description,'')) LIKE
               '%' || params.q || '%'
          THEN 1 ELSE 0
        END AS description_phrase,

        CASE
          WHEN lower(coalesce(p.url,'')) LIKE
               '%' || params.q || '%'
          THEN 1 ELSE 0
        END AS url_phrase,

        CASE
          WHEN lower(coalesce(p.domain,'')) =
               params.q
          THEN 1 ELSE 0
        END AS exact_domain,

        (
          SELECT count(*)
          FROM unnest($2::text[]) AS w(word)
          WHERE lower(coalesce(p.title,'')) LIKE
                '%' || lower(w.word) || '%'
        ) AS title_word_matches,

        (
          SELECT count(*)
          FROM unnest($2::text[]) AS w(word)
          WHERE lower(coalesce(p.description,'')) LIKE
                '%' || lower(w.word) || '%'
        ) AS description_word_matches,

        (
          SELECT count(*)
          FROM unnest($2::text[]) AS w(word)
          WHERE lower(coalesce(p.content,'')) LIKE
                '%' || lower(w.word) || '%'
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
          lower(coalesce(p.title,'')),
          params.q
        ) AS title_similarity,

        CASE
          WHEN p.published_at IS NULL
          THEN 0

          WHEN p.published_at >=
               NOW() - INTERVAL '1 day'
          THEN 1

          WHEN p.published_at >=
               NOW() - INTERVAL '7 days'
          THEN 0.85

          WHEN p.published_at >=
               NOW() - INTERVAL '30 days'
          THEN 0.65

          WHEN p.published_at >=
               NOW() - INTERVAL '180 days'
          THEN 0.40

          ELSE 0.10
        END AS freshness

      FROM pages p
      CROSS JOIN params

      WHERE
      (
        lower(trim(coalesce(p.title,''))) =
          params.q

        OR

        lower(coalesce(p.title,'')) LIKE
          params.q || '%'

        OR

        lower(coalesce(p.title,'')) LIKE
          '%' || params.q || '%'

        OR

        coalesce(
          p.search_vector,
          ''::tsvector
        ) @@ params.tsq

        OR

        lower(coalesce(p.description,'')) LIKE
          '%' || params.q || '%'

        OR

        lower(coalesce(p.url,'')) LIKE
          '%' || params.q || '%'

        OR

        EXISTS (
          SELECT 1
          FROM unnest($2::text[]) AS w(word)
          WHERE lower(coalesce(p.title,'')) LIKE
                '%' || lower(w.word) || '%'
        )

        OR

        (
          array_length($2::text[],1) > 1
          AND
          (
            SELECT count(*)
            FROM unnest($2::text[]) AS w(word)
            WHERE lower(coalesce(p.description,'')) LIKE
                  '%' || lower(w.word) || '%'
          )
          >= 2
        )

        OR

        (
          array_length($2::text[],1) > 1
          AND
          (
            SELECT count(*)
            FROM unnest($2::text[]) AS w(word)
            WHERE lower(coalesce(p.content,'')) LIKE
                  '%' || lower(w.word) || '%'
          )::numeric
          >=
          GREATEST(
            CEIL(
              array_length($2::text[],1) * 0.5
            ),
            2
          )
        )
      )

      ${
        mode === "news"
          ? "AND p.published_at IS NOT NULL"
          : ""
      }

      LIMIT $3
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
        ) AS description_coverage

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

          url_phrase * 15000

          +

          exact_domain * 100000

          +

          LEAST(
            GREATEST(
              coalesce(
                p_authority_score,
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
                p_popularity_score,
                0
              ),
              0
            ),
            100
          ) * 300

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
              AND url_phrase = 0
            THEN 250000
            ELSE 0
          END

        ) AS final_score

      FROM (
        SELECT
          scored.*,
          authority_score AS p_authority_score,
          popularity_score AS p_popularity_score
        FROM scored
      ) scored
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
      exact_domain DESC,
      p_authority_score DESC,
      p_popularity_score DESC,
      freshness DESC,
      id DESC

    LIMIT $3
    OFFSET $4
  `;

  const countSql = `
    SELECT COUNT(*)::int AS count

    FROM pages p

    WHERE
    (
      lower(trim(coalesce(p.title,''))) =
        lower(trim($1::text))

      OR

      lower(coalesce(p.title,'')) LIKE
        '%' || lower(trim($1::text)) || '%'

      OR

      lower(coalesce(p.description,'')) LIKE
        '%' || lower(trim($1::text)) || '%'

      OR

      lower(coalesce(p.url,'')) LIKE
        '%' || lower(trim($1::text)) || '%'

      OR

      coalesce(
        p.search_vector,
        ''::tsvector
      ) @@ websearch_to_tsquery(
        'simple',
        $1::text
      )

      OR

      EXISTS (
        SELECT 1
        FROM unnest($2::text[]) AS w(word)
        WHERE lower(coalesce(p.title,'')) LIKE
              '%' || lower(w.word) || '%'
      )
    )

    ${
      mode === "news"
        ? "AND p.published_at IS NOT NULL"
        : ""
    }
  `;

  const suggestionSql = `
    SELECT
      title,

      similarity(
        lower(coalesce(title,'')),
        lower($1::text)
      ) AS similarity_score

    FROM pages

    WHERE
      lower(coalesce(title,'')) LIKE
        '%' || lower($1::text) || '%'

    ORDER BY
      similarity_score DESC,
      id DESC

    LIMIT 20
  `;

  const [
    dataResult,
    countResult,
    suggestionResult
  ] = await Promise.all([
    pool.query(
      dataSql,
      [
        query,
        queryWords,
        SEARCH_CANDIDATE_LIMIT,
        offset
      ]
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

  const finalRows = [];
  const seen = new Set();
  const domainCount = new Map();

  for (const row of rows) {
    if (finalRows.length >= limit) {
      break;
    }

    const key = String(
      row.canonical ||
      row.url ||
      row.id
    );

    if (seen.has(key)) {
      continue;
    }

    const domain =
      String(row.domain || "")
        .toLowerCase();

    const count =
      domainCount.get(domain) || 0;

    if (count >= 3) {
      continue;
    }

    seen.add(key);
    finalRows.push(row);

    domainCount.set(
      domain,
      count + 1
    );
  }

  const results =
    finalRows.map(row => ({
      id: row.id,
      title:
        row.title || "Untitled",
      url: row.url,
      canonical_url:
        row.canonical || row.url,
      domain:
        row.domain || "",
      source:
        row.domain || "",
      description:
        cleanText(row.description),
      snippet:
        cleanText(
          row.description ||
          row.content
        ).slice(0, 320),
      language:
        row.language || null,
      author:
        row.author || null,
      image:
        row.image_url || null,
      published_at:
        row.published_at || null,
      updated_at:
        row.updated_at || null,
      score:
        Number(
          row.final_score || 0
        )
    }));

  const suggestions = [];

  for (const row of
    suggestionResult.rows || []) {

    const title =
      String(row.title || "").trim();

    if (!title) continue;

    if (
      suggestions.some(
        x =>
          x.toLowerCase() ===
          title.toLowerCase()
      )
    ) {
      continue;
    }

    suggestions.push(title);

    if (suggestions.length >= 5) {
      break;
    }
  }

  return {
    query,
    mode,
    page,
    limit,
    total:
      Number(
        countResult.rows?.[0]?.count || 0
      ),
    results,
    suggestions
  };
}

/* =========================================================
   ADS — DATABASE SAFETY
========================================================= */

async function ensureAdsColumns() {
  try {
    await pool.query(`
      ALTER TABLE advertisers
      ADD COLUMN IF NOT EXISTS
      api_key_hash TEXT
    `);

    await pool.query(`
      ALTER TABLE advertisers
      ADD COLUMN IF NOT EXISTS
      api_key_prefix TEXT
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS
      advertisers_api_key_hash_idx
      ON advertisers(api_key_hash)
      WHERE api_key_hash IS NOT NULL
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS
      ad_payment_orders (
        id BIGSERIAL PRIMARY KEY,
        advertiser_id BIGINT NOT NULL
          REFERENCES advertisers(id)
          ON DELETE CASCADE,

        amount NUMERIC(14,2) NOT NULL,
        currency TEXT NOT NULL DEFAULT 'INR',

        razorpay_order_id TEXT NOT NULL UNIQUE,
        razorpay_payment_id TEXT,

        status TEXT NOT NULL DEFAULT 'created',

        created_at TIMESTAMPTZ
          NOT NULL DEFAULT NOW(),

        paid_at TIMESTAMPTZ
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS
      ad_payment_orders_advertiser_idx
      ON ad_payment_orders(advertiser_id)
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS
      ad_webhook_events (
        id BIGSERIAL PRIMARY KEY,
        event_id TEXT UNIQUE,
        event_type TEXT,
        payload JSONB,
        created_at TIMESTAMPTZ
          NOT NULL DEFAULT NOW()
      )
    `);

    console.log(
      "[HEXORA] Ads payment tables ready."
    );

  } catch (error) {
    console.error(
      "[HEXORA] Ads schema setup failed:",
      error.message
    );
  }
}

/* =========================================================
   ADS — API KEY
========================================================= */

function generateAdvertiserKey() {
  return (
    "hex_" +
    crypto.randomBytes(32).toString("hex")
  );
}

function hashAdvertiserKey(key) {
  return crypto
    .createHash("sha256")
    .update(String(key))
    .digest("hex");
}

async function getAdvertiserFromKey(key) {
  if (!key) return null;

  const hash =
    hashAdvertiserKey(key);

  const result =
    await pool.query(
      `
      SELECT *
      FROM advertisers
      WHERE api_key_hash = $1
        AND status = 'active'
      LIMIT 1
      `,
      [hash]
    );

  return result.rows[0] || null;
}

function getAdvertiserKey(req) {
  return String(
    req.headers[
      "x-hexora-advertiser-key"
    ] || ""
  ).trim();
}

function getAdminKey(req) {
  return String(
    req.headers[
      "x-hexora-admin-key"
    ] || ""
  ).trim();
}

function requireAdmin(req) {
  return (
    ADS_ADMIN_KEY &&
    getAdminKey(req) ===
      ADS_ADMIN_KEY
  );
}

/* =========================================================
   ADS — CREATE ADVERTISER
========================================================= */

async function createAdvertiser(data) {
  const name =
    String(data.name || "").trim();

  const email =
    String(data.email || "")
      .trim()
      .toLowerCase();

  if (!name || !email) {
    throw new Error(
      "name and email are required"
    );
  }

  const key =
    generateAdvertiserKey();

  const hash =
    hashAdvertiserKey(key);

  const prefix =
    key.slice(0, 12);

  const result =
    await pool.query(
      `
      INSERT INTO advertisers
      (
        name,
        email,
        company_name,
        website,
        balance,
        total_spent,
        status,
        api_key_hash,
        api_key_prefix
      )
      VALUES
      (
        $1,
        $2,
        $3,
        $4,
        0,
        0,
        'active',
        $5,
        $6
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
        String(
          data.company_name || ""
        ).trim() || null,
        validHttpUrl(data.website)
          ? data.website
          : null,
        hash,
        prefix
      ]
    );

  return {
    advertiser:
      result.rows[0],
    api_key: key
  };
}

/* =========================================================
   ADS — AUTHENTICATED CAMPAIGN
========================================================= */

async function createCampaign(
  advertiser,
  data
) {
  const name =
    String(data.name || "").trim();

  if (!name) {
    throw new Error(
      "Campaign name is required"
    );
  }

  const dailyBudget =
    Math.max(
      0,
      safeNumber(
        data.daily_budget
      )
    );

  const totalBudget =
    Math.max(
      0,
      safeNumber(
        data.total_budget
      )
    );

  const result =
    await pool.query(
      `
      INSERT INTO ad_campaigns
      (
        advertiser_id,
        name,
        daily_budget,
        total_budget,
        spent,
        status
      )
      VALUES
      (
        $1,
        $2,
        $3,
        $4,
        0,
        'draft'
      )
      RETURNING *
      `,
      [
        advertiser.id,
        name,
        dailyBudget,
        totalBudget
      ]
    );

  return result.rows[0];
}

/* =========================================================
   ADS — CREATE AD
========================================================= */

async function createAd(
  advertiser,
  data
) {
  const campaignId =
    Number(data.campaign_id);

  if (!Number.isInteger(campaignId)) {
    throw new Error(
      "Valid campaign_id is required"
    );
  }

  const campaign =
    await pool.query(
      `
      SELECT *
      FROM ad_campaigns
      WHERE id = $1
        AND advertiser_id = $2
      LIMIT 1
      `,
      [
        campaignId,
        advertiser.id
      ]
    );

  if (!campaign.rows[0]) {
    throw new Error(
      "Campaign not found"
    );
  }

  const title =
    String(data.title || "").trim();

  const description =
    String(
      data.description || ""
    ).trim();

  const destinationUrl =
    String(
      data.destination_url || ""
    ).trim();

  if (!title) {
    throw new Error(
      "Ad title is required"
    );
  }

  if (
    !validHttpUrl(
      destinationUrl
    )
  ) {
    throw new Error(
      "destination_url must be http/https"
    );
  }

  const keywords =
    Array.isArray(data.keywords)
      ? data.keywords
          .map(x =>
            normalizeQuery(x)
          )
          .filter(Boolean)
          .slice(0, 100)
      : [];

  const bid =
    Math.max(
      0.01,
      safeNumber(
        data.bid_per_click,
        0.10
      )
    );

  const result =
    await pool.query(
      `
      INSERT INTO ads
      (
        campaign_id,
        title,
        description,
        destination_url,
        keywords,
        bid_per_click,
        status
      )
      VALUES
      (
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
        description,
        destinationUrl,
        keywords,
        bid
      ]
    );

  return result.rows[0];
}

/* =========================================================
   ADS — APPROVE
========================================================= */

async function approveAd(adId) {
  const id =
    Number(adId);

  if (!Number.isInteger(id)) {
    throw new Error(
      "Invalid ad id"
    );
  }

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
      [id]
    );

  if (!result.rows[0]) {
    throw new Error(
      "Ad not found"
    );
  }

  return result.rows[0];
}

/* =========================================================
   ADS — SPONSORED SEARCH
========================================================= */

async function getSponsoredAds(
  query,
  limit = 3
) {
  const words =
    wordsOf(query);

  if (!words.length) {
    return [];
  }

  const result =
    await pool.query(
      `
      SELECT
        a.id,
        a.title,
        a.description,
        a.destination_url,
        a.keywords,
        a.bid_per_click,

        c.id AS campaign_id,
        c.daily_budget,
        c.total_budget,
        c.spent,

        adv.id AS advertiser_id,
        adv.name AS advertiser_name

      FROM ads a

      JOIN ad_campaigns c
        ON c.id = a.campaign_id

      JOIN advertisers adv
        ON adv.id = c.advertiser_id

      WHERE
        a.status = 'active'

        AND c.status = 'active'

        AND adv.status = 'active'

        AND (
          c.total_budget <= 0
          OR c.spent < c.total_budget
        )

        AND (
          a.keywords && $1::text[]
          OR EXISTS (
            SELECT 1
            FROM unnest(
              a.keywords
            ) AS k(word)
            WHERE
              lower(k.word) = ANY($1::text[])
          )
        )

      ORDER BY
        a.bid_per_click DESC,
        a.clicks DESC,
        a.impressions ASC

      LIMIT $2
      `,
      [
        words.map(
          x => x.toLowerCase()
        ),
        limit
      ]
    );

  return result.rows.map(row => ({
    id: row.id,
    title: row.title,
    description: row.description,
    destination_url:
      row.destination_url,
    advertiser:
      row.advertiser_name,
    advertiser_id:
      row.advertiser_id,
    campaign_id:
      row.campaign_id,
    bid_per_click:
      Number(
        row.bid_per_click || 0
      ),
    sponsored: true
  }));
}

/* =========================================================
   ADS — IMPRESSION
========================================================= */

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
        [Number(adId)]
      );

    if (!ad.rows[0]) {
      await client.query(
        "ROLLBACK"
      );

      return false;
    }

    await client.query(
      `
      INSERT INTO ad_events
      (
        ad_id,
        event_type,
        query,
        cost
      )
      VALUES
      (
        $1,
        'impression',
        $2,
        0
      )
      `,
      [
        Number(adId),
        normalizeQuery(query)
      ]
    );

    await client.query(
      "COMMIT"
    );

    return true;

  } catch (error) {
    await client.query(
      "ROLLBACK"
    );

    throw error;

  } finally {
    client.release();
  }
}

/* =========================================================
   ADS — CLICK / CPC
========================================================= */

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

    const result =
      await client.query(
        `
        SELECT
          a.id,
          a.bid_per_click,
          a.clicks,
          c.id AS campaign_id,
          c.total_budget,
          c.spent,
          c.advertiser_id,
          adv.balance,
          adv.total_spent

        FROM ads a

        JOIN ad_campaigns c
          ON c.id = a.campaign_id

        JOIN advertisers adv
          ON adv.id = c.advertiser_id

        WHERE
          a.id = $1

          AND a.status = 'active'

          AND c.status = 'active'

          AND adv.status = 'active'

        FOR UPDATE
        `,
        [Number(adId)]
      );

    const row =
      result.rows[0];

    if (!row) {
      await client.query(
        "ROLLBACK"
      );

      return {
        ok: false,
        error: "Ad not active"
      };
    }

    const cost =
      Math.max(
        0.01,
        Number(
          row.bid_per_click || 0.10
        )
      );

    const balance =
      Number(
        row.balance || 0
      );

    const totalBudget =
      Number(
        row.total_budget || 0
      );

    const spent =
      Number(
        row.spent || 0
      );

    if (balance < cost) {
      await client.query(
        "ROLLBACK"
      );

      return {
        ok: false,
        error:
          "Advertiser balance is insufficient"
      };
    }

    if (
      totalBudget > 0 &&
      spent + cost > totalBudget
    ) {
      await client.query(
        "ROLLBACK"
      );

      return {
        ok: false,
        error:
          "Campaign budget exhausted"
      };
    }

    await client.query(
      `
      UPDATE advertisers
      SET
        balance =
          balance - $1,
        total_spent =
          total_spent + $1,
        updated_at = NOW()
      WHERE id = $2
      `,
      [
        cost,
        row.advertiser_id
      ]
    );

    await client.query(
      `
      UPDATE ad_campaigns
      SET
        spent =
          spent + $1,
        updated_at = NOW()
      WHERE id = $2
      `,
      [
        cost,
        row.campaign_id
      ]
    );

    await client.query(
      `
      UPDATE ads
      SET
        clicks =
          clicks + 1,
        updated_at = NOW()
      WHERE id = $1
      `,
      [Number(adId)]
    );

    await client.query(
      `
      INSERT INTO ad_events
      (
        ad_id,
        event_type,
        query,
        cost
      )
      VALUES
      (
        $1,
        'click',
        $2,
        $3
      )
      `,
      [
        Number(adId),
        normalizeQuery(query),
        cost
      ]
    );

    await client.query(
      `
      INSERT INTO ad_transactions
      (
        advertiser_id,
        amount,
        transaction_type,
        reference,
        status
      )
      VALUES
      (
        $1,
        $2,
        'ad_click',
        $3,
        'completed'
      )
      `,
      [
        row.advertiser_id,
        cost,
        `ad_${adId}_${Date.now()}`
      ]
    );

    await client.query(
      "COMMIT"
    );

    return {
      ok: true,
      cost,
      destination_url: null
    };

  } catch (error) {
    await client.query(
      "ROLLBACK"
    );

    throw error;

  } finally {
    client.release();
  }
}

/* =========================================================
   RAZORPAY — CREATE ORDER
========================================================= */

async function createRazorpayOrder(
  advertiser,
  amount
) {
  if (
    !RAZORPAY_KEY_ID ||
    !RAZORPAY_KEY_SECRET
  ) {
    throw new Error(
      "Razorpay environment variables are not configured"
    );
  }

  const rupees =
    Number(amount);

  if (
    !Number.isFinite(rupees) ||
    rupees < 1
  ) {
    throw new Error(
      "Minimum deposit is ₹1"
    );
  }

  if (rupees > 1000000) {
    throw new Error(
      "Deposit amount is too large"
    );
  }

  const paise =
    Math.round(
      rupees * 100
    );

  const receipt =
    `hexora_${advertiser.id}_${Date.now()}`;

  const auth =
    Buffer.from(
      `${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`
    ).toString("base64");

  const response =
    await fetch(
      "https://api.razorpay.com/v1/orders",
      {
        method: "POST",

        headers: {
          Authorization:
            `Basic ${auth}`,
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          amount: paise,
          currency: "INR",
          receipt,
          notes: {
            advertiser_id:
              String(advertiser.id),
            platform:
              "HEXORA"
          }
        })
      }
    );

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.description ||
      "Razorpay order creation failed"
    );
  }

  await pool.query(
    `
    INSERT INTO ad_payment_orders
    (
      advertiser_id,
      amount,
      currency,
      razorpay_order_id,
      status
    )
    VALUES
    (
      $1,
      $2,
      'INR',
      $3,
      'created'
    )
    `,
    [
      advertiser.id,
      rupees,
      data.id
    ]
  );

  return {
    key_id:
      RAZORPAY_KEY_ID,
    order_id:
      data.id,
    amount:
      paise,
    currency:
      "INR"
  };
}

/* =========================================================
   RAZORPAY — VERIFY PAYMENT
========================================================= */

async function verifyRazorpayPayment(
  advertiser,
  data
) {
  if (!RAZORPAY_KEY_SECRET) {
    throw new Error(
      "Razorpay secret is not configured"
    );
  }

  const orderId =
    String(
      data.razorpay_order_id || ""
    ).trim();

  const paymentId =
    String(
      data.razorpay_payment_id || ""
    ).trim();

  const signature =
    String(
      data.razorpay_signature || ""
    ).trim();

  if (
    !orderId ||
    !paymentId ||
    !signature
  ) {
    throw new Error(
      "Payment verification fields are missing"
    );
  }

  const orderResult =
    await pool.query(
      `
      SELECT *
      FROM ad_payment_orders
      WHERE
        razorpay_order_id = $1
        AND advertiser_id = $2
      LIMIT 1
      `,
      [
        orderId,
        advertiser.id
      ]
    );

  const order =
    orderResult.rows[0];

  if (!order) {
    throw new Error(
      "Payment order not found"
    );
  }

  const expected =
    crypto
      .createHmac(
        "sha256",
        RAZORPAY_KEY_SECRET
      )
      .update(
        `${orderId}|${paymentId}`
      )
      .digest("hex");

  if (
    !crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signature)
    )
  ) {
    throw new Error(
      "Invalid Razorpay payment signature"
    );
  }

  if (
    order.status === "paid"
  ) {
    return {
      ok: true,
      already_processed: true
    };
  }

  const client =
    await pool.connect();

  try {
    await client.query(
      "BEGIN"
    );

    const locked =
      await client.query(
        `
        SELECT *
        FROM ad_payment_orders
        WHERE id = $1
        FOR UPDATE
        `,
        [order.id]
      );

    const lockedOrder =
      locked.rows[0];

    if (
      lockedOrder.status === "paid"
    ) {
      await client.query(
        "COMMIT"
      );

      return {
        ok: true,
        already_processed: true
      };
    }

    const amount =
      Number(
        lockedOrder.amount
      );

    await client.query(
      `
      UPDATE advertisers
      SET
        balance =
          balance + $1,
        updated_at = NOW()
      WHERE id = $2
      `,
      [
        amount,
        advertiser.id
      ]
    );

    await client.query(
      `
      UPDATE ad_payment_orders
      SET
        razorpay_payment_id = $1,
        status = 'paid',
        paid_at = NOW()
      WHERE id = $2
      `,
      [
        paymentId,
        lockedOrder.id
      ]
    );

    await client.query(
      `
      INSERT INTO ad_transactions
      (
        advertiser_id,
        amount,
        transaction_type,
        reference,
        status,
        payment_provider,
        payment_id
      )
      VALUES
      (
        $1,
        $2,
        'deposit',
        $3,
        'completed',
        'razorpay',
        $4
      )
      `,
      [
        advertiser.id,
        amount,
        orderId,
        paymentId
      ]
    );

    await client.query(
      "COMMIT"
    );

    return {
      ok: true,
      amount
    };

  } catch (error) {
    await client.query(
      "ROLLBACK"
    );

    throw error;

  } finally {
    client.release();
  }
}

/* =========================================================
   RAZORPAY — WEBHOOK
========================================================= */

function verifyWebhookSignature(
  rawBody,
  signature
) {
  if (
    !RAZORPAY_WEBHOOK_SECRET ||
    !signature
  ) {
    return false;
  }

  const expected =
    crypto
      .createHmac(
        "sha256",
        RAZORPAY_WEBHOOK_SECRET
      )
      .update(rawBody)
      .digest("hex");

  return (
    expected.length ===
      signature.length &&
    crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signature)
    )
  );
}

async function handleRazorpayWebhook(
  req,
  res
) {
  let rawBody = "";

  await new Promise(
    (resolve, reject) => {
      req.on(
        "data",
        chunk => {
          rawBody +=
            chunk.toString();

          if (
            rawBody.length >
            2 * 1024 * 1024
          ) {
            reject(
              new Error(
                "Webhook body too large"
              )
            );

            req.destroy();
          }
        }
      );

      req.on(
        "end",
        resolve
      );

      req.on(
        "error",
        reject
      );
    }
  );

  const signature =
    String(
      req.headers[
        "x-razorpay-signature"
      ] || ""
    );

  if (
    !verifyWebhookSignature(
      rawBody,
      signature
    )
  ) {
    sendJson(
      res,
      400,
      {
        ok: false,
        error:
          "Invalid webhook signature"
      }
    );

    return;
  }

  let payload;

  try {
    payload =
      JSON.parse(rawBody);
  } catch {
    sendJson(
      res,
      400,
      {
        ok: false,
        error:
          "Invalid webhook JSON"
      }
    );

    return;
  }

  const eventId =
    String(
      req.headers[
        "x-razorpay-event-id"
      ] || ""
    ).trim();

  try {
    await pool.query(
      `
      INSERT INTO ad_webhook_events
      (
        event_id,
        event_type,
        payload
      )
      VALUES
      (
        $1,
        $2,
        $3
      )
      ON CONFLICT (event_id)
      DO NOTHING
      `,
      [
        eventId || null,
        payload.event || null,
        payload
      ]
    );
  } catch {}

  /*
   * Payment verification is still performed
   * through the trusted order/payment record.
   *
   * Webhook duplicate events are harmless.
   */

  if (
    payload.event ===
      "payment.captured" ||
    payload.event ===
      "order.paid"
  ) {
    console.log(
      "[HEXORA] Razorpay payment event received."
    );
  }

  sendJson(
    res,
    200,
    {
      ok: true
    }
  );
}

/* =========================================================
   ADVERTISER DASHBOARD
========================================================= */

async function getAdvertiserDashboard(
  advertiser
) {
  const [
    advertiserResult,
    campaignsResult,
    adsResult,
    transactionsResult
  ] = await Promise.all([
    pool.query(
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
      [advertiser.id]
    ),

    pool.query(
      `
      SELECT *
      FROM ad_campaigns
      WHERE advertiser_id = $1
      ORDER BY id DESC
      `,
      [advertiser.id]
    ),

    pool.query(
      `
      SELECT
        a.*,
        c.name AS campaign_name
      FROM ads a
      JOIN ad_campaigns c
        ON c.id = a.campaign_id
      WHERE
        c.advertiser_id = $1
      ORDER BY a.id DESC
      `,
      [advertiser.id]
    ),

    pool.query(
      `
      SELECT
        id,
        amount,
        transaction_type,
        reference,
        status,
        payment_provider,
        payment_id,
        created_at
      FROM ad_transactions
      WHERE advertiser_id = $1
      ORDER BY created_at DESC
      LIMIT 100
      `,
      [advertiser.id]
    )
  ]);

  return {
    advertiser:
      advertiserResult.rows[0],
    campaigns:
      campaignsResult.rows,
    ads:
      adsResult.rows,
    transactions:
      transactionsResult.rows
  };
}

/* =========================================================
   HEALTH
========================================================= */

async function healthCheck() {
  try {
    const result =
      await pool.query(`
        SELECT
          NOW() AS now,
          COUNT(*)::bigint AS pages
        FROM pages
      `);

    return {
      ok: true,
      database: true,
      pages:
        Number(
          result.rows?.[0]?.pages || 0
        ),
      time:
        result.rows?.[0]?.now || null
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
   STATIC FRONTEND
========================================================= */

function safeStaticPath(
  pathname
) {
  let clean;

  try {
    clean =
      decodeURIComponent(
        pathname
      );
  } catch {
    return null;
  }

  clean =
    clean
      .split("?")[0]
      .replace(/^\/+/, "");

  if (
    clean.includes("..") ||
    clean.includes("\\")
  ) {
    return null;
  }

  const root =
    path.resolve(__dirname);

  const filePath =
    path.resolve(
      root,
      clean
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
      "application/javascript; charset=utf-8",

    ".mjs":
      "application/javascript; charset=utf-8",

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
      "image/x-icon",

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
    pathname === "/" ||
    !fs.existsSync(filePath) ||
    !fs.statSync(filePath).isFile()
  ) {
    filePath =
      safeStaticPath(
        "/index.html"
      );

    if (
      !filePath ||
      !fs.existsSync(filePath)
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
          contentType(filePath),

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
   HTTP SERVER
========================================================= */

const server =
  http.createServer(
    async (req, res) => {

      try {

        if (
          req.method === "OPTIONS"
        ) {
          res.writeHead(
            204,
            {
              "Access-Control-Allow-Origin":
                "*",
              "Access-Control-Allow-Headers":
                "Content-Type, X-HEXORA-ADVERTISER-KEY, X-HEXORA-ADMIN-KEY",
              "Access-Control-Allow-Methods":
                "GET,POST,OPTIONS"
            }
          );

          res.end();
          return;
        }

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
          pathname === "/health" ||
          pathname === "/api/health"
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
          pathname === "/search" ||
          pathname === "/api/search"
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
              10000
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

          /*
           * Demand tracking never blocks search.
           */

          recordSearchDemand(
            query
          ).catch(() => {});

          const data =
            await searchDatabase(
              query,
              mode,
              page,
              limit
            );

          let sponsoredAds = [];

          try {
            sponsoredAds =
              await getSponsoredAds(
                query,
                3
              );
          } catch (error) {
            console.error(
              "[HEXORA] Sponsored ads error:",
              error.message
            );
          }

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
           NEWS
        ================================================= */

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

          const result =
            await pool.query(
              `
              SELECT
                id,
                url,
                title,
                description,
                content,
                language,
                domain,
                canonical,
                image_url,
                published_at,
                last_crawled_at
              FROM pages
              WHERE
                published_at IS NOT NULL
              ORDER BY
                published_at DESC,
                id DESC
              LIMIT $1
              `,
              [limit]
            );

          sendJson(
            res,
            200,
            {
              ok: true,
              results:
                result.rows
            }
          );

          return;
        }

        /* =================================================
           IMAGES
        ================================================= */

        if (
          pathname === "/images" ||
          pathname === "/api/images"
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

          const result =
            await pool.query(
              `
              SELECT
                id,
                url,
                title,
                description,
                domain,
                image_url,
                published_at
              FROM pages
              WHERE
                image_url IS NOT NULL
                AND
                (
                  $1 = ''
                  OR lower(coalesce(title,'')) LIKE
                     '%' || lower($1) || '%'
                  OR lower(coalesce(description,'')) LIKE
                     '%' || lower($1) || '%'
                )
              ORDER BY
                last_crawled_at DESC NULLS LAST,
                id DESC
              LIMIT $2
              `,
              [
                query,
                limit
              ]
            );

          sendJson(
            res,
            200,
            {
              ok: true,
              query,
              results:
                result.rows
            }
          );

          return;
        }

        /* =================================================
           VIDEOS
        ================================================= */

        if (
          pathname === "/videos" ||
          pathname === "/api/videos"
        ) {
          sendJson(
            res,
            200,
            {
              ok: true,
              query:
                normalizeQuery(
                  requestUrl.searchParams.get(
                    "q"
                  )
                ),
              results: []
            }
          );

          return;
        }

        /* =================================================
           MAPS
        ================================================= */

        if (
          pathname === "/maps" ||
          pathname === "/api/maps"
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
           ADS — CREATE ADVERTISER
        ================================================= */

        if (
          req.method === "POST" &&
          pathname ===
            "/api/ads/advertisers"
        ) {
          const body =
            await parseJsonBody(
              req
            );

          const result =
            await createAdvertiser(
              body
            );

          sendJson(
            res,
            201,
            {
              ok: true,
              ...result
            }
          );

          return;
        }

        /* =================================================
           ADS — CAMPAIGN
        ================================================= */

        if (
          req.method === "POST" &&
          pathname ===
            "/api/ads/campaigns"
        ) {
          const advertiser =
            await getAdvertiserFromKey(
              getAdvertiserKey(req)
            );

          if (!advertiser) {
            sendJson(
              res,
              401,
              {
                ok: false,
                error:
                  "Invalid advertiser key"
              }
            );

            return;
          }

          const body =
            await parseJsonBody(
              req
            );

          const campaign =
            await createCampaign(
              advertiser,
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

          return;
        }

        /* =================================================
           ADS — CREATE AD
        ================================================= */

        if (
          req.method === "POST" &&
          pathname ===
            "/api/ads"
        ) {
          const advertiser =
            await getAdvertiserFromKey(
              getAdvertiserKey(req)
            );

          if (!advertiser) {
            sendJson(
              res,
              401,
              {
                ok: false,
                error:
                  "Invalid advertiser key"
              }
            );

            return;
          }

          const body =
            await parseJsonBody(
              req
            );

          const ad =
            await createAd(
              advertiser,
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

          return;
        }

        /* =================================================
           ADS — APPROVE
        ================================================= */

        if (
          req.method === "POST" &&
          pathname ===
            "/api/ads/approve"
        ) {
          if (
            !requireAdmin(req)
          ) {
            sendJson(
              res,
              403,
              {
                ok: false,
                error:
                  "Admin authorization required"
              }
            );

            return;
          }

          const body =
            await parseJsonBody(
              req
            );

          const ad =
            await approveAd(
              body.ad_id
            );

          sendJson(
            res,
            200,
            {
              ok: true,
              ad
            }
          );

          return;
        }

        /* =================================================
           ADS — SERVE
        ================================================= */

        if (
          req.method === "GET" &&
          pathname ===
            "/api/ads/serve"
        ) {
          const query =
            normalizeQuery(
              requestUrl.searchParams.get(
                "q"
              )
            );

          const ads =
            await getSponsoredAds(
              query,
              3
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

          return;
        }

        /* =================================================
           ADS — IMPRESSION
        ================================================= */

        if (
          req.method === "POST" &&
          pathname ===
            "/api/ads/impression"
        ) {
          const body =
            await parseJsonBody(
              req
            );

          const ok =
            await recordAdImpression(
              body.ad_id,
              body.query
            );

          sendJson(
            res,
            200,
            {
              ok
            }
          );

          return;
        }

        /* =================================================
           ADS — CLICK
        ================================================= */

        if (
          req.method === "POST" &&
          pathname ===
            "/api/ads/click"
        ) {
          const body =
            await parseJsonBody(
              req
            );

          const result =
            await recordAdClick(
              body.ad_id,
              body.query
            );

          sendJson(
            res,
            result.ok
              ? 200
              : 400,
            result
          );

          return;
        }

        /* =================================================
           ADS — DASHBOARD
        ================================================= */

        if (
          req.method === "GET" &&
          pathname ===
            "/api/ads/dashboard"
        ) {
          const advertiser =
            await getAdvertiserFromKey(
              getAdvertiserKey(req)
            );

          if (!advertiser) {
            sendJson(
              res,
              401,
              {
                ok: false,
                error:
                  "Invalid advertiser key"
              }
            );

            return;
          }

          const dashboard =
            await getAdvertiserDashboard(
              advertiser
            );

          sendJson(
            res,
            200,
            {
              ok: true,
              ...dashboard
            }
          );

          return;
        }

        /* =================================================
           ADS — CREATE RAZORPAY ORDER
        ================================================= */

        if (
          req.method === "POST" &&
          pathname ===
            "/api/ads/payment/order"
        ) {
          const advertiser =
            await getAdvertiserFromKey(
              getAdvertiserKey(req)
            );

          if (!advertiser) {
            sendJson(
              res,
              401,
              {
                ok: false,
                error:
                  "Invalid advertiser key"
              }
            );

            return;
          }

          const body =
            await parseJsonBody(
              req
            );

          const payment =
            await createRazorpayOrder(
              advertiser,
              body.amount
            );

          sendJson(
            res,
            200,
            {
              ok: true,
              payment
            }
          );

          return;
        }

        /* =================================================
           ADS — VERIFY RAZORPAY PAYMENT
        ================================================= */

        if (
          req.method === "POST" &&
          pathname ===
            "/api/ads/payment/verify"
        ) {
          const advertiser =
            await getAdvertiserFromKey(
              getAdvertiserKey(req)
            );

          if (!advertiser) {
            sendJson(
              res,
              401,
              {
                ok: false,
                error:
                  "Invalid advertiser key"
              }
            );

            return;
          }

          const body =
            await parseJsonBody(
              req
            );

          const result =
            await verifyRazorpayPayment(
              advertiser,
              body
            );

          sendJson(
            res,
            200,
            result
          );

          return;
        }

        /* =================================================
           RAZORPAY WEBHOOK
        ================================================= */

        if (
          req.method === "POST" &&
          pathname ===
            "/api/ads/payment/webhook"
        ) {
          await handleRazorpayWebhook(
            req,
            res
          );

          return;
        }

        /* =================================================
           ADS — CONFIG
        ================================================= */

        if (
          req.method === "GET" &&
          pathname ===
            "/api/ads/config"
        ) {
          sendJson(
            res,
            200,
            {
              ok: true,
              razorpay:
                Boolean(
                  RAZORPAY_KEY_ID
                ),
              razorpay_key_id:
                RAZORPAY_KEY_ID ||
                null,
              currency:
                "INR"
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

        sendJson(
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
          "[HEXORA SERVER ERROR]",
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
              error.message
          }
        );
      }
    }
  );

/* =========================================================
   START
========================================================= */

await ensureAdsColumns();

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

    console.log(
      `[HEXORA] Razorpay configured: ${
        Boolean(RAZORPAY_KEY_ID)
      }`
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
    `[HEXORA] ${signal} received. Shutting down...`
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
  () => shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);
