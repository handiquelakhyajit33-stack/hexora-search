import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("ERROR: Supabase environment variables are missing.");
}

const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;


/* =========================
   HELPERS
========================= */

function json(res, status, data) {
  const body = JSON.stringify(data);

  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store"
  });

  res.end(body);
}


function cleanQuery(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}


function calculateScore(page, query) {
  const q = cleanQuery(query).toLowerCase();

  const title = String(page.title || "").toLowerCase();
  const description = String(page.description || "").toLowerCase();
  const url = String(page.url || "").toLowerCase();
  const content = String(page.content || "").toLowerCase();

  const words = q
    .split(/[^a-z0-9\u00C0-\uFFFF]+/i)
    .filter(Boolean);

  let score = 0;

  for (const word of words) {
    if (title.includes(word)) score += 25;
    if (description.includes(word)) score += 12;
    if (url.includes(word)) score += 8;
    if (content.includes(word)) score += 2;
  }

  if (title === q) score += 100;
  if (title.includes(q)) score += 50;
  if (url.includes(q)) score += 25;

  /*
   * Freshness signal
   */
  const date =
    page.last_crawled_at ||
    page.updated_at ||
    page.published_at;

  if (date) {
    const ageDays =
      Math.max(0, Date.now() - new Date(date).getTime()) /
      86400000;

    if (ageDays < 1) score += 10;
    else if (ageDays < 7) score += 7;
    else if (ageDays < 30) score += 4;
  }

  /*
   * Authority signals
   */
  if (url.startsWith("https://")) score += 2;

  if (
    url.includes(".gov.") ||
    url.includes(".gov/") ||
    url.includes(".edu.") ||
    url.includes(".edu/")
  ) {
    score += 5;
  }

  return score;
}


/* =========================
   SEARCH ENGINE
========================= */

async function searchWeb(query, pageNumber = 1, limit = 20) {

  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  query = cleanQuery(query);

  if (!query) {
    return {
      query,
      results: [],
      total: 0,
      page: pageNumber,
      limit,
      total_pages: 0
    };
  }

  let rows = [];

  /*
   * PRIMARY SEARCH
   *
   * Uses PostgreSQL full-text search.
   */

  const fullText = await supabase
    .from("pages")
    .select(`
      id,
      url,
      title,
      description,
      content,
      last_crawled_at,
      updated_at
    `)
    .textSearch(
      "search_vector",
      query,
      {
        type: "websearch",
        config: "simple"
      }
    )
    .limit(1000);

  if (!fullText.error) {
    rows = fullText.data || [];
  }

  /*
   * FALLBACK SEARCH
   *
   * Useful when search_vector has not been populated yet.
   */

  if (rows.length === 0) {

    const safe = query
      .replace(/[%_,]/g, " ")
      .trim();

    const pattern = `%${safe}%`;

    const fallback = await supabase
      .from("pages")
      .select(`
        id,
        url,
        title,
        description,
        content,
        last_crawled_at,
        updated_at
      `)
      .or(
        `title.ilike.${pattern},description.ilike.${pattern},url.ilike.${pattern},content.ilike.${pattern}`
      )
      .limit(1000);

    if (fallback.error) {
      throw fallback.error;
    }

    rows = fallback.data || [];
  }


  /*
   * RANKING
   */

  const ranked = rows
    .map(row => ({
      ...row,
      hexora_score: calculateScore(row, query)
    }))
    .sort((a, b) => {

      if (b.hexora_score !== a.hexora_score) {
        return b.hexora_score - a.hexora_score;
      }

      return String(a.title || "")
        .localeCompare(
          String(b.title || ""),
          undefined,
          { sensitivity: "base" }
        );
    });


  const total = ranked.length;

  const start =
    (pageNumber - 1) * limit;

  const results = ranked
    .slice(start, start + limit)
    .map(row => ({
      id: row.id,
      url: row.url,
      title: row.title || row.url,
      description:
        row.description ||
        String(row.content || "").slice(0, 240),
      score: row.hexora_score,
      last_crawled_at: row.last_crawled_at
    }));


  return {
    engine: "HEXORA",
    query,
    results,
    total,
    page: pageNumber,
    limit,
    total_pages: Math.ceil(total / limit)
  };
}


/* =========================
   NEWS
========================= */

async function getNews() {

  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("news")
    .select(`
      id,
      title,
      description,
      url,
      source_name,
      source_domain,
      published_at,
      image_url,
      fetched_at
    `)
    .order(
      "published_at",
      { ascending: false }
    )
    .limit(30);

  if (error) {
    throw error;
  }

  return data || [];
}


/* =========================
   STATIC FILES
========================= */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};


function sendFile(res, filePath) {

  if (!fs.existsSync(filePath)) {
    return false;
  }

  if (!fs.statSync(filePath).isFile()) {
    return false;
  }

  const ext =
    path.extname(filePath).toLowerCase();

  res.writeHead(200, {
    "Content-Type":
      MIME[ext] ||
      "application/octet-stream"
  });

  res.end(
    fs.readFileSync(filePath)
  );

  return true;
}


/* =========================
   HTTP SERVER
========================= */

const server = http.createServer(
  async (req, res) => {

    try {

      const requestUrl =
        new URL(
          req.url,
          `http://${req.headers.host || "localhost"}`
        );


      /* HEALTH */

      if (
        requestUrl.pathname === "/api/health" ||
        requestUrl.pathname === "/health"
      ) {

        return json(res, 200, {
          ok: true,
          engine:
            "HEXORA Independent Search Engine",
          database:
            Boolean(supabase),
          crawler:
            "Railway Worker",
          timestamp:
            new Date().toISOString()
        });
      }


      /* SEARCH */

      if (
        requestUrl.pathname === "/api/search" ||
        requestUrl.pathname === "/search"
      ) {

        const query =
          requestUrl.searchParams.get("q") || "";

        const page =
          Math.max(
            1,
            Number(
              requestUrl.searchParams.get("page") || 1
            )
          );

        const limit =
          Math.min(
            50,
            Math.max(
              1,
              Number(
                requestUrl.searchParams.get("limit") || 20
              )
            )
          );

        const result =
          await searchWeb(
            query,
            page,
            limit
          );

        return json(res, 200, result);
      }


      /* NEWS */

      if (
        requestUrl.pathname === "/api/news" ||
        requestUrl.pathname === "/news"
      ) {

        return json(res, 200, {
          items: await getNews()
        });
      }


      /* ROOT */

      let requested =
        decodeURIComponent(
          requestUrl.pathname
        );

      if (requested === "/") {
        requested = "/index.html";
      }

      const requestedFile =
        path.resolve(
          __dirname,
          "." + requested
        );

      const projectRoot =
        path.resolve(__dirname);

      /*
       * Security:
       * never serve files outside project.
       */

      if (
        requestedFile.startsWith(
          projectRoot + path.sep
        )
      ) {

        if (
          sendFile(
            res,
            requestedFile
          )
        ) {
          return;
        }
      }


      /* SPA FALLBACK */

      const indexFile =
        path.join(
          __dirname,
          "index.html"
        );

      if (
        sendFile(
          res,
          indexFile
        )
      ) {
        return;
      }


      res.writeHead(404);
      res.end("HEXORA page not found.");

    } catch (error) {

      console.error(
        "HEXORA server error:",
        error
      );

      if (!res.headersSent) {

        json(res, 500, {
          error:
            "HEXORA server error",
          message:
            String(
              error?.message ||
              error
            )
        });

      } else {
        res.end();
      }
    }
  }
);


/* =========================
   START
========================= */

server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `HEXORA API running on port ${PORT}`
    );

    console.log(
      "Independent Supabase search engine ready."
    );

  }
);
