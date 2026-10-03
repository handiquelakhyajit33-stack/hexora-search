import pg from "pg";
import * as cheerio from "cheerio";
import crypto from "node:crypto";

const { Pool } = pg;

const DATABASE_URL =
  process.env.DATABASE_URL || "";

if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is missing"
  );
}

const pool =
  new Pool({
    connectionString:
      DATABASE_URL,

    max: Number(
      process.env.DB_POOL_MAX || 3
    ),

    connectionTimeoutMillis:
      10000,

    idleTimeoutMillis:
      30000,

    ssl:
      DATABASE_URL.includes(
        "neon.tech"
      ) ||
      DATABASE_URL.includes(
        "neon."
      )
        ? {
            rejectUnauthorized:
              false
          }
        : undefined
  });

const DEFAULT_SEEDS = [
  "https://en.wikipedia.org/",
  "https://www.w3.org/",
  "https://www.iana.org/",
  "https://www.mozilla.org/",
  "https://archive.org/",
  "https://www.britannica.com/",
  "https://github.com/",
  "https://www.india.gov.in/",
  "https://assam.gov.in/"
];

const BATCH_SIZE =
  Math.max(
    1,
    Number(
      process.env.CRAWL_BATCH_SIZE ||
        12
    )
  );

const CONCURRENCY =
  Math.max(
    1,
    Number(
      process.env.CRAWL_CONCURRENCY ||
        3
    )
  );

const MAX_CONTENT =
  Math.max(
    10000,
    Number(
      process.env.CRAWL_MAX_CONTENT ||
        200000
    )
  );

const MAX_LINKS =
  Math.max(
    10,
    Number(
      process.env.CRAWL_MAX_LINKS ||
        100
    )
  );

const USER_AGENT =
  process.env.CRAWLER_USER_AGENT ||
  "HEXORA-Bot/1.0";

function unique(values) {
  return [
    ...new Set(values)
  ];
}

function sleep(ms) {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        ms
      )
  );
}

function makeHash(text) {
  return crypto
    .createHash("sha256")
    .update(text)
    .digest("hex");
}

function normalizeUrl(
  value,
  base
) {
  try {
    const url =
      new URL(
        value,
        base
      );

    if (
      !/^https?:$/.test(
        url.protocol
      )
    ) {
      return null;
    }

    url.hash = "";

    url.hostname =
      url.hostname.toLowerCase();

    return url.toString();
  } catch {
    return null;
  }
}

async function canFetch(
  url
) {
  const target =
    new URL(url);

  try {
    const response =
      await fetch(
        `${target.origin}/robots.txt`,
        {
          headers: {
            "user-agent":
              USER_AGENT
          },

          signal:
            AbortSignal.timeout(
              5000
            )
        }
      );

    if (!response.ok) {
      return true;
    }

    const text =
      await response.text();

    let applies = false;

    let blocked = [];

    for (
      const rawLine of
      text.split(/\r?\n/)
    ) {
      const line =
        rawLine
          .split("#")[0]
          .trim();

      if (!line) {
        continue;
      }

      const [
        keyRaw,
        ...rest
      ] =
        line.split(":");

      const key =
        keyRaw
          .trim()
          .toLowerCase();

      const value =
        rest
          .join(":")
          .trim();

      if (
        key ===
        "user-agent"
      ) {
        applies =
          value === "*" ||
          value.toLowerCase() ===
            "hexora-bot";

        if (applies) {
          blocked = [];
        }
      }

      if (
        applies &&
        key ===
          "disallow" &&
        value
      ) {
        blocked.push(
          value
        );
      }
    }

    const pathname =
      target.pathname || "/";

    return !blocked.some(
      (rule) =>
        pathname.startsWith(
          rule
        )
    );
  } catch {
    return true;
  }
}

function parseHtml(
  pageUrl,
  html
) {
  const $ =
    cheerio.load(html);

  $(
    "script,style,noscript,iframe,svg,canvas,form"
  ).remove();

  const title =
    (
      $("title")
        .first()
        .text()
        .trim() ||
      $("h1")
        .first()
        .text()
        .trim() ||
      new URL(
        pageUrl
      ).hostname
    ).slice(0, 500);

  const description =
    String(
      $(
        'meta[name="description"]'
      ).attr(
        "content"
      ) ||
        $(
          'meta[property="og:description"]'
        ).attr(
          "content"
        ) ||
        ""
    )
      .replace(
        /\s+/g,
        " "
      )
      .trim()
      .slice(0, 1000);

  const canonicalRaw =
    $(
      'link[rel="canonical"]'
    ).attr(
      "href"
    );

  const canonical =
    normalizeUrl(
      canonicalRaw ||
        pageUrl,
      pageUrl
    ) ||
    pageUrl;

  const text =
    $("body")
      .text(" ")
      .replace(
        /\s+/g,
        " "
      )
      .trim()
      .slice(
        0,
        MAX_CONTENT
      );

  const links = [];

  $("a[href]").each(
    (_, element) => {
      if (
        links.length >=
        MAX_LINKS
      ) {
        return false;
      }

      const link =
        normalizeUrl(
          $(element).attr(
            "href"
          ),
          canonical
        );

      if (link) {
        links.push(link);
      }

      return true;
    }
  );

  return {
    canonical,
    title,
    description,
    text,
    links:
      unique(links)
  };
}

async function fetchPage(
  url
) {
  const response =
    await fetch(
      url,
      {
        redirect:
          "follow",

        headers: {
          "user-agent":
            USER_AGENT,

          accept:
            "text/html,application/xhtml+xml"
        },

        signal:
          AbortSignal.timeout(
            15000
          )
      }
    );

  const contentType =
    response.headers.get(
      "content-type"
    ) || "";

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}`
    );
  }

  if (
    !contentType
      .toLowerCase()
      .includes(
        "text/html"
      ) &&
    !contentType
      .toLowerCase()
      .includes(
        "application/xhtml+xml"
      )
  ) {
    throw new Error(
      `Not HTML: ${contentType}`
    );
  }

  return {
    finalUrl:
      response.url,

    html:
      await response.text(),

    status:
      response.status
  };
}

async function ensureSeeds() {
  const raw =
    process.env
      .HEXORA_SEED_URLS ||
    DEFAULT_SEEDS.join(",");

  const seeds =
    unique(
      raw
        .split(",")
        .map(
          (value) =>
            normalizeUrl(
              value.trim()
            )
        )
        .filter(Boolean)
    );

  if (!seeds.length) {
    return;
  }

  await pool.query(
    `
    INSERT INTO crawl_queue
      (url, status, priority)

    SELECT
      value,
      'pending',
      100

    FROM unnest(
      $1::text[]
    ) AS value

    ON CONFLICT (url)
    DO NOTHING
    `,
    [seeds]
  );
}

async function recoverQueue() {
  await pool.query(
    `
    UPDATE crawl_queue

    SET
      status = 'pending',
      started_at = NULL,
      error =
        'requeued after worker restart'

    WHERE status = 'processing'
    `
  );
}

async function claimBatch(
  limit
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
          id,
          url

        FROM crawl_queue

        WHERE status = 'pending'

        ORDER BY
          priority DESC,
          created_at ASC

        FOR UPDATE SKIP LOCKED

        LIMIT $1
        `,
        [limit]
      );

    const jobs =
      result.rows;

    if (jobs.length) {
      await client.query(
        `
        UPDATE crawl_queue

        SET
          status = 'processing',
          started_at = now(),
          error = NULL

        WHERE id =
          ANY($1::bigint[])
        `,
        [
          jobs.map(
            (job) =>
              job.id
          )
        ]
      );
    }

    await client.query(
      "COMMIT"
    );

    return jobs;
  } catch (error) {
    await client.query(
      "ROLLBACK"
    );

    throw error;
  } finally {
    client.release();
  }
}

async function crawlOne(
  job
) {
  try {
    const allowed =
      await canFetch(
        job.url
      );

    if (!allowed) {
      throw new Error(
        "Blocked by robots.txt"
      );
    }

    const page =
      await fetchPage(
        job.url
      );

    const parsed =
      parseHtml(
        page.finalUrl,
        page.html
      );

    if (
      !parsed.text &&
      !parsed.title
    ) {
      throw new Error(
        "Empty page"
      );
    }

    const wordCount =
      parsed.text
        .split(/\s+/)
        .filter(Boolean)
        .length;

    const contentHash =
      makeHash(
        parsed.text
      );

    await pool.query(
      `
      INSERT INTO pages (
        url,
        title,
        description,
        content,
        language,
        word_count,
        updated_at,
        last_crawled_at,
        status_code,
        content_hash
      )

      VALUES (
        $1,
        $2,
        $3,
        $4,
        'unknown',
        $5,
        now(),
        now(),
        $6,
        $7
      )

      ON CONFLICT (url)

      DO UPDATE SET
        title =
          EXCLUDED.title,

        description =
          EXCLUDED.description,

        content =
          EXCLUDED.content,

        word_count =
          EXCLUDED.word_count,

        updated_at =
          now(),

        last_crawled_at =
          now(),

        status_code =
          EXCLUDED.status_code,

        content_hash =
          EXCLUDED.content_hash
      `,
      [
        parsed.canonical,
        parsed.title,
        parsed.description,
        parsed.text,
        wordCount,
        page.status,
        contentHash
      ]
    );

    if (
      parsed.links.length
    ) {
      await pool.query(
        `
        INSERT INTO crawl_queue (
          url,
          status,
          priority,
          discovered_from
        )

        SELECT
          value,
          'pending',
          50,
          $2

        FROM unnest(
          $1::text[]
        ) AS value

        ON CONFLICT (url)
        DO NOTHING
        `,
        [
          parsed.links,
          parsed.canonical
        ]
      );
    }

    await pool.query(
      `
      UPDATE crawl_queue

      SET
        status = 'done',
        finished_at = now(),
        error = NULL

      WHERE id = $1
      `,
      [job.id]
    );

    return {
      ok: true,
      url: job.url,
      discovered:
        parsed.links.length
    };
  } catch (error) {
    await pool.query(
      `
      UPDATE crawl_queue

      SET
        status = 'failed',
        finished_at = now(),
        error = $2

      WHERE id = $1
      `,
      [
        job.id,
        String(
          error?.message ||
            error
        ).slice(0, 1000)
      ]
    );

    return {
      ok: false,
      url: job.url,
      error:
        error?.message ||
        String(error)
    };
  }
}

export async function crawlBatch(
  limit = BATCH_SIZE
) {
  await ensureSeeds();

  await recoverQueue();

  const jobs =
    await claimBatch(
      limit
    );

  let successful = 0;
  let failed = 0;

  for (
    let i = 0;
    i < jobs.length;
    i += CONCURRENCY
  ) {
    const results =
      await Promise.all(
        jobs
          .slice(
            i,
            i + CONCURRENCY
          )
          .map(
            crawlOne
          )
      );

    successful +=
      results.filter(
        (item) =>
          item.ok
      ).length;

    failed +=
      results.filter(
        (item) =>
          !item.ok
      ).length;

    await sleep(100);
  }

  return {
    processed:
      jobs.length,

    successful,

    failed
  };
}

export async function seedQueue() {
  await ensureSeeds();
}

export async function normalizeOldQueueStatuses() {
  await recoverQueue();
}

export async function closeCrawlerDb() {
  await pool.end();
}
