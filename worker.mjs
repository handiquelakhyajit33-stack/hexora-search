```js
import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

const DATABASE_URL =
  process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required"
  );
}

const pool = new Pool({
  connectionString:
    DATABASE_URL,

  max: 3,

  idleTimeoutMillis:
    30000,

  connectionTimeoutMillis:
    10000,
});

const COUNTRIES = [
  "IN",
  "US",
  "GB",
  "CA",
  "AU",
  "DE",
  "FR",
  "JP",
  "BR",
  "ID",
  "MX",
  "SG",
  "AE",
  "ZA",
];

const GOOGLE_TRENDS_URL =
  "https://trends.google.com/trending/rss";

function normalizeQuery(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function cleanQuery(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function decodeXml(value) {
  return String(value || "")
    .replace(
      /<!\[CDATA\[([\s\S]*?)\]\]>/g,
      "$1"
    )
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function parseTraffic(value) {
  if (!value) {
    return 1000;
  }

  const text =
    decodeXml(value)
      .toLowerCase()
      .replace(/,/g, "")
      .trim();

  const match =
    text.match(
      /([\d.]+)\s*([km])?\+?/
    );

  if (!match) {
    return 1000;
  }

  let number =
    Number(match[1]);

  if (!Number.isFinite(number)) {
    return 1000;
  }

  if (match[2] === "k") {
    number *= 1000;
  }

  if (match[2] === "m") {
    number *= 1000000;
  }

  return Math.round(number);
}

function priorityFromTraffic(
  traffic
) {
  if (traffic >= 1000000)
    return 100000;

  if (traffic >= 500000)
    return 80000;

  if (traffic >= 200000)
    return 60000;

  if (traffic >= 100000)
    return 45000;

  if (traffic >= 50000)
    return 30000;

  if (traffic >= 20000)
    return 18000;

  if (traffic >= 10000)
    return 10000;

  if (traffic >= 5000)
    return 6000;

  if (traffic >= 2000)
    return 3000;

  return 1000;
}

async function fetchText(url) {
  const response =
    await fetch(url, {
      headers: {
        "User-Agent":
          "HEXORA-DemandBot/1.0",

        Accept:
          "application/rss+xml, application/xml, text/xml",
      },

      signal:
        AbortSignal.timeout(
          20000
        ),
    });

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} from ${url}`
    );
  }

  return await response.text();
}

function extractItems(xml) {
  const items = [];

  const blocks =
    xml.match(
      /<item[\s\S]*?<\/item>/gi
    ) || [];

  for (const block of blocks) {
    const title =
      block.match(
        /<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i
      )?.[1] ||
      block.match(
        /<title>([\s\S]*?)<\/title>/i
      )?.[1];

    const traffic =
      block.match(
        /<approx_traffic><!\[CDATA\[([\s\S]*?)\]\]><\/approx_traffic>/i
      )?.[1] ||
      block.match(
        /<approx_traffic>([\s\S]*?)<\/approx_traffic>/i
      )?.[1];

    const pubDate =
      block.match(
        /<pubDate>([\s\S]*?)<\/pubDate>/i
      )?.[1];

    const query =
      cleanQuery(
        decodeXml(title)
      );

    if (!query) {
      continue;
    }

    items.push({
      query,

      traffic:
        parseTraffic(
          traffic
        ),

      pubDate:
        decodeXml(
          pubDate
        ),
    });
  }

  return items;
}

async function upsertDemand({
  query,
  country,
  traffic,
}) {
  const normalized =
    normalizeQuery(
      query
    );

  if (
    !normalized ||
    normalized.length < 2
  ) {
    return false;
  }

  const priority =
    priorityFromTraffic(
      traffic
    );

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
      $3,
      $4,
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
        GREATEST(
          search_queries.search_count + 1,
          EXCLUDED.search_count
        ),

      crawl_priority =
        GREATEST(
          search_queries.crawl_priority,
          EXCLUDED.crawl_priority
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
      normalized,
      traffic,
      priority,
    ]
  );

  return true;
}

async function collectCountry(
  country
) {
  const url =
    `${GOOGLE_TRENDS_URL}?geo=${encodeURIComponent(country)}`;

  console.log(
    `[HEXORA] collecting trends: ${country}`
  );

  const xml =
    await fetchText(url);

  const items =
    extractItems(xml);

  console.log(
    `[HEXORA] ${country}: ${items.length} trends found`
  );

  let inserted = 0;

  for (
    const item of items
  ) {
    try {
      const ok =
        await upsertDemand({
          query:
            item.query,

          country,

          traffic:
            item.traffic,
        });

      if (ok) {
        inserted++;
      }
    } catch (
      error
    ) {
      console.error(
        `[HEXORA] demand insert failed: ${item.query}`,

        error?.message ||
          error
      );
    }
  }

  console.log(
    `[HEXORA] ${country}: ${inserted} demand queries saved`
  );

  return inserted;
}

export async function runDemandCollection() {
  console.log(
    "[HEXORA] Demand Intelligence started"
  );

  console.log(
    `[HEXORA] Countries: ${COUNTRIES.join(", ")}`
  );

  let total = 0;

  for (
    const country of COUNTRIES
  ) {
    try {
      total +=
        await collectCountry(
          country
        );
    } catch (
      error
    ) {
      console.error(
        `[HEXORA] trends failed for ${country}:`,

        error?.message ||
          error
      );
    }
  }

  console.log(
    `[HEXORA] demand collection complete: ${total}`
  );

  return total;
}

export async function shutdownDemand() {
  try {
    await pool.end();

    console.log(
      "[HEXORA] demand database pool closed"
    );
  } catch (
    error
  ) {
    console.error(
      "[HEXORA] demand pool shutdown failed:",

      error?.message ||
        error
    );
  }
}
```
