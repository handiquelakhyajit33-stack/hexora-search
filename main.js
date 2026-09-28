```javascript
/* =========================================================
   HEXORA SEARCH — FRONTEND ENGINE
   UI navigation + search + map
   Backend/API remains on the server.
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
      const url = new URL(
        String(value || ""),
        window.location.origin
      );

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

  function truncate(text, length = 320) {
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

  /* =========================================================
     VIEW MANAGEMENT
     ========================================================= */

  function showHomeView() {
    const home = $("#homeView");
    const search = $("#searchView");
    const map = $("#mapView");

    if (home) {
      home.style.display = "";
    }

    if (search) {
      search.style.display = "none";
    }

    if (map) {
      map.style.display = "none";
    }

    document.body.classList.remove(
      "hexora-search-active",
      "hexora-map-active"
    );

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });

    updateActiveNavigation("home");
  }

  function showSearchView() {
    const home = $("#homeView");
    const search = $("#searchView");
    const map = $("#mapView");

    if (home) {
      home.style.display = "none";
    }

    if (map) {
      map.style.display = "none";
    }

    if (search) {
      search.style.display = "block";
    }

    document.body.classList.add(
      "hexora-search-active"
    );

    document.body.classList.remove(
      "hexora-map-active"
    );

    updateActiveNavigation(
      state.mode === "web"
        ? "web"
        : state.mode
    );

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }

  function updateActiveNavigation(mode) {
    $$("[data-mode]").forEach((button) => {
      button.classList.toggle(
        "active",
        button.dataset.mode === mode
      );
    });

    $$(".mode").forEach((button) => {
      button.classList.toggle(
        "active",
        button.dataset.mode === mode
      );
    });

    if (mode === "home") {
      $$("[data-home]").forEach((button) => {
        button.classList.add("active");
      });
    }
  }

  /* =========================================================
     SEARCH
     ========================================================= */

  async function doSearch(query, mode = state.mode) {
    query = String(query || "").trim();

    if (!query) {
      const input = $("#searchInput");

      if (input) {
        input.focus();
      }

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
      meta.textContent =
        `Searching HEXORA for "${query}"…`;
    }

    try {
      let endpoint;

      if (mode === "news") {
        endpoint =
          `${CONFIG.newsEndpoint}?q=${encodeURIComponent(query)}`;
      } else {
        endpoint =
          `${CONFIG.searchEndpoint}?q=${encodeURIComponent(query)}`;
      }

      console.log(
        "HEXORA request:",
        endpoint
      );

      const data = await fetchJSON(endpoint);

      /*
       * Accept several common server response shapes.
       */
      let list = [];

      if (Array.isArray(data.results)) {
        list = data.results;
      } else if (Array.isArray(data.items)) {
        list = data.items;
      } else if (Array.isArray(data.data)) {
        list = data.data;
      } else if (Array.isArray(data)) {
        list = data;
      }

      renderResults(
        list,
        data,
        query,
        mode
      );

      const url =
        `?q=${encodeURIComponent(query)}` +
        `&mode=${encodeURIComponent(mode)}`;

      history.replaceState(
        {},
        "",
        url
      );

    } catch (error) {
      console.error(
        "HEXORA search error:",
        error
      );

      if (meta) {
        meta.textContent =
          "HEXORA search service error";
      }

      if (results) {
        results.innerHTML = `
          <div class="hexora-error">
            <strong>HEXORA search service error</strong>

            <p>
              ${escapeHTML(
                error.message ||
                "Unable to contact the search server."
              )}
            </p>

            <button
              type="button"
              id="retrySearch"
            >
              Try Again
            </button>
          </div>
        `;

        const retry =
          $("#retrySearch");

        if (retry) {
          retry.addEventListener(
            "click",
            () => {
              doSearch(
                query,
                mode
              );
            }
          );
        }
      }
    }
  }

  function renderResults(
    items,
    data,
    query,
    mode
  ) {
    const results = $("#results");
    const meta = $("#resultMeta");

    if (!results) {
      return;
    }

    const total =
      typeof data?.total === "number"
        ? data.total
        : items.length;

    if (meta) {
      meta.textContent =
        total > 0
          ? `${total.toLocaleString("en-IN")} results for "${query}"`
          : `No indexed results for "${query}"`;
    }

    if (!items.length) {
      results.innerHTML = `
        <div class="hexora-empty">

          <div class="hexora-empty-icon">
            ⌕
          </div>

          <h3>
            No indexed results found
          </h3>

          <p>
            HEXORA could not find a matching
            page in its current index.
          </p>

          <p style="opacity:.6">
            Query: ${escapeHTML(query)}
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
          item.heading ||
          item.url ||
          item.link ||
          "Untitled page";

        const url =
          item.url ||
          item.link ||
          item.href ||
          "#";

        const description =
          item.description ||
          item.snippet ||
          item.summary ||
          item.content ||
          "";

        const image =
          item.image_url ||
          item.image ||
          item.thumbnail ||
          "";

        const source =
          item.source_name ||
          item.source_domain ||
          item.domain ||
          "";

        const published =
          item.published_at ||
          item.publishedAt ||
          item.fetched_at ||
          item.created_at ||
          "";

        const safeLink =
          safeURL(url);

        const imageHTML =
          image
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
                        truncate(
                          description,
                          320
                        )
                      )}
                    </p>
                  `
                  : ""
              }

              ${
                published
                  ? `
                    <div class="hexora-result-date">
                      ${escapeHTML(
                        formatDate(
                          published
                        )
                      )}
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

  /* =========================================================
     NEWS
     ========================================================= */

  async function loadNews() {
    const container =
      $("#newsList");

    if (!container) {
      return;
    }

    container.innerHTML = `
      <div class="hexora-loading">
        <div class="hexora-spinner"></div>
        <span>
          Loading real indexed news…
        </span>
      </div>
    `;

    try {
      const data =
        await fetchJSON(
          CONFIG.newsEndpoint
        );

      const items =
        Array.isArray(data.results)
          ? data.results
          : Array.isArray(data.news)
            ? data.news
            : Array.isArray(data.items)
              ? data.items
              : [];

      if (!items.length) {
        container.innerHTML = `
          <div class="hexora-empty-small">
            No indexed news available yet.
          </div>
        `;

        return;
      }

      container.innerHTML =
        items
          .slice(0, 12)
          .map((item) => {
            const title =
              item.title ||
              "Untitled news";

            const url =
              safeURL(
                item.url ||
                item.link ||
                "#"
              );

            const source =
              item.source_name ||
              item.source_domain ||
              "HEXORA News";

            const description =
              item.description ||
              item.snippet ||
              "";

            const image =
              item.image_url ||
              item.image ||
              "";

            return `
              <article
                class="hexora-news-item"
              >

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

                <div
                  class="hexora-news-content"
                >

                  <div
                    class="hexora-news-source"
                  >
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
                            truncate(
                              description,
                              180
                            )
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
      console.error(
        "HEXORA news error:",
        error
      );

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
    return new Promise(
      (resolve, reject) => {

        if (window.maplibregl) {
          resolve(
            window.maplibregl
          );
          return;
        }

        if (state.mapLoading) {
          const wait =
            setInterval(() => {

              if (
                window.maplibregl
              ) {
                clearInterval(wait);

                resolve(
                  window.maplibregl
                );
              }

            }, 100);

          setTimeout(() => {
            clearInterval(wait);

            if (
              !window.maplibregl
            ) {
              reject(
                new Error(
                  "MapLibre failed to load."
                )
              );
            }

          }, 15000);

          return;
        }

        state.mapLoading = true;

        if (
          !document.querySelector(
            `link[href="${CONFIG.mapCss}"]`
          )
        ) {
          const link =
            document.createElement(
              "link"
            );

          link.rel =
            "stylesheet";

          link.href =
            CONFIG.mapCss;

          document.head.appendChild(
            link
          );
        }

        const script =
          document.createElement(
            "script"
          );

        script.src =
          CONFIG.mapScript;

        script.async = true;

        script.onload = () => {
          state.mapLoading =
            false;

          if (
            window.maplibregl
          ) {
            resolve(
              window.maplibregl
            );
          } else {
            reject(
              new Error(
                "MapLibre unavailable."
              )
            );
          }
        };

        script.onerror = () => {
          state.mapLoading =
            false;

          reject(
            new Error(
              "Unable to load map engine."
            )
          );
        };

        document.head.appendChild(
          script
        );
      }
    );
  }

  async function initMap() {
    const mapElement =
      $("#hexoraMap");

    if (
      !mapElement ||
      state.mapReady
    ) {
      return;
    }

    try {
      const maplibregl =
        await loadMapLibre();

      state.map =
        new maplibregl.Map({
          container:
            mapElement,

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

          center:
            CONFIG.defaultCenter,

          zoom:
            CONFIG.defaultZoom,

          attributionControl:
            true
        });

      state.map.addControl(
        new maplibregl.NavigationControl(),
        "top-right"
      );

      state.map.on(
        "load",
        () => {
          state.mapReady = true;

          setMapInfo(
            "HEXORA Map • Real OpenStreetMap data"
          );

          setTimeout(() => {
            if (state.map) {
              state.map.resize();
            }
          }, 100);
        }
      );

      state.map.on(
        "error",
        (event) => {
          console.error(
            "HEXORA map error:",
            event?.error ||
            event
          );
        }
      );

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
    const info =
      $("#mapInfo");

    if (info) {
      info.textContent =
        message;
      info.style.display =
        "block";
    }
  }

  function showMapView() {
    const home =
      $("#homeView");

    const search =
      $("#searchView");

    const map =
      $("#mapView");

    if (home) {
      home.style.display =
        "none";
    }

    if (search) {
      search.style.display =
        "none";
    }

    if (map) {
      map.style.display =
        "block";
    }

    document.body.classList.add(
      "hexora-map-active"
    );

    document.body.classList.remove(
      "hexora-search-active"
    );

    updateActiveNavigation(
      "maps"
    );

    setTimeout(async () => {
      await initMap();

      if (state.map) {
        state.map.resize();
      }
    }, 50);
  }

  /* =========================================================
     MAP SEARCH
     ========================================================= */

  async function searchMapPlace(query) {
    query =
      String(query || "").trim();

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
        `${CONFIG.geocoder}` +
        `?format=jsonv2` +
        `&q=${encodeURIComponent(query)}` +
        `&limit=1`;

      const data =
        await fetchJSON(
          url,
          {
            headers: {
              Accept:
                "application/json"
            }
          }
        );

      if (
        !Array.isArray(data) ||
        !data.length
      ) {
        setMapInfo(
          `No map place found for "${query}".`
        );

        return;
      }

      const place =
        data[0];

      const lat =
        Number(place.lat);

      const lon =
        Number(place.lon);

      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lon)
      ) {
        throw new Error(
          "Invalid map coordinates."
        );
      }

      if (
        state.searchMarker
      ) {
        state.searchMarker.remove();
      }

      state.searchMarker =
        new window.maplibregl.Marker()
          .setLngLat([
            lon,
            lat
          ])
          .addTo(
            state.map
          );

      state.map.flyTo({
        center: [
          lon,
          lat
        ],
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
     LOCATION
     ========================================================= */

  function locateUser() {
    if (
      !navigator.geolocation
    ) {
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

        if (
          state.userMarker
        ) {
          state.userMarker.remove();
        }

        state.userMarker =
          new window.maplibregl.Marker()
            .setLngLat([
              longitude,
              latitude
            ])
            .addTo(
              state.map
            );

        state.map.flyTo({
          center: [
            longitude,
            latitude
          ],
          zoom: 15,
          speed: 1.2
        });

        setMapInfo(
          `Your current location • ` +
          `${latitude.toFixed(5)}, ` +
          `${longitude.toFixed(5)}`
        );
      },

      (error) => {

        console.error(
          "Location error:",
          error
        );

        let message =
          "Unable to access your location.";

        if (
          error.code === 1
        ) {
          message =
            "Location permission was denied.";
        }

        if (
          error.code === 2
        ) {
          message =
            "Your location is unavailable.";
        }

        if (
          error.code === 3
        ) {
          message =
            "Location request timed out.";
        }

        setMapInfo(
          message
        );
      },

      {
        enableHighAccuracy:
          true,

        timeout:
          15000,

        maximumAge:
          0
      }
    );
  }

  function resetMap() {
    if (!state.map) {
      return;
    }

    if (
      state.searchMarker
    ) {
      state.searchMarker.remove();

      state.searchMarker =
        null;
    }

    if (
      state.userMarker
    ) {
      state.userMarker.remove();

      state.userMarker =
        null;
    }

    state.map.flyTo({
      center:
        CONFIG.defaultCenter,

      zoom:
        CONFIG.defaultZoom,

      speed: 1
    });

    setMapInfo(
      "HEXORA Map • Real OpenStreetMap data"
    );
  }

  async function fullscreenMap() {
    const element =
      $("#hexoraMap");

    if (!element) {
      return;
    }

    try {
      if (
        !document.fullscreenElement
      ) {
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

  function satelliteView() {
    showMapView();

    setMapInfo(
      "Satellite imagery is not connected yet. HEXORA is showing real map data."
    );
  }

  /* =========================================================
     MAP PREVIEW
     ========================================================= */

  async function initMapPreview() {
    const preview =
      $("#mapPreview");

    if (!preview) {
      return;
    }

    try {
      const maplibregl =
        await loadMapLibre();

      const previewMap =
        new maplibregl.Map({
          container:
            preview,

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
                id:
                  "osm-preview",

                type:
                  "raster",

                source:
                  "osm"
              }
            ]
          },

          center:
            CONFIG.defaultCenter,

          zoom: 4,

          interactive:
            false,

          attributionControl:
            false
        });

      previewMap.on(
        "error",
        (event) => {
          console.error(
            "Map preview error:",
            event?.error ||
            event
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
     MODE HANDLING
     ========================================================= */

  function setMode(mode) {
    mode =
      String(mode || "web");

    state.mode =
      mode;

    updateActiveNavigation(
      mode
    );

    /*
     * Maps has its own view.
     */
    if (
      mode === "maps"
    ) {
      showMapView();
      return;
    }

    /*
     * AI / images / news / videos
     * with an existing query can
     * search immediately.
     */
    if (
      state.query
    ) {
      doSearch(
        state.query,
        mode
      );

      return;
    }

    /*
     * No query yet:
     * open search view and focus input.
     */
    showSearchView();

    const input =
      $("#searchInput");

    if (input) {
      input.focus();
    }
  }

  /* =========================================================
     NAVIGATION
     ========================================================= */

  function setupNavigation() {

    /*
     * HOME buttons
     */
    $$("[data-home]").forEach(
      (element) => {

        element.addEventListener(
          "click",
          (event) => {

            event.preventDefault();

            showHomeView();
          }
        );
      }
    );

    /*
     * ALL data-mode buttons
     *
     * This fixes the original bug where
     * sidebar / quick-card / AI buttons
     * had no click handlers.
     */
    $$("[data-mode]").forEach(
      (element) => {

        element.addEventListener(
          "click",
          (event) => {

            event.preventDefault();

            const mode =
              element.dataset.mode ||
              "web";

            setMode(mode);
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

    if (
      !form ||
      !input
    ) {
      console.error(
        "HEXORA search form not found."
      );

      return;
    }

    form.addEventListener(
      "submit",
      (event) => {

        event.preventDefault();

        const query =
          input.value.trim();

        if (!query) {
          input.focus();
          return;
        }

        doSearch(
          query,
          state.mode
        );
      }
    );

    /*
     * Extra keyboard support.
     */
    input.addEventListener(
      "keydown",
      (event) => {

        if (
          event.key === "Enter"
        ) {
          event.preventDefault();

          form.requestSubmit();
        }
      }
    );
  }

  /* =========================================================
     MODE BUTTONS
     ========================================================= */

  function setupModes() {
    /*
     * Main mode buttons are already
     * handled by setupNavigation().
     *
     * Keep active-state support here.
     */
    $$(".mode").forEach(
      (button) => {

        button.addEventListener(
          "click",
          (event) => {

            event.preventDefault();

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
     =========================
```
