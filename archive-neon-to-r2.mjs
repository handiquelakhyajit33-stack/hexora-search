import pg from "pg";

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


const batch =
  Number(
    process.env.ARCHIVE_BATCH_SIZE ||
    100
  );


let lastId =
  0;

let total =
  0;


while (true) {

  const {
    rows
  } =
    await pool.query(

      `
      SELECT
        id,
        url,
        content,
        content_hash

      FROM pages

      WHERE
        id > $1

        AND content IS NOT NULL

        AND content <> ''

      ORDER BY id ASC

      LIMIT $2
      `,

      [
        lastId,
        batch
      ]
    );


  if (!rows.length)
    break;


  for (
    const row of
    rows
  ) {

    const hash =
      row.content_hash ||
      "archive";


    const r =
      await putHtml(

        makeR2Key(
          row.url,
          hash
        ),

        row.content,

        {
          "source-url":
            row.url,

          "archive":
            "neon"
        }

      );


    await pool.query(

      `
      UPDATE pages

      SET
        r2_key=$1,
        r2_etag=$2

      WHERE id=$3
      `,

      [
        r.key,
        r.etag,
        row.id
      ]
    );


    lastId =
      row.id;

    total++;

  }


  console.log(
    `[HEXORA] archived ${total}`
  );
}


await pool.end();


console.log(
  `[HEXORA] Neon -> R2 archive complete: ${total}`
);
