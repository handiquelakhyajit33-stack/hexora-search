(() => {
  "use strict";

  /* =====================================================
     HEXORA SEARCH FRONTEND
     Web / Images / News / Videos / Maps
  ===================================================== */

  if (window.__HEXORA_MAIN_LOADED__) {
    console.log("[HEXORA] main.js already loaded");
    return;
  }

  window.__HEXORA_MAIN_LOADED__ = true;

  const API_ENDPOINT = "/api/search";

  const VALID_MODES = new Set([
    "web",
    "images",
    "news",
    "videos",
    "maps",
  ]);

  const state = {
    mode: "web",
    query: "",
    searching: false,
  };

  /* =====================================================
     HELPERS
  ===================================================== */

  function $(selector) {
    return document.querySelector(selector);
  }

  function $$(selector) {
    return Array.from(
      document.querySelectorAll(selector)
    );
  }

  function clean(value) {
    return String(value ?? "").trim();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function safeUrl(value) {
    try {
      const url = new URL(value);

      if (
        url.protocol !== "http:" &&
        url.protocol !== "https:"
      ) {
        return null;
      }

      return url.href;
    } catch {
      return null;
    }
  }

  function getDomain(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  }

  /* =====================================================
     ELEMENTS
  ===================================================== */

  const searchForm = $("#searchForm");
  const searchInput = $("#searchInput");
  const results = $("#results");
  const resultMeta = $("#resultMeta");
  const searchView = $("#searchView");
  const mapView = $("#mapView");

  /* =====================================================
     BUTTON TYPE FIX
     
     Very important:
     data-mode buttons must NOT behave as
     form submit buttons.
  ===================================================== */

  $$("[data-mode]").forEach((button) => {
    if (
      button.tagName &&
      button.tagName.toLowerCase() === "button"
    ) {
      button.type = "button";
    }
  });

  $$("[data-home]").forEach((button) => {
    if (
      button.tagName &&
      button.tagName.toLowerCase() === "button"
    ) {
      button.type = "button";
    }
  });

  /* =====================================================
     VIEW CONTROL
  ===================================================== */

  function showSearchView() {
    if (searchView) {
      searchView.classList.add("active");
    }

    if (mapView) {
      mapView.classList.remove("active");
    }
  }

  function showHomeView() {
    if (searchView) {
      searchView.classList.remove("active");
    }

    if (mapView) {
      mapView.classList.remove("active");
    }

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  /* =====================================================
     MODE UI
  ===================================================== */

  function updateModeButtons(mode) {
    $$("[data-mode]").forEach((button) => {
      const buttonMode =
        clean(button.dataset.mode).toLowerCase();

      /*
       * Only search modes get active state.
       * AI / Engine / Workspace / Profile
       * are not search result modes.
       */
      if (VALID_MODES.has(buttonMode)) {
        button.classList.toggle(
          "active",
          buttonMode === mode
        );
      } else {
        button.classList.remove("active");
      }
    });
  }

  function modeName(mode) {
    const names = {
      web: "Web",
      images: "Images",
      news: "News",
      videos: "Videos",
      maps: "Maps",
    };

    return names[mode] || "Web";
  }

  function setMode(mode) {
    if (!VALID_MODES.has(mode)) {
      mode = "web";
    }

    state.mode = mode;

    updateModeButtons(mode);

    showSearchView();

    if (resultMeta) {
      resultMeta.textContent =
        `HEXORA ${modeName(mode)} Search`;
    }
  }

  /* =====================================================
     EMPTY MODE
  ===================================================== */

  function showModeReady(mode) {
    if (!results) return;

    const labels = {
      web: "Search the web",
      images: "Search images",
      news: "Search news",
      videos: "Search videos",
      maps: "Search places and maps",
    };

    results.innerHTML = `
      <div class="hexora-empty">
        <div class="hexora-empty-icon">⌕</div>
        <h2>${escapeHtml(
          labels[mode] || "Search HEXORA"
        )}</h2>
        <p>
          Enter a search query to see
          ${escapeHtml(modeName(mode).toLowerCase())}
          results.
        </p>
      </div>
    `;
  }

  /* =====================================================
     LOADING
  ===================================================== */

  function showLoading(mode) {
    if (!results) return;

    results.innerHTML = `
      <div class="hexora-loading">
        <div class="hexora-loading-logo">
          H
        </div>

        <div class="hexora-loading-title">
          HEXORA
        </div>

        <div class="hexora-loading-text">
          HEXORA is searching…
        </div>

        <div class="hexora-loading-mode">
          ${escapeHtml(modeName(mode))}
        </div>
      </div>
    `;
  }

  /* =====================================================
     NO DATA
  ===================================================== */

  function showNoData(mode, query) {
    if (!results) return;

    results.innerHTML = `
      <div class="hexora-empty">
        <div class="hexora-empty-icon">⌕</div>

        <h2>No data found</h2>

        <p>
          HEXORA could not find matching
          ${escapeHtml(
            modeName(mode).toLowerCase()
          )}
          data for
          <strong>${escapeHtml(query)}</strong>.
        </p>
      </div>
    `;
  }

  /* =====================================================
     RESULT META
  ===================================================== */

  function updateResultMeta(data, mode) {
    if (!resultMeta) return;

    const total =
      Number(
        data?.total ??
        data?.count ??
        data?.results?.length ??
        0
      );

    resultMeta.textContent =
      `${total} result${total === 1 ? "" : "s"} found • ${modeName(mode)}`;
  }

  /* =====================================================
     NORMALIZE API RESPONSE
  ===================================================== */

  function normalizeResults(data) {
    if (!data) {
      return [];
    }

    if (Array.isArray(data)) {
      return data;
    }

    if (Array.isArray(data.results)) {
      return data.results;
    }

    if (Array.isArray(data.data)) {
      return data.data;
    }

    if (Array.isArray(data.items)) {
      return data.items;
    }

    return [];
  }

  /* =====================================================
     WEB RESULTS
  ===================================================== */

  function renderWebResults(items) {
    if (!results) return;

    if (!items.length) {
      showNoData("web", state.query);
      return;
    }

    results.innerHTML = items
      .map((item) => {
        const url =
          safeUrl(
            item.url ||
            item.page_url ||
            item.link
          );

        const title =
          clean(
            item.title ||
            item.name ||
            item.heading ||
            url ||
            "Untitled"
          );

        const description =
          clean(
            item.description ||
            item.snippet ||
            item.content ||
            ""
          );

        const domain =
          clean(
            item.source_domain ||
            (url ? getDomain(url) : "")
          );

        return `
          <article class="result-card web-result">

            <div class="result-domain">
              ${escapeHtml(domain)}
            </div>

            <h2 class="result-title">
              ${
                url
                  ? `<a
                       href="${escapeHtml(url)}"
                       target="_blank"
                       rel="noopener noreferrer"
                     >
                       ${escapeHtml(title)}
                     </a>`
                  : escapeHtml(title)
              }
            </h2>

            ${
              description
                ? `
                  <p class="result-description">
                    ${escapeHtml(
                      description.slice(0, 500)
                    )}
                  </p>
                `
                : ""
            }

            ${
              url
                ? `
                  <div class="result-url">
                    ${escapeHtml(url)}
                  </div>
                `
                : ""
            }

          </article>
        `;
      })
      .join("");
  }

  /* =====================================================
     IMAGE RESULTS
  ===================================================== */

  function renderImageResults(items) {
    if (!results) return;

    if (!items.length) {
      showNoData("images", state.query);
      return;
    }

    results.innerHTML = `
      <div class="hexora-section-title">
        <h2>Images</h2>
        <p>
          Images for
          <strong>${escapeHtml(state.query)}</strong>
        </p>
      </div>

      <div class="hexora-image-grid">
        ${items
          .map((item) => {
            const imageUrl =
              safeUrl(
                item.image_url ||
                item.url ||
                item.image
              );

            const pageUrl =
              safeUrl(
                item.page_url ||
                item.source_url ||
                item.link
              );

            if (!imageUrl) {
              return "";
            }

            const title =
              clean(
                item.title ||
                item.alt_text ||
                item.name ||
                "HEXORA Image"
              );

            const domain =
              clean(
                item.source_domain ||
                (pageUrl
                  ? getDomain(pageUrl)
                  : "")
              );

            return `
              <article class="hexora-image-card">

                <a
                  ${
                    pageUrl
                      ? `href="${escapeHtml(
                          pageUrl
                        )}"`
                      : ""
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <div class="hexora-image-wrap">
                    <img
                      src="${escapeHtml(imageUrl)}"
                      alt="${escapeHtml(title)}"
                      loading="lazy"
                      referrerpolicy="no-referrer"
                      onerror="this.closest('.hexora-image-card')?.remove()"
                    />
                  </div>
                </a>

                <div class="hexora-image-info">
                  <div class="hexora-image-title">
                    ${escapeHtml(
                      title.slice(0, 120)
                    )}
                  </div>

                  ${
                    domain
                      ? `
                        <div class="hexora-image-domain">
                          ${escapeHtml(domain)}
                        </div>
                      `
                      : ""
                  }
                </div>

              </article>
            `;
          })
          .join("")}
      </div>
    `;
  }

  /* =====================================================
     NEWS RESULTS
  ===================================================== */

  function renderNewsResults(items) {
    if (!results) return;

    if (!items.length) {
      showNoData("news", state.query);
      return;
    }

    results.innerHTML = `
      <div class="hexora-section-title">
        <h2>News</h2>
        <p>
          News for
          <strong>${escapeHtml(state.query)}</strong>
        </p>
      </div>

      <div class="hexora-news-list">
        ${items
          .map((item) => {
            const url =
              safeUrl(
                item.url ||
                item.page_url ||
                item.link
              );

            const title =
              clean(
                item.title ||
                item.name ||
                "Untitled News"
              );

            const description =
              clean(
                item.description ||
                item.snippet ||
                ""
              );

            const source =
              clean(
                item.source_name ||
                item.source_domain ||
                (url ? getDomain(url) : "")
              );

            const image =
              safeUrl(
                item.image_url ||
                item.image ||
                item.thumbnail_url
              );

            const date =
              clean(
                item.published_at ||
                item.date ||
                ""
              );

            return `
              <article class="hexora-news-card">

                ${
                  image
                    ? `
                      <a
                        href="${
                          url
                            ? escapeHtml(url)
                            : "#"
                        }"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="hexora-news-image"
                      >
                        <img
                          src="${escapeHtml(image)}"
                          alt="${escapeHtml(title)}"
                          loading="lazy"
                          referrerpolicy="no-referrer"
                        />
                      </a>
                    `
                    : ""
                }

                <div class="hexora-news-content">

                  ${
                    source
                      ? `
                        <div class="hexora-news-source">
                          ${escapeHtml(source)}
                        </div>
                      `
                      : ""
                  }

                  <h2>
                    ${
                      url
                        ? `
                          <a
                            href="${escapeHtml(url)}"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            ${escapeHtml(title)}
                          </a>
                        `
                        : escapeHtml(title)
                    }
                  </h2>

                  ${
                    description
                      ? `
                        <p>
                          ${escapeHtml(
                            description.slice(0, 500)
                          )}
                        </p>
                      `
                      : ""
                  }

                  ${
                    date
                      ? `
                        <div class="hexora-news-date">
                          ${escapeHtml(date)}
                        </div>
                      `
                      : ""
                  }

                </div>

              </article>
            `;
          })
          .join("")}
      </div>
    `;
  }

  /* =====================================================
     VIDEO RESULTS
  ===================================================== */

  function renderVideoResults(items) {
    if (!results) return;

    if (!items.length) {
      showNoData("videos", state.query);
      return;
    }

    results.innerHTML = `
      <div class="hexora-section-title">
        <h2>Videos</h2>
        <p>
          Videos for
          <strong>${escapeHtml(state.query)}</strong>
        </p>
      </div>

      <div class="hexora-video-grid">
        ${items
          .map((item) => {
            const videoUrl =
              safeUrl(
                item.video_url ||
                item.url ||
                item.link
              );

            const pageUrl =
              safeUrl(
                item.page_url ||
                item.source_url
              );

            const thumbnail =
              safeUrl(
                item.thumbnail_url ||
                item.thumbnail ||
                item.image_url
              );

            const title =
              clean(
                item.title ||
                item.name ||
                "HEXORA Video"
              );

            const description =
              clean(
                item.description ||
                item.snippet ||
                ""
              );

            const domain =
              clean(
                item.source_domain ||
                (pageUrl
                  ? getDomain(pageUrl)
                  : videoUrl
                  ? getDomain(videoUrl)
                  : "")
              );

            return `
              <article class="hexora-video-card">

                ${
                  thumbnail
                    ? `
                      <a
                        href="${
                          videoUrl
                            ? escapeHtml(videoUrl)
                            : pageUrl
                            ? escapeHtml(pageUrl)
                            : "#"
                        }"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="hexora-video-thumb"
                      >
                        <img
                          src="${escapeHtml(
                            thumbnail
                          )}"
                          alt="${escapeHtml(title)}"
                          loading="lazy"
                          referrerpolicy="no-referrer"
                        />

                        <span class="hexora-play">
                          ▶
                        </span>
                      </a>
                    `
                    : `
                      <a
                        href="${
                          videoUrl
                            ? escapeHtml(videoUrl)
                            : pageUrl
                            ? escapeHtml(pageUrl)
                            : "#"
                        }"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="hexora-video-no-thumb"
                      >
                        ▶
                      </a>
                    `
                }

                <div class="hexora-video-info">

                  <h3>
                    ${escapeHtml(title)}
                  </h3>

                  ${
                    description
                      ? `
                        <p>
                          ${escapeHtml(
                            description.slice(0, 300)
                          )}
                        </p>
                      `
                      : ""
                  }

                  ${
                    domain
                      ? `
                        <div class="hexora-video-domain">
                          ${escapeHtml(domain)}
                        </div>
                      `
                      : ""
                  }

                </div>

              </article>
            `;
          })
          .join("")}
      </div>
    `;
  }

  /* =====================================================
     MAP / PLACE RESULTS
  ===================================================== */

  function renderMapResults(items) {
    if (!results) return;

    if (!items.length) {
      showNoData("maps", state.query);
      return;
    }

    results.innerHTML = `
      <div class="hexora-section-title">
        <h2>Maps</h2>
        <p>
          Places for
          <strong>${escapeHtml(state.query)}</strong>
        </p>
      </div>

      <div class="hexora-place-list">
        ${items
          .map((item) => {
            const pageUrl =
              safeUrl(
                item.page_url ||
                item.url ||
                item.link
              );

            const name =
              clean(
                item.name ||
                item.title ||
                "Unnamed place"
              );

            const address =
              clean(
                item.address ||
                [
                  item.city,
                  item.district,
                  item.state,
                  item.country,
                ]
                  .filter(Boolean)
                  .join(", ")
              );

            const lat =
              Number(item.latitude);

            const lon =
              Number(item.longitude);

            const hasCoordinates =
              Number.isFinite(lat) &&
              Number.isFinite(lon);

            return `
              <article class="hexora-place-card">

                <div class="hexora-place-icon">
                  ⌖
                </div>

                <div class="hexora-place-content">

                  <h2>
                    ${
                      pageUrl
                        ? `
                          <a
                            href="${escapeHtml(
                              pageUrl
                            )}"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            ${escapeHtml(name)}
                          </a>
                        `
                        : escapeHtml(name)
                    }
                  </h2>

                  ${
                    address
                      ? `
                        <p>
                          ${escapeHtml(address)}
                        </p>
                      `
                      : ""
                  }

                  ${
                    hasCoordinates
                      ? `
                        <div class="hexora-coordinates">
                          ${lat.toFixed(6)},
                          ${lon.toFixed(6)}
                        </div>

                        <a
                          class="hexora-map-link"
                          href="https://www.openstreetmap.org/?mlat=${encodeURIComponent(
                            lat
                          )}&mlon=${encodeURIComponent(
                            lon
                          )}#map=16/${encodeURIComponent(
                            lat
                          )}/${encodeURIComponent(
                            lon
                          )}"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          View location
                        </a>
                      `
                      : ""
                  }

                </div>

              </article>
            `;
          })
          .join("")}
      </div>
    `;
  }

  /* =====================================================
     RENDER BY MODE
  ===================================================== */

  function renderResults(data, mode) {
    const items =
      normalizeResults(data);

    updateResultMeta(data, mode);

    if (mode === "images") {
      renderImageResults(items);
      return;
    }

    if (mode === "news") {
      renderNewsResults(items);
      return;
    }

    if (mode === "videos") {
      renderVideoResults(items);
      return;
    }

    if (mode === "maps") {
      renderMapResults(items);
      return;
    }

    renderWebResults(items);
  }

  /* =====================================================
     SEARCH API
  ===================================================== */

  async function doSearch(query, mode) {
    query = clean(query);

    if (!VALID_MODES.has(mode)) {
      mode = "web";
    }

    if (!query) {
      state.query = "";
      state.searching = false;

      setMode(mode);
      showModeReady(mode);

      if (searchInput) {
        searchInput.focus();
      }

      return;
    }

    state.query = query;
    state.mode = mode;
    state.searching = true;

    setMode(mode);
    showLoading(mode);

    if (resultMeta) {
      resultMeta.textContent =
        `HEXORA ${modeName(mode)} Search`;
    }

    /*
     * IMPORTANT:
     * mode is ALWAYS sent to server.
     *
     * Example:
     * /api/search?q=Google&mode=images
     */
    const url =
      `${API_ENDPOINT}?q=${encodeURIComponent(
        query
      )}&mode=${encodeURIComponent(
        mode
      )}`;

    console.log(
      `[HEXORA] Searching mode=${mode}`,
      url
    );

    try {
      const response =
        await fetch(url, {
          method: "GET",
          headers: {
            Accept:
              "application/json",
          },
          cache: "no-store",
        });

      if (!response.ok) {
        throw new Error(
          `Search request failed: HTTP ${response.status}`
        );
      }

      const data =
        await response.json();

      /*
       * Prevent an old request from
       * replacing a newer tab result.
       */
      if (
        state.query !== query ||
        state.mode !== mode
      ) {
        return;
      }

      state.searching = false;

      renderResults(
        data,
        mode
      );
    } catch (error) {
      state.searching = false;

      console.error(
        "[HEXORA] Search error:",
        error
      );

      if (!results) return;

      results.innerHTML = `
        <div class="hexora-empty">

          <div class="hexora-empty-icon">
            !
          </div>

          <h2>
            Search temporarily unavailable
          </h2>

          <p>
            HEXORA could not complete this
            ${escapeHtml(
              modeName(mode).toLowerCase()
            )}
            search.
          </p>

        </div>
      `;
    }
  }

  /* =====================================================
     FORM SUBMIT
  ===================================================== */

  if (searchForm) {
    searchForm.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        event.stopPropagation();

        const query =
          clean(
            searchInput?.value
          );

        doSearch(
          query,
          state.mode
        );
      },
      true
    );
  }

  /* =====================================================
     MODE CLICK HANDLER
     
     CAPTURE PHASE:
     This prevents another old click handler
     from changing Images/News back to Web.
  ===================================================== */

  document.addEventListener(
    "click",
    (event) => {
      const modeButton =
        event.target.closest(
          "[data-mode]"
        );

      if (modeButton) {
        const mode =
          clean(
            modeButton.dataset.mode
          ).toLowerCase();

        /*
         * Search modes only.
         */
        if (
          VALID_MODES.has(mode)
        ) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();

          const query =
            clean(
              searchInput?.value
            ) ||
            state.query;

          setMode(mode);

          /*
           * Keep the selected tab visible.
           */
          if (query) {
            doSearch(
              query,
              mode
            );
          } else {
            showModeReady(mode);

            if (searchInput) {
              searchInput.focus();
            }
          }

          return;
        }
      }

      /* =================================================
         HOME
      ================================================= */

      const homeButton =
        event.target.closest(
          "[data-home]"
        );

      if (homeButton) {
        event.preventDefault();
        event.stopPropagation();

        showHomeView();

        return;
      }
    },
    true
  );

  /* =====================================================
     INITIAL STATE
  ===================================================== */

  setMode("web");

  if (searchInput) {
    searchInput.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key === "Enter"
        ) {
          event.preventDefault();

          if (searchForm) {
            searchForm.requestSubmit();
          }
        }
      }
    );
  }

  /* =====================================================
     HEXORA UI CSS
     
     Added dynamically so index.html does not
     need to be changed for the result layouts.
  ===================================================== */

  const style =
    document.createElement("style");

  style.id =
    "hexora-search-runtime-style";

  style.textContent = `
    .hexora-loading {
      min-height: 320px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 40px 20px;
    }

    .hexora-loading-logo {
      width: 64px;
      height: 64px;
      border-radius: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
      font-weight: 800;
      border: 1px solid rgba(0,255,255,.45);
      box-shadow:
        0 0 30px rgba(0,255,255,.20);
      animation: hexoraPulse 1.2s infinite;
    }

    .hexora-loading-title {
      margin-top: 18px;
      font-size: 22px;
      font-weight: 800;
      letter-spacing: 3px;
    }

    .hexora-loading-text {
      margin-top: 10px;
      opacity: .8;
      font-size: 15px;
    }

    .hexora-loading-mode {
      margin-top: 8px;
      font-size: 13px;
      opacity: .55;
    }

    @keyframes hexoraPulse {
      0%,100% {
        transform: scale(1);
        opacity: .7;
      }
      50% {
        transform: scale(1.08);
        opacity: 1;
      }
    }

    .hexora-empty {
      min-height: 280px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 40px 20px;
      opacity: .9;
    }

    .hexora-empty-icon {
      width: 58px;
      height: 58px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid rgba(0,255,255,.35);
      font-size: 24px;
      margin-bottom: 16px;
    }

    .hexora-empty h2 {
      margin: 0 0 8px;
    }

    .hexora-empty p {
      margin: 0;
      max-width: 600px;
      line-height: 1.6;
      opacity: .7;
    }

    .hexora-section-title {
      margin-bottom: 20px;
    }

    .hexora-section-title h2 {
      margin: 0 0 6px;
    }

    .hexora-section-title p {
      margin: 0;
      opacity: .65;
    }

    .hexora-image-grid {
      display: grid;
      grid-template-columns:
        repeat(auto-fill, minmax(190px, 1fr));
      gap: 16px;
    }

    .hexora-image-card {
      overflow: hidden;
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,.08);
      background: rgba(255,255,255,.025);
      transition: transform .2s ease,
                  border-color .2s ease;
    }

    .hexora-image-card:hover {
      transform: translateY(-3px);
      border-color: rgba(0,255,255,.35);
    }

    .hexora-image-wrap {
      width: 100%;
      aspect-ratio: 16 / 10;
      overflow: hidden;
      background: rgba(0,0,0,.2);
    }

    .hexora-image-wrap img {
      width: 100%;
      height: 100%;
      display: block;
      object-fit: cover;
    }

    .hexora-image-info {
      padding: 11px;
    }

    .hexora-image-title {
      font-size: 14px;
      line-height: 1.4;
    }

    .hexora-image-domain {
      margin-top: 5px;
      font-size: 12px;
      opacity: .55;
    }

    .hexora-news-list {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .hexora-news-card {
      display: flex;
      gap: 18px;
      padding: 16px;
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,.08);
      background: rgba(255,255,255,.025);
    }

    .hexora-news-image {
      width: 190px;
      min-width: 190px;
      height: 120px;
      overflow: hidden;
      border-radius: 10px;
    }

    .hexora-news-image img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    .hexora-news-content {
      min-width: 0;
    }

    .hexora-news-source {
      font-size: 12px;
      opacity: .55;
      margin-bottom: 7px;
    }

    .hexora-news-content h2 {
      margin: 0 0 8px;
      font-size: 19px;
      line-height: 1.35;
    }

    .hexora-news-content p {
      margin: 0;
      opacity: .7;
      line-height: 1.5;
    }

    .hexora-news-date {
      margin-top: 9px;
      font-size: 12px;
      opacity: .5;
    }

    .hexora-video-grid {
      display: grid;
      grid-template-columns:
        repeat(auto-fill, minmax(260px, 1fr));
      gap: 18px;
    }

    .hexora-video-card {
      overflow: hidden;
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,.08);
      background: rgba(255,255,255,.025);
    }

    .hexora-video-thumb {
      position: relative;
      display: block;
      aspect-ratio: 16 / 9;
      overflow: hidden;
    }

    .hexora-video-thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    .hexora-play {
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      width: 52px;
      height: 52px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,.7);
      font-size: 21px;
    }

    .hexora-video-no-thumb {
      height: 150px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 38px;
      border-bottom: 1px solid rgba(255,255,255,.08);
    }

    .hexora-video-info {
      padding: 14px;
    }

    .hexora-video-info h3 {
      margin: 0;
      line-height: 1.4;
    }

    .hexora-video-info p {
      margin: 8px 0 0;
      opacity: .65;
      line-height: 1.45;
    }

    .hexora-video-domain {
      margin-top: 9px;
      font-size: 12px;
      opacity: .5;
    }

    .hexora-place-list {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .hexora-place-card {
      display: flex;
      gap: 15px;
      padding: 17px;
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,.08);
      background: rgba(255,255,255,.025);
    }

    .hexora-place-icon {
      width: 44px;
      height: 44px;
      min-width: 44px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid rgba(0,255,255,.3);
      font-size: 21px;
    }

    .hexora-place-content h2 {
      margin: 0 0 6px;
    }

    .hexora-place-content p {
      margin: 0;
      opacity: .7;
      line-height: 1.5;
    }

    .hexora-coordinates {
      margin-top: 7px;
      font-size: 12px;
      opacity: .5;
    }

    .hexora-map-link {
      display: inline-block;
      margin-top: 9px;
      font-size: 13px;
    }

    @media (max-width: 600px) {

      .hexora-image-grid {
        grid-template-columns:
          repeat(2, minmax(0, 1fr));
        gap: 10px;
      }

      .hexora-news-card {
        flex-direction: column;
      }

      .hexora-news-image {
        width: 100%;
        min-width: 0;
        height: 180px;
      }

      .hexora-video-grid {
        grid-template-columns: 1fr;
      }

      .hexora-place-card {
        padding: 13px;
      }
    }
  `;

  document.head.appendChild(style);

  console.log(
    "[HEXORA] Search frontend initialized successfully"
  );
})();
