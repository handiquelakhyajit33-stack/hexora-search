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

  if (error) {
    console.error(
      "News query error:",
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
      error: error.message
    };
  }

  if (Array.isArray(data)) {
    rows = data;
  }

  /*
   * NEWS SEARCH
   *
   * Query words are checked independently.
   * This means:
   *
   * Assam
   * Assam news
   * latest Assam news
   *
   * can all find relevant news.
   */

  const words =
    uniqueTokens(query);

  if (words.length > 0) {

    rows = rows.filter(item => {

      const title =
        normalizeText(
          item.title || ""
        );

      const description =
        normalizeText(
          item.description || ""
        );

      const source =
        normalizeText(
          item.source_name || ""
        );

      const domain =
        normalizeText(
          item.source_domain || ""
        );

      const fullText =
        `${title} ${description} ${source} ${domain}`;

      /*
       * For multi-word queries,
       * require at least one query word
       * to match, then ranking decides
       * the strongest results.
       */

      return words.some(word =>
        hasWholeWord(
          fullText,
          word
        )
      );
    });
  }

  /*
   * Rank news results
   */

  const ranked =
    rows
      .map(item => {

        const title =
          item.title || "";

        const description =
          item.description || "";

        const source =
          item.source_name || "";

        let score = 0;

        let matchedWords = 0;

        for (const word of words) {

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

          const sourceCount =
            countWholeWordOccurrences(
              source,
              word
            );

          if (titleCount > 0) {
            score += 120;
            score +=
              Math.min(
                titleCount,
                5
              ) * 10;

            matched = true;
          }

          if (
            descriptionCount > 0
          ) {
            score += 35;
            score +=
              Math.min(
                descriptionCount,
                5
              ) * 3;

            matched = true;
          }

          if (
            sourceCount > 0
          ) {
            score += 25;
            matched = true;
          }

          if (matched) {
            matchedWords++;
          }
        }

        const phrase =
          normalizeText(query);

        /*
         * Exact phrase bonus
         */

        if (
          phrase &&
          hasExactPhrase(
            title,
            phrase
          )
        ) {
          score += 250;
        }

        if (
          phrase &&
          hasExactPhrase(
            description,
            phrase
          )
        ) {
          score += 80;
        }

        /*
         * Exact title bonus
         */

        if (
          phrase &&
          normalizeText(title) ===
            phrase
        ) {
          score += 350;
        }

        /*
         * Assam-specific boost
         */

        if (
          words.includes("assam")
        ) {
          if (
            hasWholeWord(
              title,
              "assam"
            )
          ) {
            score += 100;
          }

          if (
            hasWholeWord(
              description,
              "assam"
            )
          ) {
            score += 35;
          }

          if (
            hasWholeWord(
              source,
              "assam"
            )
          ) {
            score += 20;
          }
        }

        /*
         * Fresh news gets higher priority
         */

        score +=
          calculateFreshnessBonus(
            item.published_at ||
            item.fetched_at
          );

        const coverage =
          words.length > 0
            ? matchedWords /
              words.length
            : 1;

        score +=
          coverage * 100;

        /*
         * Don't allow very weak
         * multi-word matches to dominate.
         */

        if (
          words.length > 1 &&
          coverage < 0.5
        ) {
          score -= 80;
        }

        return {
          ...item,
          score,
          matchedWords,
          coverage
        };
      })
      .sort((a, b) => {

        if (
          b.score !== a.score
        ) {
          return (
            b.score -
            a.score
          );
        }

        const aDate =
          new Date(
            a.published_at ||
            a.fetched_at ||
            0
          ).getTime();

        const bDate =
          new Date(
            b.published_at ||
            b.fetched_at ||
            0
          ).getTime();

        return bDate - aDate;
      });

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
