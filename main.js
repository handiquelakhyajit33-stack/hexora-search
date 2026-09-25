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
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or Supabase key");
}

const supabase = createClient(
  SUPABASE_URL || "",
  SUPABASE_KEY || ""
);

/* -------------------------------------------------------
   BASIC HELPERS
------------------------------------------------------- */

function cleanQuery(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  return normalizeText(value)
    .split(" ")
    .map(x => x.trim())
    .filter(Boolean);
}

function uniqueTokens(value) {
  return [...new Set(tokenize(value))];
}

function countWholeWordOccurrences(text, word) {
  const source = normalizeText(text);
  const target = normalizeText(word);

  if (!source || !target) return 0;

  return source
    .split(" ")
    .filter(part => part === target)
    .length;
}

function hasWholeWord(text, word) {
  return countWholeWordOccurrences(text, word) > 0;
}

function hasExactPhrase(text, phrase) {
  const source = normalizeText(text);
  const target = normalizeText(phrase);

  if (!source || !target) return false;

  return source.includes(target);
}

function calculateProximityScore(page, query) {
  const words = uniqueTokens(query);

  if (words.length <= 1) return 0;

  const title = tokenize(page.title);
  const description = tokenize(page.description);

  let score = 0;

  for (let i = 0; i < words.length - 1; i++) {
    const a = words[i];
    const b = words[i + 1];

    const titleA = title.indexOf(a);
    const titleB = title.indexOf(b);

    if (titleA !== -1 && titleB !== -1) {
      const distance = Math.abs(titleA - titleB);

      if (distance === 1) score += 80;
      else if (distance <= 3) score += 35;
      else score += 10;
    }

    const descA = description.indexOf(a);
    const descB = description.indexOf(b);

    if (descA !== -1 && descB !== -1) {
      const distance = Math.abs(descA - descB);

      if (distance === 1) score += 20;
      else if (distance <= 5) score += 8;
    }
  }

  return score;
}

function calculateAuthorityBonus(page) {
  let score = 0;

  const url = String(page.url || "").toLowerCase();

  const authority = Number(page.authority_score || 0);
  const popularity = Number(page.popularity_score || 0);

  if (Number.isFinite(authority)) {
    score += Math.min(authority, 100) * 0.8;
  }

  if (Number.isFinite(popularity)) {
    score += Math.min(popularity, 100) * 0.4;
  }

  if (url.startsWith("https://")) {
    score += 2;
  }

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

function calculateFreshnessBonus(dateValue) {
  if (!dateValue) return 0;

  const time = new Date(dateValue).getTime();

  if (!Number.isFinite(time)) return 0;

  const ageDays =
    (Date.now() - time) / (1000 * 60 * 60 * 24);

  if (ageDays < 1) return 30;
  if (ageDays < 3) return 20;
  if (ageDays < 7) return 12;
  if (ageDays < 30) return 6;

  return 0;
}

function isShortQuery(query) {
  const words = uniqueTokens(query);

  return (
    words.length === 1 &&
    words[0].length <= 2
  );
}

function hasStrictShortQueryMatch(page, query) {
  const word = normalizeText(query);

  if (!word) return false;

  return (
    hasWholeWord(page.title, word) ||
    hasWholeWord(page.description, word) ||
    hasWholeWord(page.url, word)
  );
}

function detectMode(mode) {
  const value = String(mode || "web").toLowerCase();

  const allowed = [
    "web",
    "images",
    "news",
    "videos",
    "maps"
  ];

  return allowed.includes(value)
    ? value
    : "web";
}

/* -------------------------------------------------------
   WEB RANKING
------------------------------------------------------- */

function calculateScore(page, query) {
  const words = uniqueTokens(query);

  const title = page.title || "";
  const description = page.description || "";
  const content = page.content || "";
  const url = page.url || "";

  let score = 0;

  let matchedWords = 0;

  for (const word of words) {
    let matched = false;

    const titleCount = countWholeWordOccurrences(
      title,
      word
    );

    const descriptionCount =
      countWholeWordOccurrences(
        description,
        word
      );

    const urlCount =
      countWholeWordOccurrences(
        url,
        word
      );

    const contentCount =
      countWholeWordOccurrences(
        content,
        word
      );

    if (titleCount > 0) {
      matched = true;

      score += 80;
      score += Math.min(titleCount, 5) * 5;
    }

    if (descriptionCount > 0) {
      matched = true;

      score += 30;
      score += Math.min(descriptionCount, 3) * 3;
    }

    if (urlCount > 0) {
      matched = true;

      score += 12;
      score += Math.min(urlCount, 2);
    }

    if (contentCount > 0) {
      matched = true;

      score += 3;
      score += Math.min(contentCount, 50);
    }

    if (matched) {
      matchedWords++;
    }
  }

  const queryPhrase = normalizeText(query);

  if (hasExactPhrase(title, queryPhrase)) {
    score += 180;
  }

  if (hasExactPhrase(description, queryPhrase)) {
    score += 70;
  }

  if (hasExactPhrase(url, queryPhrase)) {
    score += 25;
  }

  if (
    normalizeText(title) === queryPhrase &&
    queryPhrase
  ) {
    score += 400;
  }

  if (
    normalizeText(title).startsWith(queryPhrase) &&
    queryPhrase
  ) {
    score += 120;
  }

  if (
    words.length > 1 &&
    words.every(word =>
      hasWholeWord(title, word)
    )
  ) {
    score += 180;
  }

  const coverage =
    words.length > 0
      ? matchedWords / words.length
      : 0;

  score += coverage * 100;

  score += calculateProximityScore(
    page,
    query
  );

  if (
    words.length === 1 &&
    matchedWords === 1 &&
    !hasWholeWord(title, words[0]) &&
    !hasWholeWord(description, words[0]) &&
    !hasWholeWord(url, words[0])
  ) {
    score -= 100;
  }

  if (
    words.length > 1 &&
    coverage < 1
  ) {
    score -= (1 - coverage) * 100;
  }

  score += calculateFreshnessBonus(
    page.published_at ||
    page.updated_at ||
    page.last_crawled_at
  );

  score += calculateAuthorityBonus(page);

  return {
    score,
    matchedWords,
    coverage
  };
}

/* -------------------------------------------------------
   WEB SEARCH
------------------------------------------------------- */

async function searchWeb(
  query,
  pageNumber = 1,
  limit = 20,
  mode = "web"
) {
  query = cleanQuery(query);
  mode = detectMode(mode);

  if (!query) {
    return {
      ok: true,
      mode,
      query,
      total: 0,
      page: pageNumber,
      limit,
      results: []
    };
  }

  let rows = [];

  const { data, error } = await supabase
    .from("pages")
    .select(`
      id,
      url,
      title,
      description,
      content,
      author,
      image_url,
      published_at,
      last_crawled_at,
      updated_at,
      authority_score,
      popularity_score
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

  if (!error && Array.isArray(data)) {
    rows = data;
  }

  if (!rows.length) {
    const safe = query
      .replace(/[%_]/g, " ")
      .trim();

    const { data: fallbackData } =
      await supabase
        .from("pages")
        .select(`
          id,
          url,
          title,
          description,
          content,
          author,
          image_url,
          published_at,
          last_crawled_at,
          updated_at,
          authority_score,
          popularity_score
        `)
        .or(
          `title.ilike.%${safe}%,description.ilike.%${safe}%,url.ilike.%${safe}%,content.ilike.%${safe}%`
        )
        .limit(500);

    if (Array.isArray(fallbackData)) {
      rows = fallbackData;
    }
  }

  const seen = new Set();

  rows = rows.filter(row => {
    const key =
      String(row.url || "").trim() ||
      String(row.id || "");

    if (seen.has(key)) return false;

    seen.add(key);

    return true;
  });

  /* Short query protection.
     Example:
     AI must not match Aiuto only.
  */

  if (isShortQuery(query)) {
    rows = rows.filter(row =>
      hasStrictShortQueryMatch(
        row,
        query
      )
    );
  }

  /* IMAGE MODE */

  if (mode === "images") {
    rows = rows.filter(row =>
      Boolean(
        String(row.image_url || "").trim()
      )
    );
  }

  /* VIDEO MODE */

  if (mode === "videos") {
    rows = rows.filter(row => {
      const text = normalizeText(
        `${row.title || ""} ${
          row.description || ""
        } ${row.url || ""} ${
          row.content || ""
        }`
      );

      const url = String(
        row.url || ""
      ).toLowerCase();

      return (
        url.includes("youtube.com") ||
        url.includes("youtu.be") ||
        url.includes("vimeo.com") ||
        text.includes(" video ") ||
        text.startsWith("video ") ||
        text.endsWith(" video")
      );
    });
  }

  /* MAP / PLACE MODE */

  if (mode === "maps") {
    rows = rows.filter(row => {
      const text = normalizeText(
        `${row.title || ""} ${
          row.description || ""
        } ${row.url || ""}`
      );

      return (
        text.includes("map") ||
        text.includes("maps") ||
        text.includes("location") ||
        text.includes("place") ||
        text.includes("address") ||
        text.includes("district") ||
        text.includes("city") ||
        text.includes("town") ||
        text.includes("village")
      );
    });
  }

  const ranked = rows
    .map(row => {
      const ranking =
        calculateScore(row, query);

      return {
        ...row,
        ...ranking
      };
    })
    .filter(row => row.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return String(
        a.title || ""
      ).localeCompare(
        String(b.title || "")
      );
    });

  const total = ranked.length;

  const start =
    (pageNumber - 1) * limit;

  const results =
    ranked.slice(
      start,
      start + limit
    );

  return {
    ok: true,
    mode,
    query,
    total,
    page: pageNumber,
    limit,
    results: results.map(row => ({
      id: row.id,
      url: row.url,
      title: row.title,
      description: row.description,
      author: row.author,
      image_url: row.image_url,
      published_at: row.published_at,
      last_crawled_at:
        row.last_crawled_at,
      score: Math.round(row.score * 100) / 100,
      matched_words: row.matchedWords,
      coverage: row.coverage
    }))
  };
}

/* -------------------------------------------------------
   NEWS SEARCH
------------------------------------------------------- */

function calculateNewsScore(item, query) {
  const words = uniqueTokens(query);

  const title = item.title || "";
  const description =
    item.description || "";
  const source =
    item.source_name || "";

  let score = 0;
  let matched = 0;

  for (const word of words) {
    let found = false;

    if (hasWholeWord(title, word)) {
      score += 120;
      found = true;
    }

    if (
      hasWholeWord(
        description,
        word
      )
    ) {
      score += 35;
      found = true;
    }

    if (
      hasWholeWord(
        source,
        word
      )
    ) {
      score += 20;
      found = true;
    }

    if (found) matched++;
  }

  const phrase =
    normalizeText(query);

  if (
    hasExactPhrase(
      title,
      phrase
    )
  ) {
    score += 220;
  }

  if (
    normalizeText(title) === phrase
  ) {
    score += 300;
  }

  score +=
    calculateFreshnessBonus(
      item.published_at ||
      item.fetched_at
    );

  const coverage =
    words.length
      ? matched / words.length
      : 0;

  score += coverage * 100;

  return {
    score,
    coverage,
    matchedWords: matched
  };
}

async function searchNews(
  query,
  pageNumber = 1,
  limit = 20
) {
  query = cleanQuery(query);

  let rows = [];

  const { data, error } =
    await supabase
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
          ascending: false,
          nullsFirst: false
        }
      )
      .limit(500);

  if (!error && Array.isArray(data)) {
    rows = data;
  }

  const queryWords =
    uniqueTokens(query);

  if (queryWords.length) {
    rows = rows.filter(item => {
      const text = normalizeText(
        `${item.title || ""} ${
          item.description || ""
        } ${item.source_name || ""}`
      );

      return queryWords.some(word =>
        hasWholeWord(text, word)
      );
    });
  }

  const ranked = rows
    .map(item => ({
      ...item,
      ...calculateNewsScore(
        item,
        query
      )
    }))
    .sort((a, b) =>
      b.score - a.score
    );

  const total = ranked.length;

  const start =
    (pageNumber - 1) * limit;

  const results =
    ranked.slice(
      start,
      start + limit
    );

  return {
    ok: true,
    mode: "news",
    query,
    total,
    page: pageNumber,
    limit,
    results
  };
}

/* -------------------------------------------------------
   HTTP SERVER
------------------------------------------------------- */

function jsonResponse(
  res,
  status,
  data
) {
  const body =
    JSON.stringify(data);

  res.writeHead(
    status,
    {
      "Content-Type":
        "application/json; charset=utf-8",
      "Cache-Control":
        "no-store"
    }
  );

  res.end(body);
}

function sendFile(
  res,
  filePath
) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }

  const ext =
    path.extname(filePath)
      .toLowerCase();

  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon"
  };

  res.writeHead(
    200,
    {
      "Content-Type":
        types[ext] ||
        "application/octet-stream"
    }
  );

  fs.createReadStream(
    filePath
  ).pipe(res);
}

const server =
  http.createServer(
    async (req, res) => {
      try {
        const requestUrl =
          new URL(
            req.url,
            `http://${req.headers.host || "localhost"}`
          );

        const pathname =
          requestUrl.pathname;

        /* HEALTH */

        if (
          pathname ===
            "/api/health" ||
          pathname === "/health"
        ) {
          return jsonResponse(
            res,
            200,
            {
              ok: true,
              service: "HEXORA",
              index: "Supabase",
              status: "online"
            }
          );
        }

        /* SEARCH */

        if (
          pathname ===
            "/api/search" ||
          pathname === "/search"
        ) {
          const query =
            requestUrl.searchParams.get(
              "q"
            ) || "";

          const mode =
            requestUrl.searchParams.get(
              "mode"
            ) || "web";

          const page =
            Math.max(
              1,
              Number(
                requestUrl.searchParams.get(
                  "page"
                ) || 1
              )
            );

          const limit =
            Math.min(
              50,
              Math.max(
                1,
                Number(
                  requestUrl.searchParams.get(
                    "limit"
                  ) || 20
                )
              )
            );

          if (
            detectMode(mode) ===
            "news"
          ) {
            const result =
              await searchNews(
                query,
                page,
                limit
              );

            return jsonResponse(
              res,
              200,
              result
            );
          }

          const result =
            await searchWeb(
              query,
              page,
              limit,
              mode
            );

          return jsonResponse(
            res,
            200,
            result
          );
        }

        /* NEWS */

        if (
          pathname ===
            "/api/news" ||
          pathname === "/news"
        ) {
          const result =
            await searchNews(
              "",
              1,
              30
            );

          return jsonResponse(
            res,
            200,
            result
          );
        }

        /* STATIC FILES */

        let filePath;

        if (pathname === "/") {
          filePath =
            path.join(
              __dirname,
              "index.html"
            );
        } else {
          const requested =
            decodeURIComponent(
              pathname
            );

          filePath =
            path.join(
              __dirname,
              requested
            );
        }

        if (
          fs.existsSync(
            filePath
          ) &&
          fs.statSync(
            filePath
          ).isFile()
        ) {
          return sendFile(
            res,
            filePath
          );
        }

        /* SPA FALLBACK */

        const indexFile =
          path.join(
            __dirname,
            "index.html"
          );

        if (
          fs.existsSync(indexFile)
        ) {
          return sendFile(
            res,
            indexFile
          );
        }

        res.writeHead(404);
        res.end("Not Found");
      } catch (error) {
        console.error(
          "Server error:",
          error
        );

        return jsonResponse(
          res,
          500,
          {
            ok: false,
            error:
              "HEXORA server error"
          }
        );
      }
    }
  );

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `HEXORA search server running on port ${PORT}`
    );
  }
);
