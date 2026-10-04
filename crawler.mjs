import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import pg from "pg";
import {
  putHtml,
  makeR2Key
} from "./storage.mjs";

const {
  Pool
} = pg;


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

    max:
      Number(
        process.env.CRAWLER_DB_POOL_MAX || 5
      ),

    connectionTimeoutMillis:
      10000,

    ssl:
      DATABASE_URL.includes("neon.") ||
      DATABASE_URL.includes("neon.tech")
        ? {
            rejectUnauthorized:
              false
          }
        : undefined

  });


const UA =
  process.env.HEXORA_USER_AGENT ||
  "HEXORA-Bot/1.0 (+https://hexorasearch.com/crawler)";


const TIMEOUT =
  Number(
    process.env.CRAWL_TIMEOUT_MS ||
    15000
  );


const MAX_CONTENT =
  Number(
    process.env.CRAWL_MAX_CONTENT ||
    120000
  );


const MAX_LINKS =
  Number(
    process.env.CRAWL_MAX_LINKS ||
    120
  );


const DOMAIN_DELAY =
  Number(
    process.env.CRAWL_DOMAIN_DELAY_MS ||
    1000
  );


const lastDomain =
  new Map();


function sleep(ms) {

  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
  );

}


async function allowed(
  url
) {

  const u =
    new URL(url);


  const last =
    lastDomain.get(
      u.hostname
    ) || 0;


  if (
    Date.now() -
    last <
    DOMAIN_DELAY
  ) {

    await sleep(
      DOMAIN_DELAY -
      (
        Date.now() -
        last
      )
    );
  }


  lastDomain.set(
    u.hostname,
    Date.now()
  );


  try {

    const r =
      await fetch(
        `${u.origin}/robots.txt`,
        {
          headers: {
            "user-agent": UA
          },

          signal:
            AbortSignal.timeout(
              5000
            )
        }
      );


    if (!r.ok)
      return true;


    const txt =
      await r.text();


    return robotsAllows(
      txt,
      u.pathname
    );

  } catch {

    return true;

  }
}


function robotsAllows(
  txt,
  path
) {

  let applies =
    false;

  let rules =
    [];


  for (
    const raw of
    txt.split(/\r?\n/)
  ) {

    const line =
      raw
        .split("#")[0]
        .trim();


    if (!line)
      continue;


    const i =
      line.indexOf(":");


    if (i < 0)
      continue;


    const key =
      line
        .slice(0, i)
        .trim()
        .toLowerCase();


    const val =
      line
        .slice(i + 1)
        .trim();


    if (
      key === "user-agent"
    ) {

      applies =
        val === "*" ||
        val.toLowerCase() ===
          "hexora-bot";


      if (applies)
        rules = [];

    } else if (
      key === "disallow" &&
      applies &&
      val
    ) {

      rules.push(
        val
      );
    }
  }


  return !rules.some(
    r =>
      path.startsWith(r)
  );
}


function cleanText(s) {

  return String(
    s || ""
  )
    .replace(
      /\s+/g,
      " "
    )
    .trim();

}


function detectLanguage(
  text
) {

  const s =
    String(text || "");


  if (
    /[\u0980-\u09FF]/u.test(s)
  )
    return "as";


  if (
    /[\u0900-\u097F]/u.test(s)
  )
    return "hi";


  if (
    /[\u0B80-\u0BFF]/u.test(s)
  )
    return "ta";


  if (
    /[\u0C00-\u0C7F]/u.test(s)
  )
    return "te";


  if (
    /[\u0C80-\u0CFF]/u.test(s)
  )
    return "kn";


  if (
    /[\u0D00-\u0D7F]/u.test(s)
  )
    return "ml";


  if (
    /[A-Za-z]/.test(s)
  )
    return "en";


  return "unknown";
}


function parseHTML(
  finalUrl,
  html
) {

  const $ =
    cheerio.load(
      html
    );


  $(
    "script,style,noscript,template,svg"
  ).remove();


  const canonical =
    $(
      'link[rel="canonical"]'
    ).attr(
      "href"
    );


  let canonicalUrl =
    finalUrl;


  try {

    if (canonical) {

      canonicalUrl =
        new URL(
          canonical,
          finalUrl
        ).href;
    }

  } catch {}


  const title =
    cleanText(
      $("title")
        .first()
        .text()
    ).slice(
      0,
      500
    );


  const description =
    cleanText(

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

    ).slice(
      0,
      1200
    );


  const text =
    cleanText(
      $("body").text()
    ).slice(
      0,
      MAX_CONTENT
    );


  const excerpt =
    text.slice(
      0,
      900
    );


  const links = [];


  $("a[href]").each(
    (_, el) => {

      if (
        links.length >=
        MAX_LINKS
      )
        return;


      const href =
        $(el).attr(
          "href"
        );


      if (!href)
        return;


      try {

        const x =
          new URL(
            href,
            finalUrl
          );


        if (
          ![
            "http:",
            "https:"
          ].includes(
            x.protocol
          )
        )
          return;


        x.hash = "";


        const target =
          x.href;


        if (
          target ===
          canonicalUrl
        )
          return;


        links.push({

          url: target,

          anchor_text:
            cleanText(
              $(el).text()
            ).slice(
              0,
              200
            )

        });

      } catch {}

    }
  );


  const unique =
    [
      ...new Map(
        links.map(
          x => [
            x.url,
            x
          ]
        )
      ).values()
    ];


  return {

    canonical:
      canonicalUrl,

    title,

    description,

    text,

    excerpt,

    language:
      detectLanguage(
        `${title} ${description} ${text}`
      ),

    links:
      unique

  };
}


async function sha256(
  text
) {

  return createHash(
    "sha256"
  )
    .update(text)
    .digest("hex");

}


export async function crawlOne(
  job
) {

  const {
    id,
    url
  } = job;


  try {

    const u =
      new URL(url);


    if (
      ![
        "http:",
        "https:"
      ].includes(
        u.protocol
      )
    ) {

      throw new Error(
        "Unsupported URL scheme"
      );
    }


    if (
      !(await allowed(url))
    ) {

      await pool.query(

        `
        UPDATE crawl_queue

        SET
          status='blocked',
          finished_at=NOW(),
          error=$1

        WHERE id=$2
        `,

        [
          "robots.txt",
          id
        ]
      );


      return {
        status:
          "blocked",

        url
      };
    }


    const response =
      await fetch(
        url,
        {

          redirect:
            "follow",

          headers: {

            "user-agent":
              UA,

            "accept":
              "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5"

          },

          signal:
            AbortSignal.timeout(
              TIMEOUT
            )
        }
      );


    const contentType =
      response.headers.get(
        "content-type"
      ) || "";


    if (
      !response.ok
    ) {

      throw new Error(
        `HTTP ${response.status}`
      );
    }


    if (
      !contentType.includes(
        "text/html"
      ) &&
      !contentType.includes(
        "application/xhtml+xml"
      )
    ) {

      throw new Error(
        `Not HTML: ${contentType}`
      );
    }


    const html =
      await response.text();


    const finalUrl =
      response.url ||
      url;


    const parsed =
      parseHTML(
        finalUrl,
        html
      );


    if (
      !parsed.title &&
      !parsed.text
    ) {

      throw new Error(
        "Empty page"
      );
    }


    const hash =
      await sha256(
        html
      );


    const r2Key =
      makeR2Key(
        parsed.canonical,
        hash
      );


    const r2 =
      await putHtml(
        r2Key,
        html,
        {
          "source-url":
            parsed.canonical,

          "content-hash":
            hash
        }
      );


    const domain =
      new URL(
        parsed.canonical
      )
        .hostname
        .toLowerCase();


    const wordCount =
      parsed.text
        ? parsed.text
            .split(/\s+/)
            .filter(Boolean)
            .length
        : 0;


    const client =
      await pool.connect();


    try {

      await client.query(
        "BEGIN"
      );


      const page =
        await client.query(

          `
          INSERT INTO pages(

            url,
            canonical_url,
            title,
            description,
            excerpt,
            content,
            domain,
            language,
            content_hash,
            word_count,
            status_code,
            crawl_status,
            last_crawled_at,
            updated_at,
            r2_key,
            r2_etag,
            outbound_links

          )

          VALUES(

            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10,
            $11,
            'indexed',
            NOW(),
            NOW(),
            $12,
            $13,
            $14

          )

          ON CONFLICT(url)

          DO UPDATE SET

            canonical_url =
              EXCLUDED.canonical_url,

            title =
              EXCLUDED.title,

            description =
              EXCLUDED.description,

            excerpt =
              EXCLUDED.excerpt,

            content =
              EXCLUDED.content,

            domain =
              EXCLUDED.domain,

            language =
              EXCLUDED.language,

            content_hash =
              EXCLUDED.content_hash,

            word_count =
              EXCLUDED.word_count,

            status_code =
              EXCLUDED.status_code,

            crawl_status =
              'indexed',

            last_crawled_at =
              NOW(),

            updated_at =
              NOW(),

            r2_key =
              EXCLUDED.r2_key,

            r2_etag =
              EXCLUDED.r2_etag,

            outbound_links =
              EXCLUDED.outbound_links

          RETURNING id
          `,

          [

            parsed.canonical,

            parsed.canonical,

            parsed.title,

            parsed.description,

            parsed.excerpt,

            parsed.text,

            domain,

            parsed.language,

            hash,

            wordCount,

            response.status,

            r2.key,

            r2.etag,

            parsed.links.length

          ]
        );


      const pageId =
        page.rows[0].id;


      for (
        const link of
        parsed.links
      ) {

        await client.query(

          `
          INSERT INTO crawl_queue(

            url,
            status,
            priority,
            discovered_from

          )

          VALUES(

            $1,
            'pending',
            50,
            $2

          )

          ON CONFLICT(url)
          DO NOTHING
          `,

          [
            link.url,
            parsed.canonical
          ]
        );


        await client.query(

          `
          INSERT INTO page_links(

            source_page_id,
            target_url,
            anchor_text

          )

          VALUES(

            $1,
            $2,
            $3

          )

          ON CONFLICT(
            source_page_id,
            target_url
          )

          DO UPDATE SET

            anchor_text =
              EXCLUDED.anchor_text
          `,

          [
            pageId,
            link.url,
            link.anchor_text
          ]
        );
      }


      await client.query(

        `
        UPDATE crawl_queue

        SET
          status='done',
          finished_at=NOW(),
          error=NULL

        WHERE id=$1
        `,

        [id]
      );


      await client.query(
        "COMMIT"
      );


    } catch (e) {

      await client.query(
        "ROLLBACK"
      );

      throw e;

    } finally {

      client.release();

    }


    return {

      status:
        "success",

      url,

      links:
        parsed.links.length

    };


  } catch (e) {

    await pool.query(

      `
      UPDATE crawl_queue

      SET

        status =
          CASE

            WHEN attempts >= 3
              THEN 'failed'

            ELSE
              'pending'

          END,

        finished_at=NOW(),

        error=$1

      WHERE id=$2
      `,

      [
        String(
          e.message || e
        ).slice(
          0,
          1000
        ),

        id
      ]
    );


    return {

      status:
        "failed",

      url,

      error:
        String(
          e.message || e
        )

    };
  }
}


export async function claimJobs(
  limit
) {

  const {
    rows
  } =
    await pool.query(

      `
      SELECT *
      FROM claim_crawl_jobs($1)
      `,

      [limit]
    );


  return rows;
}


export async function closeCrawlerDB() {

  await pool.end();

}
