import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const {
  Pool
} = pg;


const __filename =
  fileURLToPath(import.meta.url);

const __dirname =
  path.dirname(__filename);


const PORT =
  Number(
    process.env.PORT || 8080
  );


const DATABASE_URL =
  process.env.DATABASE_URL || "";


const pool =
  DATABASE_URL
    ? new Pool({

        connectionString:
          DATABASE_URL,

        max:
          Number(
            process.env.DB_POOL_MAX || 5
          ),

        connectionTimeoutMillis:
          10000,

        idleTimeoutMillis:
          30000,

        ssl:
          DATABASE_URL.includes("neon.tech") ||
          DATABASE_URL.includes("neon.")
            ? {
                rejectUnauthorized: false
              }
            : undefined

      })
    : null;


function sendJson(
  res,
  status,
  data
) {

  res.writeHead(
    status,
    {
      "Content-Type":
        "application/json; charset=utf-8",

      "Access-Control-Allow-Origin":
        "*",

      "Access-Control-Allow-Methods":
        "GET,OPTIONS",

      "Access-Control-Allow-Headers":
        "Content-Type",

      "Cache-Control":
        "no-store"
    }
  );

  res.end(
    JSON.stringify(data)
  );
}


function wordsOf(q) {

  return String(q || "")
    .normalize("NFKC")
    .toLowerCase()

    .replace(
      /[^\p{L}\p{N}\s.-]/gu,
      " "
    )

    .split(/\s+/)

    .filter(Boolean)

    .slice(0, 12);
}


function snippet(
  text,
  words,
  max = 320
) {

  const s =
    String(text || "")
      .replace(/\s+/g, " ")
      .trim();

  if (!s)
    return "";

  if (!words.length)
    return s.slice(0, max);

  const low =
    s.toLocaleLowerCase();

  let pos = -1;

  for (
    const word of words
  ) {

    const p =
      low.indexOf(word);

    if (p >= 0) {

      pos = p;

      break;
    }
  }

  if (pos < 0)
    return s.slice(0, max);

  const start =
    Math.max(
      0,
      pos - 110
    );

  const end =
    Math.min(
      s.length,
      pos + max - 110
    );

  return (
    (start ? "… " : "") +
    s.slice(start, end) +
    (end < s.length ? " …" : "")
  );
}


function freshnessScore(
  date
) {

  if (!date)
    return 0;

  const age =
    Math.max(
      0,
      (
        Date.now() -
        new Date(date).getTime()
      ) / 86400000
    );

  return Math.max(
    0,
    30 -
      Math.log1p(age) * 7
  );
}


function safeLimit(
  value
) {

  return Math.min(
    Math.max(
      Number(value) || 20,
      1
    ),
    50
  );
}


async function searchDatabase(
  query,
  limit = 20
) {

  if (!pool)
    throw new Error(
      "DATABASE_URL is missing"
    );

  const words =
    wordsOf(query);

  if (!words.length)
    return [];

  const q =
    String(query).trim();

  const tsQuery =
    words.join(" & ");


  const sql = `

    WITH candidates AS (

      SELECT

        id,
        url,
        canonical_url,
        title,
        description,
        excerpt,
        content,
        domain,
        language,

        updated_at,
        published_at,
        last_crawled_at,

        authority_score,
        freshness_score,
        quality_score,
        popularity_score,

        inbound_links,
        outbound_links,

        ts_rank_cd(
          search_vector,
          websearch_to_tsquery(
            'simple',
            $1
          )
        ) AS fts_rank,

        similarity(
          COALESCE(title, ''),
          $2
        ) AS title_sim,

        similarity(
          COALESCE(url, ''),
          $2
        ) AS url_sim,

        similarity(
          COALESCE(domain, ''),
          $2
        ) AS domain_sim

      FROM pages

      WHERE

        search_vector @@
          websearch_to_tsquery(
            'simple',
            $1
          )

        OR title % $2

        OR url % $2

        OR domain % $2

        OR EXISTS (

          SELECT 1

          FROM unnest(
            $3::text[]
          ) w

          WHERE

            title ILIKE
              '%' || w || '%'

            OR description ILIKE
              '%' || w || '%'

            OR excerpt ILIKE
              '%' || w || '%'

            OR content ILIKE
              '%' || w || '%'
        )

      LIMIT 1000
    )

    SELECT *

    FROM candidates

  `;


  const {
    rows
  } =
    await pool.query(
      sql,
      [
        tsQuery,
        q,
        words
      ]
    );


  return rows

    .map(
      row => {

        const title =
          String(
            row.title ||
            row.url ||
            "Untitled"
          );

        const desc =
          String(
            row.description ||
            row.excerpt ||
            row.content ||
            ""
          );

        const full =
          q.toLocaleLowerCase();

        const tl =
          title.toLocaleLowerCase();

        const dl =
          desc.toLocaleLowerCase();

        const ul =
          String(
            row.url || ""
          ).toLocaleLowerCase();


        let score =
          Number(
            row.fts_rank || 0
          ) * 100;


        score +=
          Number(
            row.title_sim || 0
          ) * 90;


        score +=
          Number(
            row.url_sim || 0
          ) * 30;


        score +=
          Number(
            row.domain_sim || 0
          ) * 20;


        if (tl === full) {

          score += 220;

        } else if (
          tl.includes(full)
        ) {

          score += 120;

        }


        if (
          dl.includes(full)
        ) {

          score += 45;

        }


        if (
          ul.includes(full)
        ) {

          score += 40;

        }


        score +=
          Math.min(
            80,
            Number(
              row.authority_score || 0
            )
          );


        score +=
          Math.min(
            40,
            Number(
              row.quality_score || 0
            )
          );


        score +=
          Math.min(
            25,
            Number(
              row.popularity_score || 0
            )
          );


        score +=
          Math.min(
            20,
            freshnessScore(
              row.updated_at ||
              row.published_at
            )
          );


        score +=
          Math.min(
            30,
            Math.log1p(
              Number(
                row.inbound_links || 0
              )
            ) * 8
          );


        return {

          ...row,

          title,

          description:
            desc ||
            snippet(
              row.content,
              words
            ),

          snippet:
            snippet(
              row.content ||
              row.excerpt ||
              desc,
              words
            ),

          score:
            Number(
              score.toFixed(4)
            )
        };

      }
    )

    .sort(
      (a, b) =>
        b.score - a.score
    )

    .slice(
      0,
      safeLimit(limit)
    );
}


const types = {

  ".html":
    "text/html; charset=utf-8",

  ".htm":
    "text/html; charset=utf-8",

  ".css":
    "text/css; charset=utf-8",

  ".js":
    "application/javascript; charset=utf-8",

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
    "image/webp"
};


function serveFile(
  res,
  pathname
) {

  let decoded;

  try {

    decoded =
      decodeURIComponent(
        pathname
      );

  } catch {

    return sendJson(
      res,
      400,
      {
        success: false,
        error: "Invalid path"
      }
    );
  }


  if (
    decoded.includes("\0")
  ) {

    return sendJson(
      res,
      400,
      {
        success: false,
        error: "Invalid path"
      }
    );
  }


  if (
    decoded === "/"
  ) {

    decoded =
      "/index.html";
  }


  const root =
    path.resolve(
      __dirname
    );


  const fp =
    path.resolve(
      root,
      "." + decoded
    );


  if (
    fp !== root &&
    !fp.startsWith(
      root + path.sep
    )
  ) {

    return sendJson(
      res,
      403,
      {
        success: false,
        error: "Forbidden"
      }
    );
  }


  if (
    !fs.existsSync(fp) ||
    !fs.statSync(fp).isFile()
  ) {

    const fallback =
      path.join(
        root,
        "index.html"
      );


    if (
      fs.existsSync(fallback)
    ) {

      res.writeHead(
        200,
        {
          "Content-Type":
            "text/html; charset=utf-8",

          "Cache-Control":
            "no-cache"
        }
      );

      return fs
        .createReadStream(
          fallback
        )
        .pipe(res);
    }


    return sendJson(
      res,
      404,
      {
        success: false,
        error:
          "HEXORA page not found"
      }
    );
  }


  res.writeHead(
    200,
    {
      "Content-Type":
        types[
          path
            .extname(fp)
            .toLowerCase()
        ] ||
        "application/octet-stream",

      "Cache-Control":
        "no-cache"
    }
  );


  fs
    .createReadStream(fp)
    .pipe(res);
}


async function handle(
  req,
  res
) {

  const u =
    new URL(
      req.url || "/",
      `http://${req.headers.host || "localhost"}`
    );


  if (
    req.method === "OPTIONS"
  ) {

    res.writeHead(
      204,
      {
        "Access-Control-Allow-Origin":
          "*",

        "Access-Control-Allow-Methods":
          "GET,OPTIONS",

        "Access-Control-Allow-Headers":
          "Content-Type"
      }
    );

    return res.end();
  }


  if (
    u.pathname === "/health" ||
    u.pathname === "/api/health"
  ) {

    let db =
      "missing";


    if (pool) {

      try {

        await pool.query(
          "SELECT 1"
        );

        db =
          "connected";

      } catch (e) {

        db =
          "error: " +
          e.message;
      }
    }


    return sendJson(
      res,
      200,
      {
        success: true,

        status:
          db === "connected"
            ? "ok"
            : "degraded",

        engine:
          "HEXORA Independent Search Engine",

        database:
          "Neon PostgreSQL",

        database_status:
          db,

        index_source:
          "Neon",

        storage:
          "Cloudflare R2",

        supabase_v2:
          "legacy/migration only"
      }
    );
  }


  const routes = [

    "/search",
    "/api/search",

    "/news",
    "/api/news",

    "/images",
    "/api/images",

    "/videos",
    "/api/videos",

    "/maps",
    "/api/maps"

  ];


  if (
    routes.includes(
      u.pathname
    )
  ) {

    const query =
      u.searchParams.get("q") ||
      u.searchParams.get("query") ||
      "";


    if (!query.trim()) {

      return sendJson(
        res,
        200,
        {
          success: true,
          query: "",
          total: 0,
          results: []
        }
      );
    }


    try {

      const results =
        await searchDatabase(
          query,
          u.searchParams.get(
            "limit"
          )
        );


      return sendJson(
        res,
        200,
        {
          success: true,

          engine:
            "HEXORA",

          query,

          total:
            results.length,

          results
        }
      );

    } catch (e) {

      console.error(
        "[HEXORA] Search error:",
        e
      );


      return sendJson(
        res,
        500,
        {
          success: false,

          query,

          total: 0,

          results: [],

          error:
            e.message
        }
      );
    }
  }


  return serveFile(
    res,
    u.pathname
  );
}


const server =
  http.createServer(
    (req, res) =>

      handle(
        req,
        res
      ).catch(
        e => {

          console.error(
            "[HEXORA] Request error:",
            e
          );


          if (
            !res.headersSent
          ) {

            sendJson(
              res,
              500,
              {
                success: false,
                error:
                  "Internal server error"
              }
            );

          } else {

            res.end();

          }

        }
      )
  );


process.on(
  "unhandledRejection",
  e =>
    console.error(
      "[HEXORA] Unhandled rejection:",
      e
    )
);


process.on(
  "uncaughtException",
  e =>
    console.error(
      "[HEXORA] Uncaught exception:",
      e
    )
);


server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `[HEXORA] Search server running on http://0.0.0.0:${PORT}`
    );

  }
);
