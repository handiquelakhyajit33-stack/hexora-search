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
  console.error(
    "ERROR: Supabase environment variables are missing."
  );
}

const supabase =
  SUPABASE_URL && SUPABASE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_KEY)
    : null;


/* =========================================================
   JSON RESPONSE
   ========================================================= */

function json(res, status, data) {
  const body = JSON.stringify(data);

  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store"
  });

  res.end(body);
}


/* =========================================================
   QUERY CLEANING
   ========================================================= */

function cleanQuery(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}


/* =========================================================
   TEXT NORMALIZATION
   ========================================================= */

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}


/* =========================================================
   TOKENIZER
   ========================================================= */

function tokenize(value) {
  return normalizeText(value)
    .split(/\s+/)
    .filter(word => word.length > 1);
}


/* =========================================================
   COUNT WORD OCCURRENCES
   ========================================================= */

function countOccurrences(text, term) {
  if (!text || !term) {
    return 0;
  }

  let count = 0;
  let position = 0;

  while (true) {
    const index = text.indexOf(term, position);

    if (index === -1) {
      break;
    }

    count++;

    position = index + term.length;
  }

  return count;
}


/* =========================================================
   WORD PROXIMITY
   ========================================================= */

function calculateProximityScore(text, queryWords) {
  if (!text || queryWords.length < 2) {
    return 0;
  }

  const words = tokenize(text);

  if (words.length === 0) {
    return 0;
  }

  const positions = [];

  for (const queryWord of queryWords) {
    const index = words.indexOf(queryWord);

    if (index !== -1) {
      positions.push(index);
    }
  }

  if (positions.length < 2) {
    return 0;
  }

  positions.sort((a, b) => a - b);

  const distance =
    positions[positions.length - 1] -
    positions[0];

  if (distance <= 3) {
    return 35;
  }

  if (distance <= 6) {
    return 25;
  }

  if (distance <= 12) {
    return 15;
  }

  if (distance <= 20) {
    return 8;
  }

  return 0;
}


/* =========================================================
   FIELD SCORING
   ========================================================= */

function calculateFieldScore(
  text,
  queryWords,
  exactQuery,
  weights
) {
  const normalized = normalizeText(text);

  if (!normalized) {
    return {
      score: 0,
      matchedWords: 0,
      occurrences: 0
    };
  }

  let score = 0;
  let matchedWords = 0;
  let occurrences = 0;

  for (const word of queryWords) {
    if (!word) {
      continue;
    }

    const count = countOccurrences(
      normalized,
      word
    );

    if (count > 0) {
      matchedWords++;

      occurrences += count;

      score += weights.word;

      if (count > 1) {
        score +=
          Math.min(count - 1, 5) *
          weights.repeat;
      }
    }
  }

  if (
    exactQuery &&
    normalized.includes(exactQuery)
  ) {
    score += weights.phrase;
  }

  return {
    score,
    matchedWords,
    occurrences
  };
}


/* =========================================================
   HEXORA ADVANCED RELEVANCE RANKING
   ========================================================= */

function calculateScore(page, query) {
  const normalizedQuery =
    normalizeText(query);

  if (!normalizedQuery) {
    return {
      score: 0,
      matchedWords: 0,
      coverage: 0,
      exactPhrase: false,
      titleMatches: 0,
      proximity: 0
    };
  }

  const queryWords =
    tokenize(normalizedQuery);

  const title =
    normalizeText(page.title);

  const description =
    normalizeText(page.description);

  const url =
    normalizeText(page.url);

  const content =
    normalizeText(page.content);

  let score = 0;


  /* =======================================================
     1. TITLE
     ======================================================= */

  const titleResult =
    calculateFieldScore(
      title,
      queryWords,
      normalizedQuery,
      {
        word: 55,
        repeat: 6,
        phrase: 100
      }
    );

  score += titleResult.score;


  /* Exact title */

  if (title === normalizedQuery) {
    score += 250;
  }


  /* Title starts with query */

  if (
    title.startsWith(
      normalizedQuery
    )
  ) {
    score += 80;
  }


  /* All query words found in title */

  if (
    queryWords.length > 1 &&
    titleResult.matchedWords ===
      queryWords.length
  ) {
    score += 100;
  }


  /* =======================================================
     2. DESCRIPTION
     ======================================================= */

  const descriptionResult =
    calculateFieldScore(
      description,
      queryWords,
      normalizedQuery,
      {
        word: 24,
        repeat: 3,
        phrase: 55
      }
    );

  score += descriptionResult.score;


  /* =======================================================
     3. URL / DOMAIN
     ======================================================= */

  const urlResult =
    calculateFieldScore(
      url,
      queryWords,
      normalizedQuery,
      {
        word: 18,
        repeat: 2,
        phrase: 40
      }
    );

  score += urlResult.score;


  /* =======================================================
     4. CONTENT
     ======================================================= */

  const contentResult =
    calculateFieldScore(
      content,
      queryWords,
      normalizedQuery,
      {
        word: 5,
        repeat: 1,
        phrase: 15
      }
    );

  /*
   * Content is useful, but must not overpower
   * title and description relevance.
   */

  score += Math.min(
    contentResult.score,
    80
  );


  /* =======================================================
     5. QUERY COVERAGE
     ======================================================= */

  const matchedSet =
    new Set();

  for (const word of queryWords) {
    if (
      title.includes(word) ||
      description.includes(word) ||
      url.includes(word) ||
      content.includes(word)
    ) {
      matchedSet.add(word);
    }
  }

  const matchedWords =
    matchedSet.size;

  const coverage =
    queryWords.length > 0
      ? matchedWords /
        queryWords.length
      : 0;


  if (coverage === 1) {
    score += 100;
  } else {
    score += Math.round(
      coverage * 60
    );
  }


  /* =======================================================
     6. EXACT PHRASE
     ======================================================= */

  let exactPhrase = false;

  if (
    title.includes(normalizedQuery) ||
    description.includes(normalizedQuery) ||
    url.includes(normalizedQuery) ||
    content.includes(normalizedQuery)
  ) {
    exactPhrase = true;

    score += 60;
  }


  /* =======================================================
     7. WORD PROXIMITY
     ======================================================= */

  const titleProximity =
    calculateProximityScore(
      title,
      queryWords
    );

  const descriptionProximity =
    calculateProximityScore(
      description,
      queryWords
    );

  const contentProximity =
    calculateProximityScore(
      content,
      queryWords
    );

  const proximity =
    Math.max(
      titleProximity,
      descriptionProximity,
      contentProximity
    );

  score += proximity;


  /* =======================================================
     8. FRESHNESS
     ======================================================= */

  const date =
    page.published_at ||
    page.updated_at ||
    page.last_crawled_at;

  if (date) {
    const timestamp =
      new Date(date).getTime();

    if (!Number.isNaN(timestamp)) {
      const ageDays =
        Math.max(
          0,
          Date.now() - timestamp
        ) / 86400000;

      /*
       * Freshness is intentionally small.
       * Relevance remains much more important.
       */

      if (ageDays < 1) {
        score += 8;
      } else if (ageDays < 7) {
        score += 5;
      } else if (ageDays < 30) {
        score += 3;
      }
    }
  }


  /* =======================================================
     9. HTTPS
     ======================================================= */

  if (
    String(page.url || "")
      .toLowerCase()
      .startsWith("https://")
  ) {
    score += 2;
  }


  /* =======================================================
     10. SMALL AUTHORITY SIGNAL
     ======================================================= */

  const lowerUrl =
    String(page.url || "")
      .toLowerCase();

  if (
    lowerUrl.includes(".gov.") ||
    lowerUrl.includes(".gov/") ||
    lowerUrl.includes(".edu.") ||
    lowerUrl.includes(".edu/")
  ) {
    score += 5;
  }


  return {
    score: Math.round(score),
    matchedWords,
    coverage,
    exactPhrase,
    titleMatches:
      titleResult.matchedWords,
    proximity
  };
}


/* =========================================================
   SEARCH
   ========================================================= */

async function searchWeb(
  query,
  pageNumber = 1,
  limit = 20
) {
  if (!supabase) {
    throw new Error(
      "Supabase is not configured."
    );
  }

  query = cleanQuery(query);

  pageNumber = Math.max(
    1,
    Number(pageNumber) || 1
  );

  limit = Math.min(
    50,
    Math.max(
      1,
      Number(limit) || 20
    )
  );


  if (!query) {
    return {
      engine: "HEXORA",
      query,
      results: [],
      total: 0,
      page: pageNumber,
      limit,
      total_pages: 0
    };
  }


  console.log(
    `[SEARCH_QUERY] ${query}`
  );


  let rows = [];


  /* =======================================================
     SUPABASE FULL TEXT SEARCH
     ======================================================= */

  const fullText =
    await supabase
      .from("pages")
      .select(`
        id,
        url,
        title,
        description,
        content,
        last_crawled_at,
        updated_at,
        published_at
      `)
      .textSearch(
        "search_vector",
        query,
        {
          type: "websearch",
          config: "simple"
        }
      )
      .limit(500);


  if (!fullText.error) {
    rows =
      fullText.data || [];
  } else {
    console.error(
      "[SEARCH_FTS_ERROR]",
      fullText.error.message
    );
  }


  console.log(
    `[SEARCH_LOCAL_INDEX_COUNT] ${rows.length}`
  );


  /* =======================================================
     FALLBACK SEARCH
     ======================================================= */

  if (rows.length === 0) {
    const safe =
      query
        .replace(/[%\\_,]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const pattern =
      `%${safe}%`;


    const fallback =
      await supabase
        .from("pages")
        .select(`
          id,
          url,
          title,
          description,
          content,
          last_crawled_at,
          updated_at,
          published_at
        `)
        .or(
          `title.ilike.${pattern},description.ilike.${pattern},url.ilike.${pattern},content.ilike.${pattern}`
        )
        .limit(500);


    if (fallback.error) {
      throw fallback.error;
    }


    rows =
      fallback.data || [];


    console.log(
      `[SEARCH_FALLBACK_COUNT] ${rows.length}`
    );
  }


  /* =======================================================
     REMOVE DUPLICATE URLS
     ======================================================= */

  const uniqueMap =
    new Map();

  for (const row of rows) {
    const normalizedUrl =
      String(row.url || "")
        .trim()
        .toLowerCase()
        .replace(/\/+$/, "");

    const key =
      normalizedUrl ||
      String(row.id);

    if (!uniqueMap.has(key)) {
      uniqueMap.set(
        key,
        row
      );
    }
  }

  const uniqueRows =
    Array.from(
      uniqueMap.values()
    );


  console.log(
    `[SEARCH_DEDUPED_COUNT] ${uniqueRows.length}`
  );


  /* =======================================================
     RANK
     ======================================================= */

  const ranked =
    uniqueRows
      .map(row => {
        const ranking =
          calculateScore(
            row,
            query
          );

        return {
          ...row,

          hexora_score:
            ranking.score,

          matched_words:
            ranking.matchedWords,

          coverage:
            ranking.coverage,

          exact_phrase:
            ranking.exactPhrase,

          title_matches:
            ranking.titleMatches,

          proximity:
            ranking.proximity
        };
      })


      /* Only remove zero relevance */
      .filter(row => {
        return row.hexora_score > 0;
      })


      /* =====================================================
         FINAL SORT
         ===================================================== */

      .sort((a, b) => {

        /* 1. Overall relevance */

        if (
          b.hexora_score !==
          a.hexora_score
        ) {
          return (
            b.hexora_score -
            a.hexora_score
          );
        }


        /* 2. Exact phrase */

        if (
          b.exact_phrase !==
          a.exact_phrase
        ) {
          return (
            Number(b.exact_phrase) -
            Number(a.exact_phrase)
          );
        }


        /* 3. Query coverage */

        if (
          b.coverage !==
          a.coverage
        ) {
          return (
            b.coverage -
            a.coverage
          );
        }


        /* 4. Title matches */

        if (
          b.title_matches !==
          a.title_matches
        ) {
          return (
            b.title_matches -
            a.title_matches
          );
        }


        /* 5. Proximity */

        if (
          b.proximity !==
          a.proximity
        ) {
          return (
            b.proximity -
            a.proximity
          );
        }


        /* 6. Matched words */

        if (
          b.matched_words !==
          a.matched_words
        ) {
          return (
            b.matched_words -
            a.matched_words
          );
        }


        /* 7. Stable alphabetical fallback */

        return String(
          a.title || ""
        ).localeCompare(
          String(
            b.title || ""
          ),
          undefined,
          {
            sensitivity: "base"
          }
        );
      });


  console.log(
    `[SEARCH_RANKED_COUNT] ${ranked.length}`
  );


  /* =======================================================
     PAGINATION
     ======================================================= */

  const total =
    ranked.length;

  const start =
    (pageNumber - 1) *
    limit;

  const results =
    ranked
      .slice(
        start,
        start + limit
      )
      .map(row => ({
        id: row.id,

        url: row.url,

        title:
          row.title ||
          row.url,

        description:
          row.description ||
          String(
            row.content || ""
          ).slice(
            0,
            240
          ),

        score:
          row.hexora_score,

        matched_words:
          row.matched_words,

        coverage:
          Number(
            row.coverage.toFixed(3)
          ),

        exact_phrase:
          row.exact_phrase,

        last_crawled_at:
          row.last_crawled_at
      }));


  console.log(
    `[SEARCH_FINAL_COUNT] ${results.length}`
  );


  return {
    engine:
      "HEXORA Independent Search Engine",

    query,

    results,

    total,

    page:
      pageNumber,

    limit,

    total_pages:
      Math.ceil(
        total / limit
      )
  };
}


/* =========================================================
   NEWS
   ========================================================= */

async function getNews() {
  if (!supabase) {
    return [];
  }

  const {
    data,
    error
  } = await supabase
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
      {
        ascending: false
      }
    )
    .limit(30);


  if (error) {
    throw error;
  }


  return data || [];
}


/* =========================================================
   STATIC FILE MIME TYPES
   ========================================================= */

const MIME = {
  ".html":
    "text/html; charset=utf-8",

  ".js":
    "text/javascript; charset=utf-8",

  ".css":
    "text/css; charset=utf-8",

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
    "image/webp",

  ".ico":
    "image/x-icon"
};


/* =========================================================
   SEND STATIC FILE
   ========================================================= */

function sendFile(
  res,
  filePath
) {
  if (
    !fs.existsSync(
      filePath
    )
  ) {
    return false;
  }


  if (
    !fs.statSync(
      filePath
    ).isFile()
  ) {
    return false;
  }


  const ext =
    path.extname(
      filePath
    ).toLowerCase();


  res.writeHead(
    200,
    {
      "Content-Type":
        MIME[ext] ||
        "application/octet-stream"
    }
  );


  res.end(
    fs.readFileSync(
      filePath
    )
  );


  return true;
}


/* =========================================================
   HTTP SERVER
   ========================================================= */

const server =
  http.createServer(
    async (
      req,
      res
    ) => {

      try {

        const requestUrl =
          new URL(
            req.url,
            `http://${
              req.headers.host ||
              "localhost"
            }`
          );


        /* =================================================
           HEALTH
           ================================================= */

        if (
          requestUrl.pathname ===
            "/api/health" ||
          requestUrl.pathname ===
            "/health"
        ) {

          return json(
            res,
            200,
            {
              ok: true,

              engine:
                "HEXORA Independent Search Engine",

              database:
                Boolean(
                  supabase
                ),

              crawler:
                "Railway Worker",

              timestamp:
                new Date()
                  .toISOString()
            }
          );
        }


        /* =================================================
           SEARCH
           ================================================= */

        if (
          requestUrl.pathname ===
            "/api/search" ||
          requestUrl.pathname ===
            "/search"
        ) {

          const query =
            requestUrl.searchParams
              .get("q") ||
            "";


          const page =
            Math.max(
              1,
              Number(
                requestUrl
                  .searchParams
                  .get("page") ||
                  1
              )
            );


          const limit =
            Math.min(
              50,
              Math.max(
                1,
                Number(
                  requestUrl
                    .searchParams
                    .get(
                      "limit"
                    ) ||
                    20
                )
              )
            );


          const result =
            await searchWeb(
              query,
              page,
              limit
            );


          return json(
            res,
            200,
            result
          );
        }


        /* =================================================
           NEWS
           ================================================= */

        if (
          requestUrl.pathname ===
            "/api/news" ||
          requestUrl.pathname ===
            "/news"
        ) {

          return json(
            res,
            200,
            {
              items:
                await getNews()
            }
          );
        }


        /* =================================================
           STATIC WEBSITE
           ================================================= */

        let requested =
          decodeURIComponent(
            requestUrl.pathname
          );


        if (
          requested === "/"
        ) {
          requested =
            "/index.html";
        }


        const requestedFile =
          path.resolve(
            __dirname,
            "." + requested
          );


        const projectRoot =
          path.resolve(
            __dirname
          );


        if (
          requestedFile.startsWith(
            projectRoot +
              path.sep
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


        /* =================================================
           SPA FALLBACK
           ================================================= */

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


        /* =================================================
           404
           ================================================= */

        res.writeHead(
          404,
          {
            "Content-Type":
              "text/plain; charset=utf-8"
          }
        );


        res.end(
          "HEXORA page not found."
        );

      } catch (error) {

        console.error(
          "HEXORA server error:",
          error
        );


        if (
          !res.headersSent
        ) {

          json(
            res,
            500,
            {
              error:
                "HEXORA server error",

              message:
                String(
                  error?.message ||
                  error
                )
            }
          );

        } else {

          res.end();
        }
      }
    }
  );


/* =========================================================
   START SERVER
   ========================================================= */

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

    console.log(
      "Advanced relevance ranking enabled."
    );
  }
);
