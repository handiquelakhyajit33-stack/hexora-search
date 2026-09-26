import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* =======================================================
   CONFIG
======================================================= */

const PORT = Number(process.env.PORT || 8080);

const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    "[HEXORA] Missing SUPABASE_URL or Supabase key"
  );
}

const supabase = createClient(
  SUPABASE_URL || "",
  SUPABASE_KEY || ""
);

/* =======================================================
   BASIC HELPERS
======================================================= */

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

function countWholeWordOccurrences(
  text,
  word
) {
  const source =
    normalizeText(text);

  const target =
    normalizeText(word);

  if (!source || !target) {
    return 0;
  }

  return source
    .split(" ")
    .filter(
      part => part === target
    )
    .length;
}

function hasWholeWord(
  text,
  word
) {
  return (
    countWholeWordOccurrences(
      text,
      word
    ) > 0
  );
}

function hasExactPhrase(
  text,
  phrase
) {
  const source =
    normalizeText(text);

  const target =
    normalizeText(phrase);

  if (!source || !target) {
    return false;
  }

  return source.includes(target);
}

function detectMode(mode) {
  const value =
    String(mode || "web")
      .toLowerCase();

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

/* =======================================================
   WEB RANKING
======================================================= */

function calculateProximityScore(
  page,
  query
) {
  const words =
    uniqueTokens(query);

  if (words.length <= 1) {
    return 0;
  }

  const title =
    tokenize(page.title);

  const description =
    tokenize(page.description);

  let score = 0;

  for (
    let i = 0;
    i < words.length - 1;
    i++
  ) {
    const a = words[i];
    const b = words[i + 1];

    const titleA =
      title.indexOf(a);

    const titleB =
      title.indexOf(b);

    if (
      titleA !== -1 &&
      titleB !== -1
    ) {
      const distance =
        Math.abs(
          titleA - titleB
        );

      if (distance === 1) {
        score += 80;
      } else if (
        distance <= 3
      ) {
        score += 35;
      } else {
        score += 10;
      }
    }

    const descA =
      description.indexOf(a);

    const descB =
      description.indexOf(b);

    if (
      descA !== -1 &&
      descB !== -1
    ) {
      const distance =
        Math.abs(
          descA - descB
        );

      if (distance === 1) {
        score += 20;
      } else if (
        distance <= 5
      ) {
        score += 8;
      }
    }
  }

  return score;
}

function calculateAuthorityBonus(
  page
) {
  let score = 0;

  const url =
    String(page.url || "")
      .toLowerCase();

  const authority =
    Number(
      page.authority_score || 0
    );

  const popularity =
    Number(
      page.popularity_score || 0
    );

  if (
    Number.isFinite(authority)
  ) {
    score +=
      Math.min(
        authority,
        100
      ) * 0.8;
  }

  if (
    Number.isFinite(popularity)
  ) {
    score +=
      Math.min(
        popularity,
        100
      ) * 0.4;
  }

  if (
    url.startsWith(
      "https://"
    )
  ) {
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

function calculateFreshnessBonus(
  dateValue
) {
  if (!dateValue) {
    return 0;
  }

  const time =
    new Date(
      dateValue
    ).getTime();

  if (
    !Number.isFinite(time)
  ) {
    return 0;
  }

  const ageDays =
    (Date.now() - time) /
    (1000 * 60 * 60 * 24);

  if (ageDays < 1) {
    return 30;
  }

  if (ageDays < 3) {
    return 20;
  }

  if (ageDays < 7) {
    return 12;
  }

  if (ageDays < 30) {
    return 6;
  }

  return 0;
}

function isShortQuery(
  query
) {
  const words =
    uniqueTokens(query);

  return (
    words.length === 1 &&
    words[0].length <= 2
  );
}

function hasStrictShortQueryMatch(
  page,
  query
) {
  const word =
    normalizeText(query);

  if (!word) {
    return false;
  }

  return (
    hasWholeWord(
      page.title,
      word
    ) ||
    hasWholeWord(
      page.description,
      word
    ) ||
    hasWholeWord(
      page.url,
      word
    )
  );
}

function calculateScore(
  page,
  query
) {
  const words =
    uniqueTokens(query);

  const title =
    page.title || "";

  const description =
    page.description || "";

  const content =
    page.content || "";

  const url =
    page.url || "";

  let score = 0;

  let matchedWords = 0;

  for (
    const word of words
  ) {
    let matched = false;

    const titleCount =
      countWholeWordOccurrences(
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

    if (
      titleCount > 0
    ) {
      matched = true;

      score += 80;

      score +=
        Math.min(
          titleCount,
          5
        ) * 5;
    }

    if (
      descriptionCount > 0
    ) {
      matched = true;

      score += 30;

      score +=
        Math.min(
          descriptionCount,
          3
        ) * 3;
    }

    if (
      urlCount > 0
    ) {
      matched = true;

      score += 12;

      score +=
        Math.min(
          urlCount,
          2
        );
    }

    if (
      contentCount > 0
    ) {
      matched = true;

      score += 3;

      score +=
        Math.min(
          contentCount,
          50
        );
    }

    if (matched) {
      matchedWords++;
    }
  }

  const queryPhrase =
    normalizeText(query);

  if (
    hasExactPhrase(
      title,
      queryPhrase
    )
  ) {
    score += 180;
  }

  if (
    hasExactPhrase(
      description,
      queryPhrase
    )
  ) {
    score += 70;
  }

  if (
    hasExactPhrase(
      url,
      queryPhrase
    )
  ) {
    score += 25;
  }

  if (
    normalizeText(title) ===
      queryPhrase &&
    queryPhrase
  ) {
    score += 400;
  }

  if (
    normalizeText(
      title
    ).startsWith(
      queryPhrase
    ) &&
    queryPhrase
  ) {
    score += 120;
  }

  if (
    words.length > 1 &&
    words.every(
      word =>
        hasWholeWord(
          title,
          word
        )
    )
  ) {
    score += 180;
  }

  const coverage =
    words.length > 0
      ? matchedWords /
        words.length
      : 0;

  score +=
    coverage * 100;

  score +=
    calculateProximityScore(
      page,
      query
    );

  if (
    words.length === 1 &&
    matchedWords === 1 &&
    !hasWholeWord(
      title,
      words[0]
    ) &&
    !hasWholeWord(
      description,
      words[0]
    ) &&
    !hasWholeWord(
      url,
      words[0]
    )
  ) {
    score -= 100;
  }

  if (
    words.length > 1 &&
    coverage < 1
  ) {
    score -=
      (1 - coverage) * 100;
  }

  score +=
    calculateFreshnessBonus(
      page.published_at ||
        page.updated_at ||
        page.last_crawled_at
    );

  score +=
    calculateAuthorityBonus(
      page
    );

  return {
    score,
    matchedWords,
    coverage
  };
}

/* =======================================================
   WEB SEARCH
======================================================= */

async function searchWeb(
  query,
  pageNumber = 1,
  limit = 20
) {
  query =
    cleanQuery(query);

  if (!query) {
    return {
      ok: true,
      mode: "web",
      query,
      total: 0,
      page: pageNumber,
      limit,
      results: []
    };
  }

  console.log(
    `[HEXORA SEARCH] query="${query}" page=${pageNumber} limit=${limit}`
  );

  let rows = [];

  /* =====================================================
     STEP 1: POSTGRES FULL TEXT SEARCH
  ===================================================== */

  try {
    const {
      data,
      error
    } =
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
        .textSearch(
          "search_vector",
          query,
          {
            type: "websearch",
            config: "english"
          }
        )
        .limit(500);

    if (error) {
      console.error(
        "[HEXORA FTS ERROR]",
        error
      );
    } else if (
      Array.isArray(data)
    ) {
      rows = data;

      console.log(
        `[HEXORA FTS] ${rows.length} rows found`
      );
    }
  } catch (error) {
    console.error(
      "[HEXORA FTS EXCEPTION]",
      error
    );
  }

  /* =====================================================
     STEP 2: SAFE FALLBACK
  ===================================================== */

  if (!rows.length) {
    try {
      const words =
        uniqueTokens(query)
          .filter(
            word =>
              word.length >= 2
          )
          .slice(0, 8);

      if (words.length) {
        const orParts = [];

        for (
          const word of words
        ) {
          const safeWord =
            word
              .replace(
                /[%_,().]/g,
                " "
              )
              .replace(
                /\s+/g,
                " "
              )
              .trim();

          if (!safeWord) {
            continue;
          }

          orParts.push(
            `title.ilike.%${safeWord}%`
          );

          orParts.push(
            `description.ilike.%${safeWord}%`
          );

          orParts.push(
            `url.ilike.%${safeWord}%`
          );
        }

        if (orParts.length) {
          const {
            data:
              fallbackData,
            error:
              fallbackError
          } =
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
                orParts.join(",")
              )
              .limit(500);

          if (
            fallbackError
          ) {
            console.error(
              "[HEXORA FALLBACK ERROR]",
              fallbackError
            );
          } else if (
            Array.isArray(
              fallbackData
            )
          ) {
            rows =
              fallbackData;

            console.log(
              `[HEXORA FALLBACK] ${rows.length} rows found`
            );
          }
        }
      }
    } catch (error) {
      console.error(
        "[HEXORA FALLBACK EXCEPTION]",
        error
      );
    }
  }

  /* =====================================================
     STEP 3: DEDUPLICATE
  ===================================================== */

  const seen =
    new Set();

  rows =
    rows.filter(row => {
      const key =
        String(
          row.url || ""
        ).trim() ||
        String(
          row.id || ""
        );

      if (!key) {
        return false;
      }

      if (
        seen.has(key)
      ) {
        return false;
      }

      seen.add(key);

      return true;
    });

  /* =====================================================
     STEP 4: SHORT QUERY PROTECTION
  ===================================================== */

  if (
    isShortQuery(query)
  ) {
    rows =
      rows.filter(row =>
        hasStrictShortQueryMatch(
          row,
          query
        )
      );
  }

  /* =====================================================
     STEP 5: RANKING
  ===================================================== */

  const ranked =
    rows
      .map(row => ({
        ...row,
        ...calculateScore(
          row,
          query
        )
      }))
      .filter(
        row =>
          row.score > 0
      )
      .sort((a, b) => {
        if (
          b.score !==
          a.score
        ) {
          return (
            b.score -
            a.score
          );
        }

        return String(
          a.title || ""
        ).localeCompare(
          String(
            b.title || ""
          )
        );
      });

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
          "Untitled",

        description:
          row.description ||
          "",

        author:
          row.author ||
          null,

        image_url:
          row.image_url ||
          null,

        published_at:
          row.published_at ||
          null,

        last_crawled_at:
          row.last_crawled_at ||
          null,

        score:
          Math.round(
            row.score * 100
          ) / 100,

        matched_words:
          row.matchedWords,

        coverage:
          row.coverage
      }));

  console.log(
    `[HEXORA RESULT] query="${query}" total=${total} returned=${results.length}`
  );

  return {
    ok: true,
    mode: "web",
    query,
    total,
    page: pageNumber,
    limit,
    results
  };
}

/* =======================================================
   IMAGE SEARCH
======================================================= */

function calculateImageScore(
  item,
  query
) {
  const words =
    uniqueTokens(query);

  const text =
    normalizeText(
      `${item.title || ""} ${
        item.alt_text || ""
      } ${
        item.source_domain || ""
      } ${
        item.page_url || ""
      }`
    );

  let score = 0;
  let matched = 0;

  for (
    const word of words
  ) {
    if (
      hasWholeWord(
        text,
        word
      )
    ) {
      matched++;
      score += 50;
    }
  }

  if (
    query &&
    hasExactPhrase(
      item.title,
      query
    )
  ) {
    score += 100;
  }

  if (
    query &&
    hasExactPhrase(
      item.alt_text,
      query
    )
  ) {
    score += 70;
  }

  const coverage =
    words.length
      ? matched /
        words.length
      : 0;

  score +=
    coverage * 100;

  return {
    score,
    matchedWords: matched,
    coverage
  };
}

async function searchImages(
  query,
  pageNumber = 1,
  limit = 20
) {
  query =
    cleanQuery(query);

  let rows = [];

  const {
    data,
    error
  } =
    await supabase
      .from("images")
      .select(`
        id,
        page_url,
        image_url,
        alt_text,
        title,
        source_domain,
        created_at,
        updated_at
      `)
      .limit(1000);

  if (error) {
    console.error(
      "Image search error:",
      error
    );

    return {
      ok: false,
      mode: "images",
      query,
      total: 0,
      page: pageNumber,
      limit,
      results: [],
      error:
        "Image search failed"
    };
  }

  if (
    Array.isArray(data)
  ) {
    rows = data;
  }

  const words =
    uniqueTokens(query);

  if (words.length) {
    rows =
      rows.filter(item => {
        const text =
          normalizeText(
            `${item.title || ""} ${
              item.alt_text || ""
            } ${
              item.source_domain ||
              ""
            } ${
              item.page_url || ""
            }`
          );

        return words.some(
          word =>
            hasWholeWord(
              text,
              word
            )
        );
      });
  }

  const ranked =
    rows
      .map(item => ({
        ...item,
        ...calculateImageScore(
          item,
          query
        )
      }))
      .sort(
        (a, b) =>
          b.score -
          a.score
      );

  const total =
    ranked.length;

  const start =
    (pageNumber - 1) *
    limit;

  const results =
    ranked.slice(
      start,
      start + limit
    );

  return {
    ok: true,
    mode: "images",
    query,
    total,
    page: pageNumber,
    limit,
    results
  };
}

/* =======================================================
   VIDEO SEARCH
======================================================= */

function calculateVideoScore(
  item,
  query
) {
  const words =
    uniqueTokens(query);

  const text =
    normalizeText(
      `${item.title || ""} ${
        item.description || ""
      } ${
        item.source_domain || ""
      } ${
        item.page_url || ""
      }`
    );

  let score = 0;
  let matched = 0;

  for (
    const word of words
  ) {
    if (
      hasWholeWord(
        text,
        word
      )
    ) {
      matched++;
      score += 60;
    }
  }

  if (
    query &&
    hasExactPhrase(
      item.title,
      query
    )
  ) {
    score += 120;
  }

  if (
    query &&
    hasExactPhrase(
      item.description,
      query
    )
  ) {
    score += 60;
  }

  const coverage =
    words.length
      ? matched /
        words.length
      : 0;

  score +=
    coverage * 100;

  return {
    score,
    matchedWords: matched,
    coverage
  };
}

async function searchVideos(
  query,
  pageNumber = 1,
  limit = 20
) {
  query =
    cleanQuery(query);

  let rows = [];

  const {
    data,
    error
  } =
    await supabase
      .from("videos")
      .select(`
        id,
        page_url,
        video_url,
        title,
        description,
        source_domain,
        thumbnail_url,
        created_at,
        updated_at
      `)
      .limit(1000);

  if (error) {
    console.error(
      "Video search error:",
      error
    );

    return {
      ok: false,
      mode: "videos",
      query,
      total: 0,
      page: pageNumber,
      limit,
      results: [],
      error:
        "Video search failed"
    };
  }

  if (
    Array.isArray(data)
  ) {
    rows = data;
  }

  const words =
    uniqueTokens(query);

  if (words.length) {
    rows =
      rows.filter(item => {
        const text =
          normalizeText(
            `${item.title || ""} ${
              item.description ||
              ""
            } ${
              item.source_domain ||
              ""
            } ${
              item.page_url || ""
            } ${
              item.video_url || ""
            }`
          );

        return words.some(
          word =>
            hasWholeWord(
              text,
              word
            )
        );
      });
  }

  const ranked =
    rows
      .map(item => ({
        ...item,
        ...calculateVideoScore(
          item,
          query
        )
      }))
      .sort(
        (a, b) =>
          b.score -
          a.score
      );

  const total =
    ranked.length;

  const start =
    (pageNumber - 1) *
    limit;

  const results =
    ranked.slice(
      start,
      start + limit
    );

  return {
    ok: true,
    mode: "videos",
    query,
    total,
    page: pageNumber,
    limit,
    results
  };
}

/* =======================================================
   MAP SEARCH
======================================================= */

function calculatePlaceScore(
  item,
  query
) {
  const words =
    uniqueTokens(query);

  const text =
    normalizeText(
      `${item.name || ""} ${
        item.address || ""
      } ${item.city || ""} ${
        item.district || ""
      } ${item.state || ""} ${
        item.country || ""
      } ${
        item.source_domain || ""
      }`
    );

  let score = 0;
  let matched = 0;

  for (
    const word of words
  ) {
    if (
      hasWholeWord(
        text,
        word
      )
    ) {
      matched++;
      score += 70;
    }
  }

  if (
    query &&
    hasExactPhrase(
      item.name,
      query
    )
  ) {
    score += 160;
  }

  if (
    query &&
    hasExactPhrase(
      item.city,
      query
    )
  ) {
    score += 100;
  }

  if (
    query &&
    hasExactPhrase(
      item.state,
      query
    )
  ) {
    score += 70;
  }

  const coverage =
    words.length
      ? matched /
        words.length
      : 0;

  score +=
    coverage * 100;

  if (
    Number.isFinite(
      Number(
        item.latitude
      )
    ) &&
    Number.isFinite(
      Number(
        item.longitude
      )
    )
  ) {
    score += 20;
  }

  return {
    score,
    matchedWords: matched,
    coverage
  };
}

async function searchMaps(
  query,
  pageNumber = 1,
  limit = 20
) {
  query =
    cleanQuery(query);

  let rows = [];

  const {
    data,
    error
  } =
    await supabase
      .from("places")
      .select(`
        id,
        page_url,
        name,
        address,
        city,
        district,
        state,
        country,
        latitude,
        longitude,
        source_domain,
        created_at,
        updated_at
      `)
      .limit(1000);

  if (error) {
    console.error(
      "Maps search error:",
      error
    );

    return {
      ok: false,
      mode: "maps",
      query,
      total: 0,
      page: pageNumber,
      limit,
      results: [],
      error:
        "Maps search failed"
    };
  }

  if (
    Array.isArray(data)
  ) {
    rows = data;
  }

  const words =
    uniqueTokens(query);

  if (words.length) {
    rows =
      rows.filter(item => {
        const text =
          normalizeText(
            `${item.name || ""} ${
              item.address || ""
            } ${item.city || ""} ${
              item.district || ""
            } ${item.state || ""} ${
              item.country || ""
            } ${
              item.source_domain ||
              ""
            }`
          );

        return words.some(
          word =>
            hasWholeWord(
              text,
              word
            )
        );
      });
  }

  const ranked =
    rows
      .map(item => ({
        ...item,
        ...calculatePlaceScore(
          item,
          query
        )
      }))
      .sort(
        (a, b) =>
          b.score -
          a.score
      );

  const total =
    ranked.length;

  const start =
    (pageNumber - 1) *
    limit;

  const results =
    ranked.slice(
      start,
      start + limit
    );

  return {
    ok: true,
    mode: "maps",
    query,
    total,
    page: pageNumber,
    limit,
    results
  };
}

/* =======================================================
   NEWS SEARCH
======================================================= */

function calculateNewsScore(
  item,
  query
) {
  const words =
    uniqueTokens(query);

  const title =
    item.title || "";

  const description =
    item.description || "";

  const source =
    item.source_name || "";

  let score = 0;

  let matched = 0;

  for (
    const word of words
  ) {
    let found = false;

    if (
      hasWholeWord(
        title,
        word
      )
    ) {
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

    if (found) {
      matched++;
    }
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
    normalizeText(title) ===
    phrase
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
      ? matched /
        words.length
      : 0;

  score +=
    coverage * 100;

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
  query =
    cleanQuery(query);

  let rows = [];

  const {
    data,
    error
  } =
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

  if (error) {
    console.error(
      "News search error:",
      error
    );

    return {
      ok: false,
      mode: "news",
      query,
      total: 0,
      page: pageNumber,
      limit,
      results: [],
      error:
        "News search failed"
    };
  }

  if (
    Array.isArray(data)
  ) {
    rows = data;
  }

  const queryWords =
    uniqueTokens(query);

  if (
    queryWords.length
  ) {
    rows =
      rows.filter(item => {
        const text =
          normalizeText(
            `${item.title || ""} ${
              item.description ||
              ""
            } ${
              item.source_name ||
              ""
            }`
          );

        return queryWords.some(
          word =>
            hasWholeWord(
              text,
              word
            )
        );
      });
  }

  const ranked =
    rows
      .map(item => ({
        ...item,
        ...calculateNewsScore(
          item,
          query
        )
      }))
      .sort(
        (a, b) =>
          b.score -
          a.score
      );

  const total =
    ranked.length;

  const start =
    (pageNumber - 1) *
    limit;

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

/* =======================================================
   HTTP HELPERS
======================================================= */

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
        "no-store",

      "Access-Control-Allow-Origin":
        "*"
    }
  );

  res.end(body);
}

function sendFile(
  res,
  filePath
) {
  if (
    !fs.existsSync(
      filePath
    )
  ) {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }

  const ext =
    path.extname(
      filePath
    ).toLowerCase();

  const types = {
    ".html":
      "text/html; charset=utf-8",

    ".js":
      "application/javascript; charset=utf-8",

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

/* =======================================================
   HTTP SERVER
======================================================= */

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

        const pathname =
          requestUrl.pathname;

        /* =================================================
           CORS / OPTIONS
        ================================================= */

        if (
          req.method ===
          "OPTIONS"
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

          res.end();

          return;
        }

        /* =================================================
           HEALTH
        ================================================= */

        if (
          pathname ===
            "/api/health" ||
          pathname ===
            "/health"
        ) {
          return jsonResponse(
            res,
            200,
            {
              ok: true,

              service:
                "HEXORA",

              index:
                "Supabase",

              status:
                "online",

              port: PORT
            }
          );
        }

        /* =================================================
           SEARCH
        ================================================= */

        if (
          pathname ===
            "/api/search" ||
          pathname ===
            "/search"
        ) {
          const query =
            requestUrl
              .searchParams
              .get("q") ||
            "";

          const mode =
            detectMode(
              requestUrl
                .searchParams
                .get("mode") ||
                "web"
            );

          const requestedPage =
            Number(
              requestUrl
                .searchParams
                .get("page") ||
                1
            );

          const page =
            Number.isFinite(
              requestedPage
            )
              ? Math.max(
                  1,
                  Math.floor(
                    requestedPage
                  )
                )
              : 1;

          const requestedLimit =
            Number(
              requestUrl
                .searchParams
                .get("limit") ||
                20
            );

          const limit =
            Number.isFinite(
              requestedLimit
            )
              ? Math.min(
                  50,
                  Math.max(
                    1,
                    Math.floor(
                      requestedLimit
                    )
                  )
                )
              : 20;

          let result;

          if (
            mode === "news"
          ) {
            result =
              await searchNews(
                query,
                page,
                limit
              );
          }

          else if (
            mode === "images"
          ) {
            result =
              await searchImages(
                query,
                page,
                limit
              );
          }

          else if (
            mode === "videos"
          ) {
            result =
              await searchVideos(
                query,
                page,
                limit
              );
          }

          else if (
            mode === "maps"
          ) {
            result =
              await searchMaps(
                query,
                page,
                limit
              );
          }

          else {
            result =
              await searchWeb(
                query,
                page,
                limit
              );
          }

          return jsonResponse(
            res,
            200,
            result
          );
        }

        /* =================================================
           NEWS FEED
        ================================================= */

        if (
          pathname ===
            "/api/news" ||
          pathname ===
            "/news"
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

        /* =================================================
           STATIC FILES
        ================================================= */

        let filePath;

        if (
          pathname === "/"
        ) {
          filePath =
            path.join(
              __dirname,
              "index.html"
            );
        }

        else {
          let requested;

          try {
            requested =
              decodeURIComponent(
                pathname
              );
          } catch {
            res.writeHead(
              400
            );

            res.end(
              "Bad Request"
            );

            return;
          }

          filePath =
            path.join(
              __dirname,
              requested
            );
        }

        /* =================================================
           SECURITY
        ================================================= */

        const safeBase =
          path.resolve(
            __dirname
          );

        const safePath =
          path.resolve(
            filePath
          );

        const relativePath =
          path.relative(
            safeBase,
            safePath
          );

        if (
          relativePath.startsWith(
            ".." +
              path.sep
          ) ||
          path.isAbsolute(
            relativePath
          )
        ) {
          res.writeHead(
            403
          );

          res.end(
            "Forbidden"
          );

          return;
        }

        /* =================================================
           EXISTING STATIC FILE
        ================================================= */

        if (
          fs.existsSync(
            safePath
          ) &&
          fs.statSync(
            safePath
          ).isFile()
        ) {
          return sendFile(
            res,
            safePath
          );
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
          fs.existsSync(
            indexFile
          )
        ) {
          return sendFile(
            res,
            indexFile
          );
        }

        res.writeHead(
          404
        );

        res.end(
          "Not Found"
        );

      } catch (error) {
        console.error(
          "[HEXORA SERVER ERROR]",
          error
        );

        return jsonResponse(
          res,
          500,
          {
            ok: false,

            error:
              "HEXORA server error",

            message:
              error?.message ||
              "Unknown server error"
          }
        );
      }
    }
  );

/* =======================================================
   START SERVER
======================================================= */

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `HEXORA search server running on port ${PORT}`
    );

    console.log(
      `[HEXORA] Supabase URL configured: ${
        SUPABASE_URL
          ? "YES"
          : "NO"
      }`
    );

    console.log(
      `[HEXORA] Supabase key configured: ${
        SUPABASE_KEY
          ? "YES"
          : "NO"
      }`
    );
  }
);

server.on(
  "error",
  error => {
    console.error(
      "[HEXORA LISTEN ERROR]",
      error
    );
  }
);
