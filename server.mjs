import http from "node:http";
import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";
import crypto from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
  );
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

const PORT = Number(process.env.PORT || 8080);

const USER_AGENT = "HEXORA-Bot/1.0";

const TIMEOUT_MS =
  Number(process.env.CRAWL_TIMEOUT_MS || 15000);

const BATCH_SIZE =
  Number(process.env.CRAWL_BATCH_SIZE || 10);

const CONCURRENCY =
  Number(process.env.CRAWL_CONCURRENCY || 2);

const CRAWL_INTERVAL_MS =
  Number(process.env.CRAWL_INTERVAL_MS || 30000);


// =====================================================
// BASIC HELPERS
// =====================================================

function cleanText(text = "") {
  return text
    .replace(/\s+/g, " ")
    .replace(/\u00a0/g, " ")
    .trim();
}

function hashContent(text = "") {
  return crypto
    .createHash("sha256")
    .update(text)
    .digest("hex");
}

function normalizeUrl(url, baseUrl) {
  try {
    const parsed = new URL(url, baseUrl);

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }

    parsed.hash = "";

    return parsed.toString();
  } catch {
    return null;
  }
}


// =====================================================
// HTML EXTRACTION
// =====================================================

function extractPage(html, pageUrl) {
  const $ = cheerio.load(html);

  $("script, style, noscript, iframe, svg").remove();

  const title = cleanText(
    $("title").first().text()
  );

  const description = cleanText(
    $('meta[name="description"]').attr("content") || ""
  );

  const canonical = normalizeUrl(
    $('link[rel="canonical"]').attr("href") ||
      pageUrl,
    pageUrl
  );

  const content = cleanText(
    $("body").text()
  );

  const links = new Set();

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");

    if (!href) return;

    const normalized = normalizeUrl(
      href,
      pageUrl
    );

    if (normalized) {
      links.add(normalized);
    }
  });

  const wordCount = content
    ? content.split(/\s+/).length
    : 0;

  return {
    title,
    description,
    canonical,
    content,
    links: [...links],
    wordCount,
    contentHash: hashContent(content)
  };
}


// =====================================================
// ROBOTS
// =====================================================

async function canFetch(url) {
  try {
    const parsed = new URL(url);

    const robotsUrl =
      `${parsed.origin}/robots.txt`;

    const response = await fetch(
      robotsUrl,
      {
        headers: {
          "User-Agent": USER_AGENT
        },
        signal: AbortSignal.timeout(10000)
      }
    );

    if (!response.ok) {
      return true;
    }

    const robots =
      await response.text();

    const lines = robots
      .split(/\r?\n/)
      .map(line =>
        line.trim().toLowerCase()
      );

    let activeUserAgent = false;

    for (const line of lines) {

      if (line.startsWith("user-agent:")) {
        const value =
          line.split(":")[1]?.trim();

        activeUserAgent =
          value === "*" ||
          value === "hexora-bot";
      }

      if (
        activeUserAgent &&
        line.startsWith("disallow:")
      ) {
        const path =
          line
            .split(":")
            .slice(1)
            .join(":")
            .trim();

        if (!path) continue;

        const currentPath =
          new URL(url).pathname;

        if (currentPath.startsWith(path)) {
          return false;
        }
      }
    }

    return true;

  } catch {
    return true;
  }
}


// =====================================================
// FETCH PAGE
// =====================================================

async function fetchPage(url) {

  return fetch(
    url,
    {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept":
          "text/html,application/xhtml+xml"
      },
      redirect: "follow",
      signal:
        AbortSignal.timeout(TIMEOUT_MS)
    }
  );
}


// =====================================================
// CRAWL FAILURE
// =====================================================

async function markFailure(id, error) {

  try {

    await supabase
      .from("crawl_queue")
      .update({
        last_error:
          String(error).slice(0, 1000),

        last_crawled_at:
          new Date().toISOString()
      })
      .eq("id", id);

  } catch (dbError) {

    console.error(
      "[HEXORA] Queue error:",
      dbError.message
    );
  }
}


// =====================================================
// CRAWL URL
// =====================================================

async function crawlUrl(item) {

  const url = item.url;

  console.log(
    `[HEXORA] Crawling: ${url}`
  );

  try {

    const allowed =
      await canFetch(url);

    if (!allowed) {

      console.log(
        `[HEXORA] robots.txt blocked: ${url}`
      );

      await markFailure(
        item.id,
        "Blocked by robots.txt"
      );

      return;
    }

    const response =
      await fetchPage(url);

    if (!response.ok) {

      const error =
        `HTTP ${response.status}`;

      await markFailure(
        item.id,
        error
      );

      return;
    }

    const contentType =
      response.headers.get(
        "content-type"
      ) || "";

    if (!contentType.includes("text/html")) {

      await markFailure(
        item.id,
        "Non-HTML content"
      );

      return;
    }

    const html =
      await response.text();

    if (
      !html ||
      html.length < 50
    ) {

      await markFailure(
        item.id,
        "Empty HTML"
      );

      return;
    }

    const page =
      extractPage(
        html,
        url
      );

    const now =
      new Date().toISOString();

    const pageData = {

      url,

      title:
        page.title || url,

      description:
        page.description || "",

      content:
        page.content || "",

      canonical:
        page.canonical || url,

      content_hash:
        page.contentHash,

      word_count:
        page.wordCount,

      language:
        "unknown",

      last_crawled_at:
        now
    };


    const {
      error: pageError
    } =
      await supabase
        .from("pages")
        .upsert(
          pageData,
          {
            onConflict: "url"
          }
        );

    if (pageError) {
      throw pageError;
    }


    // Add discovered links
    for (
      const link of page.links
    ) {

      await supabase
        .from("crawl_queue")
        .upsert(
          {
            url: link,
            status: "pending"
          },
          {
            onConflict: "url",
            ignoreDuplicates: true
          }
        );
    }


    await supabase
      .from("crawl_queue")
      .update({

        status: "done",

        last_error: null,

        last_crawled_at:
          now

      })
      .eq(
        "id",
        item.id
      );


    console.log(
      `[HEXORA] Crawled successfully: ${url} | links: ${page.links.length}`
    );

  } catch (error) {

    console.error(
      `[HEXORA] Crawl failed: ${url}`,
      error.message
    );

    await markFailure(
      item.id,
      error.message
    );
  }
}


// =====================================================
// CRAWL BATCH
// =====================================================

async function crawlBatch() {

  const {
    data,
    error
  } =
    await supabase
      .from("crawl_queue")
      .select("*")
      .eq(
        "status",
        "pending"
      )
      .order(
        "created_at",
        {
          ascending: true
        }
      )
      .limit(
        BATCH_SIZE
      );

  if (error) {
    throw error;
  }

  if (
    !data ||
    data.length === 0
  ) {

    console.log(
      "[HEXORA] No pending URLs."
    );

    return 0;
  }

  let index = 0;

  async function worker() {

    while (true) {

      const current =
        index++;

      if (
        current >= data.length
      ) {
        return;
      }

      const item =
        data[current];


      await supabase
        .from("crawl_queue")
        .update({
          status:
            "processing"
        })
        .eq(
          "id",
          item.id
        );


      await crawlUrl(item);
    }
  }


  const workers = [];

  for (
    let i = 0;
    i <
    Math.min(
      CONCURRENCY,
      data.length
    );
    i++
  ) {

    workers.push(
      worker()
    );
  }

  await Promise.all(
    workers
  );

  return data.length;
}


// =====================================================
// SEARCH ENGINE
// =====================================================

async function searchPages(query) {

  const q =
    cleanText(query);

  if (!q) {
    return [];
  }


  console.log(
    `[HEXORA SEARCH] ${q}`
  );


  // PostgreSQL full-text search
  const {
    data,
    error
  } =
    await supabase
      .from("pages")
      .select(
        "id,url,title,description,content,word_count,last_crawled_at"
      )
      .textSearch(
        "search_vector",
        q,
        {
          type: "websearch",
          config: "simple"
        }
      )
      .limit(100);


  if (error) {

    console.error(
      "[HEXORA SEARCH ERROR]",
      error
    );

    throw error;
  }


  const queryWords =
    q
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);


  const results =
    (data || [])
      .map(page => {

        const title =
          (page.title || "")
            .toLowerCase();

        const description =
          (page.description || "")
            .toLowerCase();

        const content =
          (page.content || "")
            .toLowerCase();

        let score = 0;


        // ---------------------------------
        // Exact title match
        // ---------------------------------

        if (
          title ===
          q.toLowerCase()
        ) {
          score += 100;
        }


        // ---------------------------------
        // Query inside title
        // ---------------------------------

        if (
          title.includes(
            q.toLowerCase()
          )
        ) {
          score += 60;
        }


        // ---------------------------------
        // Query inside description
        // ---------------------------------

        if (
          description.includes(
            q.toLowerCase()
          )
        ) {
          score += 30;
        }


        // ---------------------------------
        // Individual word matching
        // ---------------------------------

        for (
          const word of queryWords
        ) {

          if (
            title.includes(word)
          ) {
            score += 15;
          }

          if (
            description.includes(word)
          ) {
            score += 7;
          }

          if (
            content.includes(word)
          ) {
            score += 2;
          }
        }


        // ---------------------------------
        // Content quality
        // ---------------------------------

        const wordCount =
          Number(
            page.word_count || 0
          );

        if (
          wordCount >= 300
        ) {
          score += 5;
        }

        if (
          wordCount >= 1000
        ) {
          score += 5;
        }


        // ---------------------------------
        // Freshness
        // ---------------------------------

        if (
          page.last_crawled_at
        ) {

          const age =
            Date.now() -
            new Date(
              page.last_crawled_at
            ).getTime();

          const days =
            age /
            (
              1000 *
              60 *
              60 *
              24
            );

          if (
            days <= 7
          ) {
            score += 5;
          }
        }


        return {
          ...page,
          relevance_score:
            Number(
              score.toFixed(3)
            )
        };
      });


  // Highest relevance first
  results.sort(
    (a, b) =>
      b.relevance_score -
      a.relevance_score
  );


  return results
    .slice(0, 20)
    .map(
      ({
        content,
        ...page
      }) => page
    );
}


// =====================================================
// HTTP API
// =====================================================

const server =
  http.createServer(
    async (req, res) => {

      try {

        const url =
          new URL(
            req.url,
            `http://localhost:${PORT}`
          );


        // ------------------------------
        // Health
        // ------------------------------

        if (
          req.method === "GET" &&
          url.pathname === "/"
        ) {

          res.writeHead(
            200,
            {
              "Content-Type":
                "application/json"
            }
          );

          res.end(
            JSON.stringify({
              status: "ok",
              engine: "HEXORA",
              crawler: "active",
              search: "active"
            })
          );

          return;
        }


        // ------------------------------
        // Search
        // ------------------------------

        if (
          req.method === "GET" &&
          url.pathname === "/search"
        ) {

          const q =
            url.searchParams.get(
              "q"
            );

          if (!q) {

            res.writeHead(
              400,
              {
                "Content-Type":
                  "application/json"
              }
            );

            res.end(
              JSON.stringify({
                error:
                  "Missing search query"
              })
            );

            return;
          }


          const results =
            await searchPages(
              q
            );


          res.writeHead(
            200,
            {
              "Content-Type":
                "application/json",
              "Access-Control-Allow-Origin":
                "*"
            }
          );


          res.end(
            JSON.stringify({
              query: q,
              count:
                results.length,
              results
            })
          );

          return;
        }


        // ------------------------------
        // 404
        // ------------------------------

        res.writeHead(
          404,
          {
            "Content-Type":
              "application/json"
          }
        );

        res.end(
          JSON.stringify({
            error: "Not found"
          })
        );

      } catch (error) {

        console.error(
          "[HEXORA SERVER ERROR]",
          error
        );

        res.writeHead(
          500,
          {
            "Content-Type":
              "application/json"
          }
        );

        res.end(
          JSON.stringify({
            error:
              "Internal server error"
          })
        );
      }
    }
  );


// =====================================================
// START SERVER
// =====================================================

server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      "================================"
    );

    console.log(
      "HEXORA SEARCH ENGINE"
    );

    console.log(
      `HTTP server: ${PORT}`
    );

    console.log(
      "Search: /search?q=your-query"
    );

    console.log(
      "================================"
    );
  }
);


// =====================================================
// START CRAWLER
// =====================================================

async function startCrawler() {

  console.log(
    "HEXORA crawler worker started"
  );

  while (true) {

    try {

      const processed =
        await crawlBatch();

      console.log(
        `[HEXORA] Crawl cycle completed | processed: ${processed}`
      );

    } catch (error) {

      console.error(
        "[HEXORA] Crawl cycle error:",
        error.message
      );
    }


    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          CRAWL_INTERVAL_MS
        )
    );
  }
}


startCrawler()
  .catch(error => {

    console.error(
      "[HEXORA] Fatal crawler error:",
      error
    );

    process.exit(1);
  });
