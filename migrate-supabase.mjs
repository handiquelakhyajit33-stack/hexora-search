import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { createHash } from "node:crypto";
import {
  putHtml,
  makeR2Key
} from "./storage.mjs";

const {
  Pool
} = pg;


const url =
  process.env.SUPABASE_URL;

const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const dburl =
  process.env.DATABASE_URL;


if (!url || !key) {

  throw new Error(
    "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing"
  );
}


if (!dburl) {

  throw new Error(
    "DATABASE_URL missing"
  );
}


const supabase =
  createClient(
    url,
    key,
    {
      auth: {
        persistSession:
          false
      }
    }
  );


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


const batch =
  Number(
    process.env.MIGRATION_BATCH_SIZE ||
    100
  );


let offset =
  0;

let total =
  0;


while (true) {

  const {
    data,
    error
  } =
    await supabase

      .from("pages")

      .select(
        `
        url,
        title,
        description,
        content,
        language,
        content_hash,
        published_at,
        updated_at,
        last_crawled_at,
        status_code
        `
      )

      .range(
        offset,
        offset + batch - 1
      );


  if (error)
    throw error;


  if (
    !data ||
    !data.length
  )
    break;


  for (
    const row of
    data
  ) {

    const content =
      String(
        row.content || ""
      );


    const hash =
      row.content_hash ||

      createHash(
        "sha256"
      )
        .update(content)
        .digest("hex");


    let r2Key =
      null;

    let r2Etag =
      null;


    if (content) {

      const r =
        await putHtml(

          makeR2Key(
            row.url,
            hash
          ),

          content,

          {
            "source-url":
              row.url,

            "migration":
              "supabase"
          }

        );


      r2Key =
        r.key;

      r2Etag =
        r.etag;
    }


    const domain =
      (() => {

        try {

          return new URL(
            row.url
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
        last_crawled_at,
        updated_at,
        published_at,
        r2_key,
        r2_etag

      )

      VALUES(

        $1,
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
        $12,
        $13,
        $14,
        $15

      )

      ON CONFLICT(url)

      DO UPDATE SET

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

        last_crawled_at =
          EXCLUDED.last_crawled_at,

        updated_at =
          EXCLUDED.updated_at,

        published_at =
          EXCLUDED.published_at,

        r2_key =
          COALESCE(
            EXCLUDED.r2_key,
            pages.r2_key
          ),

        r2_etag =
          COALESCE(
            EXCLUDED.r2_etag,
            pages.r2_etag
          )
      `,

      [

        row.url,

        row.title || "",

        row.description || "",

        content.slice(
          0,
          900
        ),

        content,

        domain,

        row.language ||
          "unknown",

        hash,

        content
          .split(/\s+/)
          .filter(Boolean)
          .length,

        row.status_code ||
          200,

        row.last_crawled_at ||
          null,

        row.updated_at ||
          new Date().toISOString(),

        row.published_at ||
          null,

        r2Key,

        r2Etag

      ]
    );


    total++;


  }


  console.log(
    `[HEXORA] migrated ${total}`
  );


  if (
    data.length < batch
  )
    break;


  offset += batch;
}


await pool.end();


console.log(
  `[HEXORA] Supabase -> Neon/R2 migration complete: ${total}`
);
