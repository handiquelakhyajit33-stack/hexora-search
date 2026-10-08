// ============================================================
// HEXORA SEARCH ENGINE
// Complete server.mjs
// Neon/Postgres + Search + Demand + Ads + PayPal
// ============================================================

import "dotenv/config";
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

// ============================================================
// BASIC CONFIG
// ============================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 8080);
const HOST = "0.0.0.0";

const DATABASE_URL = process.env.DATABASE_URL || "";

if (!DATABASE_URL) {
  console.error("[HEXORA] DATABASE_URL is missing.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
  ssl: DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

console.log("[HEXORA] Neon database configured.");

// ============================================================
// PAYPAL CONFIG
// ============================================================

const PAYPAL_CLIENT_ID =
  process.env.PAYPAL_CLIENT_ID || "";

const PAYPAL_CLIENT_SECRET =
  process.env.PAYPAL_CLIENT_SECRET || "";

const PAYPAL_MODE =
  String(process.env.PAYPAL_MODE || "sandbox")
    .trim()
    .toLowerCase();

const PAYPAL_BASE_URL =
  PAYPAL_MODE === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

const PAYPAL_WEBHOOK_ID =
  process.env.PAYPAL_WEBHOOK_ID || "";

function paypalConfigured() {
  return Boolean(
    PAYPAL_CLIENT_ID &&
    PAYPAL_CLIENT_SECRET
  );
}

// ============================================================
// ADMIN / SECURITY
// ============================================================

const HEXORA_ADS_ADMIN_KEY =
  process.env.HEXORA_ADS_ADMIN_KEY || "";

const SEARCH_CANDIDATE_LIMIT = 10000;

// ============================================================
// HELPERS
// ============================================================

function json(res, status, data) {
  const body = JSON.stringify(data);

  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "Content-Type, X-HEXORA-ADVERTISER-KEY, X-HEXORA-ADMIN-KEY",
    "Access-Control-Allow-Methods":
      "GET,POST,OPTIONS",
  });

  res.end(body);
}

function text(res, status, body, contentType = "text/plain") {
  res.writeHead(status, {
    "Content-Type": `${contentType}; charset=utf-8`,
    "Cache-Control": "no-store",
  });

  res.end(body);
}

function safeInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);

  if (!Number.isFinite(n)) {
    return fallback;
  }

  return Math.min(
    max,
    Math.max(min, n)
  );
}

function normalizeQuery(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 500);
}

function wordsOf(value) {
  return normalizeQuery(value)
    .toLowerCase()
    .split(/[^a-z0-9\u00C0-\uFFFF]+/i)
    .filter(Boolean)
    .slice(0, 32);
}

function safeUrl(value) {
  try {
    const u = new URL(value);

    if (
      u.protocol !== "http:" &&
      u.protocol !== "https:"
    ) {
      return null;
    }

    return u.toString();
  } catch {
    return null;
  }
}

function cleanText(value, max = 1000) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function cleanSnippet(value, max = 320) {
  return cleanText(
    value
      ?.replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
    max
  );
}

function parseCookies(req) {
  const header = req.headers.cookie || "";

  const result = {};

  for (const part of header.split(";")) {
    const index = part.indexOf("=");

    if (index === -1) continue;

    const key = part
      .slice(0, index)
      .trim();

    const value = part
      .slice(index + 1)
      .trim();

    result[key] = decodeURIComponent(value);
  }

  return result;
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    let size = 0;

    req.on("data", chunk => {
      size += chunk.length;

      if (size > 2 * 1024 * 1024) {
        reject(
          new Error("Request body too large")
        );

        req.destroy();

        return;
      }

      body += chunk.toString("utf8");
    });

    req.on("end", () => {
      if (!body) {
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

function randomKey(prefix = "hx") {
  return `${prefix}_${crypto.randomBytes(32).toString("hex")}`;
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(String(value))
    .digest("hex");
}

function makeAdvertiserKey() {
  return randomKey("hxadv");
}

// ============================================================
// DATABASE INITIALIZATION
// ============================================================

async function ensureDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS search_queries (
      id BIGSERIAL PRIMARY KEY,
      query TEXT NOT NULL,
      normalized_query TEXT NOT NULL UNIQUE,
      search_count BIGINT NOT NULL DEFAULT 1,
      crawl_priority DOUBLE PRECISION NOT NULL DEFAULT 1,
      first_searched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_searched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_crawled_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS search_queries_priority_idx
    ON search_queries (
      crawl_priority DESC,
      search_count DESC,
      last_searched_at DESC
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS search_queries_status_idx
    ON search_queries(status)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS advertisers (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      company_name TEXT,
      website TEXT,
      balance NUMERIC(14,2) NOT NULL DEFAULT 0,
      total_spent NUMERIC(14,2) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ad_campaigns (
      id BIGSERIAL PRIMARY KEY,
      advertiser_id BIGINT NOT NULL
        REFERENCES advertisers(id)
        ON DELETE CASCADE,
      name TEXT NOT NULL,
      daily_budget NUMERIC(14,2) NOT NULL DEFAULT 0,
      total_budget NUMERIC(14,2) NOT NULL DEFAULT 0,
      spent NUMERIC(14,2) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ads (
      id BIGSERIAL PRIMARY KEY,
      campaign_id BIGINT NOT NULL
        REFERENCES ad_campaigns(id)
        ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      destination_url TEXT NOT NULL,
      keywords TEXT[] NOT NULL DEFAULT '{}',
      bid_per_click NUMERIC(14,2) NOT NULL DEFAULT 0.10,
      impressions BIGINT NOT NULL DEFAULT 0,
      clicks BIGINT NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ad_events (
      id BIGSERIAL PRIMARY KEY,
      ad_id BIGINT NOT NULL
        REFERENCES ads(id)
        ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      query TEXT,
      cost NUMERIC(14,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ad_transactions (
      id BIGSERIAL PRIMARY KEY,
      advertiser_id BIGINT NOT NULL
        REFERENCES advertisers(id)
        ON DELETE CASCADE,
      amount NUMERIC(14,2) NOT NULL,
      transaction_type TEXT NOT NULL,
      reference TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      payment_provider TEXT,
      payment_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE advertisers
    ADD COLUMN IF NOT EXISTS api_key_hash TEXT
  `);

  await pool.query(`
    ALTER TABLE advertisers
    ADD COLUMN IF NOT EXISTS api_key_prefix TEXT
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS advertisers_api_key_hash_idx
    ON advertisers(api_key_hash)
    WHERE api_key_hash IS NOT NULL
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ad_payment_orders (
      id BIGSERIAL PRIMARY KEY,
      advertiser_id BIGINT NOT NULL
        REFERENCES advertisers(id)
        ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_order_id TEXT NOT NULL UNIQUE,
      amount NUMERIC(14,2) NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      status TEXT NOT NULL DEFAULT 'created',
      credited BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ad_webhook_events (
      id BIGSERIAL PRIMARY KEY,
      provider TEXT NOT NULL,
      event_id TEXT NOT NULL,
      event_type TEXT,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(provider, event_id)
    )
  `);

  console.log(
    "[HEXORA] Ads payment tables ready."
  );
}

// ============================================================
// SEARCH DEMAND
// ============================================================

async function recordSearchDemand(query) {
  const original = normalizeQuery(query);

  if (!original) return;

  const normalized = original.toLowerCase();

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
        updated_at,
        status
      )
      VALUES (
        $1,
        $2,
        1,
        1,
        NOW(),
        NOW(),
        NOW(),
        'pending'
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
              search_queries.crawl_priority,
              1
            ) +
            1 +
            LN(
              GREATEST(
                1,
                search_queries.search_count + 1
              )
            )
          ),
        last_searched_at = NOW(),
        updated_at = NOW()
      `,
      [original, normalized]
    );
  } catch (error) {
    console.error(
      "[HEXORA] demand tracking failed:",
      error?.message || error
    );
  }
}

// ============================================================
// SEARCH
// ============================================================

function buildTsQuery(query) {
  const words = wordsOf(query);

  if (!words.length) {
    return null;
  }

  return words
    .map(word =>
      word.replace(
        /[^a-zA-Z0-9\u00C0-\uFFFF]/g,
        ""
      )
    )
    .filter(Boolean)
    .join(" & ");
}

async function searchDatabase(
  query,
  mode = "web",
  page = 1,
  limit = 20
) {
  const q = normalizeQuery(query);

  if (!q) {
    return {
      results: [],
      total: 0,
      suggestions: [],
    };
  }

  const offset =
    (page - 1) * limit;

  const tsQuery =
    buildTsQuery(q);

  const searchWords =
    wordsOf(q);

  const pattern =
    `%${q.replace(/[%_]/g, "")}%`;

  let rows = [];

  try {
    const result =
      await pool.query(
        `
        SELECT
          p.id,
          p.url,
          p.title,
          p.description,
          p.content,
          p.domain,
          p.language,
          p.author,
          p.image_url,
          p.published_at,
          p.updated_at,
          p.last_crawled_at,
          p.authority_score,
          p.popularity_score,

          CASE
            WHEN LOWER(COALESCE(p.title,'')) =
                 LOWER($1)
            THEN 1000

            WHEN LOWER(COALESCE(p.title,'')) LIKE
                 LOWER($2)
            THEN 700

            WHEN LOWER(COALESCE(p.description,'')) LIKE
                 LOWER($2)
            THEN 350

            WHEN LOWER(COALESCE(p.url,'')) LIKE
                 LOWER($2)
            THEN 250

            ELSE 0
          END AS exact_score,

          CASE
            WHEN $3::text IS NOT NULL
            THEN ts_rank_cd(
              p.search_vector,
              websearch_to_tsquery(
                'simple',
                $3
              )
            )
            ELSE 0
          END AS text_rank,

          CASE
            WHEN p.authority_score IS NULL
            THEN 0
            ELSE LEAST(
              100,
              GREATEST(
                0,
                p.authority_score
              )
            )
          END AS authority,

          CASE
            WHEN p.popularity_score IS NULL
            THEN 0
            ELSE LEAST(
              100,
              GREATEST(
                0,
                p.popularity_score
              )
            )
          END AS popularity

        FROM pages p

        WHERE
          (
            LOWER(COALESCE(p.title,'')) LIKE LOWER($2)
            OR LOWER(COALESCE(p.description,'')) LIKE LOWER($2)
            OR LOWER(COALESCE(p.content,'')) LIKE LOWER($2)
            OR LOWER(COALESCE(p.url,'')) LIKE LOWER($2)
            OR (
              $3::text IS NOT NULL
              AND p.search_vector @@
                  websearch_to_tsquery(
                    'simple',
                    $3
                  )
            )
          )

        ORDER BY
          exact_score DESC,
          text_rank DESC,
          authority DESC,
          popularity DESC,
          p.last_crawled_at DESC NULLS LAST

        LIMIT $4
        OFFSET $5
        `,
        [
          q,
          pattern,
          tsQuery,
          Math.min(
            SEARCH_CANDIDATE_LIMIT,
            Math.max(
              limit * 5,
              100
            )
          ),
          offset,
        ]
      );

    rows = result.rows;
  } catch (error) {
    console.error(
      "[HEXORA] search query failed:",
      error?.message || error
    );

    // Fallback search without search_vector
    try {
      const fallback =
        await pool.query(
          `
          SELECT
            id,
            url,
            title,
            description,
            content,
            domain,
            language,
            author,
            image_url,
            published_at,
            updated_at,
            last_crawled_at,
            authority_score,
            popularity_score
          FROM pages
          WHERE
            LOWER(COALESCE(title,'')) LIKE LOWER($1)
            OR LOWER(COALESCE(description,'')) LIKE LOWER($1)
            OR LOWER(COALESCE(content,'')) LIKE LOWER($1)
            OR LOWER(COALESCE(url,'')) LIKE LOWER($1)
          ORDER BY
            authority_score DESC NULLS LAST,
            popularity_score DESC NULLS LAST,
            last_crawled_at DESC NULLS LAST
          LIMIT $2
          OFFSET $3
          `,
          [
            pattern,
            limit,
            offset,
          ]
        );

      rows = fallback.rows;
    } catch (fallbackError) {
      console.error(
        "[HEXORA] fallback search failed:",
        fallbackError?.message ||
          fallbackError
      );

      rows = [];
    }
  }

  const results = [];

  const domainCounts = new Map();

  for (const row of rows) {
    const domain =
      row.domain ||
      (() => {
        try {
          return new URL(row.url).hostname;
        } catch {
          return "";
        }
      })();

    const current =
      domainCounts.get(domain) || 0;

    if (current >= 3) {
      continue;
    }

    domainCounts.set(
      domain,
      current + 1
    );

    const title =
      cleanText(
        row.title ||
        row.url ||
        "Untitled",
        250
      );

    const description =
      cleanSnippet(
        row.description ||
        row.content ||
        "",
        360
      );

    results.push({
      id: row.id,
      url: row.url,
      title,
      description,
      snippet: description,
      domain,
      language:
        row.language || null,
      author:
        row.author || null,
      image_url:
        row.image_url || null,
      published_at:
        row.published_at || null,
      updated_at:
        row.updated_at ||
        row.last_crawled_at ||
        null,
    });

    if (results.length >= limit) {
      break;
    }
  }

  let total = 0;

  try {
    const countResult =
      await pool.query(
        `
        SELECT COUNT(*)::BIGINT AS total
        FROM pages p
        WHERE
          LOWER(COALESCE(p.title,'')) LIKE LOWER($1)
          OR LOWER(COALESCE(p.description,'')) LIKE LOWER($1)
          OR LOWER(COALESCE(p.content,'')) LIKE LOWER($1)
          OR LOWER(COALESCE(p.url,'')) LIKE LOWER($1)
        `,
        [pattern]
      );

    total =
      Number(
        countResult.rows[0]?.total || 0
      );
  } catch {
    total = results.length;
  }

  const suggestions =
    searchWords.length
      ? searchWords.slice(0, 5)
      : [];

  return {
    results,
    total,
    suggestions,
  };
}

// ============================================================
// ADS AUTH
// ============================================================

async function getAdvertiserFromKey(req) {
  const key =
    req.headers[
      "x-hexora-advertiser-key"
    ];

  if (!key) {
    return null;
  }

  const hash = sha256(key);

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

function adminAuthorized(req) {
  if (!HEXORA_ADS_ADMIN_KEY) {
    return false;
  }

  const key =
    req.headers[
      "x-hexora-admin-key"
    ];

  return Boolean(
    key &&
    crypto.timingSafeEqual(
      Buffer.from(String(key)),
      Buffer.from(
        String(HEXORA_ADS_ADMIN_KEY)
      )
    )
  );
}

// ============================================================
// AD SERVING
// ============================================================

async function getSponsoredAds(query) {
  const words =
    wordsOf(query)
      .map(x => x.toLowerCase())
      .slice(0, 20);

  if (!words.length) {
    return [];
  }

  const result =
    await pool.query(`
      SELECT
        a.id,
        a.title,
        a.description,
        a.destination_url,
        a.keywords,
        a.bid_per_click,
        c.id AS campaign_id,
        c.name AS campaign_name
      FROM ads a
      JOIN ad_campaigns c
        ON c.id = a.campaign_id
      JOIN advertisers adv
        ON adv.id = c.advertiser_id
      WHERE
        a.status = 'approved'
        AND c.status = 'active'
        AND adv.status = 'active'
        AND adv.balance > 0
        AND c.spent < c.total_budget
      ORDER BY
        a.bid_per_click DESC,
        a.impressions ASC
      LIMIT 20
    `);

  const matched = [];

  for (const ad of result.rows) {
    const keywords =
      Array.isArray(ad.keywords)
        ? ad.keywords.map(x =>
            String(x).toLowerCase()
          )
        : [];

    const score =
      words.reduce(
        (sum, word) =>
          sum +
          keywords.some(k =>
            k.includes(word) ||
            word.includes(k)
          )
            ? 1
            : 0,
        0
      );

    if (score > 0) {
      matched.push({
        ...ad,
        match_score: score,
      });
    }
  }

  matched.sort(
    (a, b) =>
      b.match_score - a.match_score ||
      Number(b.bid_per_click) -
        Number(a.bid_per_click)
  );

  return matched.slice(0, 3);
}

// ============================================================
// PAYPAL API
// ============================================================

async function getPayPalAccessToken() {
  if (!paypalConfigured()) {
    throw new Error(
      "PayPal is not configured"
    );
  }

  const credentials =
    Buffer.from(
      `${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`
    ).toString("base64");

  const response =
    await fetch(
      `${PAYPAL_BASE_URL}/v1/oauth2/token`,
      {
        method: "POST",
        headers: {
          Authorization:
            `Basic ${credentials}`,
          "Content-Type":
            "application/x-www-form-urlencoded",
        },
        body:
          "grant_type=client_credentials",
      }
    );

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error_description ||
      data?.error ||
      "PayPal authentication failed"
    );
  }

  return data.access_token;
}

async function paypalRequest(
  endpoint,
  options = {}
) {
  const token =
    await getPayPalAccessToken();

  const headers = {
    Authorization:
      `Bearer ${token}`,
    "Content-Type":
      "application/json",
  };

  if (options.requestId) {
    headers["PayPal-Request-Id"] =
      options.requestId;
  }

  const response =
    await fetch(
      `${PAYPAL_BASE_URL}${endpoint}`,
      {
        method:
          options.method || "GET",
        headers,
        body:
          options.body === undefined
            ? undefined
            : JSON.stringify(
                options.body
              ),
      }
    );

  const raw =
    await response.text();

  let data = {};

  try {
    data =
      raw ? JSON.parse(raw) : {};
  } catch {
    data = {
      raw,
    };
  }

  if (!response.ok) {
    const message =
      data?.message ||
      data?.details?.[0]?.description ||
      data?.error_description ||
      `PayPal error ${response.status}`;

    throw new Error(message);
  }

  return data;
}

async function createPayPalOrder({
  amount,
  currency = "USD",
  description = "HEXORA Ads balance",
}) {
  const numericAmount =
    Number(amount);

  if (
    !Number.isFinite(
      numericAmount
    ) ||
    numericAmount <= 0
  ) {
    throw new Error(
      "Invalid payment amount"
    );
  }

  const code =
    String(currency)
      .trim()
      .toUpperCase();

  if (!/^[A-Z]{3}$/.test(code)) {
    throw new Error(
      "Invalid currency"
    );
  }

  return paypalRequest(
    "/v2/checkout/orders",
    {
      method: "POST",
      requestId:
        randomKey("paypal"),
      body: {
        intent: "CAPTURE",

        purchase_units: [
          {
            description:
              String(description)
                .slice(0, 127),

            amount: {
              currency_code: code,
              value:
                numericAmount.toFixed(2),
            },
          },
        ],

        application_context: {
          brand_name: "HEXORA",
          user_action: "PAY_NOW",
          shipping_preference:
            "NO_SHIPPING",
        },
      },
    }
  );
}

async function capturePayPalOrder(
  orderId
) {
  if (!orderId) {
    throw new Error(
      "PayPal order ID is required"
    );
  }

  return paypalRequest(
    `/v2/checkout/orders/${encodeURIComponent(
      orderId
    )}/capture`,
    {
      method: "POST",
      requestId:
        `hexora-capture-${orderId}`,
      body: {},
    }
  );
}

// ============================================================
// PAYPAL WEBHOOK VERIFICATION
// ============================================================

async function verifyPayPalWebhook(
  headers,
  webhookEvent
) {
  if (!PAYPAL_WEBHOOK_ID) {
    return false;
  }

  const token =
    await getPayPalAccessToken();

  const response =
    await fetch(
      `${PAYPAL_BASE_URL}/v1/notifications/verify-webhook-signature`,
      {
        method: "POST",
        headers: {
          Authorization:
            `Bearer ${token}`,
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify({
          auth_algo:
            headers["paypal-auth-algo"],
          cert_url:
            headers["paypal-cert-url"],
          transmission_id:
            headers[
              "paypal-transmission-id"
            ],
          transmission_sig:
            headers[
              "paypal-transmission-sig"
            ],
          transmission_time:
            headers[
              "paypal-transmission-time"
            ],
          webhook_id:
            PAYPAL_WEBHOOK_ID,
          webhook_event:
            webhookEvent,
        }),
      }
    );

  const data =
    await response.json();

  return (
    response.ok &&
    data?.verification_status ===
      "SUCCESS"
  );
}

// ============================================================
// CREDIT PAYPAL PAYMENT
// ============================================================

async function creditPayPalPayment(
  orderId,
  captureId,
  advertiserId,
  amount,
  currency
) {
  const client =
    await pool.connect();

  try {
    await client.query(
      "BEGIN"
    );

    const existing =
      await client.query(
        `
        SELECT *
        FROM ad_payment_orders
        WHERE provider = 'paypal'
        AND provider_order_id = $1
        FOR UPDATE
        `,
        [orderId]
      );

    if (!existing.rows.length) {
      throw new Error(
        "PayPal order was not found"
      );
    }

    const payment =
      existing.rows[0];

    if (
      Number(payment.advertiser_id) !==
      Number(advertiserId)
    ) {
      throw new Error(
        "Payment does not belong to advertiser"
      );
    }

    if (payment.credited) {
      await client.query(
        "COMMIT"
      );

      return {
        alreadyCredited: true,
      };
    }

    const dbAmount =
      Number(payment.amount);

    if (
      Math.abs(
        dbAmount - Number(amount)
      ) > 0.01
    ) {
      throw new Error(
        "Payment amount mismatch"
      );
    }

    if (
      String(payment.currency)
        .toUpperCase() !==
      String(currency)
        .toUpperCase()
    ) {
      throw new Error(
        "Payment currency mismatch"
      );
    }

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
        dbAmount,
        advertiserId,
      ]
    );

    await client.query(
      `
      UPDATE ad_payment_orders
      SET
        status = 'completed',
        credited = TRUE,
        updated_at = NOW()
      WHERE id = $1
      `,
      [payment.id]
    );

    await client.query(
      `
      INSERT INTO ad_transactions (
        advertiser_id,
        amount,
        transaction_type,
        reference,
        status,
        payment_provider,
        payment_id
      )
      VALUES (
        $1,
        $2,
        'deposit',
        $3,
        'completed',
        'paypal',
        $4
      )
      `,
      [
        advertiserId,
        dbAmount,
        orderId,
        captureId,
      ]
    );

    await client.query(
      "COMMIT"
    );

    return {
      alreadyCredited: false,
      amount: dbAmount,
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

// ============================================================
// SERVER
// ============================================================

const server =
  http.createServer(
    async (req, res) => {
      try {
        if (
          req.method === "OPTIONS"
        ) {
          res.writeHead(204, {
            "Access-Control-Allow-Origin":
              "*",
            "Access-Control-Allow-Headers":
              "Content-Type, X-HEXORA-ADVERTISER-KEY, X-HEXORA-ADMIN-KEY",
            "Access-Control-Allow-Methods":
              "GET,POST,OPTIONS",
          });

          res.end();

          return;
        }

        const parsed =
          new URL(
            req.url,
            `http://${req.headers.host || "localhost"}`
          );

        const pathname =
          parsed.pathname;

        // ======================================================
        // HEALTH
        // ======================================================

        if (
          req.method === "GET" &&
          pathname === "/health"
        ) {
          let database = "unknown";

          try {
            await pool.query(
              "SELECT 1"
            );

            database = "ok";
          } catch {
            database = "error";
          }

          return json(res, 200, {
            ok: true,
            service: "HEXORA",
            database,
            paypal:
              paypalConfigured(),
            mode: PAYPAL_MODE,
            timestamp:
              new Date().toISOString(),
          });
        }

        // ======================================================
        // PAYPAL CONFIG
        // ======================================================

        if (
          req.method === "GET" &&
          pathname ===
            "/api/ads/paypal/config"
        ) {
          return json(res, 200, {
            ok: true,
            provider: "paypal",
            configured:
              paypalConfigured(),
            mode: PAYPAL_MODE,
            currency: "USD",
          });
        }

        // ======================================================
        // SEARCH
        // ======================================================

        if (
          req.method === "GET" &&
          pathname === "/search"
        ) {
          const query =
            normalizeQuery(
              parsed.searchParams.get(
                "q"
              )
            );

          const mode =
            parsed.searchParams.get(
              "mode"
            ) || "web";

          const page =
            safeInt(
              parsed.searchParams.get(
                "page"
              ),
              1,
              1,
              10000
            );

          const limit =
            safeInt(
              parsed.searchParams.get(
                "limit"
              ),
              20,
              1,
              50
            );

          if (!query) {
            return json(res, 400, {
              ok: false,
              error:
                "Search query is required",
            });
          }

          recordSearchDemand(
            query
          ).catch(() => {});

          const search =
            await searchDatabase(
              query,
              mode,
              page,
              limit
            );

          let sponsored_ads = [];

          try {
            sponsored_ads =
              await getSponsoredAds(
                query
              );
          } catch (error) {
            console.error(
              "[HEXORA] ad serving error:",
              error?.message ||
                error
            );
          }

          return json(res, 200, {
            ok: true,
            query,
            mode,
            page,
            limit,
            total:
              search.total,
            results:
              search.results,
            suggestions:
              search.suggestions,
            sponsored_ads,
          });
        }

        // ======================================================
        // NEWS
        // ======================================================

        if (
          req.method === "GET" &&
          pathname === "/api/news"
        ) {
          return json(res, 200, {
            ok: true,
            results: [],
            message:
              "HEXORA news index is being built.",
          });
        }

        // ======================================================
        // IMAGES
        // ======================================================

        if (
          req.method === "GET" &&
          pathname === "/api/images"
        ) {
          const query =
            normalizeQuery(
              parsed.searchParams.get(
                "q"
              )
            );

          return json(res, 200, {
            ok: true,
            query,
            results: [],
          });
        }

        // ======================================================
        // VIDEOS
        // ======================================================

        if (
          req.method === "GET" &&
          pathname === "/api/videos"
        ) {
          const query =
            normalizeQuery(
              parsed.searchParams.get(
                "q"
              )
            );

          return json(res, 200, {
            ok: true,
            query,
            results: [],
          });
        }

        // ======================================================
        // MAPS
        // ======================================================

        if (
          req.method === "GET" &&
          pathname === "/api/maps"
        ) {
          return json(res, 200, {
            ok: true,
            results: [],
          });
        }

        // ======================================================
        // CREATE ADVERTISER
        // ======================================================

        if (
          req.method === "POST" &&
          pathname ===
            "/api/ads/advertisers"
        ) {
          const body =
            await readBody(req);

          const name =
            cleanText(body.name, 150);

          const email =
            cleanText(
              body.email,
              250
            ).toLowerCase();

          const companyName =
            cleanText(
              body.company_name,
              200
            );

          const website =
            safeUrl(
              body.website || ""
            );

          if (
            !name ||
            !email
          ) {
            return json(res, 400, {
              ok: false,
              error:
                "name and email are required",
            });
          }

          const apiKey =
            makeAdvertiserKey();

          const hash =
            sha256(apiKey);

          try {
            const result =
              await pool.query(
                `
                INSERT INTO advertisers (
                  name,
                  email,
                  company_name,
                  website,
                  api_key_hash,
                  api_key_prefix,
                  status
                )
                VALUES (
                  $1,$2,$3,$4,$5,$6,'active'
                )
                RETURNING
                  id,
                  name,
                  email,
                  company_name,
                  website,
                  balance,
                  status
                `,
                [
                  name,
                  email,
                  companyName ||
                    null,
                  website,
                  hash,
                  apiKey.slice(
                    0,
                    12
                  ),
                ]
              );

            return json(res, 201, {
              ok: true,
              advertiser:
                result.rows[0],
              api_key:
                apiKey,
              warning:
                "Save this API key. It will not be shown again.",
            });
          } catch (error) {
            if (
              String(
                error?.message || ""
              ).includes(
                "duplicate"
              )
            ) {
              return json(res, 409, {
                ok: false,
                error:
                  "Advertiser email already exists",
              });
            }

            throw error;
          }
        }

        // ======================================================
        // CREATE CAMPAIGN
        // ======================================================

        if (
          req.method === "POST" &&
          pathname ===
            "/api/ads/campaigns"
        ) {
          const advertiser =
            await getAdvertiserFromKey(
              req
            );

          if (!advertiser) {
            return json(res, 401, {
              ok: false,
              error:
                "Invalid advertiser API key",
            });
          }

          const body =
            await readBody(req);

          const name =
            cleanText(
              body.name,
              200
            );

          const dailyBudget =
            Number(
              body.daily_budget || 0
            );

          const totalBudget =
            Number(
              body.total_budget || 0
            );

          if (
            !name ||
            dailyBudget < 0 ||
            totalBudget <= 0
          ) {
            return json(res, 400, {
              ok: false,
              error:
                "Invalid campaign details",
            });
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
                $1,$2,$3,$4,'draft'
              )
              RETURNING *
              `,
              [
                advertiser.id,
                name,
                dailyBudget,
                totalBudget,
              ]
            );

          return json(res, 201, {
            ok: true,
            campaign:
              result.rows[0],
          });
        }

        // ======================================================
        // CREATE AD
        // ======================================================

        if (
          req.method === "POST" &&
          pathname === "/api/ads"
        ) {
          const advertiser =
            await getAdvertiserFromKey(
              req
            );

          if (!advertiser) {
            return json(res, 401, {
              ok: false,
              error:
                "Invalid advertiser API key",
            });
          }

          const body =
            await readBody(req);

          const campaignId =
            Number(
              body.campaign_id
            );

          const title =
            cleanText(
              body.title,
              200
            );

          const description =
            cleanText(
              body.description,
              1000
            );

          const destination =
            safeUrl(
              body.destination_url
            );

          const bid =
            Number(
              body.bid_per_click ||
                0.1
            );

          let keywords =
            Array.isArray(
              body.keywords
            )
              ? body.keywords
                  .map(x =>
                    cleanText(
                      x,
                      80
                    ).toLowerCase()
                  )
                  .filter(Boolean)
                  .slice(0, 50)
              : [];

          if (
            !campaignId ||
            !title ||
            !destination ||
            !Number.isFinite(
              bid
            ) ||
            bid <= 0
          ) {
            return json(res, 400, {
              ok: false,
              error:
                "Invalid ad details",
            });
          }

          const campaign =
            await pool.query(
              `
              SELECT id
              FROM ad_campaigns
              WHERE id = $1
              AND advertiser_id = $2
              `,
              [
                campaignId,
                advertiser.id,
              ]
            );

          if (!campaign.rows.length) {
            return json(res, 404, {
              ok: false,
              error:
                "Campaign not found",
            });
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
                $1,$2,$3,$4,$5,$6,'pending'
              )
              RETURNING *
              `,
              [
                campaignId,
                title,
                description ||
                  null,
                destination,
                keywords,
                bid,
              ]
            );

          return json(res, 201, {
            ok: true,
            ad:
              result.rows[0],
          });
        }

        // ======================================================
        // APPROVE AD
        // ======================================================

        if (
          req.method === "POST" &&
          pathname ===
            "/api/ads/approve"
        ) {
          if (
            !adminAuthorized(req)
          ) {
            return json(res, 401, {
              ok: false,
              error:
                "Invalid admin key",
            });
          }

          const body =
            await readBody(req);

          const adId =
            Number(body.ad_id);

          if (!adId) {
            return json(res, 400, {
              ok: false,
              error:
                "ad_id is required",
            });
          }

          const result =
            await pool.query(
              `
              UPDATE ads
              SET
                status = 'approved',
                updated_at = NOW()
              WHERE id = $1
              RETURNING *
              `,
              [adId]
            );

          return json(res, 200, {
            ok: true,
            ad:
              result.rows[0] || null,
          });
        }

        // ======================================================
        // AD DASHBOARD
        // ======================================================

        if (
          req.method === "GET" &&
          pathname ===
            "/api/ads/dashboard"
        ) {
          const advertiser =
            await getAdvertiserFromKey(
              req
            );

          if (!advertiser) {
            return json(res, 401, {
              ok: false,
              error:
                "Invalid advertiser API key",
            });
          }

          const campaigns =
            await pool.query(
              `
              SELECT *
              FROM ad_campaigns
              WHERE advertiser_id = $1
              ORDER BY id DESC
              `,
              [advertiser.id]
            );

          return json(res, 200, {
            ok: true,
            advertiser: {
              id:
                advertiser.id,
              name:
                advertiser.name,
              email:
                advertiser.email,
              company_name:
                advertiser.company_name,
              balance:
                advertiser.balance,
              total_spent:
                advertiser.total_spent,
            },
            campaigns:
              campaigns.rows,
          });
        }

        // ======================================================
        // PAYPAL CREATE ORDER
        // ======================================================

        if (
          req.method === "POST" &&
          pathname ===
            "/api/ads/paypal/order"
        ) {
          const advertiser =
            await getAdvertiserFromKey(
              req
            );

          if (!advertiser) {
            return json(res, 401, {
              ok: false,
              error:
                "Invalid advertiser API key",
            });
          }

          if (!paypalConfigured()) {
            return json(res, 503, {
              ok: false,
              error:
                "PayPal is not configured",
            });
          }

          const body =
            await readBody(req);

          const amount =
            Number(body.amount);

          const currency =
            String(
              body.currency ||
                "USD"
            )
              .trim()
              .toUpperCase();

          if (
            !Number.isFinite(
              amount
            ) ||
            amount <= 0
          ) {
            return json(res, 400, {
              ok: false,
              error:
                "Valid amount is required",
            });
          }

          if (
            !/^[A-Z]{3}$/.test(
              currency
            )
          ) {
            return json(res, 400, {
              ok: false,
              error:
                "Invalid currency",
            });
          }

          const order =
            await createPayPalOrder({
              amount,
              currency,
              description:
                "HEXORA Ads balance",
            });

          await pool.query(
            `
            INSERT INTO ad_payment_orders (
              advertiser_id,
              provider,
              provider_order_id,
              amount,
              currency,
              status,
              credited
            )
            VALUES (
              $1,
              'paypal',
              $2,
              $3,
              $4,
              'created',
              FALSE
            )
            `,
            [
              advertiser.id,
              order.id,
              amount,
              currency,
            ]
          );

          return json(res, 200, {
            ok: true,
            provider: "paypal",
            mode:
              PAYPAL_MODE,
            order_id:
              order.id,
            status:
              order.status,
            links:
              order.links || [],
          });
        }

        // ======================================================
        // PAYPAL CAPTURE
        // ======================================================

        if (
          req.method === "POST" &&
          pathname ===
            "/api/ads/paypal/capture"
        ) {
          const advertiser =
            await getAdvertiserFromKey(
              req
            );

          if (!advertiser) {
            return json(res, 401, {
              ok: false,
              error:
                "Invalid advertiser API key",
            });
          }

          if (!paypalConfigured()) {
            return json(res, 503, {
              ok: false,
              error:
                "PayPal is not configured",
            });
          }

          const body =
            await readBody(req);

          const orderId =
            cleanText(
              body.order_id,
              200
            );

          if (!orderId) {
            return json(res, 400, {
              ok: false,
              error:
                "order_id is required",
            });
          }

          const local =
            await pool.query(
              `
              SELECT *
              FROM ad_payment_orders
              WHERE provider = 'paypal'
              AND provider_order_id = $1
              AND advertiser_id = $2
              LIMIT 1
              `,
              [
                orderId,
                advertiser.id,
              ]
            );

          if (!local.rows.length) {
            return json(res, 404, {
              ok: false,
              error:
                "Payment order not found",
            });
          }

          const result =
            await capturePayPalOrder(
              orderId
            );

          const capture =
            result
              ?.purchase_units?.[0]
              ?.payments
              ?.captures?.[0];

          const completed =
            result.status ===
              "COMPLETED" &&
            capture?.status ===
              "COMPLETED";

          if (
            completed &&
            capture
          ) {
            const amount =
              Number(
                capture.amount
                  ?.value
              );

            const currency =
              capture.amount
                ?.currency_code;

            await creditPayPalPayment(
              orderId,
              capture.id,
              advertiser.id,
              amount,
              currency
            );
          }

          return json(res, 200, {
            ok: true,
            provider: "paypal",
            order_id:
              result.id,
            status:
              result.status,
            completed,
            capture_id:
              capture?.id ||
              null,
            amount:
              capture?.amount ||
              null,
          });
        }

        // ======================================================
        // PAYPAL WEBHOOK
        // ======================================================

        if (
          req.method === "POST" &&
          pathname ===
            "/api/ads/paypal/webhook"
        ) {
          const body =
            await readBody(req);

          const verified =
            await verifyPayPalWebhook(
              req.headers,
              body
            );

          if (!verified) {
            return json(res, 400, {
              ok: false,
              error:
                "Invalid PayPal webhook",
            });
          }

          const eventId =
            cleanText(
              body.id,
              250
            );

          const eventType =
            cleanText(
              body.event_type,
              250
            );

          if (eventId) {
            await pool.query(
              `
              INSERT INTO ad_webhook_events (
                provider,
                event_id,
                event_type,
                payload
              )
              VALUES (
                'paypal',
                $1,
                $2,
                $3
              )
              ON CONFLICT (
                provider,
                event_id
              )
              DO NOTHING
              `,
              [
                eventId,
                eventType ||
                  null,
                body,
              ]
            );
          }

          return json(res, 200, {
            ok: true,
            received: true,
          });
        }

        // ======================================================
        // AD IMPRESSION
        // ======================================================

        if (
          req.method === "POST" &&
          pathname ===
            "/api/ads/impression"
        ) {
          const body =
            await readBody(req);

          const adId =
            Number(body.ad_id);

          const query =
            cleanText(
              body.query,
              500
            );

          if (!adId) {
            return json(res, 400, {
              ok: false,
              error:
                "ad_id is required",
            });
          }

          await pool.query(
            `
            UPDATE ads
            SET
              impressions =
                impressions + 1,
              updated_at = NOW()
            WHERE id = $1
            `,
            [adId]
          );

          await pool.query(
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
            [adId, query || null]
          );

          return json(res, 200, {
            ok: true,
          });
        }

        // ======================================================
        // AD CLICK / CPC
        // ======================================================

        if (
          req.method === "POST" &&
          pathname ===
            "/api/ads/click"
        ) {
          const body =
            await readBody(req);

          const adId =
            Number(body.ad_id);

          const query =
            cleanText(
              body.query,
              500
            );

          if (!adId) {
            return json(res, 400, {
              ok: false,
              error:
                "ad_id is required",
            });
          }

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
                  a.*,
                  c.advertiser_id,
                  c.total_budget,
                  c.spent AS campaign_spent
                FROM ads a
                JOIN ad_campaigns c
                  ON c.id = a.campaign_id
                WHERE a.id = $1
                FOR UPDATE
                `,
                [adId]
              );

            if (
              !adResult.rows.length
            ) {
              await client.query(
                "ROLLBACK"
              );

              return json(res, 404, {
                ok: false,
                error:
                  "Ad not found",
              });
            }

            const ad =
              adResult.rows[0];

            const cost =
              Number(
                ad.bid_per_click
              );

            const advertiserResult =
              await client.query(
                `
                SELECT *
                FROM advertisers
                WHERE id = $1
                FOR UPDATE
                `,
                [ad.advertiser_id]
              );

            if (
              !advertiserResult
                .rows.length
            ) {
              throw new Error(
                "Advertiser not found"
              );
            }

            const advertiser =
              advertiserResult
                .rows[0];

            if (
              Number(
                advertiser.balance
              ) < cost
            ) {
              await client.query(
                "ROLLBACK"
              );

              return json(res, 402, {
                ok: false,
                error:
                  "Insufficient advertiser balance",
              });
            }

            if (
              Number(
                ad.campaign_spent
              ) + cost >
              Number(
                ad.total_budget
              )
            ) {
              await client.query(
                "ROLLBACK"
              );

              return json(res, 402, {
                ok: false,
                error:
                  "Campaign budget exhausted",
              });
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
                advertiser.id,
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
                ad.campaign_id,
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
                query || null,
                cost,
              ]
            );

            await client.query(
              `
              INSERT INTO ad_transactions (
                advertiser_id,
                amount,
                transaction_type,
                reference,
                status,
                payment_provider,
                payment_id
              )
              VALUES (
                $1,
                $2,
                'ad_click',
                $3,
                'completed',
                'internal',
                $4
              )
              `,
              [
                advertiser.id,
                cost,
                query || null,
                String(adId),
              ]
            );

            await client.query(
              "COMMIT"
            );

            return json(res, 200, {
              ok: true,
              charged:
                cost,
              destination_url:
                ad.destination_url,
            });
          } catch (error) {
            try {
              await client.query(
                "ROLLBACK"
              );
            } catch {}

            console.error(
              "[HEXORA] ad click error:",
              error?.message ||
                error
            );

            return json(res, 500, {
              ok: false,
              error:
                "Unable to process ad click",
            });
          } finally {
            client.release();
          }
        }

        // ======================================================
        // STATIC FILES
        // ======================================================

        let requestedPath =
          pathname === "/"
            ? "/index.html"
            : pathname;

        try {
          requestedPath =
            decodeURIComponent(
              requestedPath
            );
          } catch {}

        const publicPath =
          path.join(
            __dirname,
            requestedPath
          );

        const safeRoot =
          path.resolve(
            __dirname
          );

        const safePath =
          path.resolve(
            publicPath
          );

        if (
          safePath.startsWith(
            safeRoot
          ) &&
          fs.existsSync(safePath) &&
          fs.statSync(safePath).isFile()
        ) {
          const ext =
            path.extname(
              safePath
            ).toLowerCase();

          const types = {
            ".html":
              "text/html",
            ".js":
              "text/javascript",
            ".mjs":
              "text/javascript",
            ".css":
              "text/css",
            ".json":
              "application/json",
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
              "text/plain",
          };

          res.writeHead(
            200,
            {
              "Content-Type":
                `${types[ext] || "application/octet-stream"}; charset=utf-8`,
            }
          );

          fs.createReadStream(
            safePath
          ).pipe(res);

          return;
        }

        // SPA fallback
        const indexPath =
          path.join(
            __dirname,
            "index.html"
          );

        if (
          fs.existsSync(indexPath)
        ) {
          res.writeHead(
            200,
            {
              "Content-Type":
                "text/html; charset=utf-8",
            }
          );

          fs.createReadStream(
            indexPath
          ).pipe(res);

          return;
        }

        return text(
          res,
          404,
          "HEXORA: Not Found"
        );
      } catch (error) {
        console.error(
          "[HEXORA] request error:",
          error?.stack ||
            error
        );

        if (!res.headersSent) {
          return json(
            res,
            500,
            {
              ok: false,
              error:
                "Internal server error",
            }
          );
        }

        res.end();
      }
    }
  );

// ============================================================
// STARTUP
// ============================================================

async function start() {
  try {
    await ensureDatabase();

    server.listen(
      PORT,
      HOST,
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
          `[HEXORA] PayPal configured: ${paypalConfigured()}`
        );

        console.log(
          `[HEXORA] PayPal mode: ${PAYPAL_MODE}`
        );
      }
    );
  } catch (error) {
    console.error(
      "[HEXORA] Startup failed:",
      error?.stack ||
        error
    );

    process.exit(1);
  }
}

// ============================================================
// SHUTDOWN
// ============================================================

async function shutdown(
  signal
) {
  console.log(
    `[HEXORA] ${signal} received`
  );

  server.close(
    async () => {
      try {
        await pool.end();
      } catch {}

      process.exit(0);
    }
  );

  setTimeout(
    () => process.exit(1),
    10000
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

start();
