import pg from "pg";
import { createHash } from "node:crypto";

import {
  putHtml,
  makeR2Key
} from "./storage.mjs";


const {
  Pool
} = pg;


const dburl =
  process.env.DATABASE_URL;


if (!dburl) {

  throw new Error(
    "DATABASE_URL missing"
  );
}


const pool =
  new Pool({

    connectionString:
      dburl,

    max: 5,

    ssl:
      dburl.includes("neon.") ||
      dburl.includes("neon.tech")
        ? {
            rejectUnauthorized:
              false
          }
        : undefined

  });


const source =
  process.env.COMMONCRAWL_SOURCE_URL ||
  "";


if (!source) {

  throw new Error(
    "Set COMMONCRAWL_SOURCE_URL before importing Common Crawl."
  );
}


const res =
  await fetch(

    source,

    {
      headers: {
        "user-agent":
          "HEXORA-CommonCrawl-Importer/1.0"
      },

      signal:
        AbortSignal.timeout(
          30000
        )
    }

  );


if (!res.ok) {

  throw new Error(
    `Common Crawl HTTP ${res.status}`
  );
}


const text =
  await res.text();


let imported =
  0;


for (
  const line of
  text.split(/\r?\n/)
) {

  if (!line.trim())
    continue;


  let row;


  try {

    row =
      JSON.parse(
        line
      );

  } catch {

    continue;

  }


  const url =
    row.url ||
    row.URL;


  const html =
    row.html ||
    row.content;


  if (
    !url ||
    !html ||
    typeof html !==
      "string"
  )
    continue;


  const hash =
    createHash(
      "sha256"
    )
      .update(html)
      .digest("hex");


  const key =
    makeR2Key(
      url,
      hash
    );


  const r2 =
    await putHtml(

      key,

      html,

      {
        "source-url":
          url,

        "source":
          "common-crawl"
      }

    );


  const domain =
    (() => {

      try {

        return new URL(
          url
        )
          .hostname
          .toLowerCase();

      } catch {

        return "";

      }

    })();


  await pool.query(

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
      r2_key,
      r2_etag,
      last_crawled_at,
      updated_at

    )

    VALUES(

      $1,
      $1,
      '',
      $2,
      $3,
      $3,
      $4,
      'unknown',
      $5,
      $6,
      200,
      $7,
      $8,
      NOW(),
      NOW()

    )

    ON CONFLICT(url)

    DO UPDATE SET

      content_hash =
        EXCLUDED.content_hash,

      r2_key =
        EXCLUDED.r2_key,

      r2_etag =
        EXCLUDED.r2_etag,

      content =
        EXCLUDED.content,

      excerpt =
        EXCLUDED.excerpt,

      updated_at =
        NOW()

    `,

    [

      url,

      "Common Crawl imported page",

      html.slice(
        0,
        900
      ),

      domain,

      hash,

      html
        .split(/\s+/)
        .filter(Boolean)
        .length,

      r2.key,

      r2.etag

    ]
  );


  imported++;

}


await pool.end();


console.log(
  `[HEXORA] Common Crawl import complete: ${imported}`
);
