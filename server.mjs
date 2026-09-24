import http from "node:http";
import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// =====================================================
// ENVIRONMENT
// =====================================================

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

const MAX_DISCOVERED_LINKS = 200;


// =====================================================
// GLOBAL SEEDS
// =====================================================

const GLOBAL_SEEDS = [
  "https://www.wikipedia.org/",
  "https://en.wikipedia.org/",
  "https://www.bbc.com/",
  "https://www.bbc.com/news",
  "https://apnews.com/",
  "https://www.aljazeera.com/",
  "https://www.theguardian.com/",
  "https://www.ndtv.com/",
  "https://indianexpress.com/",
  "https://www.thehindu.com/",
  "https://www.hindustantimes.com/",
  "https://www.nasa.gov/",
  "https://www.who.int/",
  "https://www.un.org/",
  "https://github.com/",
  "https://developer.mozilla.org/",
  "https://stackoverflow.com/",
  "https://www.reddit.com/",
  "https://www.imdb.com/",
  "https://www.espn.com/",
  "https://www.espncricinfo.com/"
];


// =====================================================
// TRUST / DOMAIN QUALITY
// =====================================================

const TRUSTED_DOMAINS = [
  "nasa.gov",
  "who.int",
  "un.org",
  "bbc.com",
  "apnews.com",
  "aljazeera.com",
  "theguardian.com",
  "ndtv.com",
  "indianexpress.com",
  "thehindu.com",
  "hindustantimes.com",
  "github.com",
  "developer.mozilla.org",
  "stackoverflow.com",
  "wikipedia.org",
  "imdb.com",
  "espn.com",
  "espncricinfo.com",
  "reddit.com"
];


// =====================================================
// HELPERS
// =====================================================

function cleanText(text = "") {
  return String(text)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
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

    if (
      !["http:", "https:"].includes(
        parsed.protocol
      )
    ) {
      return null;
    }

    parsed.hash = "";

    // Remove tracking parameters
    const removeParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid",
      "ref",
      "ref_src"
    ];

    for (const key of removeParams) {
      parsed.searchParams.delete(key);
    }

    return parsed.toString();
  } catch {
    return null;
  }
}


function getDomain(url) {
  try {
    return new URL(url)
      .hostname
      .replace(/^www\./, "")
      .toLowerCase();
  } catch {
    return "";
  }
}


function domainAuthority(url) {
  const domain = getDomain(url);

  if (!domain) return 0;

  for (const trusted of TRUSTED_DOMAINS) {
    if (
      domain === trusted ||
      domain.endsWith("." + trusted)
    ) {
      return 10;
    }
  }

  return 0;
}


function urlQuality(url) {
  const lower = url.toLowerCase();

  let score = 0;

  const good = [
    "/news/",
    "/article/",
    "/articles/",
    "/wiki/",
    "/science/",
    "/technology/",
    "/sports/",
    "/business/",
    "/world/",
    "/india/",
    "/assam/",
    "/guwahati/",
    "/learn/",
    "/docs/",
    "/blog/"
  ];

  const bad = [
    "/login",
    "/signup",
    "/register",
    "/account",
    "/privacy",
    "/terms",
    "/cookie",
    "/search?",
    "/tag/",
    "/author/",
    "/wp-admin",
    "/feed",
    "/comments"
  ];

  for (const part of good) {
    if (lower.includes(part)) {
      score += 5;
    }
  }

  for (const part of bad) {
    if (lower.includes(part)) {
      score -= 5;
    }
  }

  return score;
}


function isProbablyWebPage(url) {
  const lower = url.toLowerCase();

  const badExtensions = [
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".svg",
    ".mp4",
    ".mp3",
    ".pdf",
    ".zip",
    ".rar",
    ".exe",
    ".apk",
    ".css",
    ".js",
    ".xml"
  ];

  return !badExtensions.some(
    ext => lower.includes(ext)
  );
}


// =====================================================
// HTML EXTRACTION
// =====================================================

function extractPage(html, pageUrl) {
  const $ = cheerio.load(html);

  $(
    "script,style,noscript,iframe,svg,canvas,template"
  ).remove();

  const title = cleanText(
    $("title").first().text()
  );

  const description = cleanText(
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") ||
    ""
  );

  const canonical =
    normalizeUrl(
      $('link[rel="canonical"]').attr("href") ||
      pageUrl,
      pageUrl
    ) || pageUrl;

  const content = cleanText(
    $("body").text()
  );

  const links = new Set();

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");

    if (!href) return;

    const normalized =
      normalizeUrl(href, pageUrl);

    if (
      normalized &&
      isProbablyWebPage(normalized)
    ) {
      links.add(normalized);
    }
  });

  const limitedLinks =
    [...links].slice(
      0,
      MAX_DISCOVERED_LINKS
    );

  const wordCount = content
    ? content.split(/\s+/).length
    : 0;

  return {
    title,
    description,
    canonical,
    content,
    links: limitedLinks,
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
        signal:
          AbortSignal.timeout(10000)
      }
    );

    if (!response.ok) {
      return true;
    }

    const robots =
      await response.text();

    const lines =
      robots
        .split(/\r?\n/)
        .map(line =>
          line.trim()
        );

    let applies = false;

    for (const rawLine of lines) {
      const line =
        rawLine.toLowerCase();

      if (
        line.startsWith(
          "user-agent:"
        )
      ) {
        const agent =
          line
            .split(":")
            .slice(1)
            .join(":")
            .trim();

        applies =
          agent === "*" ||
          agent === "hexora-bot";
      }

      if (
        applies &&
        line.startsWith(
          "disallow:"
        )
      ) {
        const blockedPath =
          line
            .split(":")
            .slice(1)
            .join(":")
            .trim();

        if (!blockedPath) {
          continue;
        }

        const currentPath =
          new URL(url).pathname;

        if (
          currentPath.startsWith(
            blockedPath
          )
        ) {
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
// FETCH
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
        AbortSignal.timeout(
          TIMEOUT_MS
        )
    }
  );
}


// =====================================================
// FAILURE
// =====================================================

async function markFailure(
  id,
  error
) {
  try {
    await supabase
      .from("crawl_queue")
      .update({
        status: "pending",
        last_error:
          String(error)
            .slice(0, 1000),
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
      await markFailure(
        item.id,
        "Blocked by robots.txt"
      );

      return;
    }

    const response =
      await fetchPage(url);

    if (!response.ok) {
      await markFailure(
        item.id,
        `HTTP ${response.status}`
      );

      return;
    }

    const contentType =
      response.headers.get(
        "content-type"
      ) || "";

    if (
      !contentType.includes(
        "text/html"
      )
    ) {
      await markFailure(
        item.id,
        "Non-HTML content"
      );

      return;
    }

    const finalUrl =
      response.url || url;

    const html =
      await response.text();

    if (
      !html ||
      html.length < 100
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
        finalUrl
      );

    const now =
      new Date().toISOString();

    const pageData = {
      url: finalUrl,

      title:
        page.title ||
        finalUrl,

      description:
        page.description ||
        "",

      content:
        page.content ||
        "",

      canonical:
        page.canonical ||
        finalUrl,

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
        last_crawled_at: now
      })
      .eq(
        "id",
        item.id
      );


    console.log(
      `[HEXORA] Success: ${finalUrl} | links: ${page.links.length}`
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
// REFRESH GLOBAL SEEDS
// =====================================================

async function refreshSeeds() {
  try {
    for (
      const url of GLOBAL_SEEDS
    ) {
      await supabase
        .from("crawl_queue")
        .upsert(
          {
            url,
            status: "pending"
          },
          {
            onConflict: "url",
            ignoreDuplicates: true
          }
        );
    }

    console.log(
      `[HEXORA] Global seeds checked: ${GLOBAL_SEEDS.length}`
    );
  } catch (error) {
    console.error(
      "[HEXORA] Seed refresh error:",
      error.message
    );
  }
}


// =====================================================
// CRAWL PRIORITY
// =====================================================

function crawlPriority(item) {
  const url = item.url || "";

  let score = 0;

  score +=
    domainAuthority(url);

  score +=
    urlQuality(url);

  const lower =
    url.toLowerCase();

  if (
    lower.includes("/news")
  ) {
    score += 5;
  }

  if (
    lower.includes("/article")
  ) {
    score += 5;
  }

  if (
    lower.includes("/world")
  ) {
    score += 3;
  }

  if (
    lower.includes("/india")
  ) {
    score += 3;
  }

  return score;
}


// =====================================================
// CRAWL BATCH
// =====================================================

async function crawlBatch() {
  await refreshSeeds();

  const fetchLimit =
    Math.max(
      BATCH_SIZE * 5,
      50
    );

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
      .limit(fetchLimit);

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

  const selected =
    data
      .sort(
        (a, b) =>
          crawlPriority(b) -
          crawlPriority(a)
      )
      .slice(
        0,
        BATCH_SIZE
      );

  let index = 0;

  async function worker() {
    while (true) {
      const current =
        index++;

      if (
        current >=
        selected.length
      ) {
        return;
      }

      const item =
        selected[current];

      await supabase
        .from("crawl_queue")
        .update({
          status: "processing"
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
      selected.length
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

  return selected.length;
}


// =====================================================
// SEARCH HELPERS
// =====================================================

function normalizeSearchText(text) {
  return cleanText(
    text
      .toLowerCase()
      .replace(/[“”‘’]/g, '"')
  );
}


function countOccurrences(
  text,
  term
) {
  if (!term) return 0;

  let count = 0;
  let pos = 0;

  while (true) {
    const found =
      text.indexOf(
        term,
        pos
      );

    if (found === -1) {
      break;
    }

    count++;
    pos =
      found +
      Math.max(
        term.length,
        1
      );
  }

  return count;
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

  const normalizedQ =
    normalizeSearchText(q);

  const queryWords =
    normalizedQ
      .split(/\s+/)
      .filter(
        word =>
          word.length >= 2
      );


  // -----------------------------------------
  // 1. PostgreSQL full text search
  // -----------------------------------------

  let candidates = [];

  const {
    data: ftsData,
    error: ftsError
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
      .limit(200);

  if (!ftsError) {
    candidates.push(
      ...(ftsData || [])
    );
  } else {
    console.error(
      "[HEXORA FTS]",
      ftsError.message
    );
  }


  // -----------------------------------------
  // 2. Exact / partial title search
  // -----------------------------------------

  for (
    const word of queryWords.slice(
      0,
      8
    )
  ) {
    const pattern =
      `%${word}%`;

    const {
      data,
      error
    } =
      await supabase
        .from("pages")
        .select(
          "id,url,title,description,content,word_count,last_crawled_at"
        )
        .ilike(
          "title",
          pattern
        )
        .limit(100);

    if (
      !error &&
      data
    ) {
      candidates.push(
        ...data
      );
    }
  }


  // -----------------------------------------
  // 3. Description search
  // -----------------------------------------

  for (
    const word of queryWords.slice(
      0,
      5
    )
  ) {
    const pattern =
      `%${word}%`;

    const {
      data,
      error
    } =
      await supabase
        .from("pages")
        .select(
          "id,url,title,description,content,word_count,last_crawled_at"
        )
        .ilike(
          "description",
          pattern
        )
        .limit(100);

    if (
      !error &&
      data
    ) {
      candidates.push(
        ...data
      );
    }
  }


  // -----------------------------------------
  // Remove duplicates
  // -----------------------------------------

  const unique =
    new Map();

  for (
    const page of candidates
  ) {
    if (
      page &&
      page.url
    ) {
      unique.set(
        page.url,
        page
      );
    }
  }


  // -----------------------------------------
  // Ranking
  // -----------------------------------------

  const results =
    [...unique.values()]
      .map(page => {
        const title =
          normalizeSearchText(
            page.title || ""
          );

        const description =
          normalizeSearchText(
            page.description || ""
          );

        const content =
          normalizeSearchText(
            page.content || ""
          );

        const url =
          normalizeSearchText(
            page.url || ""
          );

        let score = 0;


        // =================================
        // EXACT TITLE
        // =================================

        if (
          title === normalizedQ
        ) {
          score += 1000;
        }


        // =================================
        // TITLE PHRASE
        // =================================

        if (
          title.includes(
            normalizedQ
          )
        ) {
          score += 600;
        }


        // =================================
        // DESCRIPTION PHRASE
        // =================================

        if (
          description.includes(
            normalizedQ
          )
        ) {
          score += 250;
        }


        // =================================
        // URL PHRASE
        // =================================

        if (
          url.includes(
            normalizedQ
          )
        ) {
          score += 220;
        }


        // =================================
        // EACH QUERY WORD
        // =================================

        let titleMatches = 0;
        let descriptionMatches = 0;
        let contentMatches = 0;

        for (
          const word of queryWords
        ) {
          const t =
            countOccurrences(
              title,
              word
            );

          const d =
            countOccurrences(
              description,
              word
            );

          const c =
            countOccurrences(
              content,
              word
            );

          if (t > 0) {
            titleMatches++;
            score +=
              Math.min(
                t,
                5
              ) * 100;
          }

          if (d > 0) {
            descriptionMatches++;
            score +=
              Math.min(
                d,
                5
              ) * 35;
          }

          if (c > 0) {
            contentMatches++;
            score +=
              Math.min(
                c,
                10
              ) * 4;
          }

          if (
            url.includes(word)
          ) {
            score += 40;
          }
        }


        // =================================
        // QUERY COVERAGE
        // =================================

        if (
          queryWords.length > 0
        ) {
          const titleCoverage =
            titleMatches /
            queryWords.length;

          const descriptionCoverage =
            descriptionMatches /
            queryWords.length;

          const contentCoverage =
            contentMatches /
            queryWords.length;

          score +=
            titleCoverage * 500;

          score +=
            descriptionCoverage * 180;

          score +=
            contentCoverage * 100;
        }


        // =================================
        // DOMAIN QUALITY
        // =================================

        score +=
          domainAuthority(
            page.url
          );


        // =================================
        // URL QUALITY
        // =================================

        score +=
          urlQuality(
            page.url
          );


        // =================================
        // CONTENT QUALITY
        // =================================

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
          score += 8;
        }


        // =================================
        // FRESHNESS
        // =================================

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
            days <= 1
          ) {
            score += 10;
          } else if (
            days <= 7
          ) {
            score += 6;
          } else if (
            days <= 30
          ) {
            score += 3;
          }
        }


        // =================================
        // PENALTY FOR WEAK MATCH
        // =================================

        if (
          titleMatches === 0 &&
          descriptionMatches === 0 &&
          !url.includes(
            normalizedQ
          )
        ) {
          score -= 250;
        }


        // Wikipedia generic-page penalty
        // when query isn't actually in title.
        if (
          getDomain(page.url)
            .includes(
              "wikipedia.org"
            ) &&
          !title.includes(
            normalizedQ
          ) &&
          !description.includes(
            normalizedQ
          )
        ) {
          score -= 180;
        }


        return {
          ...page,
          relevance_score:
            Number(
              score.toFixed(2)
            )
        };
      });


  // =========================================
  // SORT
  // =========================================

  results.sort(
    (a, b) =>
      b.relevance_score -
      a.relevance_score
  );


  // =========================================
  // FINAL RESULTS
  // =========================================

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
// HTTP SERVER
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


        // =================================
        // HOME
        // =================================

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


        // =================================
        // SEARCH
        // =================================

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
            await searchPages(q);

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


        // =================================
        // STATIC FILES
        // =================================

        if (
          req.method === "GET"
        ) {
          const requestedPath =
            decodeURIComponent(
              url.pathname
            );

          if (
            requestedPath !== "/" &&
            !requestedPath.includes(
              ".."
            ) &&
            !requestedPath.includes(
              "\\"
            )
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


        // =================================
        // 404
        // =================================

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

  await refreshSeeds();

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
