(() => {
  "use strict";

  const API_ENDPOINT = "/api/search";

  const SEARCH_MODES = [
    "web",
    "images",
    "news",
    "videos",
    "maps"
  ];

  const SPECIAL_MODES = [
    "ai",
    "engine",
    "workspace",
    "profile"
  ];

  const MODE_NAMES = {
    web: "Web",
    images: "Images",
    news: "News",
    videos: "Videos",
    maps: "Maps"
  };

  const state = {
    mode: "web",
    query: "",
    searching: false
  };

  const searchForm =
    document.getElementById("searchForm");

  const searchInput =
    document.getElementById("searchInput");

  const searchView =
    document.getElementById("searchView");

  const homeView =
    document.getElementById("homeView");

  const mapView =
    document.getElementById("mapView");

  const results =
    document.getElementById("results");

  const resultMeta =
    document.getElementById("resultMeta");

  /* ==================================================
     HELPERS
  ================================================== */

  function cleanQuery(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isSearchMode(mode) {
    return SEARCH_MODES.includes(mode);
  }

  function escapeHTML(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function safeURL(value) {
    const raw =
      String(value || "").trim();

    if (!raw) return "";

    try {
      const url =
        new URL(
          raw,
          window.location.origin
        );

      if (
        url.protocol !== "http:" &&
        url.protocol !== "https:"
      ) {
        return "";
      }

      return url.href;
    } catch {
      return "";
    }
  }

  function getModeFromURL() {
    try {
      const params =
        new URLSearchParams(
          window.location.search
        );

      const mode =
        params.get("mode");

      return isSearchMode(mode)
        ? mode
        : null;
    } catch {
      return null;
    }
  }

  function getQueryFromURL() {
    try {
      const params =
        new URLSearchParams(
          window.location.search
        );

      return cleanQuery(
        params.get("q")
      );
    } catch {
      return "";
    }
  }

  function updateURL() {
    try {
      const params =
        new URLSearchParams();

      if (state.query) {
        params.set(
          "q",
          state.query
        );
      }

      params.set(
        "mode",
        state.mode
      );

      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}?${params.toString()}`
      );
    } catch {
      // Ignore
    }
  }

  /* ==================================================
     VIEW CONTROL
  ================================================== */

  function showHome() {
    if (homeView) {
      homeView.style.display = "";
    }

    if (searchView) {
      searchView.classList.remove("active");
      searchView.style.display = "none";
    }

    if (mapView) {
      mapView.classList.remove("active");
      mapView.style.display = "none";
    }
  }

  function showSearch() {
    if (homeView) {
      homeView.style.display = "none";
    }

    if (searchView) {
      searchView.classList.add("active");
      searchView.style.display = "block";
    }

    if (mapView) {
      mapView.classList.remove("active");
      mapView.style.display = "none";
    }
  }

  function showMap() {
    if (homeView) {
      homeView.style.display = "none";
    }

    if (searchView) {
      searchView.classList.remove("active");
      searchView.style.display = "none";
    }

    if (mapView) {
      mapView.classList.add("active");
      mapView.style.display = "block";
    }
  }

  /* ==================================================
     ACTIVE TAB
  ================================================== */

  function updateActiveTabs() {
    const buttons =
      document.querySelectorAll(
        "[data-mode]"
      );

    buttons.forEach(button => {
      const mode =
        button.getAttribute(
          "data-mode"
        );

      /*
       * Only actual search modes can
       * become active search tabs.
       */
      if (!isSearchMode(mode)) {
        return;
      }

      button.classList.toggle(
        "active",
        mode === state.mode
      );

      button.setAttribute(
        "aria-selected",
        mode === state.mode
          ? "true"
          : "false"
      );
    });
  }

  /* ==================================================
     LOADING
  ================================================== */

  function showLoading() {
    if (!results) return;

    const name =
      MODE_NAMES[state.mode] ||
      "Web";

    if (resultMeta) {
      resultMeta.textContent =
        `HEXORA ${name} Search`;
    }

    results.innerHTML = `
      <div class="state">
        <div style="
          font-size:22px;
          margin-bottom:10px;
          color:#00eaff;
        ">
          ◌
        </div>

        <div style="
          color:#dffaff;
          font-weight:800;
          margin-bottom:6px;
        ">
          HEXORA is searching ${escapeHTML(name)}…
        </div>

        <div>
          Searching for
          “${escapeHTML(state.query)}”
        </div>
      </div>
    `;
  }

  function showNoResults() {
    if (!results) return;

    const name =
      MODE_NAMES[state.mode] ||
      "Web";

    if (resultMeta) {
      resultMeta.textContent =
        `HEXORA ${name} Search`;
    }

    results.innerHTML = `
      <div class="state">
        <div style="
          font-size:28px;
          color:#00eaff;
          margin-bottom:8px;
        ">
          ⌕
        </div>

        <strong style="
          display:block;
          color:#fff;
          margin-bottom:7px;
        ">
          No record found
        </strong>

        <span>
          HEXORA could not find matching
          ${escapeHTML(name.toLowerCase())}
          data for
          “${escapeHTML(state.query)}”.
        </span>
      </div>
    `;
  }

  function showError(message) {
    if (!results) return;

    results.innerHTML = `
      <div class="state">
        <strong style="
          display:block;
          color:#ff8c8c;
          margin-bottom:7px;
        ">
          HEXORA Search Error
        </strong>

        <span>
          ${escapeHTML(message)}
        </span>
      </div>
    `;
  }

  /* ==================================================
     WEB
  ================================================== */

  function renderWeb(data) {
    const rows =
      Array.isArray(data?.results)
        ? data.results
        : [];

    if (!rows.length) {
      showNoResults();
      return;
    }

    if (resultMeta) {
      resultMeta.textContent =
        `HEXORA Web · ${data.total ?? rows.length} results`;
    }

    results.innerHTML =
      rows.map(item => {

        const url =
          safeURL(
            item.url ||
            item.page_url ||
            item.canonical_url ||
            item.link
          );

        const title =
          item.title ||
          item.name ||
          item.page_title ||
          "Untitled";

        const description =
          item.description ||
          item.snippet ||
          item.content ||
          item.text ||
          "";

        const domain =
          item.source_domain ||
          item.domain ||
          "";

        return `
          <article class="search-result">

            <div class="result-source">
              ${escapeHTML(domain)}
            </div>

            <div class="result-title">
              ${
                url
                  ? `
                    <a
                      href="${escapeHTML(url)}"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      ${escapeHTML(title)}
                    </a>
                  `
                  : escapeHTML(title)
              }
            </div>

            ${
              url
                ? `
                  <div class="result-url">
                    ${escapeHTML(url)}
                  </div>
                `
                : ""
            }

            ${
              description
                ? `
                  <div class="result-description">
                    ${escapeHTML(description)}
                  </div>
                `
                : ""
            }

            ${
              item.created_at
                ? `
                  <div class="result-date">
                    ${escapeHTML(
                      item.created_at
                    )}
                  </div>
                `
                : ""
            }

          </article>
        `;
      }).join("");
  }

  /* ==================================================
     IMAGES
  ================================================== */

  function renderImages(data) {
    const rows =
      Array.isArray(data?.results)
        ? data.results
        : [];

    if (!rows.length) {
      showNoResults();
      return;
    }

    if (resultMeta) {
      resultMeta.textContent =
        `HEXORA Images · ${data.total ?? rows.length} results`;
    }

    results.innerHTML = `
      <div style="
        display:grid;
        grid-template-columns:
          repeat(auto-fill,minmax(190px,1fr));
        gap:14px;
      ">

        ${rows.map(item => {

          const imageURL =
            safeURL(
              item.image_url ||
              item.url ||
              item.src
            );

          const pageURL =
            safeURL(
              item.page_url ||
              item.source_url
            );

          const title =
            item.title ||
            item.alt_text ||
            "HEXORA Image";

          if (!imageURL) {
            return "";
          }

          return `
            <article style="
              overflow:hidden;
              border:1px solid rgba(71,203,255,.13);
              border-radius:15px;
              background:rgba(5,20,33,.78);
            ">

              ${
                pageURL
                  ? `
                    <a
                      href="${escapeHTML(pageURL)}"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                  `
                  : ""
              }

              <img
                src="${escapeHTML(imageURL)}"
                alt="${escapeHTML(title)}"
                loading="lazy"
                style="
                  display:block;
                  width:100%;
                  height:190px;
                  object-fit:cover;
                  background:#06111d;
                "
                onerror="
                  this.closest('article').style.display='none'
                "
              >

              <div style="
                padding:11px;
              ">

                <div style="
                  font-size:13px;
                  font-weight:700;
                  white-space:nowrap;
                  overflow:hidden;
                  text-overflow:ellipsis;
                ">
                  ${escapeHTML(title)}
                </div>

                ${
                  item.source_domain
                    ? `
                      <div style="
                        margin-top:5px;
                        font-size:10px;
                        color:#71879b;
                      ">
                        ${escapeHTML(
                          item.source_domain
                        )}
                      </div>
                    `
                    : ""
                }

              </div>

              ${
                pageURL
                  ? "</a>"
                  : ""
              }

            </article>
          `;
        }).join("")}

      </div>
    `;
  }

  /* ==================================================
     NEWS
  ================================================== */

  function renderNews(data) {
    const rows =
      Array.isArray(data?.results)
        ? data.results
        : [];

    if (!rows.length) {
      showNoResults();
      return;
    }

    if (resultMeta) {
      resultMeta.textContent =
        `HEXORA News · ${data.total ?? rows.length} results`;
    }

    results.innerHTML =
      rows.map(item => {

        const url =
          safeURL(
            item.url ||
            item.link ||
            item.page_url
          );

        const image =
          safeURL(
            item.image_url ||
            item.image ||
            item.thumbnail
          );

        const title =
          item.title ||
          item.headline ||
          "News";

        const description =
          item.description ||
          item.snippet ||
          "";

        return `
          <article class="search-result">

            ${
              image
                ? `
                  <img
                    src="${escapeHTML(image)}"
                    alt=""
                    loading="lazy"
                    style="
                      width:150px;
                      height:90px;
                      object-fit:cover;
                      border-radius:10px;
                      float:left;
                      margin:0 14px 8px 0;
                    "
                    onerror="
                      this.style.display='none'
                    "
                  >
                `
                : ""
            }

            <div class="result-source">
              ${escapeHTML(
                item.source_domain ||
                item.source ||
                ""
              )}
            </div>

            <div class="result-title">
              ${
                url
                  ? `
                    <a
                      href="${escapeHTML(url)}"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      ${escapeHTML(title)}
                    </a>
                  `
                  : escapeHTML(title)
              }
            </div>

            ${
              description
                ? `
                  <div class="result-description">
                    ${escapeHTML(description)}
                  </div>
                `
                : ""
            }

            <div style="clear:both"></div>

          </article>
        `;
      }).join("");
  }

  /* ==================================================
     VIDEOS
  ================================================== */

  function renderVideos(data) {
    const rows =
      Array.isArray(data?.results)
        ? data.results
        : [];

    if (!rows.length) {
      showNoResults();
      return;
    }

    if (resultMeta) {
      resultMeta.textContent =
        `HEXORA Videos · ${data.total ?? rows.length} results`;
    }

    results.innerHTML =
      rows.map(item => {

        const videoURL =
          safeURL(
            item.video_url ||
            item.url ||
            item.link
          );

        const thumbnail =
          safeURL(
            item.thumbnail ||
            item.thumbnail_url ||
            item.image_url
          );

        const title =
          item.title ||
          item.name ||
          "Video";

        return `
          <article class="search-result">

            <div style="
              display:flex;
              gap:14px;
            ">

              ${
                thumbnail
                  ? `
                    <img
                      src="${escapeHTML(thumbnail)}"
                      alt=""
                      loading="lazy"
                      style="
                        width:160px;
                        height:95px;
                        object-fit:cover;
                        border-radius:10px;
                        flex:none;
                      "
                      onerror="
                        this.style.display='none'
                      "
                    >
                  `
                  : ""
              }

              <div>

                <div class="result-source">
                  ${escapeHTML(
                    item.source_domain ||
                    item.source ||
                    ""
                  )}
                </div>

                <div class="result-title">

                  ${
                    videoURL
                      ? `
                        <a
                          href="${escapeHTML(videoURL)}"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          ▶ ${escapeHTML(title)}
                        </a>
                      `
                      : `
                        ▶ ${escapeHTML(title)}
                      `
                  }

                </div>

                ${
                  item.description ||
                  item.snippet
                    ? `
                      <div class="result-description">
                        ${escapeHTML(
                          item.description ||
                          item.snippet ||
                          ""
                        )}
                      </div>
                    `
                    : ""
                }

              </div>

            </div>

          </article>
        `;
      }).join("");
  }

  /* ==================================================
     MAP RESULTS
  ================================================== */

  function renderMaps(data) {
    const rows =
      Array.isArray(data?.results)
        ? data.results
        : [];

    if (!rows.length) {
      showNoResults();
      return;
    }

    if (resultMeta) {
      resultMeta.textContent =
        `HEXORA Maps · ${data.total ?? rows.length} places`;
    }

    results.innerHTML =
      rows.map(item => {

        const url =
          safeURL(
            item.url ||
            item.page_url
          );

        const name =
          item.name ||
          item.title ||
          "Place";

        const address =
          item.address ||
          item.formatted_address ||
          "";

        return `
          <article class="search-result">

            <div style="
              display:flex;
              gap:13px;
            ">

              <div style="
                font-size:27px;
                color:#00eaff;
              ">
                ⌖
              </div>

              <div>

                <div class="result-title">

                  ${
                    url
                      ? `
                        <a
                          href="${escapeHTML(url)}"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          ${escapeHTML(name)}
                        </a>
                      `
                      : escapeHTML(name)
                  }

                </div>

                ${
                  address
                    ? `
                      <div class="result-description">
                        ${escapeHTML(address)}
                      </div>
                    `
                    : ""
                }

              </div>

            </div>

          </article>
        `;
      }).join("");
  }

  /* ==================================================
     RENDER ROUTER
  ================================================== */

  function renderResults(data, mode) {

    /*
     * VERY IMPORTANT:
     * Always use the mode saved BEFORE fetch.
     */

    if (mode === "images") {
      renderImages(data);
      return;
    }

    if (mode === "news") {
      renderNews(data);
      return;
    }

    if (mode === "videos") {
      renderVideos(data);
      return;
    }

    if (mode === "maps") {
      renderMaps(data);
      return;
    }

    renderWeb(data);
  }

  /* ==================================================
     SEARCH
  ================================================== */

  async function doSearch(
    query,
    selectedMode
  ) {

    query =
      cleanQuery(query);

    /*
     * Never allow undefined/null mode
     * to silently become another tab.
     */

    const mode =
      isSearchMode(selectedMode)
        ? selectedMode
        : "web";

    state.query = query;
    state.mode = mode;
    state.searching = true;

    updateActiveTabs();
    updateURL();

    /*
     * MAP SEARCH
     */

    if (mode === "maps") {
      showMap();
    } else {
      showSearch();
      showLoading();
    }

    if (!query) {
      state.searching = false;

      if (results) {
        results.innerHTML = "";
      }

      return;
    }

    try {

      const requestURL =
        `${API_ENDPOINT}?q=${encodeURIComponent(
          query
        )}&mode=${encodeURIComponent(
          mode
        )}`;

      console.log(
        "[HEXORA SEARCH]",
        {
          query,
          mode,
          url: requestURL
        }
      );

      const response =
        await fetch(
          requestURL,
          {
            method: "GET",
            headers: {
              Accept:
                "application/json"
            },
            cache: "no-store"
          }
        );

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}`
        );
      }

      const data =
        await response.json();

      /*
       * CRITICAL:
       * Backend response can NEVER
       * change the selected frontend tab.
       *
       * We continue using `mode`.
       */

      state.mode = mode;
      state.query = query;

      updateActiveTabs();
      updateURL();

      if (mode === "maps") {
        showMap();
      } else {
        showSearch();
      }

      renderResults(
        data,
        mode
      );

    } catch (error) {

      console.error(
        "[HEXORA SEARCH ERROR]",
        error
      );

      if (mode !== state.mode) {
        state.mode = mode;
        updateActiveTabs();
      }

      showError(
        "Could not connect to HEXORA search server."
      );

    } finally {
      state.searching = false;
    }
  }

  /* ==================================================
     MODE CLICK
  ================================================== */

  document.addEventListener(
    "click",
    event => {

      const button =
        event.target.closest(
          "[data-mode]"
        );

      if (!button) {
        return;
      }

      const mode =
        button.getAttribute(
          "data-mode"
        );

      /*
       * AI / Engine / Workspace /
       * Profile are NOT search modes.
       */

      if (!isSearchMode(mode)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      /*
       * SAVE THE MODE IMMEDIATELY.
       */

      state.mode = mode;

      updateActiveTabs();
      updateURL();

      /*
       * If user already typed a query,
       * immediately search using the
       * newly selected mode.
       */

      const query =
        cleanQuery(
          searchInput
            ? searchInput.value
            : state.query
        );

      state.query = query;

      if (mode === "maps") {
        showMap();
      } else {
        showSearch();
      }

      if (query) {
        doSearch(
          query,
          mode
        );
      }

    },
    true
  );

  /* ==================================================
     HOME CLICK
  ================================================== */

  document.addEventListener(
    "click",
    event => {

      const button =
        event.target.closest(
          "[data-home]"
        );

      if (!button) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      state.query = "";
      state.mode = "web";
      state.searching = false;

      if (searchInput) {
        searchInput.value = "";
      }

      updateActiveTabs();

      try {
        window.history.replaceState(
          {},
          "",
          window.location.pathname
        );
      } catch {
        // Ignore
      }

      showHome();

    },
    true
  );

  /* ==================================================
     SEARCH FORM
  ================================================== */

  if (searchForm) {

    searchForm.addEventListener(
      "submit",
      event => {

        event.preventDefault();
        event.stopPropagation();

        const query =
          cleanQuery(
            searchInput
              ? searchInput.value
              : ""
          );

        /*
         * THIS IS THE IMPORTANT FIX.
         *
         * Never write:
         *
         * doSearch(query, "web")
         *
         * Always use current state.mode.
         */

        doSearch(
          query,
          state.mode
        );

      },
      true
    );

  }

  /* ==================================================
     INPUT ENTER
  ================================================== */

  if (searchInput) {

    searchInput.addEventListener(
      "keydown",
      event => {

        if (
          event.key !== "Enter"
        ) {
          return;
        }

        event.preventDefault();

        const query =
          cleanQuery(
            searchInput.value
          );

        doSearch(
          query,
          state.mode
        );

      }
    );

  }

  /* ==================================================
     INITIALIZE
  ================================================== */

  function initialize() {

    const urlMode =
      getModeFromURL();

    const urlQuery =
      getQueryFromURL();

    state.mode =
      urlMode || "web";

    state.query =
      urlQuery || "";

    updateActiveTabs();

    if (searchInput) {
      searchInput.value =
        state.query;
    }

    if (
      state.query &&
      isSearchMode(state.mode)
    ) {

      doSearch(
        state.query,
        state.mode
      );

    } else {

      showHome();

    }
  }

  /* ==================================================
     BROWSER BACK / FORWARD
  ================================================== */

  window.addEventListener(
    "popstate",
    () => {

      const mode =
        getModeFromURL() ||
        "web";

      const query =
        getQueryFromURL();

      state.mode = mode;
      state.query = query;

      updateActiveTabs();

      if (searchInput) {
        searchInput.value =
          query;
      }

      if (query) {
        doSearch(
          query,
          mode
        );
      } else {
        showHome();
      }

    }
  );

  /* ==================================================
     DEBUG
  ================================================== */

  window.HEXORA_SEARCH = {
    state,
    doSearch,
    setMode(mode) {

      if (!isSearchMode(mode)) {
        return;
      }

      state.mode = mode;

      updateActiveTabs();
      updateURL();

      if (state.query) {
        doSearch(
          state.query,
          mode
        );
      }
    }
  };

  initialize();

})();
