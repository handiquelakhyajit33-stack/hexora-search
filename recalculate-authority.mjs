import pg from "pg";


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


await pool.query(
  "SELECT refresh_domain_stats()"
);


await pool.query(`

  WITH inbound AS (

    SELECT
      target_url,
      COUNT(*)::INTEGER AS c

    FROM page_links

    GROUP BY target_url

  )

  UPDATE pages p

  SET
    inbound_links =
      COALESCE(
        i.c,
        0
      )

  FROM inbound i

  WHERE
    p.url = i.target_url

`);


await pool.query(`

  UPDATE pages

  SET

    freshness_score =

      GREATEST(

        0,

        30 -

        LEAST(

          30,

          EXTRACT(
            EPOCH
            FROM (
              NOW() -
              COALESCE(
                updated_at,
                last_crawled_at,
                NOW()
              )
            )
          )
          / 86400
          / 7

        )

      ),


    quality_score =

      LEAST(

        40,

        CASE

          WHEN word_count >= 1000
            THEN 30

          WHEN word_count >= 500
            THEN 22

          WHEN word_count >= 200
            THEN 14

          WHEN word_count >= 80
            THEN 7

          ELSE
            1

        END

      ),


    popularity_score =

      LEAST(

        25,

        LOG(
          GREATEST(
            1,
            inbound_links + 1
          )
        ) * 7

      ),


    authority_score =

      LEAST(

        80,

        LOG(
          GREATEST(
            1,
            inbound_links + 1
          )
        ) * 12

        +

        LEAST(
          20,
          quality_score / 2
        )

      )

`);


await pool.query(
  "SELECT refresh_domain_stats()"
);


await pool.end();


console.log(
  "[HEXORA] authority/ranking signals recalculated"
);
