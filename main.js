async function doSearch(query, mode = "web") {
  query = String(query || "").trim();

  if (!query) {
    showSearchView();
    const results = $("#results");
    const meta = $("#resultMeta");

    if (meta) meta.textContent = "";
    if (results) {
      results.innerHTML = `
        <div class="hexora-empty">
          <div class="hexora-search-logo">H</div>
          <h2>Search HEXORA</h2>
          <p>Type something to search the web.</p>
        </div>
      `;
    }

    $("#searchInput")?.focus();
    return;
  }

  state.query = query;
  state.mode = mode;

  // Open search page immediately
  showSearchView();

  const results = $("#results");
  const meta = $("#resultMeta");

  // 🔎 HEXORA LOADING UI
  if (meta) {
    meta.textContent = "";
  }

  if (results) {
    results.innerHTML = `
      <div class="hexora-searching">
        <div class="hexora-loader">
          <div class="hexora-loader-ring"></div>
          <div class="hexora-loader-logo">H</div>
        </div>

        <div class="hexora-searching-title">
          HEXORA is searching
        </div>

        <div class="hexora-searching-query">
          for "<strong>${escapeHTML(query)}</strong>"
        </div>

        <div class="hexora-searching-dots">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    `;
  }

  try {
    const endpoint =
      mode === "news"
        ? CONFIG.newsEndpoint
        : CONFIG.searchEndpoint;

    const url =
      `${endpoint}?q=${encodeURIComponent(query)}`;

    console.log("[HEXORA] Searching:", url);

    const data = await fetchJSON(url);

    console.log("[HEXORA] Search response:", data);

    const items = Array.isArray(data?.results)
      ? data.results
      : [];

    if (meta) {
      meta.textContent =
        `${items.length} result${items.length === 1 ? "" : "s"} found`;
    }

    if (!results) return;

    if (!items.length) {
      results.innerHTML = `
        <div class="hexora-no-results">
          <div class="hexora-no-results-logo">H</div>

          <h2>No web results found</h2>

          <p>
            HEXORA could not find matching indexed results for
            "<strong>${escapeHTML(query)}</strong>".
          </p>

          <button
            type="button"
            class="hexora-retry"
            id="hexoraRetryBtn"
          >
            🔄 Search Again
          </button>
        </div>
      `;

      $("#hexoraRetryBtn")?.addEventListener("click", () => {
        doSearch(query, mode);
      });

      return;
    }

    // Render real results
    renderResults(items, mode);

  } catch (error) {
    console.error("[HEXORA] Search error:", error);

    if (meta) {
      meta.textContent = "";
    }

    if (results) {
      results.innerHTML = `
        <div class="hexora-error">
          <div class="hexora-error-logo">!</div>

          <h2>HEXORA search error</h2>

          <p>
            HEXORA could not connect to the search server.
          </p>

          <button
            type="button"
            class="hexora-retry"
            id="hexoraRetryBtn"
          >
            🔄 Retry Search
          </button>
        </div>
      `;

      $("#hexoraRetryBtn")?.addEventListener("click", () => {
        doSearch(query, mode);
      });
    }
  }
}
