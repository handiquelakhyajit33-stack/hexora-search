/* =========================================================
   HEXORA — Main Frontend
   Search Beyond Limits
   ========================================================= */

(() => {
  "use strict";

  const CONFIG = {
    // IMPORTANT: HEXORA backend search endpoint
    searchEndpoint: "/search",

    newsEndpoint: "/api/news",
    imagesEndpoint: "/api/images",
    videosEndpoint: "/api/videos",
    mapsEndpoint: "/api/maps",

    searchLimit: 20,
    requestTimeout: 20000
  };

  /* =========================================================
     DOM HELPERS
     ========================================================= */

  const $ = (selector, root = document) =>
    root.querySelector(selector);

  const $$ = (selector, root = document) =>
    [...root.querySelectorAll(selector)];

  function escapeHTML(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function safeURL(value) {
    try {
      const url = new URL(value, window.location.origin);

      if (
        url.protocol === "http:" ||
        url.protocol === "https:"
      ) {
        return url.href;
      }

      return "#";
    } catch {
      return "#";
    }
  }

  function cleanText(value) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /* =========================================================
     STATE
     ========================================================= */

  const state = {
    query: "",
    mode: "web",
    page: 1,
    limit: CONFIG.searchLimit,
    loading: false,
    results: [],
    total: 0
  };

  /* =========================================================
     ELEMENTS
     ========================================================= */

  function getSearchInput() {
    return (
      $("#searchInput") ||
      $("#search-input") ||
      $('input[type="search"]') ||
      $('input[placeholder="Search"]')
    );
  }

  function getSearchForm() {
    return (
      $("#searchForm") ||
      $("#search-form") ||
      $("form")
    );
  }

  function getResultsContainer() {
    return (
      $("#results") ||
      $("#searchResults") ||
      $("#resultsContainer")
    );
  }

  function getSearchView() {
    return $("#searchView");
  }

  function getHomeView() {
    return $("#homeView");
  }

  /* =========================================================
     VIEW CONTROL
     ========================================================= */

  function hideAllViews() {
    $$("[data-view]").forEach((view) => {
      view.classList.remove("active");
      view.style.display = "none";
    });
  }

  function showView(name) {
    const view =
      document.querySelector(`[data-view="${name}"]`) ||
      document.getElementById(`${name}View`);

    if (!view) return;

    hideAllViews();

    view.classList.add("active");
    view.style.display = "";
  }

  function showSearchView() {
    const view = getSearchView();

    if (!view) return;

    view.classList.add("active");
    view.style.display = "";
  }

  /* =========================================================
     SEARCH UI
     ========================================================= */

  function showSearching(query) {
    const container = getResultsContainer();

    if (!container) return;

    container.innerHTML = `
      <div class="hexora-search-status">
        <div class="hexora-spinner"></div>
        <div>
          <strong>Searching web for "${escapeHTML(query)}"</strong>
          <div class="muted">HEXORA is searching...</div>
        </div>
      </div>
    `;
  }

  function showNoResults(query) {
    const container = getResultsContainer();

    if (!container) return;

    container.innerHTML = `
      <div class="hexora-empty-state">
        <div class="empty-icon">🔎</div>
        <h3>No results found</h3>
        <p>
          HEXORA could not find matching indexed results
          for "<strong>${escapeHTML(query)}</strong>".
        </p>
      </div>
    `;
  }

  function showSearchError(message = "") {
    const container = getResultsContainer();

    if (!container) return;

    container.innerHTML = `
      <div class="hexora-error-state">
        <div class="empty-icon">⚠️</div>
        <h3>Search server not connected</h3>
        <p>
          HEXORA could not connect to the search server.
        </p>
        ${
          message
            ? `<small>${escapeHTML(message)}</small>`
            : ""
        }
        <button
          type="button"
          class="retry-search-btn"
          id="retrySearchBtn"
        >
          Retry Search
        </button>
      </div>
    `;

    const retry = $("#retrySearchBtn");

    if (retry) {
      retry.addEventListener("click", () => {
        if (state.query) {
          doSearch(state.query, state.mode, state.page);
        }
      });
    }
  }

  /* =========================================================
     FETCH WITH TIMEOUT
     ========================================================= */

  async function fetchJSON(url, options = {}) {
    const controller = new AbortController();

    const timer = setTimeout(() => {
      controller.abort();
    }, CONFIG.requestTimeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...(options.headers || {})
        }
      });

      const text = await response.text();

      let data = null;

      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(
          `Server returned invalid JSON (${response.status})`
        );
      }

      if (!response.ok) {
        throw new Error(
          data?.error ||
          data?.message ||
          `HTTP ${response.status}`
        );
      }

      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  /* =========================================================
     BUILD SEARCH URL
     ========================================================= */

  function buildSearchURL(query, mode, page, limit) {
    const params = new URLSearchParams();

    params.set("q", query);
    params.set("mode", mode);
    params.set("page", String(page));
    params.set("limit", String(limit));

    return `${CONFIG.searchEndpoint}?${params.toString()}`;
  }

  /* =========================================================
     MAIN SEARCH
     ========================================================= */

  async function doSearch(
    rawQuery,
    mode = state.mode,
    page = 1
  ) {
    const query = cleanText(rawQuery);

    if (!query) {
      const input = getSearchInput();

      if (input) {
        input.focus();
      }

      return;
    }

    if (state.loading) return;

    state.query = query;
    state.mode = mode || "web";
    state.page = page || 1;
    state.loading = true;

    showSearchView();
    showSearching(query);

    const input = getSearchInput();

    if (input && input.value !== query) {
      input.value = query;
    }

    updateURL();

    try {
      let data;

      /* =====================================================
         WEB SEARCH
         IMPORTANT:
         Backend endpoint is /search
         NOT /api/search
         ===================================================== */

      if (state.mode === "web") {
        const url = buildSearchURL(
          query,
          state.mode,
          state.page,
          state.limit
        );

        data = await fetchJSON(url);
      }

      /* =====================================================
         OTHER MODES
         ===================================================== */

      else if (state.mode === "news") {
        const params = new URLSearchParams({
          q: query,
          page: String(state.page),
          limit: String(state.limit)
        });

        data = await fetchJSON(
          `${CONFIG.newsEndpoint}?${params.toString()}`
        );
      }

      else if (state.mode === "images") {
        const params = new URLSearchParams({
          q: query,
          page: String(state.page),
          limit: String(state.limit)
        });

        data = await fetchJSON(
          `${CONFIG.imagesEndpoint}?${params.toString()}`
        );
      }

      else if (state.mode === "videos") {
        const params = new URLSearchParams({
          q: query,
          page: String(state.page),
          limit: String(state.limit)
        });

        data = await fetchJSON(
          `${CONFIG.videosEndpoint}?${params.toString()}`
        );
      }

      else if (state.mode === "maps") {
        const params = new URLSearchParams({
          q: query,
          page: String(state.page),
          limit: String(state.limit)
        });

        data = await fetchJSON(
          `${CONFIG.mapsEndpoint}?${params.toString()}`
        );
      }

      if (!data) {
        throw new Error("Empty response from server");
      }

      const results =
        Array.isArray(data.results)
          ? data.results
          : Array.isArray(data.data)
            ? data.data
            : [];

      state.results = results;
      state.total =
        Number(data.total) ||
        results.length ||
        0;

      renderSearchResponse(data);

    } catch (error) {
      console.error(
        "[HEXORA] Search failed:",
        error
      );

      showSearchError(
        error?.message || "Unknown search error"
      );
    } finally {
      state.loading = false;
    }
  }

  /* =========================================================
     RENDER RESPONSE
     ========================================================= */

  function renderSearchResponse(data) {
    if (state.mode === "web") {
      renderWebResults(data);
      return;
    }

    if (state.mode === "news") {
      renderNewsResults(data);
      return;
    }

    if (state.mode === "images") {
      renderImageResults(data);
      return;
    }

    if (state.mode === "videos") {
      renderVideoResults(data);
      return;
    }

    if (state.mode === "maps") {
      renderMapResults(data);
      return;
    }

    renderWebResults(data);
  }

  /* =========================================================
     WEB RESULTS
     ========================================================= */

  function renderWebResults(data) {
    const container = getResultsContainer();

    if (!container) return;

    const results =
      Array.isArray(data?.results)
        ? data.results
        : [];

    if (!results.length) {
      showNoResults(state.query);
      return;
    }

    const sponsored =
      Array.isArray(data?.sponsored_ads)
        ? data.sponsored_ads
        : [];

    let html = "";

    if (sponsored.length) {
      html += `
        <section class="hexora-sponsored">
          <div class="section-label">
            Sponsored
          </div>

          ${sponsored
            .map(renderSponsoredResult)
            .join("")}
        </section>
      `;
    }

    html += `
      <div class="results-summary">
        <span>
          About ${formatNumber(
            data?.total || results.length
          )} results
        </span>
        <span>•</span>
        <span>HEXORA Web</span>
      </div>

      <section class="web-results">
        ${results
          .map(renderWebResult)
          .join("")}
      </section>
    `;

    if (
      Array.isArray(data?.suggestions) &&
      data.suggestions.length
    ) {
      html += `
        <div class="hexora-suggestions">
          <strong>Related searches</strong>

          <div class="suggestion-list">
            ${data.suggestions
              .slice(0, 8)
              .map(
                (item) => `
                  <button
                    type="button"
                    class="suggestion-btn"
                    data-query="${escapeHTML(item)}"
                  >
                    ${escapeHTML(item)}
                  </button>
                `
              )
              .join("")}
          </div>
        </div>
      `;
    }

    html += renderPagination();

    container.innerHTML = html;

    bindResultLinks(container);
  }

  function renderWebResult(result) {
    const url = safeURL(result.url);

    const title =
      cleanText(result.title) ||
      cleanText(result.url) ||
      "Untitled";

    const description =
      cleanText(
        result.snippet ||
        result.description ||
        result.content
      ) ||
      "No description available.";

    const domain =
      cleanText(result.domain) ||
      getDomain(result.url);

    const language =
      cleanText(result.language);

    const published =
      formatDate(
        result.published_at ||
        result.updated_at
      );

    return `
      <article class="search-result">
        <div class="result-topline">
          <span class="result-domain">
            ${escapeHTML(domain)}
          </span>

          ${
            language
              ? `
                <span class="result-language">
                  ${escapeHTML(language)}
                </span>
              `
              : ""
          }
        </div>

        <h2 class="result-title">
          <a
            href="${url}"
            target="_blank"
            rel="noopener noreferrer"
            data-result-url="${url}"
          >
            ${escapeHTML(title)}
          </a>
        </h2>

        <div class="result-url">
          ${escapeHTML(
            shortenURL(result.url)
          )}
        </div>

        <p class="result-snippet">
          ${escapeHTML(description)}
        </p>

        ${
          published
            ? `
              <div class="result-meta">
                Updated ${escapeHTML(published)}
              </div>
            `
            : ""
        }
      </article>
    `;
  }

  /* =========================================================
     SPONSORED ADS
     ========================================================= */

  function renderSponsoredResult(ad) {
    const url = safeURL(
      ad.final_url ||
      ad.url ||
      ad.website
    );

    const title =
      cleanText(ad.title) ||
      cleanText(ad.business_name) ||
      "Sponsored result";

    const description =
      cleanText(
        ad.description ||
        ad.snippet
      );

    return `
      <article class="sponsored-result">
        <div class="sponsored-badge">
          Sponsored
        </div>

        <h2 class="result-title">
          <a
            href="${url}"
            target="_blank"
            rel="noopener noreferrer"
          >
            ${escapeHTML(title)}
          </a>
        </h2>

        ${
          description
            ? `
              <p class="result-snippet">
                ${escapeHTML(description)}
              </p>
            `
            : ""
        }
      </article>
    `;
  }

  /* =========================================================
     NEWS
     ========================================================= */

  function renderNewsResults(data) {
    const container = getResultsContainer();

    if (!container) return;

    const results =
      Array.isArray(data?.results)
        ? data.results
        : [];

    if (!results.length) {
      showNoResults(state.query);
      return;
    }

    container.innerHTML = `
      <div class="results-summary">
        <span>
          ${formatNumber(results.length)} news results
        </span>
      </div>

      <section class="news-results">
        ${results
          .map((item) => {
            const url = safeURL(
              item.url ||
              item.link
            );

            return `
              <article class="news-card">
                ${
                  item.image_url
                    ? `
                      <img
                        src="${safeURL(item.image_url)}"
                        alt=""
                        loading="lazy"
                      >
                    `
                    : ""
                }

                <div>
                  <div class="result-domain">
                    ${escapeHTML(
                      item.domain ||
                      getDomain(item.url)
                    )}
                  </div>

                  <h2>
                    <a
                      href="${url}"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      ${escapeHTML(
                        item.title ||
                        "News"
                      )}
                    </a>
                  </h2>

                  <p>
                    ${escapeHTML(
                      item.snippet ||
                      item.description ||
                      ""
                    )}
                  </p>

                  <small>
                    ${escapeHTML(
                      formatDate(
                        item.published_at ||
                        item.updated_at
                      )
                    )}
                  </small>
                </div>
              </article>
            `;
          })
          .join("")}
      </section>

      ${renderPagination()}
    `;

    bindResultLinks(container);
  }

  /* =========================================================
     IMAGES
     ========================================================= */

  function renderImageResults(data) {
    const container = getResultsContainer();

    if (!container) return;

    const results =
      Array.isArray(data?.results)
        ? data.results
        : [];

    if (!results.length) {
      showNoResults(state.query);
      return;
    }

    container.innerHTML = `
      <div class="results-summary">
        ${formatNumber(results.length)} images
      </div>

      <div class="image-results">
        ${results
          .map((item) => {
            const image =
              safeURL(
                item.image_url ||
                item.image ||
                item.thumbnail
              );

            const pageURL =
              safeURL(
                item.url ||
                item.source_url ||
                "#"
              );

            if (image === "#") {
              return "";
            }

            return `
              <a
                class="image-card"
                href="${pageURL}"
                target="_blank"
                rel="noopener noreferrer"
              >
                <img
                  src="${image}"
                  alt="${escapeHTML(
                    item.title || state.query
                  )}"
                  loading="lazy"
                >

                <div class="image-caption">
                  ${escapeHTML(
                    item.title ||
                    item.domain ||
                    ""
                  )}
                </div>
              </a>
            `;
          })
          .join("")}
      </div>

      ${renderPagination()}
    `;

    bindResultLinks(container);
  }

  /* =========================================================
     VIDEOS
     ========================================================= */

  function renderVideoResults(data) {
    const container = getResultsContainer();

    if (!container) return;

    const results =
      Array.isArray(data?.results)
        ? data.results
        : [];

    if (!results.length) {
      showNoResults(state.query);
      return;
    }

    container.innerHTML = `
      <div class="results-summary">
        ${formatNumber(results.length)} videos
      </div>

      <section class="video-results">
        ${results
          .map((item) => {
            const url = safeURL(
              item.url ||
              item.link
            );

            return `
              <article class="video-card">
                ${
                  item.thumbnail
                    ? `
                      <a
                        href="${url}"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <img
                          src="${safeURL(item.thumbnail)}"
                          alt=""
                          loading="lazy"
                        >
                      </a>
                    `
                    : ""
                }

                <div class="video-info">
                  <h2>
                    <a
                      href="${url}"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      ${escapeHTML(
                        item.title ||
                        "Video"
                      )}
                    </a>
                  </h2>

                  <p>
                    ${escapeHTML(
                      item.description ||
                      item.snippet ||
                      ""
                    )}
                  </p>
                </div>
              </article>
            `;
          })
          .join("")}
      </section>

      ${renderPagination()}
    `;

    bindResultLinks(container);
  }

  /* =========================================================
     PAGINATION
     ========================================================= */

  function renderPagination() {
    const totalPages = Math.ceil(
      state.total / state.limit
    );

    if (totalPages <= 1) {
      return "";
    }

    const previousDisabled =
      state.page <= 1;

    const nextDisabled =
      state.page >= totalPages;

    return `
      <div class="pagination">
        <button
          type="button"
          class="page-btn"
          data-page-action="prev"
          ${previousDisabled ? "disabled" : ""}
        >
          ← Previous
        </button>

        <span class="page-number">
          Page ${state.page} of ${totalPages}
        </span>

        <button
          type="button"
          class="page-btn"
          data-page-action="next"
          ${nextDisabled ? "disabled" : ""}
        >
          Next →
        </button>
      </div>
    `;
  }

  /* =========================================================
     RESULT EVENTS
     ========================================================= */

  function bindResultLinks(container) {
    container
      .querySelectorAll("[data-query]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const query =
            button.getAttribute(
              "data-query"
            );

          if (query) {
            doSearch(
              query,
              "web",
              1
            );
          }
        });
      });

    container
      .querySelectorAll(
        "[data-page-action]"
      )
      .forEach((button) => {
        button.addEventListener(
          "click",
          () => {
            const action =
              button.getAttribute(
                "data-page-action"
              );

            if (
              action === "prev" &&
              state.page > 1
            ) {
              doSearch(
                state.query,
                state.mode,
                state.page - 1
              );
            }

            if (
              action === "next" &&
              state.page <
                Math.ceil(
                  state.total /
                    state.limit
                )
            ) {
              doSearch(
                state.query,
                state.mode,
                state.page + 1
              );
            }
          }
        );
      });
  }

  /* =========================================================
     SEARCH FORM
     ========================================================= */

  function submitSearch(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    const input = getSearchInput();

    if (!input) {
      console.warn(
        "[HEXORA] Search input not found."
      );
      return false;
    }

    const query = cleanText(
      input.value
    );

    if (!query) {
      input.focus();
      return false;
    }

    doSearch(
      query,
      state.mode,
      1
    );

    return false;
  }

  /* =========================================================
     MODE BUTTONS
     ========================================================= */

  function setMode(mode) {
    const validModes = [
      "web",
      "news",
      "images",
      "videos",
      "maps"
    ];

    if (
      !validModes.includes(mode)
    ) {
      mode = "web";
    }

    state.mode = mode;

    $$(
      "[data-mode]"
    ).forEach((button) => {
      const buttonMode =
        button.getAttribute(
          "data-mode"
        );

      button.classList.toggle(
        "active",
        buttonMode === mode
      );

      button.setAttribute(
        "aria-selected",
        buttonMode === mode
          ? "true"
          : "false"
      );
    });

    const input = getSearchInput();

    if (
      input &&
      cleanText(input.value)
    ) {
      doSearch(
        input.value,
        mode,
        1
      );
    }
  }

  /* =========================================================
     NAVIGATION
     ========================================================= */

  function bindNavigation() {
    $$(
      "[data-mode]"
    ).forEach((button) => {
      button.addEventListener(
        "click",
        (event) => {
          event.preventDefault();

          setMode(
            button.getAttribute(
              "data-mode"
            )
          );
        }
      );
    });

    $$(
      "[data-nav]"
    ).forEach((button) => {
      button.addEventListener(
        "click",
        (event) => {
          event.preventDefault();

          const target =
            button.getAttribute(
              "data-nav"
            );

          navigateTo(target);
        }
      );
    });

    $$(
      ".side-btn"
    ).forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          const target =
            button.getAttribute(
              "data-nav"
            );

          if (target) {
            navigateTo(target);
          }
        }
      );
    });
  }

  function navigateTo(target) {
    if (!target) return;

    const normalized =
      target
        .toLowerCase()
        .replace(/^#/, "");

    if (
      normalized === "home"
    ) {
      showHome();

      return;
    }

    if (
      normalized === "search"
    ) {
      showSearchView();

      const input =
        getSearchInput();

      if (input) {
        input.focus();
      }

      return;
    }

    const view =
      document.getElementById(
        `${normalized}View`
      );

    if (view) {
      hideAllViews();

      view.style.display = "";
      view.classList.add(
        "active"
      );

      return;
    }

    const selector =
      `[data-view="${normalized}"]`;

    const dataView =
      $(selector);

    if (dataView) {
      hideAllViews();

      dataView.style.display =
        "";

      dataView.classList.add(
        "active"
      );
    }
  }

  function showHome() {
    const home =
      getHomeView();

    if (!home) {
      showSearchView();
      return;
    }

    hideAllViews();

    home.style.display = "";
    home.classList.add(
      "active"
    );
  }

  /* =========================================================
     QUICK SEARCH BUTTONS
     ========================================================= */

  function bindQuickSearch() {
    $$(
      "[data-search]"
    ).forEach((button) => {
      button.addEventListener(
        "click",
        (event) => {
          event.preventDefault();

          const query =
            button.getAttribute(
              "data-search"
            );

          if (!query) return;

          const input =
            getSearchInput();

          if (input) {
            input.value = query;
          }

          doSearch(
            query,
            "web",
            1
          );
        }
      );
    });
  }

  /* =========================================================
     URL STATE
     ========================================================= */

  function updateURL() {
    try {
      const params =
        new URLSearchParams(
          window.location.search
        );

      if (state.query) {
        params.set(
          "q",
          state.query
        );
      } else {
        params.delete("q");
      }

      if (
        state.mode &&
        state.mode !== "web"
      ) {
        params.set(
          "mode",
          state.mode
        );
      } else {
        params.delete("mode");
      }

      const newURL =
        `${window.location.pathname}?${params.toString()}`;

      window.history.replaceState(
        {},
        "",
        newURL
      );
    } catch {
      // Ignore URL errors.
    }
  }

  function restoreURLState() {
    try {
      const params =
        new URLSearchParams(
          window.location.search
        );

      const query =
        cleanText(
          params.get("q")
        );

      const mode =
        params.get("mode") ||
        "web";

      if (query) {
        const input =
          getSearchInput();

        if (input) {
          input.value =
            query;
        }

        setModeWithoutSearch(
          mode
        );

        doSearch(
          query,
          mode,
          1
        );
      }
    } catch {
      // Ignore URL errors.
    }
  }

  function setModeWithoutSearch(
    mode
  ) {
    const validModes = [
      "web",
      "news",
      "images",
      "videos",
      "maps"
    ];

    if (
      !validModes.includes(mode)
    ) {
      mode = "web";
    }

    state.mode = mode;

    $$(
      "[data-mode]"
    ).forEach((button) => {
      const active =
        button.getAttribute(
          "data-mode"
        ) === mode;

      button.classList.toggle(
        "active",
        active
      );

      button.setAttribute(
        "aria-selected",
        active
          ? "true"
          : "false"
      );
    });
  }

  /* =========================================================
     SEARCH EVENTS
     ========================================================= */

  function bindSearch() {
    const form =
      getSearchForm();

    if (form) {
      form.addEventListener(
        "submit",
        submitSearch
      );
    }

    const input =
      getSearchInput();

    if (input) {
      input.addEventListener(
        "keydown",
        (event) => {
          if (
            event.key ===
            "Enter"
          ) {
            event.preventDefault();

            submitSearch(
              event
            );
          }
        }
      );
    }

    $$(
      "[data-search-submit]"
    ).forEach((button) => {
      button.addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          submitSearch(
            event
          );
        }
      );
    });

    $$(
      ".search-button"
    ).forEach((button) => {
      button.addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          submitSearch(
            event
          );
        }
      );
    });
  }

  /* =========================================================
     MAP SUPPORT
     ========================================================= */

  let mapInstance = null;

  async function initMap() {
    const mapElement =
      $("#hexoraMap");

    if (
      !mapElement ||
      mapInstance
    ) {
      return;
    }

    try {
      if (
        typeof window.maplibregl ===
        "undefined"
      ) {
        return;
      }

      mapInstance =
        new maplibregl.Map({
          container:
            "hexoraMap",

          style:
            "https://demotiles.maplibre.org/style.json",

          center: [
            78.9629,
            20.5937
          ],

          zoom: 4
        });

      mapInstance.addControl(
        new maplibregl.NavigationControl(),
        "top-right"
      );

    } catch (error) {
      console.warn(
        "[HEXORA] Map initialization failed:",
        error
      );
    }
  }

  function loadMapLibre() {
    if (
      window.maplibregl
    ) {
      initMap();
      return;
    }

    if (
      document.querySelector(
        'script[data-maplibre]'
      )
    ) {
      return;
    }

    const script =
      document.createElement(
        "script"
      );

    script.src =
      "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js";

    script.async = true;

    script.dataset.maplibre =
      "true";

    script.onload = () => {
      initMap();
    };

    script.onerror = () => {
      console.warn(
        "[HEXORA] MapLibre could not load."
      );
    };

    document.head.appendChild(
      script
    );

    if (
      !document.querySelector(
        'link[data-maplibre-css]'
      )
    ) {
      const link =
        document.createElement(
          "link"
        );

      link.rel =
        "stylesheet";

      link.href =
        "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css";

      link.dataset.maplibreCss =
        "true";

      document.head.appendChild(
        link
      );
    }
  }

  /* =========================================================
     GEOLOCATION
     ========================================================= */

  function bindLocationButton() {
    $$(
      "[data-location]"
    ).forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          if (
            !navigator.geolocation
          ) {
            alert(
              "Geolocation is not supported by this browser."
            );

            return;
          }

          navigator.geolocation.getCurrentPosition(
            (position) => {
              const {
                latitude,
                longitude
              } = position.coords;

              if (
                mapInstance
              ) {
                mapInstance.flyTo({
                  center: [
                    longitude,
                    latitude
                  ],
                  zoom: 12
                });

                new maplibregl.Marker()
                  .setLngLat([
                    longitude,
                    latitude
                  ])
                  .addTo(
                    mapInstance
                  );
              }
            },
            (error) => {
              console.warn(
                "[HEXORA] Location error:",
                error
              );
            },
            {
              enableHighAccuracy: true,
              timeout: 10000,
              maximumAge: 60000
            }
          );
        }
      );
    });
  }

  /* =========================================================
     UTILITIES
     ========================================================= */

  function formatNumber(value) {
    const number =
      Number(value);

    if (
      !Number.isFinite(
        number
      )
    ) {
      return "0";
    }

    return number.toLocaleString(
      "en-IN"
    );
  }

  function getDomain(url) {
    try {
      return new URL(
        url
      ).hostname;
    } catch {
      return "";
    }
  }

  function shortenURL(url) {
    const value =
      cleanText(url);

    if (
      value.length <= 100
    ) {
      return value;
    }

    return (
      value.slice(0, 97) +
      "..."
    );
  }

  function formatDate(value) {
    if (!value) return "";

    const date =
      new Date(value);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return "";
    }

    return date.toLocaleDateString(
      "en-IN",
      {
        year: "numeric",
        month: "short",
        day: "numeric"
      }
    );
  }

  /* =========================================================
     KEYBOARD SHORTCUT
     ========================================================= */

  function bindKeyboardShortcuts() {
    document.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key === "/" &&
          document.activeElement?.tagName !==
            "INPUT" &&
          document.activeElement?.tagName !==
            "TEXTAREA"
        ) {
          event.preventDefault();

          const input =
            getSearchInput();

          if (input) {
            input.focus();
          }
        }

        if (
          event.key === "Escape"
        ) {
          const input =
            getSearchInput();

          if (
            input &&
            document.activeElement ===
              input
          ) {
            input.blur();
          }
        }
      }
    );
  }

  /* =========================================================
     GLOBAL HEXORA API
     ========================================================= */

  window.HEXORA = {
    config: CONFIG,
    state,

    search(query, mode = "web") {
      return doSearch(
        query,
        mode,
        1
      );
    },

    setMode(mode) {
      setMode(mode);
    },

    home() {
      showHome();
    }
  };

  /* =========================================================
     INITIALIZATION
     ========================================================= */

  function init() {
    console.log(
      "[HEXORA] Frontend initialized."
    );

    console.log(
      "[HEXORA] Search endpoint:",
      CONFIG.searchEndpoint
    );

    bindSearch();
    bindNavigation();
    bindQuickSearch();
    bindLocationButton();
    bindKeyboardShortcuts();

    loadMapLibre();

    restoreURLState();

    /*
     * If no query exists, keep Home visible.
     * Otherwise search state will open automatically.
     */
    if (
      !window.location.search.includes(
        "q="
      )
    ) {
      const home =
        getHomeView();

      if (home) {
        showHome();
      }
    }
  }

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      {
        once: true
      }
    );
  } else {
    init();
  }
})();
