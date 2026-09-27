/* =========================================================
   HEXORA SEARCH — FRONTEND ENGINE
   Backend/API logic must remain on the server.
   ========================================================= */

(() => {
  "use strict";

  const CONFIG = {
    searchEndpoint: "/api/search",
    newsEndpoint: "/api/news",

    mapTiles:
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",

    geocoder:
      "https://nominatim.openstreetmap.org/search",

    mapScript:
      "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js",

    mapCss:
      "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css",

    defaultCenter: [91.7362, 26.1445],
    defaultZoom: 5,

    requestTimeout: 15000
  };

  const state = {
    mode: "web",
    query: "",
    map: null,
    mapReady: false,
    mapLoading: false,
    userMarker: null,
    searchMarker: null,
    lastLocation: null
  };

  /* =========================================================
     HELPERS
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

  function truncate(text, length = 240) {
    const value = String(text ?? "").trim();

    if (value.length <= length) {
      return value;
    }

    return value.slice(0, length).trim() + "…";
  }

  function formatDate(value) {
    if (!value) return "";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(date);
  }

  async function fetchJSON(url, options = {}) {
    const controller = new AbortController();

    const timeout = setTimeout(() => {
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

      let data = {};

      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new Error(
          `Invalid server response (${response.status})`
        );
      }

      if (!response.ok) {
        throw new Error(
          data.error ||
            data.message ||
            `Request failed (${response.status})`
        );
      }

      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  function setText(selector, text) {
    const element = $(selector);

    if (element) {
      element.textContent = text;
    }
  }

  /* =========================================================
     SEARCH
     ========================================================= */

  async function doSearch(query, mode = state.mode) {
    query = String(query || "").trim();

    if (!query) {
      return;
    }

    state.query = query;
    state.mode = mode;

    const input = $("#searchInput");

    if (input) {
      input.value = query;
    }

    showSearchView();

    const results = $("#results");
    const meta = $("#resultMeta");

    if (results) {
      results.innerHTML = `
        <div class="hexora-loading">
          <div class="hexora-spinner"></div>
          <span>Searching HEXORA…</span>
        </div>
      `;
    }

    if (meta) {
      meta.textContent = "Searching the HEXORA index…";
    }

    try {
      let endpoint = CONFIG.searchEndpoint;

      /*
       * Web search uses /api/search.
       * News uses the dedicated /api/news endpoint.
       * Other modes currently use the same indexed search
       * until dedicated image/video/shopping indexes are connected.
       */

      if (mode === "news") {
        endpoint =
          `${CONFIG.newsEndpoint}?q=${encodeURIComponent(query)}`;
      } else {
        endpoint =
          `${CONFIG.searchEndpoint}?q=${encodeURIComponent(query)}`;
      }

      const data = await fetchJSON(endpoint);

      const list = Array.isArray(data.results)
        ? data.results
        : [];

      renderResults(list, data, query, mode);

      history.replaceState(
        {},
        "",
        `?q=${encodeURIComponent(query)}&mode=${encodeURIComponent(mode)}`
      );
    } catch (error) {
      console.error("HEXORA search error:", error);

      if (meta) {
        meta.textContent = "Search service error";
      }

      if (results) {
        results.innerHTML = `
          <div class="hexora-error">
            <strong>HEXORA search service error</strong>
            <p>${escapeHTML(error.message)}</p>
            <button type="button" id="retrySearch">
              Try Again
            </button>
          </div>
        `;

        const retry = $("#retrySearch");

        if (retry) {
          retry.addEventListener("click", () => {
            doSearch(query, mode);
          });
        }
      }
    }
  }

  function renderResults(items, data, query, mode) {
    const results = $("#results");
    const meta = $("#resultMeta");

    if (!results) {
      return;
    }

    if (meta) {
      const total =
        typeof data.total === "number"
          ? data.total
          : items.length;

      meta.textContent =
        total > 0
          ? `${total.toLocaleString("en-IN")} results for "${query}"`
          : `No indexed results for "${query}"`;
    }

    if (!items.length) {
      results.innerHTML = `
        <div class="hexora-empty">
          <div class="hexora-empty-icon">⌕</div>
          <h3>No indexed results found</h3>
          <p>
            HEXORA could not find a matching page in its current index.
          </p>
        </div>
      `;

      return;
    }

    results.innerHTML = items
      .map((item, index) => {
        const title =
          item.title ||
          item.name ||
          item.url ||
          "Untitled page";

        const url =
          item.url ||
          item.link ||
          "#";

        const description =
          item.description ||
          item.snippet ||
          item.content ||
          "";

        const image =
          item.image_url ||
          item.image ||
          "";

        const source =
          item.source_name ||
          item.source_domain ||
          "";

        const published =
          item.published_at ||
          item.fetched_at ||
          "";

        const safeLink = safeURL(url);

        const imageHTML = image
          ? `
            <img
              class="hexora-result-image"
              src="${escapeHTML(image)}"
              alt=""
              loading="lazy"
              onerror="this.style.display='none'"
            >
          `
          : "";

        return `
          <article
            class="hexora-result"
            data-result-index="${index}"
          >
            <div class="hexora-result-main">

              ${
                source
                  ? `
                    <div class="hexora-result-source">
                      ${escapeHTML(source)}
                    </div>
                  `
                  : ""
              }

              <a
                class="hexora-result-title"
                href="${escapeHTML(safeLink)}"
                target="_blank"
                rel="noopener noreferrer"
              >
                ${escapeHTML(title)}
              </a>

              <div class="hexora-result-url">
                ${escapeHTML(url)}
              </div>

              ${
                description
                  ? `
                    <p class="hexora-result-description">
                      ${escapeHTML(
                        truncate(description, 320)
                      )}
                    </p>
                  `
                  : ""
              }

              ${
                published
                  ? `
                    <div class="hexora-result-date">
                      ${escapeHTML(formatDate(published))}
                    </div>
                  `
                  : ""
              }

            </div>

            ${imageHTML}
          </article>
        `;
      })
      .join("");

    results.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }

  function showSearchView() {
    const searchView = $("#searchView");

    if (searchView) {
      searchView.style.display = "";
    }

    document.body.classList.add("hexora-search-active");

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }

  /* =========================================================
     NEWS
     ========================================================= */

  async function loadNews() {
    const container = $("#newsList");

    if (!container) {
      return;
    }

    container.innerHTML = `
      <div class="hexora-loading">
        <div class="hexora-spinner"></div>
        <span>Loading real indexed news…</span>
      </div>
    `;

    try {
      const data = await fetchJSON(CONFIG.newsEndpoint);

      const items = Array.isArray(data.results)
        ? data.results
        : Array.isArray(data.news)
        ? data.news
        : [];

      if (!items.length) {
        container.innerHTML = `
          <div class="hexora-empty-small">
            No indexed news available yet.
          </div>
        `;

        return;
      }

      container.innerHTML = items
        .slice(0, 12)
        .map((item) => {
          const title =
            item.title ||
            "Untitled news";

          const url =
            safeURL(item.url || "#");

          const source =
            item.source_name ||
            item.source_domain ||
            "HEXORA News";

          const description =
            item.description ||
            "";

          const image =
            item.image_url ||
            item.image ||
            "";

          return `
            <article class="hexora-news-item">

              ${
                image
                  ? `
                    <img
                      src="${escapeHTML(image)}"
                      alt=""
                      loading="lazy"
                      class="hexora-news-image"
                      onerror="this.style.display='none'"
                    >
                  `
                  : ""
              }

              <div class="hexora-news-content">

                <div class="hexora-news-source">
                  ${escapeHTML(source)}
                </div>

                <a
                  href="${escapeHTML(url)}"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  ${escapeHTML(title)}
                </a>

                ${
                  description
                    ? `
                      <p>
                        ${escapeHTML(
                          truncate(description, 180)
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
    } catch (error) {
      console.error("HEXORA news error:", error);

      container.innerHTML = `
        <div class="hexora-error">
          Unable to load indexed news.
        </div>
      `;
    }
  }

  /* =========================================================
     MAPLIBRE
     ========================================================= */

  function loadMapLibre() {
    return new Promise((resolve, reject) => {
      if (window.maplibregl) {
        resolve(window.maplibregl);
        return;
      }

      if (state.mapLoading) {
        const wait = setInterval(() => {
          if (window.maplibregl) {
            clearInterval(wait);
            resolve(window.maplibregl);
          }
        }, 100);

        setTimeout(() => {
          clearInterval(wait);

          if (!window.maplibregl) {
            reject(
              new Error("MapLibre failed to load.")
            );
          }
        }, 15000);

        return;
      }

      state.mapLoading = true;

      const cssExists =
        document.querySelector(
          `link[href="${CONFIG.mapCss}"]`
        );

      if (!cssExists) {
        const link = document.createElement("link");

        link.rel = "stylesheet";
        link.href = CONFIG.mapCss;

        document.head.appendChild(link);
      }

      const script = document.createElement("script");

      script.src = CONFIG.mapScript;
      script.async = true;

      script.onload = () => {
        state.mapLoading = false;

        if (window.maplibregl) {
          resolve(window.maplibregl);
        } else {
          reject(
            new Error("MapLibre loaded but unavailable.")
          );
        }
      };

      script.onerror = () => {
        state.mapLoading = false;

        reject(
          new Error("Unable to load map engine.")
        );
      };

      document.head.appendChild(script);
    });
  }

  async function initMap() {
    const mapElement = $("#hexoraMap");

    if (!mapElement || state.mapReady) {
      return;
    }

    try {
      const maplibregl = await loadMapLibre();

      state.map = new maplibregl.Map({
        container: mapElement,

        style: {
          version: 8,

          sources: {
            osm: {
              type: "raster",
              tiles: [
                CONFIG.mapTiles
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
              source: "osm"
            }
          ]
        },

        center: CONFIG.defaultCenter,
        zoom: CONFIG.defaultZoom,

        attributionControl: true
      });

      state.map.addControl(
        new maplibregl.NavigationControl(),
        "top-right"
      );

      state.map.on("load", () => {
        state.mapReady = true;

        setMapInfo(
          "HEXORA Map • Real OpenStreetMap data"
        );
      });

      state.map.on("error", (event) => {
        console.error(
          "HEXORA map error:",
          event?.error || event
        );
      });
    } catch (error) {
      console.error(
        "HEXORA map initialization error:",
        error
      );

      setMapInfo(
        "Map engine could not be loaded."
      );
    }
  }

  function setMapInfo(message) {
    const info = $("#mapInfo");

    if (info) {
      info.textContent = message;
    }
  }

  function showMapView() {
    const mapView = $("#mapView");

    if (mapView) {
      mapView.style.display = "";
    }

    document.body.classList.add("hexora-map-active");

    setTimeout(() => {
      initMap();

      if (state.map) {
        state.map.resize();
      }
    }, 50);

    const mapElement = $("#hexoraMap");

    if (mapElement) {
      mapElement.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }
  }

  /* =========================================================
     MAP SEARCH
     ========================================================= */

  async function searchMapPlace(query) {
    query = String(query || "").trim();

    if (!query) {
      return;
    }

    showMapView();

    await initMap();

    setMapInfo(
      `Searching HEXORA Map for "${query}"…`
    );

    try {
      const url =
        `${CONFIG.geocoder}?format=jsonv2` +
        `&q=${encodeURIComponent(query)}` +
        `&limit=1`;

      const data = await fetchJSON(url, {
        headers: {
          Accept:
            "application/json"
        }
      });

      if (!Array.isArray(data) || !data.length) {
        setMapInfo(
          `No map place found for "${query}".`
        );

        return;
      }

      const place = data[0];

      const lat = Number(place.lat);
      const lon = Number(place.lon);

      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lon)
      ) {
        throw new Error(
          "Invalid map coordinates."
        );
      }

      if (state.searchMarker) {
        state.searchMarker.remove();
      }

      state.searchMarker =
        new window.maplibregl.Marker()
          .setLngLat([lon, lat])
          .addTo(state.map);

      state.map.flyTo({
        center: [lon, lat],
        zoom: 14,
        speed: 1.2
      });

      setMapInfo(
        place.display_name ||
          "HEXORA Map location"
      );
    } catch (error) {
      console.error(
        "HEXORA map search error:",
        error
      );

      setMapInfo(
        "Map search failed. Please try again."
      );
    }
  }

  /* =========================================================
     CURRENT LOCATION
     ========================================================= */

  function locateUser() {
    if (!navigator.geolocation) {
      setMapInfo(
        "Your browser does not support location."
      );

      return;
    }

    showMapView();

    setMapInfo(
      "Requesting your current location…"
    );

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const latitude =
          position.coords.latitude;

        const longitude =
          position.coords.longitude;

        state.lastLocation = {
          latitude,
          longitude
        };

        await initMap();

        if (state.userMarker) {
          state.userMarker.remove();
        }

        state.userMarker =
          new window.maplibregl.Marker()
            .setLngLat([
              longitude,
              latitude
            ])
            .addTo(state.map);

        state.map.flyTo({
          center: [
            longitude,
            latitude
          ],
          zoom: 15,
          speed: 1.2
        });

        setMapInfo(
          `Your current location • ${latitude.toFixed(
            5
          )}, ${longitude.toFixed(5)}`
        );
      },

      (error) => {
        console.error(
          "Location error:",
          error
        );

        let message =
          "Unable to access your location.";

        if (error.code === 1) {
          message =
            "Location permission was denied.";
        }

        if (error.code === 2) {
          message =
            "Your location is unavailable.";
        }

        if (error.code === 3) {
          message =
            "Location request timed out.";
        }

        setMapInfo(message);
      },

      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
      }
    );
  }

  function resetMap() {
    if (!state.map) {
      return;
    }

    if (state.searchMarker) {
      state.searchMarker.remove();
      state.searchMarker = null;
    }

    if (state.userMarker) {
      state.userMarker.remove();
      state.userMarker = null;
    }

    state.map.flyTo({
      center: CONFIG.defaultCenter,
      zoom: CONFIG.defaultZoom,
      speed: 1
    });

    setMapInfo(
      "HEXORA Map • Real OpenStreetMap data"
    );
  }

  async function fullscreenMap() {
    const element = $("#hexoraMap");

    if (!element) {
      return;
    }

    try {
      if (!document.fullscreenElement) {
        await element.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }

      setTimeout(() => {
        if (state.map) {
          state.map.resize();
        }
      }, 300);
    } catch (error) {
      console.error(
        "Fullscreen error:",
        error
      );
    }
  }

  /* =========================================================
     SATELLITE
     ========================================================= */

  function satelliteView() {
    /*
     * Do NOT fake satellite imagery.
     * This keeps the map honest until a real satellite
     * tile/data provider is connected.
     */

    showMapView();

    setMapInfo(
      "Satellite imagery is not connected yet. HEXORA is showing real map data."
    );
  }

  /* =========================================================
     MAP PREVIEW
     ========================================================= */

  async function initMapPreview() {
    const preview = $("#mapPreview");

    if (!preview) {
      return;
    }

    try {
      const maplibregl =
        await loadMapLibre();

      const previewMap =
        new maplibregl.Map({
          container: preview,

          style: {
            version: 8,

            sources: {
              osm: {
                type: "raster",

                tiles: [
                  CONFIG.mapTiles
                ],

                tileSize: 256,

                attribution:
                  "© OpenStreetMap contributors"
              }
            },

            layers: [
              {
                id: "osm-preview",
                type: "raster",
                source: "osm"
              }
            ]
          },

          center:
            CONFIG.defaultCenter,

          zoom: 4,

          interactive: false,

          attributionControl: false
        });

      previewMap.on(
        "error",
        (event) => {
          console.error(
            "Map preview error:",
            event?.error || event
          );
        }
      );
    } catch (error) {
      console.error(
        "Map preview failed:",
        error
      );

      preview.innerHTML = `
        <div class="hexora-map-fallback">
          HEXORA MAP
        </div>
      `;
    }
  }

  /* =========================================================
     MODES
     ========================================================= */

  function setMode(mode) {
    state.mode = mode;

    $$(".mode").forEach((button) => {
      button.classList.toggle(
        "active",
        button.dataset.mode === mode
      );
    });

    if (mode === "maps") {
      showMapView();
      return;
    }

    if (state.query) {
      doSearch(
        state.query,
        mode === "web" ? "web" : mode
      );
    }
  }

  /* =========================================================
     MOBILE MENU
     ========================================================= */

  function setupMobileMenu() {
    const menuButton =
      $("#mobileMenu");

    const menu =
      $("#mobileNav");

    if (!menuButton || !menu) {
      return;
    }

    menuButton.addEventListener(
      "click",
      () => {
        menu.classList.toggle("open");
      }
    );
  }

  /* =========================================================
     NAVIGATION
     ========================================================= */

  function setupNavigation() {
    $$("[data-nav]").forEach(
      (element) => {
        element.addEventListener(
          "click",
          (event) => {
            const target =
              element.dataset.nav;

            if (!target) {
              return;
            }

            event.preventDefault();

            if (target === "home") {
              document.body.classList.remove(
                "hexora-search-active"
              );

              window.scrollTo({
                top: 0,
                behavior: "smooth"
              });

              return;
            }

            if (
              target === "web" ||
              target === "search"
            ) {
              const input =
                $("#searchInput");

              if (input) {
                input.focus();
              }

              return;
            }

            if (target === "maps") {
              showMapView();
            }

            if (target === "news") {
              const news =
                $("#newsList");

              if (news) {
                news.scrollIntoView({
                  behavior: "smooth"
                });
              }
            }
          }
        );
      }
    );
  }

  /* =========================================================
     SEARCH FORM
     ========================================================= */

  function setupSearch() {
    const form =
      $("#searchForm");

    const input =
      $("#searchInput");

    if (!form || !input) {
      return;
    }

    form.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();

        doSearch(
          input.value,
          state.mode
        );
      }
    );
  }

  /* =========================================================
     MODE BUTTONS
     ========================================================= */

  function setupModes() {
    $$(".mode").forEach(
      (button) => {
        button.addEventListener(
          "click",
          () => {
            const mode =
              button.dataset.mode ||
              "web";

            setMode(mode);
          }
        );
      }
    );
  }

  /* =========================================================
     TRENDING
     ========================================================= */

  function setupTrending() {
    $$(".trend").forEach(
      (element) => {
        element.addEventListener(
          "click",
          () => {
            const query =
              element.dataset.query ||
              element.textContent ||
              "";

            const input =
              $("#searchInput");

            if (input) {
              input.value =
                query.trim();
            }

            doSearch(
              query.trim(),
              "web"
            );
          }
        );
      }
    );
  }

  /* =========================================================
     QUICK ACTIONS
     ========================================================= */

  function setupQuickActions() {
    $$("[data-quick]").forEach(
      (button) => {
        button.addEventListener(
          "click",
          () => {
            const action =
              button.dataset.quick;

            if (action === "location") {
              locateUser();
            }

            if (action === "search") {
              showMapView();

              const input =
                $("#mapSearchInput");

              if (input) {
                input.focus();
              }
            }

            if (action === "directions") {
              showMapView();

              setMapInfo(
                "Search a place first to begin map navigation."
              );

              const input =
                $("#mapSearchInput");

              if (input) {
                input.focus();
              }
            }

            if (action === "satellite") {
              satelliteView();
            }
          }
        );
      }
    );
  }

  /* =========================================================
     MAP CONTROLS
     ========================================================= */

  function setupMapControls() {
    const searchButton =
      $("#mapSearchBtn");

    const mapInput =
      $("#mapSearchInput");

    if (searchButton && mapInput) {
      searchButton.addEventListener(
        "click",
        () => {
          searchMapPlace(
            mapInput.value
          );
        }
      );

      mapInput.addEventListener(
        "keydown",
        (event) => {
          if (event.key === "Enter") {
            event.preventDefault();

            searchMapPlace(
              mapInput.value
            );
          }
        }
      );
    }

    const locateButton =
      $("#locateBtn");

    if (locateButton) {
      locateButton.addEventListener(
        "click",
        locateUser
      );
    }

    const resetButton =
      $("#resetMapBtn");

    if (resetButton) {
      resetButton.addEventListener(
        "click",
        resetMap
      );
    }

    const fullscreenButton =
      $("#fullscreenMapBtn");

    if (fullscreenButton) {
      fullscreenButton.addEventListener(
        "click",
        fullscreenMap
      );
    }
  }

  /* =========================================================
     FEATURE BUTTONS
     ========================================================= */

  function setupFeatureButtons() {
    const openMap =
      $("#openMapBtn");

    if (openMap) {
      openMap.addEventListener(
        "click",
        showMapView
      );
    }

    const mapPreviewButton =
      $("#mapPreviewBtn");

    if (mapPreviewButton) {
      mapPreviewButton.addEventListener(
        "click",
        showMapView
      );
    }

    const newsButton =
      $("#viewNewsBtn");

    if (newsButton) {
      newsButton.addEventListener(
        "click",
        () => {
          const news =
            $("#newsList");

          if (news) {
            news.scrollIntoView({
              behavior: "smooth"
            });
          }
        }
      );
    }
  }

  /* =========================================================
     CUSTOM SMALL CSS
     ========================================================= */

  function injectUtilityStyles() {
    if ($("#hexoraRuntimeStyles")) {
      return;
    }

    const style =
      document.createElement("style");

    style.id =
      "hexoraRuntimeStyles";

    style.textContent = `
      .hexora-loading {
        display:flex;
        align-items:center;
        gap:12px;
        padding:24px;
        opacity:.85;
      }

      .hexora-spinner {
        width:20px;
        height:20px;
        border:3px solid rgba(255,255,255,.18);
        border-top-color:currentColor;
        border-radius:50%;
        animation:hexoraSpin .8s linear infinite;
      }

      @keyframes hexoraSpin {
        to {
          transform:rotate(360deg);
        }
      }

      .hexora-result {
        display:flex;
        justify-content:space-between;
        gap:18px;
        padding:22px 0;
        border-bottom:1px solid rgba(255,255,255,.08);
      }

      .hexora-result-main {
        min-width:0;
        flex:1;
      }

      .hexora-result-source {
        font-size:12px;
        opacity:.65;
        margin-bottom:5px;
      }

      .hexora-result-title {
        display:block;
        font-size:20px;
        line-height:1.3;
        font-weight:700;
        text-decoration:none;
      }

      .hexora-result-url {
        font-size:12px;
        opacity:.55;
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
        margin-top:5px;
      }

      .hexora-result-description {
        line-height:1.6;
        opacity:.8;
        margin:9px 0 0;
      }

      .hexora-result-date {
        font-size:12px;
        opacity:.5;
        margin-top:8px;
      }

      .hexora-result-image {
        width:150px;
        height:100px;
        object-fit:cover;
        border-radius:14px;
        flex:none;
      }

      .hexora-error,
      .hexora-empty {
        padding:30px;
        border-radius:18px;
        background:rgba(255,255,255,.04);
        border:1px solid rgba(255,255,255,.08);
      }

      .hexora-empty-icon {
        font-size:40px;
        opacity:.6;
      }

      .hexora-error button {
        margin-top:12px;
        border:0;
        border-radius:10px;
        padding:10px 16px;
        cursor:pointer;
      }

      .hexora-news-item {
        display:flex;
        gap:14px;
        padding:14px 0;
        border-bottom:1px solid rgba(255,255,255,.08);
      }

      .hexora-news-image {
        width:92px;
        height:70px;
        object-fit:cover;
        border-radius:10px;
        flex:none;
      }

      .hexora-news-content {
        min-width:0;
      }

      .hexora-news-source {
        font-size:11px;
        opacity:.55;
        margin-bottom:4px;
      }

      .hexora-news-content a {
        font-weight:700;
        text-decoration:none;
        line-height:1.35;
      }

      .hexora-news-content p {
        margin:5px 0 0;
        font-size:13px;
        opacity:.7;
      }

      .hexora-map-fallback {
        width:100%;
        height:100%;
        display:grid;
        place-items:center;
        font-weight:800;
        letter-spacing:4px;
        opacity:.5;
      }

      @media(max-width:600px) {
        .hexora-result {
          display:block;
        }

        .hexora-result-image {
          width:100%;
          height:180px;
          margin-top:12px;
        }

        .hexora-result-title {
          font-size:18px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  /* =========================================================
     URL STATE
     ========================================================= */

  function loadURLState() {
    const params =
      new URLSearchParams(
        window.location.search
      );

    const query =
      params.get("q");

    const mode =
      params.get("mode");

    if (mode) {
      state.mode = mode;

      $$(".mode").forEach(
        (button) => {
          button.classList.toggle(
            "active",
            button.dataset.mode === mode
          );
        }
      );
    }

    if (query) {
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
  }

  /* =========================================================
     INITIALIZE
     ========================================================= */

  function init() {
    injectUtilityStyles();

    setupSearch();
    setupModes();
    setupTrending();
    setupQuickActions();
    setupMapControls();
    setupFeatureButtons();
    setupMobileMenu();
    setupNavigation();

    loadNews();

    /*
     * Map preview is loaded after the main page.
     * If map preview does not exist, nothing breaks.
     */
    setTimeout(() => {
      initMapPreview();
    }, 300);

    loadURLState();

    /*
     * Expose a small public API for debugging /
     * future HEXORA modules.
     */
    window.HEXORA = {
      search: doSearch,
      searchNews: (query) =>
        doSearch(query, "news"),
      showMap: showMapView,
      searchMap: searchMapPlace,
      locate: locateUser,
      resetMap,
      setMode
    };

    console.log(
      "HEXORA frontend initialized."
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
