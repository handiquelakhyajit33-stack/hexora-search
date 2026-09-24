import http from "node:http";
import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

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
  return String(text)
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
        const blockedPath =
          line
            .split(":")
            .slice(1)
            .join(":")
            .trim();

        if (!blockedPath) continue;

        const currentPath =
          new URL(url).pathname;

        if (currentPath.startsWith(blockedPath)) {
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

  const normalizedQuery =
    q.toLowerCase();

  // ===================================================
  // POSTGRESQL FULL TEXT SEARCH
  // ===================================================

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
    normalizedQuery
      .split(/\s+/)
      .filter(
        word => word.length > 1
      );


  // ===================================================
  // SCORE RESULTS
  // ===================================================

  const results =
    (data || [])
      .map(page => {

        const title =
          cleanText(
            page.title || ""
          ).toLowerCase();

        const description =
          cleanText(
            page.description || ""
          ).toLowerCase();

        const content =
          cleanText(
            page.content || ""
          ).toLowerCase();

        let score = 0;


        // ---------------------------------------------
        // 1. EXACT TITLE MATCH
        // ---------------------------------------------

        if (
          title === normalizedQuery
        ) {
          score += 150;
        }


        // ---------------------------------------------
        // 2. TITLE PHRASE MATCH
        // ---------------------------------------------

        if (
          title.includes(
            normalizedQuery
          )
        ) {
          score += 80;
        }


        // ---------------------------------------------
        // 3. DESCRIPTION PHRASE MATCH
        // ---------------------------------------------

        if (
          description.includes(
            normalizedQuery
          )
        ) {
          score += 40;
        }


        // ---------------------------------------------
        // 4. WORD MATCHING
        // ---------------------------------------------

        let matchedWords = 0;

        for (
          const word of queryWords
        ) {

          let matched = false;

          if (
            title.includes(word)
          ) {
            score += 25;
            matched = true;
          }

          if (
            description.includes(word)
          ) {
            score += 12;
            matched = true;
          }

          if (
            content.includes(word)
          ) {
            score += 3;
            matched = true;
          }

          if (matched) {
            matchedWords++;
          }
        }


        // ---------------------------------------------
        // 5. QUERY COVERAGE
        // ---------------------------------------------

        if (
          queryWords.length > 0
        ) {

          const coverage =
            matchedWords /
            queryWords.length;

          score += coverage * 50;
        }


        // ---------------------------------------------
        // 6. DOMAIN EXTRACTION
        // ---------------------------------------------

        let hostname = "";

        try {

          hostname =
            new URL(
              page.url
            )
              .hostname
              .toLowerCase()
              .replace(
                /^www\./,
                ""
              );

        } catch {}


        // ---------------------------------------------
        // 7. OFFICIAL DOMAIN RELEVANCE
        // ---------------------------------------------

        const domainKeywords = {

          google: [
            "google.com"
          ],

          youtube: [
            "youtube.com"
          ],

          amazon: [
            "amazon.com"
          ],

          wikipedia: [
            "wikipedia.org"
          ],

          facebook: [
            "facebook.com"
          ],

          instagram: [
            "instagram.com"
          ],

          github: [
            "github.com"
          ],

          reddit: [
            "reddit.com"
          ],

          microsoft: [
            "microsoft.com"
          ],

          apple: [
            "apple.com"
          ],

          openai: [
            "openai.com"
          ]

        };


        for (
          const [
            keyword,
            domains
          ]
          of Object.entries(
            domainKeywords
          )
        ) {

          if (
            normalizedQuery.includes(
              keyword
            )
          ) {

            const isOfficial =
              domains.some(
                domain =>
                  hostname === domain ||
                  hostname.endsWith(
                    `.${domain}`
                  )
              );

            if (isOfficial) {
              score += 100;
            }
          }
        }


        // ---------------------------------------------
        // 8. DOMAIN NAME MATCH
        // ---------------------------------------------

        for (
          const word of queryWords
        ) {

          const cleanWord =
            word.replace(
              /[^a-z0-9]/g,
              ""
            );

          if (
            cleanWord &&
            hostname.includes(
              cleanWord
            )
          ) {
            score += 20;
          }
        }


        // ---------------------------------------------
        // 9. CONTENT QUALITY
        // ---------------------------------------------

        const wordCount =
          Number(
            page.word_count || 0
          );


        if (
          wordCount >= 100
        ) {
          score += 3;
        }

        if (
          wordCount >= 300
        ) {
          score += 5;
        }

        if (
          wordCount >= 1000
        ) {
          score += 7;
        }


        // ---------------------------------------------
        // 10. FRESHNESS
        // ---------------------------------------------

        if (
          page.last_crawled_at
        ) {

          const crawledAt =
            new Date(
              page.last_crawled_at
            ).getTime();

          if (
            Number.isFinite(
              crawledAt
            )
          ) {

            const ageDays =
              (
                Date.now() -
                crawledAt
              ) /
              (
                1000 *
                60 *
                60 *
                24
              );


            if (
              ageDays <= 1
            ) {

              score += 15;

            } else if (
              ageDays <= 3
            ) {

              score += 10;

            } else if (
              ageDays <= 7
            ) {

              score += 5;
            }
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


  // ===================================================
  // SORT BY RELEVANCE
  // ===================================================

  results.sort(
    (a, b) => {

      if (
        b.relevance_score !==
        a.relevance_score
      ) {

        return (
          b.relevance_score -
          a.relevance_score
        );
      }

      return String(
        a.title || ""
      ).localeCompare(
        String(
          b.title || ""
        )
      );
    }
  );


  // ===================================================
  // REMOVE DUPLICATE URLS
  // ===================================================

  const seen =
    new Set();

  const uniqueResults =
    results.filter(
      page => {

        let key =
          page.url;

        try {

          const parsed =
            new URL(
              page.url
            );

          parsed.hash = "";

          key =
            parsed.origin +
            parsed.pathname
              .replace(
                /\/+$/,
                ""
              );

        } catch {}


        if (
          seen.has(key)
        ) {
          return false;
        }

        seen.add(key);

        return true;
      }
    );


  // ===================================================
  // RETURN TOP 20
  // ===================================================

  return uniqueResults
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


        // =================================================
        // HEXORA WEBSITE
        // =================================================

        if (
          req.method === "GET" &&
          url.pathname === "/"
        ) {

          const filePath =
            path.join(
              process.cwd(),
              "index.html"
            );


          if (
            !fs.existsSync(
              filePath
            )
          ) {

            res.writeHead(
              404,
              {
                "Content-Type":
                  "text/plain; charset=utf-8"
              }
            );

            res.end(
              "HEXORA website not found"
            );

            return;
          }


          res.writeHead(
            200,
            {
              "Content-Type":
                "text/html; charset=utf-8"
            }
          );


          fs.createReadStream(
            filePath
          ).pipe(res);

          return;
        }


        // =================================================
        // SEARCH
        // =================================================

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


        // =================================================
        // FRONTEND STATIC FILES
        // =================================================

        if (
          req.method === "GET"
        ) {

          const requestedPath =
            decodeURIComponent(
              url.pathname
            );


          if (
            requestedPath !== "/" &&
            !requestedPath.includes("..") &&
            !requestedPath.includes("\\")
          ) {

            const staticPath =
              path.join(
                process.cwd(),
                requestedPath
              );


            if (
              fs.existsSync(
                staticPath
              ) &&
              fs.statSync(
                staticPath
              ).isFile()
            ) {

              const ext =
                path
                  .extname(
                    staticPath
                  )
                  .toLowerCase();


              const mimeTypes = {

                ".html":
                  "text/html; charset=utf-8",

                ".js":
                  "application/javascript; charset=utf-8",

                ".mjs":
                  "application/javascript; charset=utf-8",

                ".css":
                  "text/css; charset=utf-8",

                ".json":
                  "application/json; charset=utf-8",

                ".png":
                  "image/png",

                ".jpg":
                  "image/jpeg",

                ".jpeg":
                  "image/jpeg",

                ".gif":
                  "image/gif",

                ".svg":
                  "image/svg+xml",

                ".webp":
                  "image/webp",

                ".ico":
                  "image/x-icon",

                ".txt":
                  "text/plain; charset=utf-8",

                ".woff":
                  "font/woff",

                ".woff2":
                  "font/woff2"
              };


              res.writeHead(
                200,
                {
                  "Content-Type":
                    mimeTypes[ext] ||
                    "application/octet-stream"
                }
              );


              fs.createReadStream(
                staticPath
              ).pipe(res);

              return;
            }
          }
        }


        // =================================================
        // 404
        // =================================================

        res.writeHead(
          404,
          {
            "Content-Type":
              "application/json"
          }
        );


        res.end(
          JSON.stringify({
            error:
              "Not found"
          })
        );


      } catch (error) {

        console.error(
          "[HEXORA SERVER ERROR]",
          error
        );


        if (!res.headersSent) {

          res.writeHead(
            500,
            {
              "Content-Type":
                "application/json"
            }
          );

        }


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
