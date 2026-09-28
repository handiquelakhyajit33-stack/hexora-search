/* =========================================================
   HEXORA SEARCH ENGINE
   main.js
   Category Search: Web / Images / News / Videos / Maps
   ========================================================= */

(() => {
  "use strict";

  /* -------------------------------------------------------
     Prevent duplicate script initialization
  ------------------------------------------------------- */

  if (window.__HEXORA_MAIN_LOADED__) {
    console.warn("[HEXORA] main.js already loaded.");
    return;
  }

  window.__HEXORA_MAIN_LOADED__ = true;

  /* -------------------------------------------------------
     CONFIG
  ------------------------------------------------------- */

  const CONFIG = {
    apiEndpoint: "/api/search",

    modes: [
      "web",
      "images",
      "news",
      "videos",
      "maps"
    ]
  };

  /* -------------------------------------------------------
     STATE
  ------------------------------------------------------- */

  const state = {
    mode: "web",
    query: "",
    searching: false
  };

  /* -------------------------------------------------------
     DOM HELPERS
  ------------------------------------------------------- */

  const $ = (selector, root = document) =>
    root.querySelector(selector);

  const $$ = (selector, root = document) =>
    Array.from(root.querySelectorAll(selector));

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
      const url = new URL(value, window.location.origin);

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

  function hostname(value) {
    try {
      return new URL(value).hostname;
    } catch {
      return "";
    }
  }

  /* -------------------------------------------------------
     FIND ELEMENTS
  ------------------------------------------------------- */

  const searchForm = $("#searchForm");
  const searchInput = $("#searchInput");
  const resultsEl = $("#results");
  const resultMeta = $("#resultMeta");
  const searchView = $("#searchView");

  /* -------------------------------------------------------
     MODE NAMES
  ------------------------------------------------------- */

  function modeName(mode) {
    switch (mode) {
      case "images":
        return "images";

      case "news":
        return "news";

      case "videos":
        return "videos";

      case "maps":
        return "maps";

      case "web":
      default:
        return "web";
    }
  }

  function modeLabel(mode) {
    switch (mode) {
      case "images":
        return "Images";

      case "news":
        return "News";

      case "videos":
        return "Videos";

      case "maps":
        return "Maps";

      case "web":
      default:
        return "Web";
    }
  }

  /* -------------------------------------------------------
     BUTTON TYPE FIX
     Prevent data-mode buttons from submitting forms
  ------------------------------------------------------- */

  function prepareModeButtons() {
    $$("[data-mode]").forEach((button) => {
      if (
        button.tagName === "BUTTON" &&
        !button.getAttribute("type")
      ) {
        button.setAttribute(
          "type",
          "button"
        );
      }
    });
  }

  /* -------------------------------------------------------
     MODE BUTTON UI
  ------------------------------------------------------- */

  function updateModeButtons() {
    $$("[data-mode]").forEach((button) => {
      const buttonMode =
        button.dataset.mode;

      if (
        CONFIG.modes.includes(buttonMode)
      ) {
        button.classList.toggle(
          "active",
          buttonMode === state.mode
        );

        button.setAttribute(
          "aria-selected",
          buttonMode === state.mode
            ? "true"
            : "false"
        );
      }
    });
  }

  /* -------------------------------------------------------
     SEARCH / HOME VIEW
  ------------------------------------------------------- */

  function showSearchView() {
    if (searchView) {
      searchView.classList.add("active");
    }

    const homeElements = [
      "[data-home-view]",
      "#homeView",
      ".hero"
    ];

    homeElements.forEach((selector) => {
      $$(selector).forEach((element) => {
        if (
          element !== searchView &&
          !element.closest("#searchView")
        ) {
          element.classList.add(
            "hexora-hidden-home"
          );
        }
      });
    });
  }

  function showHomeView() {
    if (searchView) {
      searchView.classList.remove("active");
    }

    $$(".hexora-hidden-home").forEach(
      (element) => {
        element.classList.remove(
          "hexora-hidden-home"
        );
      }
    );
  }

  /* -------------------------------------------------------
     SEARCH INPUT
  ------------------------------------------------------- */

  function getSearchQuery() {
    if (!searchInput) {
      return "";
    }

    return String(
      searchInput.value || ""
    ).trim();
  }

  /* -------------------------------------------------------
     LOADING UI
  ------------------------------------------------------- */

  function renderLoading(query, mode) {
    if (!resultsEl) return;

    const label =
      modeLabel(mode);

    if (resultMeta) {
      resultMeta.textContent =
        `HEXORA Search • ${label}`;
    }

    resultsEl.innerHTML = `
      <div class="hexora-loading">
        <div class="hexora-loading-logo">
          H
        </div>

        <div class="hexora-loading-text">
          <strong>
            HEXORA is searching ${escapeHtml(
              label.toLowerCase()
            )}...
          </strong>

          <span>
            Searching for "${escapeHtml(
              query
            )}"
          </span>
        </div>
      </div>
    `;
  }

  /* -------------------------------------------------------
     NO RECORD UI
  ------------------------------------------------------- */

  function renderNoRecord(query, mode) {
    if (!resultsEl) return;

    const label =
      modeLabel(mode);

    if (resultMeta) {
      resultMeta.textContent =
        `HEXORA • ${label}`;
    }

    resultsEl.innerHTML = `
      <div class="hexora-empty">
        <div class="hexora-empty-icon">
          ⌕
        </div>

        <h2>No record found</h2>

        <p>
          HEXORA could not find matching
          ${escapeHtml(
            label.toLowerCase()
          )}
          records for
          "<strong>${escapeHtml(
            query
          )}</strong>".
        </p>
      </div>
    `;
  }

  /* -------------------------------------------------------
     ERROR UI
  ------------------------------------------------------- */

  function renderError(message) {
    if (!resultsEl) return;

    resultsEl.innerHTML = `
      <div class="hexora-error">
        <div class="hexora-error-icon">
          !
        </div>

        <h2>Search error</h2>

        <p>
          ${escapeHtml(
            message ||
              "HEXORA could not complete the search."
          )}
        </p>

        <button
          type="button"
          class="secondary"
          id="hexoraRetryBtn"
        >
          Try again
        </button>
      </div>
    `;

    const retry =
      $("#hexoraRetryBtn");

    if (retry) {
      retry.addEventListener(
        "click",
        () => {
          if (state.query) {
            doSearch(
              state.query,
              state.mode
            );
          }
        }
      );
    }
  }

  /* -------------------------------------------------------
     RESPONSE NORMALIZATION
  ------------------------------------------------------- */

  function normalizeResponse(data) {
    if (!data) {
      return {
        total: 0,
        results: []
      };
    }

    let results = [];

    if (Array.isArray(data.results)) {
      results = data.results;
    } else if (Array.isArray(data.data)) {
      results = data.data;
    } else if (Array.isArray(data.items)) {
      results = data.items;
    } else if (
      Array.isArray(data.rows)
    ) {
      results = data.rows;
    }

    let total;

    if (
      typeof data.total === "number"
    ) {
      total = data.total;
    } else {
      total = results.length;
    }

    return {
      total,
      results,
      raw: data
    };
  }

  /* -------------------------------------------------------
     WEB RESULT RENDERER
  ------------------------------------------------------- */

  function renderWebResults(
    results,
    total
  ) {
    if (!resultsEl) return;

    if (!results.length) {
      renderNoRecord(
        state.query,
        "web"
      );
      return;
    }

    if (resultMeta) {
      resultMeta.textContent =
        `${total} ${
          total === 1
            ? "result"
            : "results"
        } found`;
    }

    resultsEl.innerHTML =
      results
        .map((item) => {
          const url =
            safeUrl(
              item.url ||
              item.page_url ||
              item.link
            );

          const title =
            item.title ||
            item.name ||
            "Untitled result";

          const description =
            item.description ||
            item.snippet ||
            item.content ||
            "";

          const domain =
            item.source_domain ||
            (url
              ? hostname(url)
              : "");

          if (!url) {
            return `
              <article class="hexora-web-result">
                <h2>
                  ${escapeHtml(title)}
                </h2>

                <p>
                  ${escapeHtml(
                    description
                  )}
                </p>
              </article>
            `;
          }

          return `
            <article class="hexora-web-result">

              <div class="hexora-result-domain">
                ${escapeHtml(domain)}
              </div>

              <h2>
                <a
                  href="${escapeHtml(url)}"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  ${escapeHtml(title)}
                </a>
              </h2>

              <div class="hexora-result-url">
                ${escapeHtml(url)}
              </div>

              ${
                description
                  ? `
                    <p>
                      ${escapeHtml(
                        description
                      )}
                    </p>
                  `
                  : ""
              }

            </article>
          `;
        })
        .join("");
  }

  /* -------------------------------------------------------
     IMAGE RESULT RENDERER
  ------------------------------------------------------- */

  function renderImageResults(
    results,
    total
  ) {
    if (!resultsEl) return;

    if (!results.length) {
      renderNoRecord(
        state.query,
        "images"
      );
      return;
    }

    if (resultMeta) {
      resultMeta.textContent =
        `${total} ${
          total === 1
            ? "image"
            : "images"
        } found`;
    }

    resultsEl.innerHTML = `
      <div class="hexora-image-grid">

        ${results
          .map((item) => {
            const imageUrl =
              safeUrl(
                item.image_url ||
                item.url ||
                item.src
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
              item.title ||
              item.alt_text ||
              item.alt ||
              item.name ||
              state.query;

            const domain =
              item.source_domain ||
              (pageUrl
                ? hostname(pageUrl)
                : "");

            return `
              <article class="hexora-image-card">

                <a
                  href="${
                    pageUrl ||
                    imageUrl
                  }"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="hexora-image-link"
                >

                  <div class="hexora-image-box">

                    <img
                      src="${escapeHtml(
                        imageUrl
                      )}"
                      alt="${escapeHtml(
                        title
                      )}"
                      loading="lazy"
                      referrerpolicy="no-referrer"
                      onerror="this.closest('.hexora-image-card')?.remove();"
                    />

                  </div>

                </a>

                <div class="hexora-image-info">

                  <strong>
                    ${escapeHtml(
                      title
                    )}
                  </strong>

                  ${
                    domain
                      ? `
                        <span>
                          ${escapeHtml(
                            domain
                          )}
                        </span>
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

  /* -------------------------------------------------------
     NEWS RESULT RENDERER
  ------------------------------------------------------- */

  function renderNewsResults(
    results,
    total
  ) {
    if (!resultsEl) return;

    if (!results.length) {
      renderNoRecord(
        state.query,
        "news"
      );
      return;
    }

    if (resultMeta) {
      resultMeta.textContent =
        `${total} ${
          total === 1
            ? "news result"
            : "news results"
        } found`;
    }

    resultsEl.innerHTML =
      results
        .map((item) => {
          const url =
            safeUrl(
              item.url ||
              item.page_url ||
              item.link
            );

          const imageUrl =
            safeUrl(
              item.image_url ||
              item.thumbnail_url
            );

          const title =
            item.title ||
            "Untitled news";

          const description =
            item.description ||
            item.snippet ||
            "";

          const source =
            item.source_name ||
            item.source_domain ||
            (url
              ? hostname(url)
              : "");

          const date =
            item.published_at ||
            item.date ||
            item.created_at ||
            "";

          let formattedDate = "";

          if (date) {
            try {
              formattedDate =
                new Date(date)
                  .toLocaleDateString(
                    undefined,
                    {
                      year: "numeric",
                      month: "short",
                      day: "numeric"
                    }
                  );
            } catch {
              formattedDate =
                String(date);
            }
          }

          return `
            <article class="hexora-news-card">

              ${
                imageUrl
                  ? `
                    <a
                      href="${
                        url ||
                        imageUrl
                      }"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="hexora-news-image"
                    >
                      <img
                        src="${escapeHtml(
                          imageUrl
                        )}"
                        alt="${escapeHtml(
                          title
                        )}"
                        loading="lazy"
                        referrerpolicy="no-referrer"
                      />
                    </a>
                  `
                  : ""
              }

              <div class="hexora-news-body">

                <div class="hexora-news-source">
                  ${escapeHtml(
                    source
                  )}

                  ${
                    formattedDate
                      ? `
                        <span>
                          • ${escapeHtml(
                            formattedDate
                          )}
                        </span>
                      `
                      : ""
                  }
                </div>

                <h2>
                  ${
                    url
                      ? `
                        <a
                          href="${escapeHtml(
                            url
                          )}"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          ${escapeHtml(
                            title
                          )}
                        </a>
                      `
                      : escapeHtml(
                          title
                        )
                  }
                </h2>

                ${
                  description
                    ? `
                      <p>
                        ${escapeHtml(
                          description
                        )}
                      </p>
                    `
                    : ""
                }

              </div>

            </article>
          `;
        })
        .join("");
  }

  /* -------------------------------------------------------
     VIDEO RESULT RENDERER
  ------------------------------------------------------- */

  function renderVideoResults(
    results,
    total
  ) {
    if (!resultsEl) return;

    if (!results.length) {
      renderNoRecord(
        state.query,
        "videos"
      );
      return;
    }

    if (resultMeta) {
      resultMeta.textContent =
        `${total} ${
          total === 1
            ? "video"
            : "videos"
        } found`;
    }

    resultsEl.innerHTML =
      results
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
              item.image_url
            );

          const title =
            item.title ||
            state.query;

          const description =
            item.description ||
            "";

          if (!videoUrl) {
            return "";
          }

          return `
            <article class="hexora-video-card">

              <div class="hexora-video-player">

                ${
                  thumbnail
                    ? `
                      <a
                        href="${escapeHtml(
                          videoUrl
                        )}"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <img
                          src="${escapeHtml(
                            thumbnail
                          )}"
                          alt="${escapeHtml(
                            title
                          )}"
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
                        href="${escapeHtml(
                          videoUrl
                        )}"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="hexora-video-open"
                      >
                        ▶ Watch video
                      </a>
                    `
                }

              </div>

              <div class="hexora-video-body">

                <h2>
                  <a
                    href="${escapeHtml(
                      videoUrl
                    )}"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    ${escapeHtml(
                      title
                    )}
                  </a>
                </h2>

                ${
                  description
                    ? `
                      <p>
                        ${escapeHtml(
                          description
                        )}
                      </p>
                    `
                    : ""
                }

                ${
                  pageUrl
                    ? `
                      <span class="hexora-video-source">
                        ${escapeHtml(
                          hostname(
                            pageUrl
                          )
                        )}
                      </span>
                    `
                    : ""
                }

              </div>

            </article>
          `;
        })
        .join("");
  }

  /* -------------------------------------------------------
     MAP RESULT RENDERER
  ------------------------------------------------------- */

  function renderMapResults(
    results,
    total
  ) {
    if (!resultsEl) return;

    if (!results.length) {
      renderNoRecord(
        state.query,
        "maps"
      );
      return;
    }

    if (resultMeta) {
      resultMeta.textContent =
        `${total} ${
          total === 1
            ? "place"
            : "places"
        } found`;
    }

    resultsEl.innerHTML =
      results
        .map((item) => {
          const pageUrl =
            safeUrl(
              item.page_url ||
              item.url ||
              item.link
            );

          const name =
            item.name ||
            item.title ||
            "Unnamed place";

          const address =
            item.address ||
            [
              item.city,
              item.district,
              item.state,
              item.country
            ]
              .filter(Boolean)
              .join(", ");

          const latitude =
            Number(item.latitude);

          const longitude =
            Number(item.longitude);

          let mapUrl = null;

          if (
            Number.isFinite(latitude) &&
            Number.isFinite(longitude)
          ) {
            mapUrl =
              `https://www.openstreetmap.org/?mlat=${encodeURIComponent(
                latitude
              )}&mlon=${encodeURIComponent(
                longitude
              )}#map=16/${encodeURIComponent(
                latitude
              )}/${encodeURIComponent(
                longitude
              )}`;
          }

          return `
            <article class="hexora-map-card">

              <div class="hexora-map-icon">
                ⌖
              </div>

              <div class="hexora-map-body">

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
                          ${escapeHtml(
                            name
                          )}
                        </a>
                      `
                      : escapeHtml(
                          name
                        )
                  }
                </h2>

                ${
                  address
                    ? `
                      <p>
                        ${escapeHtml(
                          address
                        )}
                      </p>
                    `
                    : ""
                }

                ${
                  Number.isFinite(
                    latitude
                  ) &&
                  Number.isFinite(
                    longitude
                  )
                    ? `
                      <div class="hexora-coordinates">
                        ${escapeHtml(
                          latitude
                        )},
                        ${escapeHtml(
                          longitude
                        )}
                      </div>
                    `
                    : ""
                }

                ${
                  mapUrl
                    ? `
                      <a
                        href="${escapeHtml(
                          mapUrl
                        )}"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="secondary hexora-map-link"
                      >
                        Open map
                      </a>
                    `
                    : ""
                }

              </div>

            </article>
          `;
        })
        .join("");
  }

  /* -------------------------------------------------------
     RENDER RESULT BASED ON MODE
  ------------------------------------------------------- */

  function renderResults(
    mode,
    results,
    total
  ) {
    switch (mode) {
      case "images":
        renderImageResults(
          results,
          total
        );
        break;

      case "news":
        renderNewsResults(
          results,
          total
        );
        break;

      case "videos":
        renderVideoResults(
          results,
          total
        );
        break;

      case "maps":
        renderMapResults(
          results,
          total
        );
        break;

      case "web":
      default:
        renderWebResults(
          results,
          total
        );
        break;
    }
  }

  /* -------------------------------------------------------
     SEARCH API
  ------------------------------------------------------- */

  async function doSearch(
    query,
    mode = state.mode
  ) {
    const cleanQuery =
      String(query || "").trim();

    if (!cleanQuery) {
      return;
    }

    if (
      !CONFIG.modes.includes(mode)
    ) {
      mode = "web";
    }

    state.query =
      cleanQuery;

    state.mode =
      mode;

    state.searching = true;

    updateModeButtons();
    prepareModeButtons();

    showSearchView();

    if (searchInput) {
      searchInput.value =
        cleanQuery;
    }

    renderLoading(
      cleanQuery,
      mode
    );

    try {
      /*
       * IMPORTANT:
       * mode is ALWAYS sent to backend.
       *
       * This prevents Images/News/Videos
       * from accidentally receiving Web results.
       */

      const url =
        `${CONFIG.apiEndpoint}` +
        `?q=${encodeURIComponent(
          cleanQuery
        )}` +
        `&mode=${encodeURIComponent(
          mode
        )}`;

      console.log(
        "[HEXORA] Searching:",
        url
      );

      const response =
        await fetch(url, {
          method: "GET",
          headers: {
            Accept:
              "application/json"
          },
          cache: "no-store"
        });

      if (!response.ok) {
        throw new Error(
          `Search request failed (${response.status})`
        );
      }

      const data =
        await response.json();

      /*
       * Ignore stale responses if the user
       * starts another search before this one ends.
       */
      if (
        state.query !== cleanQuery ||
        state.mode !== mode
      ) {
        return;
      }

      const normalized =
        normalizeResponse(data);

      const results =
        Array.isArray(
          normalized.results
        )
          ? normalized.results
          : [];

      const total =
        Number.isFinite(
          normalized.total
        )
          ? normalized.total
          : results.length;

      /*
       * Strict category behaviour:
       *
       * Images -> ONLY image renderer
       * News   -> ONLY news renderer
       * Videos -> ONLY video renderer
       * Maps   -> ONLY map renderer
       * Web    -> ONLY web renderer
       *
       * No fallback to another category.
       */

      if (results.length === 0) {
        renderNoRecord(
          cleanQuery,
          mode
        );
      } else {
        renderResults(
          mode,
          results,
          total
        );
      }
    } catch (error) {
      console.error(
        "[HEXORA] Search error:",
        error
      );

      renderError(
        error?.message ||
          "Unable to connect to HEXORA search server."
      );
    } finally {
      state.searching = false;
    }
  }

  /* -------------------------------------------------------
     SET MODE
  ------------------------------------------------------- */

  function setMode(
    mode,
    options = {}
  ) {
    if (
      !CONFIG.modes.includes(mode)
    ) {
      return;
    }

    state.mode = mode;

    updateModeButtons();

    const shouldSearch =
      options.search !== false;

    const query =
      getSearchQuery();

    /*
     * If there is already a query,
     * selecting a category immediately searches
     * that category.
     */

    if (
      shouldSearch &&
      query
    ) {
      doSearch(
        query,
        mode
      );
    } else if (
      searchView &&
      searchView.classList.contains(
        "active"
      )
    ) {
      /*
       * If search page is already open but
       * no query exists, show category name.
       */

      if (resultMeta) {
        resultMeta.textContent =
          `HEXORA • ${modeLabel(
            mode
          )}`;
      }

      if (resultsEl) {
        resultsEl.innerHTML = `
          <div class="hexora-empty">
            <div class="hexora-empty-icon">
              ⌕
            </div>

            <h2>
              Search ${escapeHtml(
                modeLabel(mode)
              )}
            </h2>

            <p>
              Enter a search query to search
              HEXORA ${escapeHtml(
                modeLabel(mode)
              ).toLowerCase()}.
            </p>
          </div>
        `;
      }
    }
  }

  /* -------------------------------------------------------
     SEARCH FORM
  ------------------------------------------------------- */

  if (searchForm) {
    searchForm.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        event.stopPropagation();

        const query =
          getSearchQuery();

        if (!query) {
          if (searchInput) {
            searchInput.focus();
          }

          return;
        }

        doSearch(
          query,
          state.mode
        );
      }
    );
  }

  /* -------------------------------------------------------
     MODE CLICK HANDLER
  ------------------------------------------------------- */

  /*
   * Capture phase is used so another old listener
   * cannot accidentally reset the selected mode.
   */

  document.addEventListener(
    "click",
    (event) => {
      const target =
        event.target instanceof Element
          ? event.target
          : null;

      if (!target) return;

      const button =
        target.closest(
          "[data-mode]"
        );

      if (!button) return;

      const mode =
        button.dataset.mode;

      /*
       * Only handle actual HEXORA search modes.
       * AI / Engine / Workspace / Profile etc.
       * are left for their own application handlers.
       */

      if (
        !CONFIG.modes.includes(mode)
      ) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      setMode(mode);

    },
    true
  );

  /* -------------------------------------------------------
     HOME BUTTON
  ------------------------------------------------------- */

  document.addEventListener(
    "click",
    (event) => {
      const target =
        event.target instanceof Element
          ? event.target
          : null;

      if (!target) return;

      const homeButton =
        target.closest(
          "[data-home]"
        );

      if (!homeButton) return;

      /*
       * Do not interfere with links.
       */
      if (
        homeButton.tagName === "A" &&
        homeButton.getAttribute("href")
      ) {
        return;
      }

      event.preventDefault();

      showHomeView();
    }
  );

  /* -------------------------------------------------------
     KEYBOARD SHORTCUT
  ------------------------------------------------------- */

  document.addEventListener(
    "keydown",
    (event) => {
      /*
       * "/" focuses search box.
       */

      if (
        event.key === "/" &&
        document.activeElement !==
          searchInput
      ) {
        event.preventDefault();

        if (searchInput) {
          searchInput.focus();
        }
      }

      /*
       * Escape clears search view.
       */

      if (
        event.key === "Escape" &&
        document.activeElement ===
          searchInput
      ) {
        if (searchInput) {
          searchInput.blur();
        }
      }
    }
  );

  /* -------------------------------------------------------
     DYNAMIC CSS
     Only adds styles needed by result renderers.
  ------------------------------------------------------- */

  function injectStyles() {
    if (
      document.getElementById(
        "hexora-main-js-styles"
      )
    ) {
      return;
    }

    const style =
      document.createElement("style");

    style.id =
      "hexora-main-js-styles";

    style.textContent = `
      .hexora-hidden-home {
        display: none !important;
      }

      .hexora-loading {
        min-height: 260px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 16px;
        text-align: center;
        padding: 40px 20px;
      }

      .hexora-loading-logo {
        width: 58px;
        height: 58px;
        border-radius: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 25px;
        font-weight: 900;
        border: 1px solid rgba(0,255,255,.45);
        box-shadow:
          0 0 24px rgba(0,255,255,.18);
        animation:
          hexoraPulse 1.2s ease-in-out infinite;
      }

      .hexora-loading-text {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .hexora-loading-text strong {
        font-size: 17px;
      }

      .hexora-loading-text span {
        opacity: .65;
        font-size: 13px;
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

      .hexora-empty,
      .hexora-error {
        min-height: 260px;
        padding: 50px 20px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
      }

      .hexora-empty-icon,
      .hexora-error-icon {
        width: 52px;
        height: 52px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px solid rgba(0,255,255,.35);
        margin-bottom: 15px;
        font-size: 24px;
      }

      .hexora-empty h2,
      .hexora-error h2 {
        margin: 0 0 8px;
      }

      .hexora-empty p,
      .hexora-error p {
        max-width: 560px;
        opacity: .7;
        line-height: 1.6;
      }

      .hexora-web-result {
        padding: 18px 0;
        border-bottom: 1px solid rgba(255,255,255,.08);
      }

      .hexora-result-domain {
        font-size: 12px;
        opacity: .55;
        margin-bottom: 5px;
      }

      .hexora-web-result h2 {
        margin: 4px 0;
        font-size: 20px;
      }

      .hexora-web-result h2 a {
        text-decoration: none;
      }

      .hexora-web-result h2 a:hover {
        text-decoration: underline;
      }

      .hexora-result-url {
        font-size: 12px;
        opacity: .5;
        word-break: break-all;
        margin-bottom: 7px;
      }

      .hexora-web-result p {
        margin: 5px 0 0;
        opacity: .72;
        line-height: 1.6;
      }

      .hexora-image-grid {
        display: grid;
        grid-template-columns:
          repeat(auto-fill, minmax(190px, 1fr));
        gap: 16px;
        padding: 16px 0;
      }

      .hexora-image-card {
        overflow: hidden;
        border: 1px solid rgba(255,255,255,.08);
        border-radius: 16px;
        background: rgba(255,255,255,.025);
      }

      .hexora-image-link {
        display: block;
      }

      .hexora-image-box {
        width: 100%;
        aspect-ratio: 1 / 1;
        overflow: hidden;
        background: rgba(0,0,0,.25);
      }

      .hexora-image-box img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
        transition: transform .25s ease;
      }

      .hexora-image-card:hover img {
        transform: scale(1.04);
      }

      .hexora-image-info {
        padding: 11px;
        display: flex;
        flex-direction: column;
        gap: 5px;
      }

      .hexora-image-info strong {
        font-size: 13px;
        line-height: 1.4;
      }

      .hexora-image-info span {
        font-size: 11px;
        opacity: .55;
      }

      .hexora-news-card {
        display: grid;
        grid-template-columns: 190px 1fr;
        gap: 18px;
        padding: 18px 0;
        border-bottom: 1px solid rgba(255,255,255,.08);
      }

      .hexora-news-image {
        display: block;
        width: 100%;
        aspect-ratio: 16 / 10;
        overflow: hidden;
        border-radius: 12px;
        background: rgba(255,255,255,.04);
      }

      .hexora-news-image img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }

      .hexora-news-source {
        font-size: 12px;
        opacity: .6;
        margin-bottom: 7px;
      }

      .hexora-news-body h2 {
        margin: 0 0 8px;
        font-size: 20px;
      }

      .hexora-news-body h2 a {
        text-decoration: none;
      }

      .hexora-news-body p {
        margin: 0;
        opacity: .7;
        line-height: 1.55;
      }

      .hexora-video-card {
        display: grid;
        grid-template-columns: 280px 1fr;
        gap: 18px;
        padding: 18px 0;
        border-bottom: 1px solid rgba(255,255,255,.08);
      }

      .hexora-video-player {
        position: relative;
        aspect-ratio: 16 / 9;
        overflow: hidden;
        border-radius: 14px;
        background: #050505;
      }

      .hexora-video-player img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }

      .hexora-video-player a {
        display: block;
        width: 100%;
        height: 100%;
        position: relative;
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
        background: rgba(0,0,0,.72);
        font-size: 20px;
      }

      .hexora-video-open {
        display: flex !important;
        align-items: center;
        justify-content: center;
        color: white;
        text-decoration: none;
        font-weight: 700;
      }

      .hexora-video-body h2 {
        margin: 0 0 8px;
        font-size: 19px;
      }

      .hexora-video-body h2 a {
        text-decoration: none;
      }

      .hexora-video-body p {
        margin: 0 0 10px;
        opacity: .7;
        line-height: 1.5;
      }

      .hexora-video-source {
        font-size: 12px;
        opacity: .55;
      }

      .hexora-map-card {
        display: flex;
        gap: 16px;
        padding: 18px 0;
        border-bottom: 1px solid rgba(255,255,255,.08);
      }

      .hexora-map-icon {
        width: 46px;
        height: 46px;
        min-width: 46px;
        border-radius: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px solid rgba(0,255,255,.25);
        font-size: 22px;
      }

      .hexora-map-body h2 {
        margin: 0 0 6px;
      }

      .hexora-map-body h2 a {
        text-decoration: none;
      }

      .hexora-map-body p {
        margin: 0 0 7px;
        opacity: .7;
      }

      .hexora-coordinates {
        font-size: 12px;
        opacity: .55;
        margin-bottom: 10px;
      }

      .hexora-map-link {
        display: inline-block;
        text-decoration: none;
        padding: 7px 11px;
        border-radius: 8px;
      }

      @media (max-width: 700px) {
        .hexora-news-card,
        .hexora-video-card {
          grid-template-columns: 1fr;
        }

        .hexora-image-grid {
          grid-template-columns:
            repeat(2, minmax(0, 1fr));
          gap: 10px;
        }

        .hexora-web-result h2,
        .hexora-news-body h2 {
          font-size: 17px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  /* -------------------------------------------------------
     INITIALIZATION
  ------------------------------------------------------- */

  function init() {
    prepareModeButtons();
    updateModeButtons();
    injectStyles();

    /*
     * Keep initial mode as Web.
     */

    state.mode = "web";

    /*
     * If URL contains ?q=...
     * automatically search it.
     */

    try {
      const params =
        new URLSearchParams(
          window.location.search
        );

      const q =
        params.get("q");

      const mode =
        params.get("mode");

      if (
        q &&
        q.trim()
      ) {
        const validMode =
          CONFIG.modes.includes(
            mode
          )
            ? mode
            : "web";

        if (searchInput) {
          searchInput.value =
            q.trim();
        }

        state.mode =
          validMode;

        updateModeButtons();

        doSearch(
          q.trim(),
          validMode
        );
      }
    } catch {
      // Ignore invalid URL params.
    }

    console.log(
      "[HEXORA] Search UI initialized."
    );
  }

  /*
   * DOM may already be ready or still loading.
   */

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

  /* -------------------------------------------------------
     OPTIONAL GLOBAL API
     Useful for existing HEXORA UI buttons.
  ------------------------------------------------------- */

  window.HEXORA = {
    ...(window.HEXORA || {}),

    search: (
      query,
      mode = "web"
    ) =>
      doSearch(
        query,
        mode
      ),

    setMode,

    getState: () => ({
      ...state
    })
  };

})();
