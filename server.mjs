
async function searchPages(query, options = {}) {
  const q = cleanText(query);

  if (!q) {
    return {
      results: [],
      total: 0,
      page: 1,
      limit: 20,
      total_pages: 0
    };
  }

  const page = Math.max(
    1,
    Number(options.page || 1)
  );

  const limit = Math.min(
    50,
    Math.max(
      1,
      Number(options.limit || 20)
    )
  );

  console.log(
    `[HEXORA SEARCH] ${q} page=${page} limit=${limit}`
  );

  let data = [];
  let ftsError = null;

  const fts = await supabase
    .from("pages")
    .select(
      "id,url,title,description,content,last_crawled_at"
    )
    .textSearch(
      "search_vector",
      q,
      {
        type: "websearch",
        config: "simple"
      }
    )
    .limit(1000);

  data = fts.data || [];
  ftsError = fts.error;

  if (ftsError || data.length === 0) {
    console.log(
      "[HEXORA] Using search fallback"
    );

    const pattern = `%${q}%`;

    const fallback = await supabase
      .from("pages")
      .select(
        "id,url,title,description,content,last_crawled_at"
      )
      .or(
        `title.ilike.${pattern},description.ilike.${pattern},url.ilike.${pattern}`
      )
      .limit(1000);

    if (fallback.error) {
      throw fallback.error;
    }

    data = fallback.data || [];
  }

  const ranked = data
    .map((page) => ({
      ...page,
      relevance_score: Number(
        scorePage(page, q).toFixed(2)
      )
    }))
    .sort(
      (a, b) =>
        b.relevance_score -
        a.relevance_score
    );

  const total = ranked.length;

  const start = (page - 1) * limit;

  const results = ranked
    .slice(start, start + limit)
    .map(({ content, ...page }) => page);

  return {
    results,
    total,
    page,
    limit,
    total_pages: Math.ceil(total / limit)
  };
}
