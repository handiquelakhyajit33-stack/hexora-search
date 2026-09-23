// --------------------------------------------------
// TEXT NORMALIZATION
// --------------------------------------------------

function normalizeText(value = "") {
  return String(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value = "") {
  return [
    ...new Set(
      normalizeText(value)
        .split(/\s+/)
        .filter(Boolean)
    )
  ].slice(0, 8);
}

function countOccurrences(text, term) {
  if (!text || !term) return 0;

  let count = 0;
  let position = 0;

  while (true) {
    const index = text.indexOf(term, position);

    if (index === -1) break;

    count++;

    position =
      index + Math.max(term.length, 1);

    if (count >= 50) break;
  }

  return count;
}

// --------------------------------------------------
// QUERY WORD PROXIMITY
// --------------------------------------------------

function proximityScore(text, words) {
  if (!text || words.length < 2) {
    return 0;
  }

  const positions = [];

  for (const word of words) {
    const index = text.indexOf(word);

    if (index >= 0) {
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

  if (distance <= 30) return 45;
  if (distance <= 80) return 30;
  if (distance <= 160) return 18;
  if (distance <= 300) return 8;

  return 0;
}

// --------------------------------------------------
// PAGE QUALITY
// --------------------------------------------------

function pageQuality(page) {
  const title =
    normalizeText(page.title);

  const description =
    normalizeText(page.description);

  const content =
    normalizeText(page.content);

  let score = 0;

  if (title.length >= 5) {
    score += 5;
  }

  if (description.length >= 30) {
    score += 5;
  }

  if (content.length >= 500) {
    score += 8;
  }

  if (content.length >= 2000) {
    score += 5;
  }

  // Very thin pages get a small penalty.
  if (
    content.length > 0 &&
    content.length < 100
  ) {
    score -= 12;
  }

  return score;
}

// --------------------------------------------------
// FRESHNESS
// --------------------------------------------------

function freshnessScore(updatedAt) {
  if (!updatedAt) {
    return 0;
  }

  const timestamp =
    Date.parse(updatedAt);

  if (!Number.isFinite(timestamp)) {
    return 0;
  }

  const ageDays = Math.max(
    0,
    (Date.now() - timestamp) /
      86400000
  );

  if (ageDays <= 7) return 10;
  if (ageDays <= 30) return 7;
  if (ageDays <= 90) return 4;
  if (ageDays <= 365) return 2;

  return 0;
}

// --------------------------------------------------
// STRONG PAGE RANKING
// --------------------------------------------------

function scorePage(
  page,
  query,
  words
) {
  const title =
    normalizeText(page.title);

  const description =
    normalizeText(page.description);

  const url =
    normalizeText(page.url);

  const content =
    normalizeText(page.content);

  const phrase =
    normalizeText(query);

  let score = 0;

  // ================================================
  // 1. EXACT TITLE
  // ================================================

  if (title === phrase) {
    score += 1000;
  }

  // ================================================
  // 2. EXACT QUERY PHRASE IN TITLE
  // ================================================

  if (
    phrase &&
    title.includes(phrase)
  ) {
    score += 500;
  }

  // ================================================
  // 3. ALL QUERY WORDS IN TITLE
  // ================================================

  const titleMatches =
    words.filter(
      word => title.includes(word)
    ).length;

  if (
    words.length > 0 &&
    titleMatches === words.length
  ) {
    score += 350;
  }

  // ================================================
  // 4. INDIVIDUAL TITLE MATCHES
  // ================================================

  for (const word of words) {
    if (title.includes(word)) {
      score += 100;
    }

    const occurrences =
      countOccurrences(
        title,
        word
      );

    score += Math.min(
      occurrences * 20,
      60
    );
  }

  // ================================================
  // 5. TITLE PROXIMITY
  // ================================================

  score += proximityScore(
    title,
    words
  );

  // ================================================
  // 6. DESCRIPTION
  // ================================================

  if (
    phrase &&
    description.includes(phrase)
  ) {
    score += 100;
  }

  const descriptionMatches =
    words.filter(
      word =>
        description.includes(word)
    ).length;

  score +=
    descriptionMatches * 25;

  // ================================================
  // 7. CONTENT EXACT PHRASE
  // ================================================

  if (
    phrase &&
    content.includes(phrase)
  ) {
    score += 80;
  }

  // ================================================
  // 8. CONTENT WORD MATCHES
  // ================================================

  let contentWords = 0;

  for (const word of words) {
    const occurrences =
      countOccurrences(
        content,
        word
      );

    if (occurrences > 0) {
      contentWords++;
    }

    // Content frequency intentionally has
    // much lower weight than title relevance.
    score += Math.min(
      occurrences * 2,
      20
    );
  }

  if (
    words.length > 1 &&
    contentWords === words.length
  ) {
    score += 40;
  }

  // ================================================
  // 9. CONTENT PROXIMITY
  // ================================================

  score += proximityScore(
    content,
    words
  );

  // ================================================
  // 10. URL
  // ================================================

  if (
    phrase &&
    url.includes(phrase)
  ) {
    score += 35;
  }

  for (const word of words) {
    if (url.includes(word)) {
      score += 8;
    }
  }

  // ================================================
  // 11. QUALITY
  // ================================================

  score += pageQuality(page);

  // ================================================
  // 12. FRESHNESS
  // ================================================

  score += freshnessScore(
    page.updated_at
  );

  return score;
}

// --------------------------------------------------
// NEWS RANKING
// --------------------------------------------------

function newsScore(
  item,
  query,
  words
) {
  const title =
    normalizeText(item.title);

  const description =
    normalizeText(item.description);

  const source =
    normalizeText(item.source_name);

  const phrase =
    normalizeText(query);

  let score = 0;

  if (title === phrase) {
    score += 500;
  }

  if (
    phrase &&
    title.includes(phrase)
  ) {
    score += 250;
  }

  for (const word of words) {
    if (title.includes(word)) {
      score += 70;
    }

    if (
      description.includes(word)
    ) {
      score += 20;
    }

    if (source.includes(word)) {
      score += 3;
    }
  }

  // Freshness is useful for news,
  // but should not completely dominate relevance.
  const age = item.published_at
    ? Math.max(
        0,
        (Date.now() -
          Date.parse(
            item.published_at
          )) /
          86400000
      )
    : 999;

  if (age <= 1) {
    score += 30;
  } else if (age <= 3) {
    score += 20;
  } else if (age <= 7) {
    score += 12;
  } else if (age <= 30) {
    score += 5;
  }

  return score;
}

// --------------------------------------------------
// SNIPPET
// --------------------------------------------------

function snippet(
  page,
  query,
  words
) {
  const content =
    String(page.content || "")
      .replace(/\s+/g, " ")
      .trim();

  const description =
    String(page.description || "")
      .replace(/\s+/g, " ")
      .trim();

  const text =
    content ||
    description ||
    String(page.title || "");

  if (!text) {
    return "";
  }

  const lower =
    normalizeText(text);

  const phrase =
    normalizeText(query);

  let at = -1;

  // Prefer exact query phrase.
  if (phrase) {
    at = lower.indexOf(phrase);
  }

  // Otherwise find first relevant word.
  if (at === -1) {
    for (const word of words) {
      const index =
        lower.indexOf(word);

      if (
        index >= 0 &&
        (
          at === -1 ||
          index < at
        )
      ) {
        at = index;
      }
    }
  }

  if (at === -1) {
    return text.slice(0, 280);
  }

  const start =
    Math.max(0, at - 120);

  const end =
    Math.min(
      text.length,
      at + 300
    );

  let result =
    text.slice(start, end);

  if (start > 0) {
    result =
      "… " + result;
  }

  if (end < text.length) {
    result += " …";
  }

  return result;
}

// --------------------------------------------------
// SEARCH
// --------------------------------------------------

async function search(q) {
  const query =
    String(q || "").trim();

  const words =
    tokenize(query);

  if (
    !query ||
    words.length === 0
  ) {
    return {
      query,
      total: 0,
      results: []
    };
  }

  const sb = db();

  // Keep the existing API/database architecture.
  // Candidate retrieval is still from the existing
  // Supabase pages table.
  const [
    {
      data: pages,
      error: pageError
    },
    {
      data: newsData,
      error: newsError
    }
  ] = await Promise.all([
    sb
      .from("pages")
      .select(
        "url,title,description,content,updated_at"
      )
      .limit(1200),

    sb
      .from("news")
      .select(
        "title,description,url,source_name,source_domain,published_at,image_url"
      )
      .order(
        "published_at",
        {
          ascending: false
        }
      )
      .limit(300)
  ]);

  if (pageError) {
    throw pageError;
  }

  if (newsError) {
    throw newsError;
  }

  // ----------------------------------------------
  // WEB
  // ----------------------------------------------

  const pageResults =
    (pages || [])
      .map(page => ({
        ...page,
        type: "web",
        score:
          scorePage(
            page,
            query,
            words
          ),
        snippet:
          snippet(
            page,
            query,
            words
          )
      }))
      .filter(
        result =>
          result.score > 0 &&
          result.url
      );

  // ----------------------------------------------
  // NEWS
  // ----------------------------------------------

  const newsResults =
    (newsData || [])
      .map(item => ({
        ...item,
        type: "news",
        score:
          newsScore(
            item,
            query,
            words
          ),
        snippet:
          item.description ||
          item.title ||
          ""
      }))
      .filter(
        result =>
          result.score > 0 &&
          result.url
      );

  // ----------------------------------------------
  // REMOVE DUPLICATE URLS
  // ----------------------------------------------

  const seen =
    new Set();

  const results = [
    ...pageResults,
    ...newsResults
  ]
    .sort(
      (a, b) =>
        b.score - a.score
    )
    .filter(result => {
      const url =
        normalizeText(
          result.url
        );

      if (
        !url ||
        seen.has(url)
      ) {
        return false;
      }

      seen.add(url);

      return true;
    })
    .slice(0, 30);

  return {
    query,
    total: results.length,
    results
  };
}
