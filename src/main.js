(() => {
  "use strict";

  const CONFIG = {
    searchEndpoint: "/api/search",
    newsEndpoint: "/api/news",
    mapLibreJS: "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js",
    mapLibreCSS: "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css",
    geocoder: "https://nominatim.openstreetmap.org/search",
    defaultCenter: [91.7362, 26.1445],
    defaultZoom: 5,
    timeout: 20000
  };

  const SEARCH_MODES = ["web", "images", "news", "videos", "maps"];

  const state = {
    mode: "web",
    query: "",
    map: null,
    marker: null
  };

  /* =========================
     BASIC HELPERS
  ========================= */

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

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
      const u = new URL(value, location.origin);

      if (u.protocol === "http:" || u.protocol === "https:") {
        return u.href;
      }
    } catch {}

    return "#";
  }

  function getDomain(url) {
    try {
      return new URL(url, location.origin).hostname;
    } catch {
      return "";
    }
  }

  function truncate(value, length = 220) {
    const text = String(value ?? "").trim();
    return text.length > length
      ? text.slice(0, length - 1) + "…"
      : text;
  }

  function formatDate(value) {
    if (!value) return "";

    try {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return String(value);

      return new Intl.DateTimeFormat("en", {
        year: "numeric",
        month: "short",
        day: "numeric"
      }).format(d);
    } catch {
      return String(value);
    }
  }

  function modeName(mode) {
    const names = {
      web: "Web",
      images: "Images",
      news: "News",
      videos: "Videos",
      maps: "Maps"
    };

    return names[mode] || "Web";
  }

  /* =========================
     FETCH
  ========================= */

  async function fetchJSON(url) {
    const controller = new AbortController();

    const timer = setTimeout(() => {
      controller.abort();
    }, CONFIG.timeout);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json"
        },
        signal: controller.signal
      });

      const text = await response.text();

      let data;

      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new Error("Invalid server response.");
      }

      if (!response.ok) {
        throw new Error(
          data?.error ||
          data?.message ||
          `Server error ${response.status}`
        );
      }

      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  function extractResults(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.results)) return data.results;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.items)) return data.items;
    return [];
  }

  /* =========================
     VIEW SWITCHING
  ========================= */

  function hideAllViews() {
    const searchView = $("#searchView");
    const mapView = $("#mapView");

    if (searchView) {
      searchView.classList.remove("active");
    }

    if (mapView) {
      mapView.classList.remove("active");
    }
  }

  function openHome() {
    hideAllViews();

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }

  function openSearchView() {
    const mapView = $("#mapView");

    if (mapView) {
      mapView.classList.remove("active");
    }

    const searchView = $("#searchView");

    if (searchView) {
      searchView.classList.add("active");
    }

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }

  function openMapView() {
    const searchView = $("#searchView");

    if (searchView) {
      searchView.classList.remove("active");
    }

    const mapView = $("#mapView");

    if (mapView) {
      mapView.classList.add("active");
    }

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });

    setTimeout(initMap, 100);
  }

  /* =========================
     MODE BUTTONS
  ========================= */

  function updateModeButtons() {
    $$("[data-mode]").forEach((button) => {
      const mode = button.dataset.mode;

      button.classList.toggle(
        "active",
        mode === state.mode
      );
    });
  }

  /*
   * IMPORTANT:
   * This function handles ONLY the five real search tabs.
   */

  function selectSearchMode(mode) {
    if (!SEARCH_MODES.includes(mode)) {
      return;
    }

    state.mode = mode;
    updateModeButtons();

    /*
     * Maps has its own full-screen map section.
     */
    if (mode === "maps") {
      openSearchView();

      const input = $("#searchInput");

      if (state.query) {
        if (input) {
          input.value = state.query;
        }

        doSearch(state.query, "maps");
      } else {
        const results = $("#results");
        const meta = $("#resultMeta");

        if (meta) {
          meta.textContent = "HEXORA Maps";
        }

        if (results) {
          results.innerHTML = `
            <div style="
              padding:50px 20px;
              text-align:center;
              opacity:.75;
            ">
              <div style="
                font-size:42px;
                margin-bottom:12px;
              ">⌖</div>

              <div style="
                font-size:22px;
                font-weight:700;
              ">
                Search a location
              </div>

              <div style="
                margin-top:8px;
                opacity:.65;
              ">
                Enter a place in the search box.
              </div>
            </div>
          `;
        }

        if (input) {
          input.focus();
        }
      }

      return;
    }

    /*
     * All other search modes stay in searchView.
     */
    openSearchView();

    const input = $("#searchInput");

    if (state.query) {
      if (input) {
        input.value = state.query;
      }

      /*
       * Same query + NEW selected tab.
       */
      doSearch(
        state.query,
        mode
      );
    } else {
      clearResultsForMode(mode);

      if (input) {
        input.focus();
      }
    }
  }

  function clearResultsForMode(mode) {
    const meta = $("#resultMeta");
    const results = $("#results");

    if (meta) {
      meta.textContent =
        `HEXORA ${modeName(mode)}`;
    }

    if (results) {
      results.innerHTML = `
        <div style="
          min-height:220px;
          display:flex;
          align-items:center;
          justify-content:center;
          text-align:center;
          opacity:.65;
          padding:30px;
        ">
          Search something to see
          ${escapeHTML(modeName(mode).toLowerCase())}.
        </div>
      `;
    }
  }

  /* =========================
     SEARCH FORM
  ========================= */

  function setupSearchForm() {
    const form = $("#searchForm");
    const input = $("#searchInput");

    if (!form) return;

    form.addEventListener("submit", (event) => {
      event.preventDefault();

      const query = input?.value?.trim() || "";

      if (!query) {
        if (input) input.focus();
        return;
      }

      doSearch(
        query,
        state.mode
      );
    });
  }

  /* =========================
     MAIN SEARCH
  ========================= */

  async function doSearch(query, mode) {
    query = String(query || "").trim();

    if (!query) return;

    if (!SEARCH_MODES.includes(mode)) {
      mode = "web";
    }

    state.query = query;
    state.mode = mode;

    updateModeButtons();
    openSearchView();

    showLoading(query, mode);

    /*
     * THIS IS THE MAIN FIX.
     *
     * mode is explicitly sent to server.
     */
    const url =
      `${CONFIG.searchEndpoint}` +
      `?q=${encodeURIComponent(query)}` +
      `&mode=${encodeURIComponent(mode)}`;

    console.log(
      "[HEXORA SEARCH]",
      mode,
      query,
      url
    );

    try {
      const data = await fetchJSON(url);

      console.log(
        "[HEXORA RESULT]",
        mode,
        data
      );

      const results = extractResults(data);

      const total =
        typeof data?.total === "number"
          ? data.total
          : results.length;

      if (!results.length) {
        showNoResults(
          query,
          mode
        );
        return;
      }

      renderResults(
        results,
        mode,
        total
      );

      try {
        const urlState =
          `${location.pathname}` +
          `?q=${encodeURIComponent(query)}` +
          `&mode=${encodeURIComponent(mode)}`;

        history.pushState(
          { q: query, mode },
          "",
          urlState
        );
      } catch {}

    } catch (error) {
      console.error(
        "[HEXORA SEARCH ERROR]",
        error
      );

      showError(error);
    }
  }

  /* =========================
     LOADING
  ========================= */

  function showLoading(query, mode) {
    const meta = $("#resultMeta");
    const results = $("#results");

    if (meta) {
      meta.textContent =
        `Searching ${modeName(mode)}…`;
    }

    if (!results) return;

    results.innerHTML = `
      <div style="
        min-height:280px;
        display:flex;
        flex-direction:column;
        align-items:center;
        justify-content:center;
        text-align:center;
        gap:12px;
      ">

        <div style="
          width:58px;
          height:58px;
          border-radius:50%;
          border:3px solid rgba(0,255,255,.15);
          border-top-color:#00ffff;
          animation:hexoraLoadingSpin .8s linear infinite;
        "></div>

        <div style="
          font-size:22px;
          font-weight:800;
          color:#00ffff;
        ">
          HEXORA
        </div>

        <div style="
          font-size:16px;
          opacity:.75;
        ">
          HEXORA is searching…
        </div>

        <div style="
          font-size:13px;
          opacity:.5;
        ">
          ${escapeHTML(modeName(mode))}
        </div>

      </div>

      <style>
        @keyframes hexoraLoadingSpin {
          from {
            transform:rotate(0deg);
          }

          to {
            transform:rotate(360deg);
          }
        }
      </style>
    `;
  }

  /* =========================
     NO DATA
  ========================= */

  function showNoResults(query, mode) {
    const meta = $("#resultMeta");
    const results = $("#results");

    if (meta) {
      meta.textContent =
        `0 results • ${modeName(mode)}`;
    }

    if (!results) return;

    results.innerHTML = `
      <div style="
        min-height:250px;
        padding:50px 20px;
        text-align:center;
        display:flex;
        flex-direction:column;
        align-items:center;
        justify-content:center;
      ">

        <div style="
          font-size:48px;
          margin-bottom:12px;
          opacity:.65;
        ">
          ⌕
        </div>

        <div style="
          font-size:22px;
          font-weight:800;
        ">
          No data found
        </div>

        <div style="
          margin-top:9px;
          opacity:.6;
        ">
          No ${escapeHTML(
            modeName(mode).toLowerCase()
          )} data found for
          "<strong>${escapeHTML(query)}</strong>".
        </div>

      </div>
    `;
  }

  function showError(error) {
    const meta = $("#resultMeta");
    const results = $("#results");

    if (meta) {
      meta.textContent = "Search error";
    }

    if (!results) return;

    results.innerHTML = `
      <div style="
        padding:55px 20px;
        text-align:center;
      ">

        <div style="
          font-size:42px;
          margin-bottom:10px;
        ">
          ⚠
        </div>

        <div style="
          font-size:21px;
          font-weight:800;
        ">
          HEXORA search error
        </div>

        <div style="
          margin-top:9px;
          opacity:.65;
        ">
          ${escapeHTML(
            error?.message ||
            "Unable to search."
          )}
        </div>

      </div>
    `;
  }

  /* =========================
     RESULTS ROUTER
  ========================= */

  function renderResults(results, mode, total) {
    const container = $("#results");
    const meta = $("#resultMeta");

    if (!container) return;

    if (meta) {
      meta.textContent =
        `${total} results • ${modeName(mode)}`;
    }

    if (mode === "images") {
      renderImages(results, container);
      return;
    }

    if (mode === "news") {
      renderNews(results, container);
      return;
    }

    if (mode === "videos") {
      renderVideos(results, container);
      return;
    }

    if (mode === "maps") {
      renderMaps(results, container);
      return;
    }

    renderWeb(results, container);
  }

  /* =========================
     WEB
  ========================= */

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
          <article style="
            padding:20px 0;
            border-bottom:
              1px solid rgba(255,255,255,.08);
          ">

            <div style="
              font-size:12px;
              opacity:.5;
              margin-bottom:7px;
            ">
              ${index + 1} •
              ${escapeHTML(domain)}
            </div>

            <a
              href="${safeURL(url)}"
              target="_blank"
              rel="noopener noreferrer"
              style="
                color:#00ffff;
                font-size:21px;
                font-weight:800;
                text-decoration:none;
              "
            >
              ${escapeHTML(title)}
            </a>

            <div style="
              margin-top:6px;
              font-size:12px;
              opacity:.45;
              word-break:break-all;
            ">
              ${escapeHTML(url)}
            </div>

            ${
              description
                ? `
                  <div style="
                    margin-top:10px;
                    line-height:1.6;
                    opacity:.75;
                  ">
                    ${escapeHTML(
                      truncate(description)
                    )}
                  </div>
                `
                : ""
            }

          </article>
        `;
      })
      .join("");
  }

  /* =========================
     IMAGES
  ========================= */

  function renderImages(results, container) {
    container.innerHTML = `
      <div style="
        display:grid;
        grid-template-columns:
          repeat(auto-fill,minmax(190px,1fr));
        gap:16px;
        padding:15px 0;
      ">

        ${results.map((item) => {
          const image =
            item.image_url ||
            item.image ||
            item.thumbnail_url ||
            item.thumbnail ||
            "";

          const page =
            item.page_url ||
            item.url ||
            item.link ||
            image ||
            "#";

          const title =
            item.title ||
            item.alt_text ||
            item.name ||
            "Image";

          const domain =
            item.source_domain ||
            getDomain(page);

          return `
            <article style="
              overflow:hidden;
              border-radius:14px;
              background:
                rgba(255,255,255,.035);
              border:
                1px solid rgba(255,255,255,.08);
            ">

              ${
                image
                  ? `
                    <a
                      href="${safeURL(page)}"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <img
                        src="${safeURL(image)}"
                        alt="${escapeHTML(title)}"
                        loading="lazy"
                        referrerpolicy="no-referrer"
                        style="
                          width:100%;
                          aspect-ratio:16/10;
                          object-fit:cover;
                          display:block;
                        "
                        onerror="
                          this.style.display='none';
                        "
                      >
                    </a>
                  `
                  : `
                    <div style="
                      aspect-ratio:16/10;
                      display:flex;
                      align-items:center;
                      justify-content:center;
                      opacity:.5;
                    ">
                      Image unavailable
                    </div>
                  `
              }

              <div style="
                padding:12px;
              ">

                <a
                  href="${safeURL(page)}"
                  target="_blank"
                  rel="noopener noreferrer"
                  style="
                    color:#fff;
                    text-decoration:none;
                    font-weight:700;
                    line-height:1.4;
                  "
                >
                  ${escapeHTML(
                    truncate(title, 90)
                  )}
                </a>

                <div style="
                  margin-top:6px;
                  font-size:12px;
                  opacity:.5;
                ">
                  ${escapeHTML(domain)}
                </div>

              </div>

            </article>
          `;
        }).join("")}

      </div>
    `;
  }

  /* =========================
     NEWS
  ========================= */

  function renderNews(results, container) {
    container.innerHTML = results
      .map((item) => {
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
          <article style="
            display:flex;
            gap:16px;
            padding:18px 0;
            border-bottom:
              1px solid rgba(255,255,255,.08);
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
                    "
                  >
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

            <div style="
              flex:1;
              min-width:0;
            ">

              <div style="
                font-size:12px;
                opacity:.5;
                margin-bottom:6px;
              ">
                ${escapeHTML(source)}
                ${
                  date
                    ? " • " +
                      escapeHTML(
                        formatDate(date)
                      )
                    : ""
                }
              </div>

              <a
                href="${safeURL(url)}"
                target="_blank"
                rel="noopener noreferrer"
                style="
                  color:#00ffff;
                  font-size:20px;
                  font-weight:800;
                  text-decoration:none;
                "
              >
                ${escapeHTML(title)}
              </a>

              ${
                description
                  ? `
                    <div style="
                      margin-top:8px;
                      line-height:1.55;
                      opacity:.72;
                    ">
                      ${escapeHTML(
                        truncate(description)
                      )}
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

  /* =========================
     VIDEOS
  ========================= */

  function renderVideos(results, container) {
    container.innerHTML = results
      .map((item) => {
        const title =
          item.title ||
          item.name ||
          "Video";

        const page =
          item.page_url ||
          item.url ||
          item.link ||
          "#";

        const video =
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
          getDomain(page);

        return `
          <article style="
            padding:20px 0;
            border-bottom:
              1px solid rgba(255,255,255,.08);
          ">

            ${
              video
                ? `
                  <video
                    controls
                    preload="metadata"
                    ${
                      thumbnail
                        ? `poster="${safeURL(thumbnail)}"`
                        : ""
                    }
                    style="
                      width:100%;
                      max-height:380px;
                      background:#000;
                      border-radius:12px;
                      display:block;
                    "
                  >
                    <source
                      src="${safeURL(video)}"
                    >
                  </video>
                `
                : thumbnail
                  ? `
                    <a
                      href="${safeURL(page)}"
                      target="_blank"
                      rel="noopener noreferrer"
                      style="
                        position:relative;
                        display:block;
                      "
                    >

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

                      <span style="
                        position:absolute;
                        left:50%;
                        top:50%;
                        transform:
                          translate(-50%,-50%);
                        width:55px;
                        height:55px;
                        border-radius:50%;
                        display:flex;
                        align-items:center;
                        justify-content:center;
                        background:
                          rgba(0,0,0,.75);
                        color:#00ffff;
                        font-size:23px;
                      ">
                        ▶
                      </span>

                    </a>
                  `
                  : `
                    <a
                      href="${safeURL(page)}"
                      target="_blank"
                      rel="noopener noreferrer"
                      style="
                        height:230px;
                        display:flex;
                        align-items:center;
                        justify-content:center;
                        border-radius:12px;
                        background:
                          rgba(255,255,255,.04);
                        color:#00ffff;
                        font-size:45px;
                        text-decoration:none;
                      "
                    >
                      ▶
                    </a>
                  `
            }

            <div style="
              padding-top:12px;
            ">

              <div style="
                font-size:12px;
                opacity:.5;
                margin-bottom:5px;
              ">
                ${escapeHTML(domain)}
              </div>

              <a
                href="${safeURL(page)}"
                target="_blank"
                rel="noopener noreferrer"
                style="
                  color:#00ffff;
                  font-size:20px;
                  font-weight:800;
                  text-decoration:none;
                "
              >
                ${escapeHTML(title)}
              </a>

              ${
                description
                  ? `
                    <div style="
                      margin-top:8px;
                      opacity:.7;
                    ">
                      ${escapeHTML(
                        truncate(description)
                      )}
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

  /* =========================
     MAP SEARCH RESULTS
  ========================= */

  function renderMaps(results, container) {
    container.innerHTML = `
      <div style="
        display:grid;
        gap:14px;
        padding:15px 0;
      ">

        ${results.map((item) => {
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

          return `
            <article style="
              padding:18px;
              border-radius:14px;
              border:
                1px solid rgba(255,255,255,.08);
              background:
                rgba(255,255,255,.025);
            ">

              <div style="
                font-size:20px;
                font-weight:800;
                color:#00ffff;
              ">
                ${escapeHTML(name)}
              </div>

              ${
                address
                  ? `
                    <div style="
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
                    <button
                      type="button"
                      class="secondary"
                      data-map-result
                      data-lat="${escapeHTML(lat)}"
                      data-lon="${escapeHTML(lon)}"
                      style="
                        margin-top:12px;
                      "
                    >
                      View on Map
                    </button>
                  `
                  : ""
              }

            </article>
          `;
        }).join("")}

      </div>
    `;

    $$("[data-map-result]").forEach((button) => {
      button.addEventListener("click", () => {
        const lat = Number(button.dataset.lat);
        const lon = Number(button.dataset.lon);

        if (
          !Number.isFinite(lat) ||
          !Number.isFinite(lon)
        ) {
          return;
        }

        openMapView();

        setTimeout(() => {
          if (!state.map) return;

          state.map.flyTo({
            center: [lon, lat],
            zoom: 14
          });

          addMarker(
            lon,
            lat
          );
        }, 600);
      });
    });
  }

  /* =========================
     SIDEBAR / HERO BUTTONS
  ========================= */

  function setupModeButtons() {
    $$("[data-mode]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();

        const mode =
          String(button.dataset.mode || "")
            .toLowerCase()
            .trim();

        if (SEARCH_MODES.includes(mode)) {
          selectSearchMode(mode);
          return;
        }

        /*
         * Other sidebar sections.
         */
        if (mode === "ai") {
          showFeature(
            "AI",
            "HEXORA AI"
          );
          return;
        }

        if (mode === "engine") {
          showFeature(
            "Engine",
            "HEXORA Search Engine"
          );
          return;
        }

        if (mode === "workspace") {
          showFeature(
            "Workspace",
            "HEXORA Workspace"
          );
          return;
        }

        if (mode === "profile") {
          showFeature(
            "Profile",
            "HEXORA Profile"
          );
          return;
        }
      });
    });
  }

  function showFeature(title, subtitle) {
    openSearchView();

    const meta = $("#resultMeta");
    const results = $("#results");

    if (meta) {
      meta.textContent = subtitle;
    }

    if (results) {
      results.innerHTML = `
        <div style="
          min-height:250px;
          display:flex;
          align-items:center;
          justify-content:center;
          flex-direction:column;
          text-align:center;
          gap:10px;
        ">

          <div style="
            font-size:27px;
            font-weight:800;
            color:#00ffff;
          ">
            ${escapeHTML(title)}
          </div>

          <div style="
            opacity:.6;
          ">
            ${escapeHTML(subtitle)}
          </div>

        </div>
      `;
    }
  }

  /* =========================
     HOME BUTTON
  ========================= */

  function setupHomeButtons() {
    $$("[data-home]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        openHome();
      });
    });
  }

  /* =========================
     MAP
  ========================= */

  function loadMapLibre() {
    return new Promise((resolve, reject) => {
      if (window.maplibregl) {
        resolve(window.maplibregl);
        return;
      }

      if (!document.querySelector(
        'link[data-hexora-map]'
      )) {
        const link =
          document.createElement("link");

        link.rel = "stylesheet";
        link.href = CONFIG.mapLibreCSS;
        link.dataset.hexoraMap = "true";

        document.head.appendChild(link);
      }

      const oldScript =
        document.querySelector(
          'script[data-hexora-map]'
        );

      if (oldScript) {
        oldScript.addEventListener(
          "load",
          () => resolve(window.maplibregl)
        );

        oldScript.addEventListener(
          "error",
          reject
        );

        return;
      }

      const script =
        document.createElement("script");

      script.src = CONFIG.mapLibreJS;
      script.async = true;
      script.dataset.hexoraMap = "true";

      script.onload = () => {
        if (window.maplibregl) {
          resolve(window.maplibregl);
        } else {
          reject(
            new Error(
              "Map engine unavailable."
            )
          );
        }
      };

      script.onerror = () => {
        reject(
          new Error(
            "Could not load map."
          )
        );
      };

      document.head.appendChild(script);
    });
  }

  async function initMap() {
    const element = $("#hexoraMap");

    if (!element) return;

    if (state.map) {
      setTimeout(() => {
        state.map.resize();
      }, 100);

      return;
    }

    try {
      const maplibregl =
        await loadMapLibre();

      state.map =
        new maplibregl.Map({
          container: "hexoraMap",

          style: {
            version: 8,

            sources: {
              "hexora-osm": {
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
                id: "hexora-osm-layer",
                type: "raster",
                source: "hexora-osm"
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

    } catch (error) {
      element.innerHTML = `
        <div style="
          min-height:350px;
          display:flex;
          align-items:center;
          justify-content:center;
          text-align:center;
          padding:20px;
        ">
          <div>
            <div style="
              font-size:24px;
              font-weight:800;
              color:#00ffff;
            ">
              HEXORA Maps
            </div>

            <div style="
              margin-top:8px;
              opacity:.6;
            ">
              ${escapeHTML(error.message)}
            </div>
          </div>
        </div>
      `;
    }
  }

  function addMarker(lon, lat) {
    if (!state.map || !window.maplibregl) {
      return;
    }

    if (state.marker) {
      state.marker.remove();
    }

    state.marker =
      new window.maplibregl.Marker({
        color: "#00ffff"
      })
        .setLngLat([lon, lat])
        .addTo(state.map);
  }

  async function mapGeocode(query) {
    query = String(query || "").trim();

    if (!query) return;

    try {
      const url =
        `${CONFIG.geocoder}` +
        `?q=${encodeURIComponent(query)}` +
        `&format=json` +
        `&limit=1`;

      const data =
        await fetchJSON(url);

      if (!Array.isArray(data) || !data.length) {
        return;
      }

      const lat = Number(data[0].lat);
      const lon = Number(data[0].lon);

      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lon)
      ) {
        return;
      }

      openMapView();

      setTimeout(() => {
        if (!state.map) return;

        state.map.flyTo({
          center: [lon, lat],
          zoom: 14
        });

        addMarker(lon, lat);
      }, 600);

    } catch (error) {
      console.warn(
        "Map geocoder error:",
        error
      );
    }
  }

  function setupMapControls() {
    $$(
      "#openMapBtn, [data-open-map]"
    ).forEach((button) => {
      button.addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          openMapView();
        }
      );
    });

    const mapForm =
      $("#mapSearchForm");

    const mapInput =
      $("#mapSearchInput");

    if (mapForm) {
      mapForm.addEventListener(
        "submit",
        (event) => {
          event.preventDefault();

          mapGeocode(
            mapInput?.value || ""
          );
        }
      );
    }

    $$(
      "#locateBtn, [data-locate]"
    ).forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          if (!navigator.geolocation) {
            return;
          }

          navigator.geolocation.getCurrentPosition(
            (position) => {
              const lat =
                position.coords.latitude;

              const lon =
                position.coords.longitude;

              openMapView();

              setTimeout(() => {
                if (!state.map) return;

                state.map.flyTo({
                  center: [lon, lat],
                  zoom: 15
                });

                addMarker(
                  lon,
                  lat
                );
              }, 600);
            },
            (error) => {
              console.warn(
                "Location unavailable:",
                error
              );
            },
            {
              enableHighAccuracy: true,
              timeout: 10000,
              maximumAge: 30000
            }
          );
        }
      );
    });

    $$(
      "#resetMapBtn, [data-reset-map]"
    ).forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          if (!state.map) return;

          state.map.flyTo({
            center: CONFIG.defaultCenter,
            zoom: CONFIG.defaultZoom
          });

          if (state.marker) {
            state.marker.remove();
            state.marker = null;
          }
        }
      );
    });

    $$(
      "#fullscreenMapBtn, [data-fullscreen-map]"
    ).forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          const map =
            $("#hexoraMap");

          if (!map) return;

          if (document.fullscreenElement) {
            document.exitFullscreen?.();
          } else {
            map.requestFullscreen?.();
          }
        }
      );
    });

    /*
     * 3D buttons.
     * Your HTML has duplicate IDs, therefore
     * querySelectorAll is intentionally used.
     */
    $$("#3dMapBtn").forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          if (!state.map) return;

          const pitch =
            state.map.getPitch();

          state.map.easeTo({
            pitch: pitch > 20 ? 0 : 55,
            duration: 700
          });
        }
      );
    });

    $$("#earthMapBtn").forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          if (!state.map) return;

          state.map.easeTo({
            pitch: 45,
            bearing: 0,
            duration: 700
          });
        }
      );
    });
  }

  /* =========================
     URL / BACK BUTTON
  ========================= */

  function restoreFromURL() {
    const params =
      new URLSearchParams(
        location.search
      );

    const query =
      params.get("q") || "";

    const mode =
      params.get("mode") || "web";

    if (!SEARCH_MODES.includes(mode)) {
      state.mode = "web";
    } else {
      state.mode = mode;
    }

    updateModeButtons();

    if (!query) return;

    state.query = query;

    const input =
      $("#searchInput");

    if (input) {
      input.value = query;
    }

    doSearch(
      query,
      state.mode
    );
  }

  window.addEventListener(
    "popstate",
    () => {
      restoreFromURL();
    }
  );

  /* =========================
     KEYBOARD
  ========================= */

  function setupKeyboard() {
    document.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key === "/" &&
          document.activeElement?.tagName !== "INPUT" &&
          document.activeElement?.tagName !== "TEXTAREA"
        ) {
          event.preventDefault();

          $("#searchInput")?.focus();
        }
      }
    );
  }

  /* =========================
     HOME NEWS
  ========================= */

  async function loadHomeNews() {
    const container =
      $("#homeNews") ||
      $("#newsResults") ||
      $("#newsPanel");

    if (!container) return;

    try {
      const data =
        await fetchJSON(
          `${CONFIG.newsEndpoint}?page=1&limit=6`
        );

      const results =
        extractResults(data);

      if (!results.length) {
        container.innerHTML = `
          <div style="opacity:.55;">
            No data found
          </div>
        `;
        return;
      }

      container.innerHTML =
        results.slice(0, 6)
          .map((item) => {
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
                  padding:8px 0;
                  color:inherit;
                  text-decoration:none;
                "
              >
                ${escapeHTML(
                  truncate(title, 100)
                )}
              </a>
            `;
          })
          .join("");

    } catch {
      container.innerHTML = `
        <div style="opacity:.5;">
          News unavailable
        </div>
      `;
    }
  }

  /* =========================
     INIT
  ========================= */

  function init() {
    setupSearchForm();
    setupModeButtons();
    setupHomeButtons();
    setupMapControls();
    setupKeyboard();

    state.mode = "web";
    updateModeButtons();

    loadHomeNews();

    restoreFromURL();

    console.log(
      "%cHEXORA",
      "color:#00ffff;font-size:24px;font-weight:bold;"
    );

    console.log(
      "HEXORA main.js loaded successfully."
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
