/* =========================================================
   HEXORA SEARCH ENGINE — MAIN.JS
   Works with:
   Web / Images / News / Videos / Maps
   Backend:
   /api/search?q=QUERY&mode=MODE
   ========================================================= */

(() => {
  "use strict";

  const CONFIG = {
    searchEndpoint: "/api/search",
    newsEndpoint: "/api/news",

    mapLibreJS:
      "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js",

    mapLibreCSS:
      "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css",

    geocoder:
      "https://nominatim.openstreetmap.org/search",

    defaultCenter: [91.7362, 26.1445],
    defaultZoom: 5,
    timeout: 20000
  };

  const VALID_MODES = [
    "web",
    "images",
    "news",
    "videos",
    "maps"
  ];

  const state = {
    mode: "web",
    query: "",
    searching: false,
    map: null,
    mapLoaded: false,
    mapMarker: null
  };

  /* =========================================================
     HELPERS
     ========================================================= */

  function $(selector) {
    return document.querySelector(selector);
  }

  function $$(selector) {
    return [...document.querySelectorAll(selector)];
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
    if (!value) return "#";

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

  function truncate(value, length = 220) {
    const text = String(value ?? "").trim();

    if (text.length <= length) {
      return text;
    }

    return text.slice(0, length - 1) + "…";
  }

  function formatDate(value) {
    if (!value) return "";

    try {
      const date = new Date(value);

      if (Number.isNaN(date.getTime())) {
        return String(value);
      }

      return new Intl.DateTimeFormat("en", {
        year: "numeric",
        month: "short",
        day: "numeric"
      }).format(date);
    } catch {
      return String(value);
    }
  }

  async function fetchJSON(url, options = {}) {
    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, CONFIG.timeout);

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

      let data = {};

      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new Error(
          `Server returned invalid JSON (${response.status})`
        );
      }

      if (!response.ok) {
        throw new Error(
          data?.error ||
          data?.message ||
          `Request failed (${response.status})`
        );
      }

      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  function getResultsArray(data) {
    if (Array.isArray(data)) return data;

    if (Array.isArray(data?.results)) {
      return data.results;
    }

    if (Array.isArray(data?.data)) {
      return data.data;
    }

    if (Array.isArray(data?.items)) {
      return data.items;
    }

    return [];
  }

  function getTotal(data, results) {
    if (typeof data?.total === "number") {
      return data.total;
    }

    return results.length;
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
      default:
        return "Web";
    }
  }

  /* =========================================================
     VIEW CONTROL
     ========================================================= */

  function showHomeView() {
    const searchView = $("#searchView");
    const mapView = $("#mapView");

    if (searchView) {
      searchView.classList.remove("active");
    }

    if (mapView) {
      mapView.classList.remove("active");
    }

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }

  function showSearchView() {
    const searchView = $("#searchView");
    const mapView = $("#mapView");

    if (searchView) {
      searchView.classList.add("active");
    }

    if (mapView) {
      mapView.classList.remove("active");
    }

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }

  function showMapView() {
    const searchView = $("#searchView");
    const mapView = $("#mapView");

    if (searchView) {
      searchView.classList.remove("active");
    }

    if (mapView) {
      mapView.classList.add("active");
    }

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });

    setTimeout(() => {
      initializeMap();
    }, 100);
  }

  /* =========================================================
     LOADING
     ========================================================= */

  function showSearching(query, mode) {
    const results = $("#results");
    const meta = $("#resultMeta");

    if (!results) return;

    if (meta) {
      meta.textContent =
        `Searching ${modeLabel(mode)} for "${query}"…`;
    }

    results.innerHTML = `
      <div class="hexora-searching"
           style="
             min-height:240px;
             display:flex;
             align-items:center;
             justify-content:center;
             flex-direction:column;
             gap:14px;
             text-align:center;
           ">

        <div
          style="
            width:58px;
            height:58px;
            border-radius:50%;
            border:3px solid rgba(0,255,255,.15);
            border-top-color:#00ffff;
            animation:hexoraSpin .9s linear infinite;
          ">
        </div>

        <div
          style="
            font-size:20px;
            font-weight:700;
            color:#00ffff;
          ">
          HEXORA
        </div>

        <div style="opacity:.75;">
          HEXORA is searching…
        </div>

        <div style="font-size:13px;opacity:.55;">
          ${escapeHTML(modeLabel(mode))}
        </div>
      </div>

      <style>
        @keyframes hexoraSpin {
          to {
            transform:rotate(360deg);
          }
        }
      </style>
    `;
  }

  function showNoResults(query, mode) {
    const results = $("#results");
    const meta = $("#resultMeta");

    if (meta) {
      meta.textContent =
        `0 results • ${modeLabel(mode)}`;
    }

    if (!results) return;

    results.innerHTML = `
      <div
        style="
          padding:60px 20px;
          text-align:center;
          opacity:.8;
        ">

        <div style="font-size:48px;margin-bottom:15px;">
          ⌕
        </div>

        <div
          style="
            font-size:22px;
            font-weight:700;
            margin-bottom:10px;
          ">
          No data found
        </div>

        <div style="opacity:.65;">
          No ${escapeHTML(modeLabel(mode).toLowerCase())}
          results found for
          "<strong>${escapeHTML(query)}</strong>".
        </div>

      </div>
    `;
  }

  function showSearchError(error) {
    const results = $("#results");
    const meta = $("#resultMeta");

    if (meta) {
      meta.textContent = "Search error";
    }

    if (!results) return;

    results.innerHTML = `
      <div
        style="
          padding:50px 20px;
          text-align:center;
        ">

        <div style="font-size:42px;margin-bottom:12px;">
          ⚠
        </div>

        <div
          style="
            font-size:20px;
            font-weight:700;
            margin-bottom:8px;
          ">
          HEXORA search error
        </div>

        <div style="opacity:.7;">
          ${escapeHTML(error?.message || "Unable to search.")}
        </div>

      </div>
    `;
  }

  /* =========================================================
     MODE BUTTONS
     ========================================================= */

  function updateModeButtons() {
    $$("[data-mode]").forEach(button => {
      const mode = button.dataset.mode;

      if (mode === state.mode) {
        button.classList.add("active");
      } else {
        button.classList.remove("active");
      }
    });
  }

  function setMode(mode) {
    if (!VALID_MODES.includes(mode)) {
      return;
    }

    state.mode = mode;

    updateModeButtons();
  }

  /* =========================================================
     SEARCH
     ========================================================= */

  async function doSearch(query, mode = state.mode) {
    query = String(query || "").trim();

    if (!query) {
      showSearchView();

      const input = $("#searchInput");

      if (input) {
        input.focus();
      }

      return;
    }

    if (!VALID_MODES.includes(mode)) {
      mode = "web";
    }

    state.query = query;
    state.mode = mode;
    state.searching = true;

    updateModeButtons();
    showSearchView();
    showSearching(query, mode);

    const url =
      `${CONFIG.searchEndpoint}` +
      `?q=${encodeURIComponent(query)}` +
      `&mode=${encodeURIComponent(mode)}`;

    try {
      const data = await fetchJSON(url);

      const results = getResultsArray(data);
      const total = getTotal(data, results);

      state.searching = false;

      if (!results.length) {
        showNoResults(query, mode);
        return;
      }

      renderResults(results, mode, total);

      try {
        const newURL =
          `${window.location.pathname}` +
          `?q=${encodeURIComponent(query)}` +
          `&mode=${encodeURIComponent(mode)}`;

        window.history.pushState(
          {
            q: query,
            mode
          },
          "",
          newURL
        );
      } catch {
        // Ignore history errors.
      }

    } catch (error) {
      state.searching = false;
      showSearchError(error);
    }
  }

  function setupSearch() {
    const form = $("#searchForm");
    const input = $("#searchInput");

    if (!form) return;

    form.addEventListener("submit", event => {
      event.preventDefault();

      const query = input?.value?.trim() || "";

      doSearch(
        query,
        state.mode || "web"
      );
    });
  }

  /* =========================================================
     RESULT RENDERING
     ========================================================= */

  function renderResults(results, mode, total) {
    const container = $("#results");
    const meta = $("#resultMeta");

    if (!container) return;

    if (meta) {
      meta.textContent =
        `${total} results • ${modeLabel(mode)}`;
    }

    switch (mode) {
      case "images":
        renderImages(results, container);
        break;

      case "news":
        renderNews(results, container);
        break;

      case "videos":
        renderVideos(results, container);
        break;

      case "maps":
        renderMaps(results, container);
        break;

      default:
        renderWeb(results, container);
        break;
    }
  }

  /* =========================================================
     WEB RESULTS
     ========================================================= */

  function renderWeb(results, container) {
    container.innerHTML = results
      .map((item, index) => {
        const title =
          item.title ||
          item.name ||
          item.page_title ||
          item.url ||
          "Untitled";

        const url =
          item.url ||
          item.page_url ||
          item.link ||
          "#";

        const description =
          item.description ||
          item.snippet ||
          item.content ||
          item.text ||
          "";

        const domain =
          item.source_domain ||
          getDomain(url);

        return `
          <article
            class="hexora-result web-result"
            style="
              padding:20px 0;
              border-bottom:1px solid rgba(255,255,255,.08);
            ">

            <div
              style="
                font-size:12px;
                opacity:.55;
                margin-bottom:6px;
              ">
              ${index + 1} • ${escapeHTML(domain)}
            </div>

            <a
              href="${safeURL(url)}"
              target="_blank"
              rel="noopener noreferrer"
              style="
                font-size:21px;
                font-weight:700;
                color:#00ffff;
                text-decoration:none;
              ">
              ${escapeHTML(title)}
            </a>

            <div
              style="
                margin-top:7px;
                font-size:13px;
                opacity:.55;
                word-break:break-all;
              ">
              ${escapeHTML(url)}
            </div>

            ${
              description
                ? `
                  <div
                    style="
                      margin-top:10px;
                      line-height:1.6;
                      opacity:.78;
                    ">
                    ${escapeHTML(truncate(description))}
                  </div>
                `
                : ""
            }

          </article>
        `;
      })
      .join("");
  }

  /* =========================================================
     IMAGE RESULTS
     ========================================================= */

  function renderImages(results, container) {
    container.innerHTML = `
      <div
        class="hexora-image-grid"
        style="
          display:grid;
          grid-template-columns:
            repeat(auto-fill,minmax(210px,1fr));
          gap:16px;
          padding:15px 0;
        ">
        ${results
          .map((item, index) => {
            const imageURL =
              item.image_url ||
              item.image ||
              item.thumbnail_url ||
              item.thumbnail ||
              "";

            const pageURL =
              item.page_url ||
              item.url ||
              item.link ||
              imageURL ||
              "#";

            const title =
              item.title ||
              item.alt_text ||
              item.name ||
              "Image";

            const domain =
              item.source_domain ||
              getDomain(pageURL);

            if (!imageURL) {
              return `
                <article
                  style="
                    border:1px solid rgba(255,255,255,.08);
                    border-radius:14px;
                    padding:15px;
                  ">

                  <div style="opacity:.7;">
                    ${escapeHTML(title)}
                  </div>

                  <a
                    href="${safeURL(pageURL)}"
                    target="_blank"
                    rel="noopener noreferrer"
                    style="
                      display:inline-block;
                      margin-top:10px;
                      color:#00ffff;
                    ">
                    Open source
                  </a>

                </article>
              `;
            }

            return `
              <article
                class="hexora-image-card"
                style="
                  overflow:hidden;
                  border-radius:14px;
                  background:rgba(255,255,255,.035);
                  border:1px solid rgba(255,255,255,.08);
                ">

                <a
                  href="${safeURL(pageURL)}"
                  target="_blank"
                  rel="noopener noreferrer"
                  style="
                    display:block;
                    text-decoration:none;
                  ">

                  <div
                    style="
                      width:100%;
                      aspect-ratio:16/10;
                      background:rgba(0,0,0,.25);
                      overflow:hidden;
                    ">

                    <img
                      src="${safeURL(imageURL)}"
                      alt="${escapeHTML(title)}"
                      loading="lazy"
                      referrerpolicy="no-referrer"
                      style="
                        width:100%;
                        height:100%;
                        object-fit:cover;
                        display:block;
                      "
                      onerror="
                        this.style.display='none';
                        this.parentElement.innerHTML=
                        '<div style=\\'height:100%;display:flex;align-items:center;justify-content:center;opacity:.5;\\'>Image unavailable</div>';
                      "
                    >

                  </div>

                  <div style="padding:12px;">

                    <div
                      style="
                        font-weight:700;
                        line-height:1.4;
                        color:#fff;
                      ">
                      ${escapeHTML(truncate(title, 90))}
                    </div>

                    <div
                      style="
                        margin-top:6px;
                        font-size:12px;
                        opacity:.55;
                      ">
                      ${escapeHTML(domain)}
                    </div>

                  </div>

                </a>

              </article>
            `;
          })
          .join("")}
      </div>
    `;
  }

  /* =========================================================
     NEWS RESULTS
     ========================================================= */

  function renderNews(results, container) {
    container.innerHTML = results
      .map(item => {
        const title =
          item.title ||
          item.name ||
          "News";

        const url =
          item.url ||
          item.page_url ||
          item.link ||
          "#";

        const description =
          item.description ||
          item.snippet ||
          "";

        const source =
          item.source_name ||
          item.source_domain ||
          getDomain(url);

        const date =
          item.published_at ||
          item.fetched_at ||
          item.created_at ||
          "";

        const image =
          item.image_url ||
          item.image ||
          item.thumbnail_url ||
          "";

        return `
          <article
            class="hexora-news-result"
            style="
              display:flex;
              gap:18px;
              padding:18px 0;
              border-bottom:1px solid rgba(255,255,255,.08);
            ">

            ${
              image
                ? `
                  <a
                    href="${safeURL(url)}"
                    target="_blank"
                    rel="noopener noreferrer"
                    style="
                      flex:0 0 150px;
                      height:95px;
                      overflow:hidden;
                      border-radius:10px;
                    ">

                    <img
                      src="${safeURL(image)}"
                      alt=""
                      loading="lazy"
                      referrerpolicy="no-referrer"
                      style="
                        width:100%;
                        height:100%;
                        object-fit:cover;
                      "
                    >

                  </a>
                `
                : ""
            }

            <div style="min-width:0;flex:1;">

              <div
                style="
                  font-size:12px;
                  opacity:.55;
                  margin-bottom:6px;
                ">
                ${escapeHTML(source)}
                ${date ? " • " + escapeHTML(formatDate(date)) : ""}
              </div>

              <a
                href="${safeURL(url)}"
                target="_blank"
                rel="noopener noreferrer"
                style="
                  color:#00ffff;
                  font-size:20px;
                  font-weight:700;
                  text-decoration:none;
                ">
                ${escapeHTML(title)}
              </a>

              ${
                description
                  ? `
                    <div
                      style="
                        margin-top:8px;
                        line-height:1.55;
                        opacity:.75;
                      ">
                      ${escapeHTML(truncate(description))}
                    </div>
                  `
                  : ""
              }

            </div>

          </article>
        `;
      })
      .join("");
  }

  /* =========================================================
     VIDEO RESULTS
     ========================================================= */

  function renderVideos(results, container) {
    container.innerHTML = results
      .map(item => {
        const title =
          item.title ||
          item.name ||
          "Video";

        const pageURL =
          item.page_url ||
          item.url ||
          item.link ||
          "#";

        const videoURL =
          item.video_url ||
          item.video ||
          "";

        const thumbnail =
          item.thumbnail_url ||
          item.thumbnail ||
          item.image_url ||
          "";

        const description =
          item.description ||
          item.snippet ||
          "";

        const domain =
          item.source_domain ||
          getDomain(pageURL);

        let mediaHTML = "";

        if (videoURL) {
          mediaHTML = `
            <video
              controls
              preload="metadata"
              poster="${safeURL(thumbnail)}"
              style="
                width:100%;
                max-height:360px;
                display:block;
                border-radius:12px;
                background:#000;
              ">
              <source
                src="${safeURL(videoURL)}">
              Your browser cannot play this video.
            </video>
          `;
        } else if (thumbnail) {
          mediaHTML = `
            <a
              href="${safeURL(pageURL)}"
              target="_blank"
              rel="noopener noreferrer"
              style="
                display:block;
                position:relative;
              ">

              <img
                src="${safeURL(thumbnail)}"
                alt="${escapeHTML(title)}"
                loading="lazy"
                referrerpolicy="no-referrer"
                style="
                  width:100%;
                  aspect-ratio:16/9;
                  object-fit:cover;
                  border-radius:12px;
                  display:block;
                "
              >

              <span
                style="
                  position:absolute;
                  left:50%;
                  top:50%;
                  transform:translate(-50%,-50%);
                  width:55px;
                  height:55px;
                  border-radius:50%;
                  display:flex;
                  align-items:center;
                  justify-content:center;
                  background:rgba(0,0,0,.75);
                  color:#00ffff;
                  font-size:24px;
                ">
                ▶
              </span>

            </a>
          `;
        } else {
          mediaHTML = `
            <a
              href="${safeURL(pageURL)}"
              target="_blank"
              rel="noopener noreferrer"
              style="
                display:flex;
                aspect-ratio:16/9;
                align-items:center;
                justify-content:center;
                background:rgba(255,255,255,.04);
                border-radius:12px;
                color:#00ffff;
                font-size:35px;
                text-decoration:none;
              ">
              ▶
            </a>
          `;
        }

        return `
          <article
            class="hexora-video-result"
            style="
              padding:20px 0;
              border-bottom:1px solid rgba(255,255,255,.08);
            ">

            ${mediaHTML}

            <div style="padding-top:12px;">

              <div
                style="
                  font-size:12px;
                  opacity:.55;
                  margin-bottom:5px;
                ">
                ${escapeHTML(domain)}
              </div>

              <a
                href="${safeURL(pageURL)}"
                target="_blank"
                rel="noopener noreferrer"
                style="
                  color:#00ffff;
                  font-size:20px;
                  font-weight:700;
                  text-decoration:none;
                ">
                ${escapeHTML(title)}
              </a>

              ${
                description
                  ? `
                    <div
                      style="
                        margin-top:7px;
                        opacity:.7;
                        line-height:1.5;
                      ">
                      ${escapeHTML(truncate(description))}
                    </div>
                  `
                  : ""
              }

            </div>

          </article>
        `;
      })
      .join("");
  }

  /* =========================================================
     MAP RESULTS
     ========================================================= */

  function renderMaps(results, container) {
    container.innerHTML = `
      <div
        class="hexora-map-results"
        style="
          display:grid;
          gap:14px;
          padding:15px 0;
        ">

        ${results
          .map(item => {
            const name =
              item.name ||
              item.title ||
              item.display_name ||
              "Place";

            const address =
              item.display_name ||
              item.address ||
              item.formatted_address ||
              "";

            const lat =
              item.lat ??
              item.latitude;

            const lon =
              item.lon ??
              item.lng ??
              item.longitude;

            const website =
              item.website ||
              item.url ||
              item.page_url ||
              "";

            return `
              <article
                style="
                  padding:18px;
                  border:1px solid rgba(255,255,255,.08);
                  border-radius:14px;
                  background:rgba(255,255,255,.025);
                ">

                <div
                  style="
                    font-size:20px;
                    font-weight:700;
                    color:#00ffff;
                  ">
                  ${escapeHTML(name)}
                </div>

                ${
                  address
                    ? `
                      <div
                        style="
                          margin-top:8px;
                          opacity:.7;
                          line-height:1.5;
                        ">
                        ${escapeHTML(address)}
                      </div>
                    `
                    : ""
                }

                ${
                  lat != null && lon != null
                    ? `
                      <div
                        style="
                          margin-top:7px;
                          font-size:12px;
                          opacity:.5;
                        ">
                        ${escapeHTML(lat)},
                        ${escapeHTML(lon)}
                      </div>
                    `
                    : ""
                }

                <div
                  style="
                    margin-top:13px;
                    display:flex;
                    gap:10px;
                    flex-wrap:wrap;
                  ">

                  ${
                    lat != null && lon != null
                      ? `
                        <button
                          type="button"
                          class="secondary"
                          data-map-result
                          data-lat="${escapeHTML(lat)}"
                          data-lon="${escapeHTML(lon)}">
                          View on Map
                        </button>
                      `
                      : ""
                  }

                  ${
                    website
                      ? `
                        <a
                          href="${safeURL(website)}"
                          target="_blank"
                          rel="noopener noreferrer"
                          class="secondary"
                          style="
                            display:inline-flex;
                            align-items:center;
                            text-decoration:none;
                          ">
                          Open
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

    $$("#results [data-map-result]").forEach(button => {
      button.addEventListener("click", () => {
        const lat = Number(button.dataset.lat);
        const lon = Number(button.dataset.lon);

        if (
          Number.isFinite(lat) &&
          Number.isFinite(lon)
        ) {
          showMapView();

          setTimeout(() => {
            if (state.map) {
              state.map.flyTo({
                center: [lon, lat],
                zoom: 14
              });

              addMapMarker(lon, lat);
            }
          }, 500);
        }
      });
    });
  }

  function getDomain(url) {
    if (!url) return "";

    try {
      return new URL(
        url,
        window.location.origin
      ).hostname;
    } catch {
      return "";
    }
  }

  /* =========================================================
     SIDEBAR / HERO MODES
     ========================================================= */

  function setupModes() {
    $$("[data-mode]").forEach(button => {
      button.addEventListener("click", event => {
        event.preventDefault();

        const mode = button.dataset.mode;

        /*
         * Only search modes are sent to the backend.
         * AI / Engine / Workspace / Profile are kept
         * separate so they do not accidentally call /api/search.
         */

        if (VALID_MODES.includes(mode)) {
          setMode(mode);

          const input = $("#searchInput");

          /*
           * If there is already a query:
           * clicking Images/News/Videos/Maps immediately
           * searches that SAME query in the selected mode.
           */
          if (state.query.trim()) {
            if (input) {
              input.value = state.query;
            }

            doSearch(
              state.query,
              mode
            );
          } else {
            showSearchView();

            if (input) {
              input.focus();
            }
          }

          return;
        }

        /*
         * Non-search navigation.
         */

        if (mode === "ai") {
          showFeatureMessage(
            "AI",
            "HEXORA AI"
          );
          return;
        }

        if (mode === "engine") {
          showFeatureMessage(
            "Engine",
            "HEXORA Search Engine"
          );
          return;
        }

        if (mode === "workspace") {
          showFeatureMessage(
            "Workspace",
            "HEXORA Workspace"
          );
          return;
        }

        if (mode === "profile") {
          showFeatureMessage(
            "Profile",
            "HEXORA Profile"
          );
          return;
        }
      });
    });
  }

  function showFeatureMessage(title, subtitle) {
    showSearchView();

    const meta = $("#resultMeta");
    const results = $("#results");

    if (meta) {
      meta.textContent = subtitle;
    }

    if (results) {
      results.innerHTML = `
        <div
          style="
            min-height:260px;
            display:flex;
            align-items:center;
            justify-content:center;
            flex-direction:column;
            text-align:center;
            gap:10px;
          ">

          <div
            style="
              font-size:26px;
              font-weight:700;
              color:#00ffff;
            ">
            ${escapeHTML(title)}
          </div>

          <div style="opacity:.6;">
            This HEXORA section is ready for integration.
          </div>

        </div>
      `;
    }
  }

  /* =========================================================
     HOME BUTTONS
     ========================================================= */

  function setupHomeButtons() {
    $$("[data-home]").forEach(button => {
      button.addEventListener("click", event => {
        event.preventDefault();
        showHomeView();
      });
    });
  }

  /* =========================================================
     HOME NEWS
     ========================================================= */

  async function loadHomeNews() {
    const targets = [
      "#homeNews",
      "#newsResults",
      "#newsPanel"
    ];

    const container =
      targets
        .map(selector => $(selector))
        .find(Boolean);

    if (!container) {
      return;
    }

    try {
      const data = await fetchJSON(
        `${CONFIG.newsEndpoint}?page=1&limit=6`
      );

      const results = getResultsArray(data);

      if (!results.length) {
        container.innerHTML = `
          <div style="opacity:.55;">
            No data found
          </div>
        `;
        return;
      }

      container.innerHTML = results
        .slice(0, 6)
        .map(item => {
          const title =
            item.title ||
            "News";

          const url =
            item.url ||
            item.page_url ||
            "#";

          return `
            <a
              href="${safeURL(url)}"
              target="_blank"
              rel="noopener noreferrer"
              style="
                display:block;
                padding:10px 0;
                text-decoration:none;
                color:inherit;
              ">
              ${escapeHTML(truncate(title, 100))}
            </a>
          `;
        })
        .join("");

    } catch {
      container.innerHTML = `
        <div style="opacity:.55;">
          News unavailable
        </div>
      `;
    }
  }

  /* =========================================================
     MAP
     ========================================================= */

  function loadMapLibre() {
    return new Promise((resolve, reject) => {
      if (window.maplibregl) {
        resolve(window.maplibregl);
        return;
      }

      if (!document.querySelector(
        'link[data-hexora-maplibre]'
      )) {
        const link = document.createElement("link");

        link.rel = "stylesheet";
        link.href = CONFIG.mapLibreCSS;
        link.dataset.hexoraMaplibre = "true";

        document.head.appendChild(link);
      }

      const existingScript =
        document.querySelector(
          'script[data-hexora-maplibre]'
        );

      if (existingScript) {
        existingScript.addEventListener(
          "load",
          () => resolve(window.maplibregl)
        );

        existingScript.addEventListener(
          "error",
          reject
        );

        return;
      }

      const script =
        document.createElement("script");

      script.src = CONFIG.mapLibreJS;
      script.async = true;
      script.dataset.hexoraMaplibre = "true";

      script.onload = () => {
        if (window.maplibregl) {
          resolve(window.maplibregl);
        } else {
          reject(
            new Error("MapLibre failed to load.")
          );
        }
      };

      script.onerror = () => {
        reject(
          new Error("Could not load map engine.")
        );
      };

      document.head.appendChild(script);
    });
  }

  async function initializeMap() {
    const mapElement = $("#hexoraMap");

    if (!mapElement) {
      return;
    }

    if (state.map) {
      setTimeout(() => {
        state.map.resize();
      }, 100);

      return;
    }

    try {
      const maplibregl =
        await loadMapLibre();

      state.map = new maplibregl.Map({
        container: "hexoraMap",

        style: {
          version: 8,

          sources: {
            "osm-tiles": {
              type: "raster",
              tiles: [
                "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              ],
              tileSize: 256,
              attribution:
                "© OpenStreetMap contributors"
            }
          },

          layers: [
            {
              id: "osm",
              type: "raster",
              source: "osm-tiles"
            }
          ]
        },

        center: CONFIG.defaultCenter,
        zoom: CONFIG.defaultZoom
      });

      state.map.addControl(
        new maplibregl.NavigationControl(),
        "top-right"
      );

      state.map.on("load", () => {
        state.mapLoaded = true;

        setTimeout(() => {
          state.map.resize();
        }, 100);
      });

    } catch (error) {
      mapElement.innerHTML = `
        <div
          style="
            height:100%;
            min-height:350px;
            display:flex;
            align-items:center;
            justify-content:center;
            text-align:center;
            padding:20px;
          ">
          <div>
            <div
              style="
                font-size:22px;
                font-weight:700;
                color:#00ffff;
              ">
              HEXORA Maps
            </div>

            <div
              style="
                margin-top:8px;
                opacity:.65;
              ">
              ${escapeHTML(error.message)}
            </div>
          </div>
        </div>
      `;
    }
  }

  function addMapMarker(lon, lat) {
    if (!state.map || !window.maplibregl) {
      return;
    }

    if (state.mapMarker) {
      state.mapMarker.remove();
    }

    state.mapMarker =
      new window.maplibregl.Marker({
        color: "#00ffff"
      })
        .setLngLat([lon, lat])
        .addTo(state.map);
  }

  async function searchMapLocation(query) {
    query = String(query || "").trim();

    if (!query) return;

    try {
      const url =
        `${CONFIG.geocoder}` +
        `?q=${encodeURIComponent(query)}` +
        `&format=json` +
        `&limit=5`;

      const response = await fetchJSON(url);

      if (!Array.isArray(response) || !response.length) {
        return;
      }

      const first = response[0];

      const lat = Number(first.lat);
      const lon = Number(first.lon);

      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lon)
      ) {
        return;
      }

      showMapView();

      setTimeout(() => {
        if (!state.map) return;

        state.map.flyTo({
          center: [lon, lat],
          zoom: 14
        });

        addMapMarker(lon, lat);
      }, 500);

    } catch {
      // Do not break the search UI.
    }
  }

  function setupMapButtons() {
    /*
     * Open full map.
     */
    $$(
      "[data-open-map], #openMapBtn"
    ).forEach(button => {
      button.addEventListener("click", event => {
        event.preventDefault();
        showMapView();
      });
    });

    /*
     * Map search.
     */
    const mapSearchForm =
      $("#mapSearchForm");

    const mapSearchInput =
      $("#mapSearchInput");

    if (mapSearchForm) {
      mapSearchForm.addEventListener(
        "submit",
        event => {
          event.preventDefault();

          searchMapLocation(
            mapSearchInput?.value || ""
          );
        }
      );
    }

    /*
     * Current location.
     */
    $$(
      "#locateBtn, [data-locate]"
    ).forEach(button => {
      button.addEventListener("click", () => {
        if (!navigator.geolocation) {
          return;
        }

        navigator.geolocation.getCurrentPosition(
          position => {
            const lat =
              position.coords.latitude;

            const lon =
              position.coords.longitude;

            showMapView();

            setTimeout(() => {
              if (!state.map) return;

              state.map.flyTo({
                center: [lon, lat],
                zoom: 15
              });

              addMapMarker(lon, lat);
            }, 500);
          },
          () => {
            // Permission denied / unavailable.
          },
          {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 30000
          }
        );
      });
    });

    /*
     * Reset map.
     */
    $$(
      "#resetMapBtn, [data-reset-map]"
    ).forEach(button => {
      button.addEventListener("click", () => {
        if (!state.map) return;

        state.map.flyTo({
          center: CONFIG.defaultCenter,
          zoom: CONFIG.defaultZoom
        });

        if (state.mapMarker) {
          state.mapMarker.remove();
          state.mapMarker = null;
        }
      });
    });

    /*
     * Fullscreen.
     */
    $$(
      "#fullscreenMapBtn, [data-fullscreen-map]"
    ).forEach(button => {
      button.addEventListener("click", () => {
        const mapElement = $("#hexoraMap");

        if (!mapElement) return;

        if (document.fullscreenElement) {
          document.exitFullscreen?.();
        } else {
          mapElement.requestFullscreen?.();
        }
      });
    });

    /*
     * Street / satellite / earth / 3D buttons.
     *
     * Multiple IDs exist in the supplied HTML, so we
     * intentionally use querySelectorAll instead of
     * getElementById.
     */

    $$(
      "#satelliteMapBtn, #3dMapBtn, #earthMapBtn, #streetMapBtn"
    ).forEach(button => {
      button.addEventListener("click", () => {
        /*
         * The current map uses OSM raster tiles.
         * Keep the button functional without breaking
         * the map if a premium satellite/3D provider
         * is not configured.
         */
        if (!state.map) return;

        const type =
          button.id || "";

        if (type === "3dMapBtn") {
          const currentPitch =
            state.map.getPitch();

          state.map.easeTo({
            pitch:
              currentPitch > 20 ? 0 : 55,
            duration: 700
          });

          return;
        }

        if (type === "earthMapBtn") {
          state.map.easeTo({
            pitch: 45,
            bearing: 0,
            duration: 700
          });

          return;
        }

        /*
         * Satellite/street buttons do not replace the
         * current map source unless a real tile source
         * is configured.
         */
      });
    });
  }

  /* =========================================================
     KEYBOARD
     ========================================================= */

  function setupKeyboard() {
    document.addEventListener(
      "keydown",
      event => {
        if (
          event.key === "/" &&
          document.activeElement?.tagName !== "INPUT" &&
          document.activeElement?.tagName !== "TEXTAREA"
        ) {
          event.preventDefault();

          const input = $("#searchInput");

          if (input) {
            input.focus();
          }
        }

        if (event.key === "Escape") {
          const input = $("#searchInput");

          if (
            input &&
            document.activeElement === input
          ) {
            input.blur();
          }
        }
      }
    );
  }

  /* =========================================================
     URL STATE
     ========================================================= */

  function restoreURLState() {
    const params =
      new URLSearchParams(
        window.location.search
      );

    const query =
      params.get("q") || "";

    const mode =
      params.get("mode") || "web";

    if (!query) {
      setMode(
        VALID_MODES.includes(mode)
          ? mode
          : "web"
      );

      return;
    }

    const input = $("#searchInput");

    if (input) {
      input.value = query;
    }

    state.query = query;

    setMode(
      VALID_MODES.includes(mode)
        ? mode
        : "web"
    );

    doSearch(
      query,
      state.mode
    );
  }

  window.addEventListener(
    "popstate",
    () => {
      restoreURLState();
    }
  );

  /* =========================================================
     INITIALIZE
     ========================================================= */

  function init() {
    setupSearch();
    setupModes();
    setupHomeButtons();
    setupKeyboard();
    setupMapButtons();

    /*
     * Default mode.
     */
    setMode("web");

    /*
     * Home news is optional.
     * If the corresponding HTML container exists,
     * it will be populated.
     */
    loadHomeNews();

    /*
     * Restore q/mode if URL contains them.
     */
    restoreURLState();

    console.log(
      "%cHEXORA",
      "color:#00ffff;font-size:22px;font-weight:bold"
    );

    console.log(
      "HEXORA Search Engine initialized."
    );
  }

  if (
    document.readyState === "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      init
    );
  } else {
    init();
  }

})();
