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

const MAX_DISCOVERED_LINKS =
  Number(process.env.MAX_DISCOVERED_LINKS || 200);


// =====================================================
// WORLDWIDE SEEDS
// =====================================================

const CRAWL_SEEDS = [
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

const SEED_REFRESH_MS =
  15 * 60 * 1000;


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

    if (
      !["http:", "https:"].includes(
        parsed.protocol
      )
    ) {
      return null;
    }

    parsed.hash = "";

    // Remove common tracking parameters
    const trackingParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid",
      "mc_cid",
      "mc_eid"
    ];

    for (
      const param of trackingParams
    ) {
      parsed.searchParams.delete(param);
    }

    return parsed.toString();

  } catch {
    return null;
  }
}


// =====================================================
// URL QUALITY
// =====================================================

function urlQuality(url) {
  const text =
    String(url || "").toLowerCase();

  let score = 0;

  const goodTerms = [
    "news",
    "article",
    "story",
    "latest",
    "technology",
    "science",
    "business",
    "sports",
    "world",
    "india",
    "assam",
    "guwahati",
    "health",
    "education",
    "research",
    "tutorial",
    "guide"
  ];

  const badTerms = [
    "login",
    "signin",
    "signup",
    "register",
    "account",
    "cart",
    "checkout",
    "privacy",
    "terms",
    "cookie",
    "advertise",
    "javascript:",
    "mailto:"
  ];

  for (
    const term of goodTerms
  ) {
    if (text.includes(term)) {
      score += 20;
    }
  }

  for (
    const term of badTerms
  ) {
    if (text.includes(term)) {
      score -= 80;
    }
  }

  return score;
}


// =====================================================
// HTML EXTRACTION
// =====================================================

function extractPage(
  html,
  pageUrl
) {
  const $ =
    cheerio.load(html);

  $(
    "script, style, noscript, iframe, svg, canvas"
  ).remove();

  const title =
    cleanText(
      $("title").first().text()
    );

  const description =
    cleanText(
      $(
        'meta[name="description"]'
      ).attr("content") || ""
    );

  const ogDescription =
    cleanText(
      $(
        'meta[property="og:description"]'
      ).attr("content") || ""
    );

  const finalDescription =
    description ||
    ogDescription;

  const canonical =
    normalizeUrl(
      $(
        'link[rel="canonical"]'
      ).attr("href") ||
        pageUrl,
      pageUrl
    );

  const content =
    cleanText(
      $("body").text()
    );

  const links =
    new Set();

  $("a[href]").each(
    (_, element) => {

      const href =
        $(element).attr("href");

      if (!href) {
        return;
      }

      const normalized =
        normalizeUrl(
          href,
          pageUrl
        );

      if (normalized) {
        links.add(normalized);
      }
    }
  );

  const wordCount =
    content
      ? content.split(/\s+/).length
      : 0;

  return {
    title,
    description:
      finalDescription,
    canonical,
    content,
    links: [
      ...links
    ],
    wordCount,
    contentHash:
      hashContent(content)
  };
}


// =====================================================
// ROBOTS
// =====================================================

async function canFetch(url) {

  try {

    const parsed =
      new URL(url);

    const robotsUrl =
      `${parsed.origin}/robots.txt`;

    const response =
      await fetch(
        robotsUrl,
        {
          headers: {
            "User-Agent":
              USER_AGENT
          },
          signal:
            AbortSignal.timeout(
              10000
            )
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
        .map(
          line =>
            line
              .trim()
              .toLowerCase()
        );

    let activeUserAgent =
      false;

    for (
      const line of lines
    ) {

      if (
        line.startsWith(
          "user-agent:"
        )
      ) {

        const value =
          line
            .split(":")
            .slice(1)
            .join(":")
            .trim();

        activeUserAgent =
          value === "*" ||
          value ===
            "hexora-bot";
      }

      if (
        activeUserAgent &&
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
          new URL(url)
            .pathname;

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
// FETCH PAGE
// =====================================================

async function fetchPage(url) {

  return fetch(
    url,
    {
      headers: {
        "User-Agent":
          USER_AGENT,

        "Accept":
          "text/html,application/xhtml+xml"
      },

      redirect:
        "follow",

      signal:
        AbortSignal.timeout(
          TIMEOUT_MS
        )
    }
  );
}


// =====================================================
// CRAWL FAILURE
// =====================================================

async function markFailure(
  id,
  error
) {

  try {

    await supabase
      .from("crawl_queue")
      .update({
        status:
          "pending",

        last_error:
          String(error)
            .slice(
              0,
              1000
            ),

        last_crawled_at:
          new Date()
            .toISOString()
      })
      .eq(
        "id",
        id
      );

  } catch (
    dbError
  ) {

    console.error(
      "[HEXORA] Queue error:",
      dbError.message
    );
  }
}


// =====================================================
// CRAWL URL
// =====================================================

async function crawlUrl(
  item
) {

  const url =
    item.url;

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
      new Date()
        .toISOString();

    const pageData = {

      url,

      title:
        page.title ||
        url,

      description:
        page.description ||
        "",

      content:
        page.content ||
        "",

      canonical:
        page.canonical ||
        url,

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
            onConflict:
              "url"
          }
        );

    if (pageError) {
      throw pageError;
    }


    // =================================================
    // DISCOVER LINKS
    // =================================================

    const discovered =
      page.links
        .filter(
          link =>
            urlQuality(link) > -80
        )
        .sort(
          (
            a,
            b
          ) =>
            urlQuality(b) -
            urlQuality(a)
        )
        .slice(
          0,
          MAX_DISCOVERED_LINKS
        );


    for (
      const link of discovered
    ) {

      await supabase
        .from("crawl_queue")
        .upsert(
          {
            url:
              link,

            status:
              "pending"
          },
          {
            onConflict:
              "url",

            ignoreDuplicates:
              true
          }
        );
    }


    await supabase
      .from("crawl_queue")
      .update({

        status:
          "done",

        last_error:
          null,

        last_crawled_at:
          now

      })
      .eq(
        "id",
        item.id
      );


    console.log(
      `[HEXORA] Crawled successfully: ${url} | links: ${discovered.length}`
    );

  } catch (
    error
  ) {

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
// CRAWL PRIORITY
// =====================================================

function crawlPriority(
  item
) {

  const url =
    String(
      item.url || ""
    ).toLowerCase();

  let score =
    urlQuality(url);

  try {

    const parsed =
      new URL(url);

    const hostname =
      parsed.hostname
        .toLowerCase()
        .replace(
          /^www\./,
          ""
        );

    // Important worldwide sources
    const trustedDomains = [
      "wikipedia.org",
      "bbc.com",
      "apnews.com",
      "aljazeera.com",
      "theguardian.com",
      "ndtv.com",
      "indianexpress.com",
      "thehindu.com",
      "hindustantimes.com",
      "nasa.gov",
      "who.int",
      "un.org",
      "github.com",
      "developer.mozilla.org",
      "stackoverflow.com",
      "reddit.com",
      "imdb.com",
      "espn.com",
      "espncricinfo.com"
    ];

    for (
      const domain of
        trustedDomains
    ) {

      if (
        hostname === domain ||
        hostname.endsWith(
          `.${domain}`
        )
      ) {
        score += 150;
        break;
      }
    }

    // Article/news paths
    const pathText =
      parsed.pathname
        .toLowerCase();

    const articleTerms = [
      "/news/",
      "/article/",
      "/articles/",
      "/story/",
      "/stories/",
      "/latest/",
      "/world/",
      "/technology/",
      "/science/",
      "/business/",
      "/sports/",
      "/health/",
      "/education/"
    ];

    for (
      const term of
        articleTerms
    ) {

      if (
        pathText.includes(term)
      ) {
        score += 80;
      }
    }

    // Generic navigation pages lower priority
    const weakTerms = [
      "/login",
      "/signin",
      "/signup",
      "/account",
      "/privacy",
      "/terms",
      "/contact",
      "/about"
    ];

    for (
      const term of
        weakTerms
    ) {

      if (
        pathText.includes(term)
      ) {
        score -= 200;
      }
    }

  } catch {}

  return score;
}


// =====================================================
// REFRESH GLOBAL SEEDS
// =====================================================

async function refreshCrawlSeeds() {

  try {

    const {
      data,
      error
    } =
      await supabase
        .from("crawl_queue")
        .select(
          "id,url,status,last_crawled_at"
        )
        .in(
          "url",
          CRAWL_SEEDS
        );

    if (error) {

      console.error(
        "[HEXORA] Seed lookup error:",
        error.message
      );

      return;
    }

    const existing =
      new Map(
        (data || [])
          .map(
            row =>
              [
                row.url,
                row
              ]
          )
      );


    for (
      const seed of
        CRAWL_SEEDS
    ) {

      const row =
        existing.get(seed);

      if (!row) {

        await supabase
          .from("crawl_queue")
          .upsert(
            {
              url:
                seed,

              status:
                "pending"
            },
            {
              onConflict:
                "url",

              ignoreDuplicates:
                true
            }
          );

        console.log(
          `[HEXORA] Added global seed: ${seed}`
        );

        continue;
      }


      if (
        row.status ===
        "processing"
      ) {
        continue;
      }


      const lastCrawled =
        row.last_crawled_at
          ? new Date(
              row.last_crawled_at
            ).getTime()
          : 0;

      const age =
        Date.now() -
        lastCrawled;


      if (
        row.status === "done" &&
        age >=
          SEED_REFRESH_MS
      ) {

        await supabase
          .from("crawl_queue")
          .update({
            status:
              "pending",

            last_error:
              null
          })
          .eq(
            "id",
            row.id
          );

        console.log(
          `[HEXORA] Refreshed seed: ${seed}`
        );
      }
    }

  } catch (
    error
  ) {

    console.error(
      "[HEXORA] Seed refresh error:",
      error.message
    );
  }
}


// =====================================================
// CRAWL BATCH
// =====================================================

async function crawlBatch() {

  await refreshCrawlSeeds();


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
          ascending:
            true
        }
      )
      .limit(
        Math.max(
          BATCH_SIZE * 5,
          50
        )
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


  const prioritized =
    [...data]
      .sort(
        (
          a,
          b
        ) =>
          crawlPriority(b) -
          crawlPriority(a)
      )
      .slice(
        0,
        BATCH_SIZE
      );


  console.log(
    "[HEXORA] Priority crawl:"
  );

  for (
    const item of
      prioritized
  ) {

    console.log(
      `${crawlPriority(item)} | ${item.url}`
    );
  }


  let index = 0;


  async function worker() {

    while (true) {

      const current =
        index++;

      if (
        current >=
        prioritized.length
      ) {
        return;
      }

      const item =
        prioritized[current];


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


      await crawlUrl(
        item
      );
    }
  }


  const workers =
    [];


  for (
    let i = 0;
    i <
    Math.min(
      CONCURRENCY,
      prioritized.length
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


  return prioritized.length;
}


// =====================================================
// SEARCH HELPERS
// =====================================================

function getQueryWords(
  query
) {

  return cleanText(query)
    .toLowerCase()
    .split(/\s+/)
    .map(
      word =>
        word.replace(
          /[^\p{L}\p{N}.-]/gu,
          ""
        )
    )
    .filter(
      word =>
        word.length > 1
    );
}


function countOccurrences(
  text,
  word
) {

  if (
    !text ||
    !word
  ) {
    return 0;
  }

  let count = 0;
  let position = 0;

  while (true) {

    const index =
      text.indexOf(
        word,
        position
      );

    if (
      index === -1
    ) {
      break;
    }

    count++;

    position =
      index +
      word.length;
  }

  return count;
}


function domainAuthority(
  hostname
) {

  const trusted = {

    "wikipedia.org": 80,
    "bbc.com": 85,
    "apnews.com": 85,
    "aljazeera.com": 82,
    "theguardian.com": 82,

    "ndtv.com": 80,
    "indianexpress.com": 80,
    "thehindu.com": 82,
    "hindustantimes.com": 78,

    "nasa.gov": 90,
    "who.int": 90,
    "un.org": 90,

    "github.com": 85,
    "developer.mozilla.org": 90,
    "stackoverflow.com": 82,

    "imdb.com": 80,
    "espn.com": 82,
    "espncricinfo.com": 82
  };


  for (
    const [
      domain,
      score
    ]
    of Object.entries(
      trusted
    )
  ) {

    if (
      hostname === domain ||
      hostname.endsWith(
        `.${domain}`
      )
    ) {
      return score;
    }
  }

  return 0;
}


// =====================================================
// SEARCH ENGINE
// =====================================================

async function searchPages(
  query
) {

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

  const queryWords =
    getQueryWords(q);


  // ===================================================
  // PRIMARY FULL TEXT SEARCH
  // ===================================================

  const {
    data:
      ftsData,
    error:
      ftsError
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
          type:
            "websearch",

          config:
            "simple"
        }
      )
      .limit(250);


  if (ftsError) {

    console.error(
      "[HEXORA FTS ERROR]",
      ftsError
    );

    throw ftsError;
  }


  // ===================================================
  // FALLBACK TITLE / DESCRIPTION / URL SEARCH
  // ===================================================

  let fallbackData =
    [];


  for (
    const word of
      queryWords.slice(
        0,
        8
      )
  ) {

    const {
      data,
      error
    } =
      await supabase
        .from("pages")
        .select(
          "id,url,title,description,content,word_count,last_crawled_at"
        )
        .or(
          `title.ilike.%${word}%,description.ilike.%${word}%,url.ilike.%${word}%`
        )
        .limit(100);


    if (
      !error &&
      data
    ) {

      fallbackData =
        fallbackData.concat(
          data
        );
    }
  }


  // ===================================================
  // MERGE CANDIDATES
  // ===================================================

  const candidateMap =
    new Map();


  for (
    const page of
      [
        ...(ftsData || []),
        ...fallbackData
      ]
  ) {

    if (
      page &&
      page.url
    ) {

      candidateMap.set(
        page.url,
        page
      );
    }
  }


  const candidates =
    [
      ...candidateMap.values()
    ];


  // ===================================================
  // RANK
  // ===================================================

  const results =
    candidates.map(
      page => {

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

        const urlText =
          String(
            page.url || ""
          ).toLowerCase();


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


        let score =
          0;


        // =================================================
        // EXACT QUERY
        // =================================================

        if (
          title ===
          normalizedQuery
        ) {
          score += 1000;
        }


        // =================================================
        // TITLE PHRASE
        // =================================================

        if (
          title.includes(
            normalizedQuery
          )
        ) {
          score += 500;
        }


        // =================================================
        // DESCRIPTION PHRASE
        // =================================================

        if (
          description.includes(
            normalizedQuery
          )
        ) {
          score += 220;
        }


        // =================================================
        // URL PHRASE
        // =================================================

        if (
          urlText.includes(
            normalizedQuery
          )
        ) {
          score += 180;
        }


        let titleMatches = 0;
        let descriptionMatches = 0;
        let contentMatches = 0;


        // =================================================
        // WORD RELEVANCE
        // =================================================

        for (
          const word of
            queryWords
        ) {

          const titleCount =
            countOccurrences(
              title,
              word
            );

          const descriptionCount =
            countOccurrences(
              description,
              word
            );

          const contentCount =
            countOccurrences(
              content,
              word
            );

          const urlCount =
            countOccurrences(
              urlText,
              word
            );


          if (
            titleCount > 0
          ) {

            titleMatches++;

            score +=
              Math.min(
                titleCount,
                5
              ) * 90;
          }


          if (
            descriptionCount > 0
          ) {

            descriptionMatches++;

            score +=
              Math.min(
                descriptionCount,
                5
              ) * 35;
          }


          if (
            contentCount > 0
          ) {

            contentMatches++;

            score +=
              Math.min(
                contentCount,
                20
              ) * 2;
          }


          if (
            urlCount > 0
          ) {

            score +=
              Math.min(
                urlCount,
                3
              ) * 25;
          }
        }


        // =================================================
        // QUERY COVERAGE
        // =================================================

        if (
          queryWords.length > 0
        ) {

          score +=
            (
              titleMatches /
              queryWords.length
            ) * 300;

          score +=
            (
              descriptionMatches /
              queryWords.length
            ) * 120;

          score +=
            (
              contentMatches /
              queryWords.length
            ) * 80;
        }


        // =================================================
        // DOMAIN AUTHORITY
        // =================================================

        score +=
          domainAuthority(
            hostname
          );


        // =================================================
        // CONTENT QUALITY
        // =================================================

        const wordCount =
          Number(
            page.word_count || 0
          );


        if (
          wordCount >= 100
        ) {
          score += 5;
        }

        if (
          wordCount >= 300
        ) {
          score += 10;
        }

        if (
          wordCount >= 800
        ) {
          score += 15;
        }

        if (
          wordCount >= 1500
        ) {
          score += 10;
        }


        // =================================================
        // FRESHNESS
        // =================================================

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

              score += 50;

            } else if (
              ageDays <= 3
            ) {

              score += 35;

            } else if (
              ageDays <= 7
            ) {

              score += 20;

            } else if (
              ageDays <= 30
            ) {

              score += 8;
            }
          }
        }


        // =================================================
        // GENERIC PAGE PENALTY
        // =================================================

        if (
          queryWords.length === 1 &&
          titleMatches === 0 &&
          descriptionMatches === 0
        ) {

          score -= 120;
        }


        // =================================================
        // WIKIPEDIA GENERIC PAGE PENALTY
        // =================================================

        if (
          hostname ===
            "wikipedia.org" ||
          hostname.endsWith(
            ".wikipedia.org"
          )
        ) {

          if (
            !title.includes(
              normalizedQuery
            ) &&
            titleMatches === 0
          ) {
            score -= 250;
          }
        }


        // =================================================
        // VERY LOW RELEVANCE PENALTY
        // =================================================

        if (
          titleMatches === 0 &&
          descriptionMatches === 0 &&
          contentMatches === 0
        ) {

          score -= 500;
        }


        return {

          ...page,

          relevance_score:
            Number(
              score.toFixed(3)
            )
        };
      }
    );


  // ===================================================
  // SORT
  // ===================================================

  results.sort(
    (
      a,
      b
    ) => {

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
  // DEDUPLICATE
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
  // RETURN
  // ===================================================

  return uniqueResults
    .slice(
      0,
      20
    )
    .map(
      ({
        content,
        ...page
      }) =>
        page
    );
}


// =====================================================
// HTTP SERVER
// =====================================================

const server =
  http.createServer(
    async (
      req,
      res
    ) => {

      try {

        const url =
          new URL(
            req.url,
            `http://localhost:${PORT}`
          );


        // =================================================
        // HOME
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
                  "application/json; charset=utf-8"
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
                "application/json; charset=utf-8",

              "Access-Control-Allow-Origin":
                "*"
            }
          );


          res.end(
            JSON.stringify({
              query:
                q,

              count:
                results.length,

              results
            })
          );

          return;
        }


        // =================================================
        // STATIC FILES
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


        // =================================================
        // 404
        // =================================================

        res.writeHead(
          404,
          {
            "Content-Type":
              "application/json; charset=utf-8"
          }
        );


        res.end(
          JSON.stringify({
            error:
              "Not found"
          })
        );


      } catch (
        error
      ) {

        console.error(
          "[HEXORA SERVER ERROR]",
          error
        );


        if (
          !res.headersSent
        ) {

          res.writeHead(
            500,
            {
              "Content-Type":
                "application/json; charset=utf-8"
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
      "Worldwide crawler: ENABLED"
    );

    console.log(
      "Intelligent ranking: ENABLED"
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

    } catch (
      error
    ) {

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
  .catch(
    error => {

      console.error(
        "[HEXORA] Fatal crawler error:",
        error
      );

      process.exit(1);
    }
  );
