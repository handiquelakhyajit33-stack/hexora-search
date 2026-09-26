async function searchWeb(
  query,
  pageNumber = 1,
  limit = 20
) {
  query = cleanQuery(query);

  if (!query) {
    return {
      ok: true,
      mode: "web",
      query: "",
      total: 0,
      page: pageNumber,
      limit,
      results: []
    };
  }

  // Keep search fast
  const safeLimit = Math.min(
    Math.max(Number(limit) || 20, 1),
    20
  );

  let rows = [];

  /* =====================================================
     1. FAST FULL-TEXT SEARCH
  ===================================================== */

  try {
    const { data, error } =
      await supabase
        .from("pages")
        .select(`
          id,
          url,
          title,
          description,
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
        .limit(100);

    if (error) {
      console.error(
        "FAST TEXT SEARCH ERROR:",
        error.message
      );
    } else if (Array.isArray(data)) {
      rows = data;
    }
  } catch (err) {
    console.error(
      "FAST TEXT SEARCH FAILED:",
      err.message
    );
  }

  /* =====================================================
     2. FAST FALLBACK
     Search only title / description / URL.
     NEVER scan full content here.
  ===================================================== */

  if (!rows.length) {
    const words = uniqueTokens(query)
      .slice(0, 8)
      .filter(word => word.length >= 2);

    if (words.length) {
      const conditions = [];

      for (const word of words) {
        const safeWord = word
          .replace(/[%_]/g, "")
          .replace(/,/g, " ")
          .trim();

        if (!safeWord) continue;

        conditions.push(
          `title.ilike.%${safeWord}%`
        );

        conditions.push(
          `description.ilike.%${safeWord}%`
        );

        conditions.push(
          `url.ilike.%${safeWord}%`
        );
      }

      if (conditions.length) {
        try {
          const { data, error } =
            await supabase
              .from("pages")
              .select(`
                id,
                url,
                title,
                description,
                author,
                image_url,
                published_at,
                last_crawled_at,
                updated_at,
                authority_score,
                popularity_score
              `)
              .or(
                conditions.join(",")
              )
              .limit(100);

          if (error) {
            console.error(
              "FALLBACK SEARCH ERROR:",
              error.message
            );
          } else if (Array.isArray(data)) {
            rows = data;
          }
        } catch (err) {
          console.error(
            "FALLBACK SEARCH FAILED:",
            err.message
          );
        }
      }
    }
  }

  /* =====================================================
     3. REMOVE DUPLICATES
  ===================================================== */

  const seen = new Set();

  rows = rows.filter(row => {
    const key =
      String(row.url || "").trim() ||
      String(row.id || "");

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);

    return true;
  });

  /* =====================================================
     4. LIGHTWEIGHT RANKING
  ===================================================== */

  const ranked = rows
    .map(row => {
      const words =
        uniqueTokens(query);

      const title =
        String(row.title || "");

      const description =
        String(row.description || "");

      const url =
        String(row.url || "");

      const titleText =
        normalizeText(title);

      const descriptionText =
        normalizeText(description);

      const urlText =
        normalizeText(url);

      const queryText =
        normalizeText(query);

      let score = 0;
      let matchedWords = 0;

      /* Exact title */
      if (
        queryText &&
        titleText === queryText
      ) {
        score += 500;
      }

      /* Title phrase */
      if (
        queryText &&
        titleText.includes(queryText)
      ) {
        score += 250;
      }

      /* Description phrase */
      if (
        queryText &&
        descriptionText.includes(queryText)
      ) {
        score += 80;
      }

      /* URL phrase */
      if (
        queryText &&
        urlText.includes(queryText)
      ) {
        score += 40;
      }

      /* Individual words */
      for (const word of words) {
        if (
          titleText.includes(word)
        ) {
          score += 100;
          matchedWords++;
        }

        if (
          descriptionText.includes(word)
        ) {
          score += 30;
        }

        if (
          urlText.includes(word)
        ) {
          score += 15;
        }
      }

      /* All query words found in title */
      if (
        words.length > 1 &&
        words.every(word =>
          titleText.includes(word)
        )
      ) {
        score += 200;
      }

      /* Coverage */
      const coverage =
        words.length > 0
          ? matchedWords / words.length
          : 0;

      score += coverage * 100;

      /* Freshness */
      score += calculateFreshnessBonus(
        row.published_at ||
        row.updated_at ||
        row.last_crawled_at
      );

      /* Authority */
      score += calculateAuthorityBonus(
        row
      );

      return {
        ...row,
        score,
        matchedWords,
        coverage
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

  /* =====================================================
     5. PAGINATION
  ===================================================== */

  const total =
    ranked.length;

  const start =
    (Math.max(pageNumber, 1) - 1) *
    safeLimit;

  const results =
    ranked.slice(
      start,
      start + safeLimit
    );

  /* =====================================================
     6. RESPONSE
  ===================================================== */

  return {
    ok: true,
    mode: "web",
    query,
    total,
    page: pageNumber,
    limit: safeLimit,

    results: results.map(row => ({
      id: row.id,
      url: row.url,
      title: row.title,
      description: row.description,

      author:
        row.author || null,

      image_url:
        row.image_url || null,

      published_at:
        row.published_at || null,

      last_crawled_at:
        row.last_crawled_at || null,

      score:
        Math.round(
          row.score * 100
        ) / 100,

      matched_words:
        row.matchedWords,

      coverage:
        row.coverage
    }))
  };
}
