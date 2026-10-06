```javascript
(() => {
  "use strict";

  /* =========================================================
     HEXORA SEARCH ENGINE
     Complete frontend controller
  ========================================================= */

  const CONFIG = {
    searchEndpoint: "/api/search",
    newsEndpoint: "/api/news",

    mapTiles:
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",

    geocoder:
      "https://nominatim.openstreetmap.org/search",

    mapLibreJS:
      "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js",

    mapLibreCSS:
      "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css",

    defaultCenter: [91.7362, 26.1445],
    defaultZoom: 5,

    timeout: 15000
  };

  /* =========================================================
     STATE
  ========================================================= */

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

  const $ = (selector) => document.querySelector(selector);

  const $$ = (selector) =>
    Array.from(document.querySelectorAll(selector));

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

  function truncate(text, length = 220) {
    text = String(text || "");

    if (text.length <= length) {
      return text;
    }

    return text.slice(0, length).trim() + "…";
  }

  function setText(selector, value) {
    const element = $(selector);

    if (element) {
      element.textContent = value ?? "";
    }
  }

  function formatDate(value) {
    if (!value) {
      return "";
    }

    try {
      const date = new Date(value);

      if (Number.isNaN(date.getTime())) {
        return "";
      }

      return new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric"
      }).format(date);
    } catch {
      return "";
    }
  }

  async function fetchJSON(url, options = {}) {
    const controller = new AbortController();

    const timer = setTimeout(() => {
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

      const contentType =
        response.headers.get("content-type") || "";

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}`
        );
      }

      if (!contentType.includes("application/json")) {
        const text = await response.text();

        throw new Error(
          `Server returned non-JSON response: ${text.slice(0, 120)}`
        );
      }

      return await response.json();

    } finally {
      clearTimeout(timer);
    }
  }

  /* =========================================================
     SEARCH VIEW
  ========================================================= */

  function showHomeView() {
    const homeView = $("#homeView");
    const searchView = $("#searchView");
    const mapView = $("#mapView");

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

    document.body.classList.remove(
      "hexora-search-active"
    );

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }

  function showSearchView() {
    const homeView = $("#homeView");
    const searchView = $("#searchView");
    const mapView = $("#mapView");

    if (homeView) {
      homeView.style.display = "none";
    }

    if (mapView) {
      mapView.classList.remove("active");
      mapView.style.display = "none";
    }

    if (searchView) {
      searchView.style.display = "block";
      searchView.classList.add("active");
    }

    document.body.classList.add(
      "hexora-search-active"
    );

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }

  /* =========================================================
     MAP VIEW
  ========================================================= */

  function showMapView() {
    const homeView = $("#homeView");
    const searchView = $("#searchView");
    const mapView = $("#mapView");

    if (homeView) {
      homeView.style.display = "none";
    }

    if (searchView) {
      searchView.classList.remove("active");
      searchView.style.display = "none";
    }

    if (mapView) {
      mapView.style.display = "block";
      mapView.classList.add("active");
    }

    document.body.classList.add(
      "hexora-search-active"
    );

    initMap();

    setTimeout(() => {
      if (state.map) {
        state.map.resize();
      }
    }, 150);
  }

  /* =========================================================
     LOADING SCREEN
  ========================================================= */

  function showSearching(query) {
    const results = $("#results");
    const meta = $("#resultMeta");

    if (meta) {
      meta.textContent = "";
    }

    if (!results) {
      return;
    }

    results.innerHTML = `
      <div class="hexora-searching">

        <div class="hexora-loader">

          <div class="hexora-loader-ring"></div>

          <div class="hexora-loader-logo">
            H
          </div>

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

  /* =========================================================
     SEARCH
  ========================================================= */

  async function doSearch(query, mode = "web") {
    query = String(query || "").trim();

    state.query = query;
    state.mode = mode;

    if (!query) {
      showSearchView();

      const results = $("#results");

      if (results) {
        results.innerHTML = `
          <div class="hexora-empty">

            <div class="hexora-search-logo">
              H
            </div>

            <h2>Search HEXORA</h2>

            <p>
              Type something to search the web.
            </p>

          </div>
        `;
      }

      $("#searchInput")?.focus();

      return;
    }

    /* Show search page first */
    showSearchView();

    /* Show loading animation */
    showSearching(query);

    /* Small delay for loading animation */
    await new Promise((resolve) => {
      setTimeout(resolve, 180);
    });

    try {

      const endpoint =
        mode === "news"
          ? CONFIG.newsEndpoint
          : CONFIG.searchEndpoint;

      /*
       * IMPORTANT FIX:
       * Always send the selected mode to backend.
       *
       * web    -> mode=web
       * images -> mode=images
       * videos -> mode=videos
       * news   -> mode=news
       */
      const url =
        `${endpoint}?q=${encodeURIComponent(query)}&mode=${encodeURIComponent(mode)}`;

      console.log(
        "[HEXORA] Searching:",
        url
      );

      const data =
        await fetchJSON(url);

      console.log(
        "[HEXORA] Search response:",
        data
      );

      const results =
        Array.isArray(data?.results)
          ? data.results
          : [];

      const meta =
        $("#resultMeta");

      if (meta) {

        const total =
          Number.isFinite(Number(data?.total))
            ? Number(data.total)
            : results.length;

        meta.textContent =
          `${total.toLocaleString()} result${total === 1 ? "" : "s"} found`;
      }

      if (!results.length) {
        showNoResults(query);
        return;
      }

      renderResults(
        results,
        mode
      );

    } catch (error) {

      console.error(
        "[HEXORA] Search error:",
        error
      );

      showSearchError(error);
    }
  }

  /* =========================================================
     NO RESULTS
  ========================================================= */

  function showNoResults(query) {
    const results = $("#results");

    if (!results) {
      return;
    }

    const modeText =
      state.mode === "images"
        ? "image"
        : state.mode === "videos"
        ? "video"
        : state.mode === "news"
        ? "news"
        : "web";

    results.innerHTML = `
      <div class="hexora-no-results">

        <div class="hexora-no-results-logo">
          H
        </div>

        <h2>
          No ${escapeHTML(modeText)} results found
        </h2>

        <p>
          HEXORA could not find matching indexed
          results for
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

    $("#hexoraRetryBtn")?.addEventListener(
      "click",
      () => {
        doSearch(
          query,
          state.mode
        );
      }
    );
  }

  /* =========================================================
     SEARCH ERROR
  ========================================================= */

  function showSearchError(error) {
    const results = $("#results");

    if (!results) {
      return;
    }

    results.innerHTML = `
      <div class="hexora-error">

        <div class="hexora-error-logo">
          !
        </div>

        <h2>HEXORA search error</h2>

        <p>
          HEXORA could not connect to the
          search server.
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

    $("#hexoraRetryBtn")?.addEventListener(
      "click",
      () => {
        doSearch(
          state.query,
          state.mode
        );
      }
    );

    console.error(error);
  }

  /* =========================================================
     RESULT CARD
  ========================================================= */

  function renderResults(items, mode = "web") {
    const results = $("#results");

    if (!results) {
      return;
    }

    results.innerHTML =
      items
        .map((item, index) => {

          const title =
            item.title ||
            item.name ||
            item.heading ||
            "Untitled";

          const url =
            item.url ||
            item.link ||
            item.href ||
            "#";

          const description =
            item.description ||
            item.snippet ||
            item.content ||
            "";

          const image =
            item.image ||
            item.thumbnail ||
            item.image_url ||
            "";

          const source =
            item.source ||
            item.domain ||
            "";

          const date =
            formatDate(
              item.date ||
              item.published_at ||
              item.publishedAt ||
              item.created_at
            );

          const videoURL =
            item.video_url ||
            item.video ||
            "";

          const cleanURL =
            safeURL(url);

          const cleanImage =
            safeURL(image);

          const cleanVideo =
            safeURL(videoURL);

          /*
           * IMAGE MODE
           */
          if (mode === "images") {

            return `
              <article
                class="hexora-result hexora-image-result"
                data-result-index="${index}"
              >

                ${
                  image
                    ? `
                      <a
                        href="${cleanURL}"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="hexora-large-image"
                      >
                        <img
                          src="${cleanImage}"
                          alt="${escapeHTML(title)}"
                          loading="lazy"
                          onerror="this.parentElement.style.display='none'"
                        />
                      </a>
                    `
                    : ""
                }

                <div class="hexora-result-body">

                  <div class="hexora-result-source">
                    ${escapeHTML(source || cleanURL)}
                  </div>

                  <h2 class="hexora-result-title">

                    <a
                      href="${cleanURL}"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      ${escapeHTML(title)}
                    </a>

                  </h2>

                  ${
                    description
                      ? `
                        <p class="hexora-result-description">
                          ${escapeHTML(
                            truncate(description, 220)
                          )}
                        </p>
                      `
                      : ""
                  }

                </div>

              </article>
            `;
          }

          /*
           * VIDEO MODE
           */
          if (mode === "videos") {

            return `
              <article
                class="hexora-result hexora-video-result"
                data-result-index="${index}"
              >

                ${
                  videoURL
                    ? `
                      <div class="hexora-video-box">

                        <a
                          href="${cleanVideo}"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          ▶ Watch Video
                        </a>

                      </div>
                    `
                    : image
                    ? `
                      <a
                        href="${cleanURL}"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="hexora-large-image"
                      >
                        <img
                          src="${cleanImage}"
                          alt="${escapeHTML(title)}"
                          loading="lazy"
                          onerror="this.parentElement.style.display='none'"
                        />

                        <span class="hexora-play">
                          ▶
                        </span>

                      </a>
                    `
                    : ""
                }

                <div class="hexora-result-body">

                  <div class="hexora-result-source">
                    ${escapeHTML(source || cleanURL)}
                  </div>

                  <h2 class="hexora-result-title">

                    <a
                      href="${cleanURL}"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      ${escapeHTML(title)}
                    </a>

                  </h2>

                  <div class="hexora-result-url">
                    ${escapeHTML(url)}
                  </div>

                  ${
                    description
                      ? `
                        <p class="hexora-result-description">
                          ${escapeHTML(
                            truncate(description, 300)
                          )}
                        </p>
                      `
                      : ""
                  }

                </div>

              </article>
            `;
          }

          /*
           * NEWS MODE
           */
          if (mode === "news") {

            return `
              <article
                class="hexora-result hexora-news-result"
                data-result-index="${index}"
              >

                <div class="hexora-result-body">

                  <div class="hexora-result-source">
                    ${escapeHTML(source || cleanURL)}
                  </div>

                  <h2 class="hexora-result-title">

                    <a
                      href="${cleanURL}"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      ${escapeHTML(title)}
                    </a>

                  </h2>

                  <div class="hexora-result-url">
                    ${escapeHTML(url)}
                  </div>

                  ${
                    description
                      ? `
                        <p class="hexora-result-description">
                          ${escapeHTML(
                            truncate(description, 300)
                          )}
                        </p>
                      `
                      : ""
                  }

                  ${
                    date
                      ? `
                        <div class="hexora-result-date">
                          ${escapeHTML(date)}
                        </div>
                      `
                      : ""
                  }

                </div>

                ${
                  image
                    ? `
                      <div class="hexora-result-image">
                        <img
                          src="${cleanImage}"
                          alt=""
                          loading="lazy"
                          onerror="this.parentElement.style.display='none'"
                        />
                      </div>
                    `
                    : ""
                }

              </article>
            `;
          }

          /*
           * NORMAL WEB MODE
           */
          return `
            <article
              class="hexora-result"
              data-result-index="${index}"
            >

              <div class="hexora-result-body">

                <div class="hexora-result-source">
                  ${escapeHTML(source || cleanURL)}
                </div>

                <h2 class="hexora-result-title">

                  <a
                    href="${cleanURL}"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    ${escapeHTML(title)}
                  </a>

                </h2>

                <div class="hexora-result-url">
                  ${escapeHTML(url)}
                </div>

                ${
                  description
                    ? `
                      <p class="hexora-result-description">
                        ${escapeHTML(
                          truncate(description, 300)
                        )}
                      </p>
                    `
                    : ""
                }

                ${
                  date
                    ? `
                      <div class="hexora-result-date">
                        ${escapeHTML(date)}
                      </div>
                    `
                    : ""
                }

              </div>

              ${
                image
                  ? `
                    <div class="hexora-result-image">

                      <img
                        src="${cleanImage}"
                        alt=""
                        loading="lazy"
                        onerror="this.parentElement.style.display='none'"
                      />

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
     MODE BUTTONS
  ========================================================= */

  function updateModeButtons(mode) {

    $$(".mode").forEach((button) => {

      button.classList.toggle(
        "active",
        button.dataset.mode === mode
      );

    });

    $$("[data-mode]").forEach((button) => {

      button.classList.toggle(
        "active",
        button.dataset.mode === mode
      );

    });
  }

  function setMode(mode) {

    if (!mode) {
      return;
    }

    state.mode = mode;

    updateModeButtons(mode);

    if (mode === "maps") {
      showMapView();
      return;
    }

    showSearchView();

    const input =
      $("#searchInput");

    if (state.query) {

      if (input) {
        input.value = state.query;
      }

      doSearch(
        state.query,
        mode
      );

    } else {

      if (input) {
        input.focus();
      }

    }
  }

  /* =========================================================
     SEARCH FORM
  ========================================================= */

  function setupSearch() {

    const form =
      $("#searchForm");

    const input =
      $("#searchInput");

    if (!form) {

      console.warn(
        "[HEXORA] #searchForm not found"
      );

      return;
    }

    form.addEventListener(
      "submit",
      (event) => {

        event.preventDefault();

        const query =
          input?.value?.trim() || "";

        doSearch(
          query,
          state.mode
        );

      }
    );
  }

  /* =========================================================
     ALL MODE BUTTONS
  ========================================================= */

  function setupModes() {

    $$(".mode").forEach((button) => {

      button.addEventListener(
        "click",
        (event) => {

          event.preventDefault();

          const mode =
            button.dataset.mode;

          setMode(mode);

        }
      );

    });

    $$("[data-mode]").forEach((button) => {

      if (
        button.classList.contains("mode")
      ) {
        return;
      }

      button.addEventListener(
        "click",
        (event) => {

          event.preventDefault();

          const mode =
            button.dataset.mode;

          setMode(mode);

        }
      );

    });
  }

  /* =========================================================
     HOME BUTTON
  ========================================================= */

  function setupHomeButtons() {

    $$("[data-home]").forEach((button) => {

      button.addEventListener(
        "click",
        (event) => {

          event.preventDefault();

          state.query = "";
          state.mode = "web";

          updateModeButtons("web");

          showHomeView();

        }
      );

    });
  }

  /* =========================================================
     KEYBOARD
  ========================================================= */

  function setupKeyboard() {

    document.addEventListener(
      "keydown",
      (event) => {

        if (
          event.key === "Escape" &&
          document.body.classList.contains(
            "hexora-search-active"
          )
        ) {

          showHomeView();

        }

        if (
          event.key === "/" &&
          document.activeElement?.tagName !== "INPUT" &&
          document.activeElement?.tagName !== "TEXTAREA"
        ) {

          event.preventDefault();

          showSearchView();

          $("#searchInput")?.focus();

        }

      }
    );
  }

  /* =========================================================
     NEWS
  ========================================================= */

  async function loadNews() {

    const newsContainer =
      $("#newsResults");

    if (!newsContainer) {
      return;
    }

    try {

      const data =
        await fetchJSON(
          `${CONFIG.newsEndpoint}?q=latest&mode=news`
        );

      const items =
        Array.isArray(data?.results)
          ? data.results
          : [];

      if (!items.length) {
        return;
      }

      newsContainer.innerHTML =
        items
          .slice(0, 6)
          .map((item) => {

            const title =
              item.title ||
              item.name ||
              "News";

            const url =
              safeURL(
                item.url ||
                item.link ||
                "#"
              );

            return `
              <a
                href="${url}"
                target="_blank"
                rel="noopener noreferrer"
                class="hexora-news-item"
              >
                ${escapeHTML(title)}
              </a>
            `;

          })
          .join("");

    } catch (error) {

      console.warn(
        "[HEXORA] News unavailable:",
        error
      );

    }
  }

  /* =========================================================
     MAPLIBRE CSS
  ========================================================= */

  function loadMapCSS() {

    if (
      document.querySelector(
        'link[data-hexora-maplibre]'
      )
    ) {
      return;
    }

    const link =
      document.createElement("link");

    link.rel = "stylesheet";
    link.href = CONFIG.mapLibreCSS;

    link.dataset.hexoraMaplibre =
      "true";

    document.head.appendChild(link);
  }

  /* =========================================================
     MAPLIBRE JS
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

          const timer =
            setInterval(() => {

              if (window.maplibregl) {

                clearInterval(timer);

                resolve(
                  window.maplibregl
                );

              }

            }, 100);

          setTimeout(() => {

            clearInterval(timer);

            if (!window.maplibregl) {

              reject(
                new Error(
                  "MapLibre loading timeout"
                )
              );

            }

          }, 15000);

          return;
        }

        state.mapLoading = true;

        loadMapCSS();

        const script =
          document.createElement("script");

        script.src =
          CONFIG.mapLibreJS;

        script.async = true;

        script.onload = () => {

          state.mapLoading = false;

          if (window.maplibregl) {

            resolve(
              window.maplibregl
            );

          } else {

            reject(
              new Error(
                "MapLibre unavailable"
              )
            );

          }

        };

        script.onerror = () => {

          state.mapLoading = false;

          reject(
            new Error(
              "Could not load MapLibre"
            )
          );

        };

        document.head.appendChild(
          script
        );

      }
    );
  }

  /* =========================================================
     FIND MAP ELEMENT
  ========================================================= */

  function getMapElement() {

    return (
      $("#map") ||
      $("#mapContainer") ||
      $(".map-container") ||
      $(".map")
    );
  }

  /* =========================================================
     INIT MAP
  ========================================================= */

  async function initMap() {

    if (state.map) {

      setTimeout(() => {

        state.map.resize();

      }, 100);

      return;
    }

    const mapElement =
      getMapElement();

    if (!mapElement) {

      console.warn(
        "[HEXORA] Map element not found"
      );

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
            CONFIG.defaultZoom

        });

      state.mapReady = true;

      state.map.addControl(
        new maplibregl.NavigationControl(),
        "top-right"
      );

      state.map.on(
        "load",
        () => {

          setTimeout(() => {

            state.map.resize();

          }, 100);

        }
      );

    } catch (error) {

      console.error(
        "[HEXORA] Map error:",
        error
      );

    }
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

    try {

      const url =
        `${CONFIG.geocoder}?q=${encodeURIComponent(query)}&format=json&limit=1`;

      const response =
        await fetchJSON(
          url,
          {
            headers: {
              Accept:
                "application/json"
            }
          }
        );

      const place =
        Array.isArray(response)
          ? response[0]
          : null;

      if (!place) {

        alert(
          "Location not found."
        );

        return;
      }

      const lat =
        Number(place.lat);

      const lon =
        Number(place.lon);

      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lon)
      ) {
        return;
      }

      await initMap();

      if (!state.map) {
        return;
      }

      state.map.flyTo({

        center: [
          lon,
          lat
        ],

        zoom: 12,

        essential: true

      });

      if (state.searchMarker) {

        state.searchMarker.remove();

      }

      const maplibregl =
        window.maplibregl;

      if (maplibregl) {

        state.searchMarker =
          new maplibregl.Marker({
            color: "#00ffff"
          })
            .setLngLat([
              lon,
              lat
            ])
            .addTo(
              state.map
            );

      }

    } catch (error) {

      console.error(
        "[HEXORA] Map search error:",
        error
      );

      alert(
        "Could not search location."
      );

    }
  }

  /* =========================================================
     USER LOCATION
  ========================================================= */

  function locateUser() {

    if (!navigator.geolocation) {

      alert(
        "Location is not supported by this browser."
      );

      return;
    }

    navigator.geolocation.getCurrentPosition(

      async (position) => {

        const lat =
          position.coords.latitude;

        const lon =
          position.coords.longitude;

        state.lastLocation = {
          lat,
          lon
        };

        await initMap();

        if (!state.map) {
          return;
        }

        state.map.flyTo({

          center: [
            lon,
            lat
          ],

          zoom: 14,

          essential: true

        });

        const maplibregl =
          window.maplibregl;

        if (!maplibregl) {
          return;
        }

        if (state.userMarker) {

          state.userMarker.remove();

        }

        state.userMarker =
          new maplibregl.Marker({
            color: "#00ffff"
          })
            .setLngLat([
              lon,
              lat
            ])
            .addTo(
              state.map
            );

      },

      (error) => {

        console.warn(
          "[HEXORA] Location error:",
          error
        );

        alert(
          "Could not get your location."
        );

      },

      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000
      }

    );
  }

  /* =========================================================
     MAP CONTROLS
  ========================================================= */

  function setupMapControls() {

    const searchButton =
      $("#mapSearchBtn");

    const searchInput =
      $("#mapSearchInput");

    if (searchButton) {

      searchButton.addEventListener(
        "click",
        (event) => {

          event.preventDefault();

          searchMapPlace(
            searchInput?.value || ""
          );

        }
      );

    }

    if (searchInput) {

      searchInput.addEventListener(
        "keydown",
        (event) => {

          if (
            event.key === "Enter"
          ) {

            event.preventDefault();

            searchMapPlace(
              searchInput.value
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
        (event) => {

          event.preventDefault();

          locateUser();

        }
      );

    }

    const resetButton =
      $("#resetMapBtn");

    if (resetButton) {

      resetButton.addEventListener(
        "click",
        (event) => {

          event.preventDefault();

          if (!state.map) {
            return;
          }

          state.map.flyTo({

            center:
              CONFIG.defaultCenter,

            zoom:
              CONFIG.defaultZoom

          });

        }
      );

    }

    const fullscreenButton =
      $("#fullscreenMapBtn");

    if (fullscreenButton) {

      fullscreenButton.addEventListener(
        "click",
        (event) => {

          event.preventDefault();

          const mapElement =
            getMapElement();

          if (!mapElement) {
            return;
          }

          if (
            document.fullscreenElement
          ) {

            document.exitFullscreen?.();

          } else {

            mapElement
              .requestFullscreen?.();

          }

        }
      );

    }

    /*
     * Satellite is not connected.
     */
    $$("#satelliteMapBtn").forEach(
      (button) => {

        button.addEventListener(
          "click",
          (event) => {

            event.preventDefault();

            alert(
              "Satellite imagery is not connected yet."
            );

          }
        );

      }
    );

    /*
     * 3D is not connected.
     */
    $$("#3dMapBtn").forEach(
      (button) => {

        button.addEventListener(
          "click",
          (event) => {

            event.preventDefault();

            alert(
              "3D map mode is not connected yet."
            );

          }
        );

      }
    );
  }

  /* =========================================================
     FEATURE BUTTONS
  ========================================================= */

  function setupFeatureButtons() {

    const openMapBtn =
      $("#openMapBtn");

    if (openMapBtn) {

      openMapBtn.addEventListener(
        "click",
        (event) => {

          event.preventDefault();

          setMode("maps");

        }
      );

    }

    const mapPreviewBtn =
      $("#mapPreviewBtn");

    if (mapPreviewBtn) {

      mapPreviewBtn.addEventListener(
        "click",
        (event) => {

          event.preventDefault();

          setMode("maps");

        }
      );

    }

    const viewNewsBtn =
      $("#viewNewsBtn");

    if (viewNewsBtn) {

      viewNewsBtn.addEventListener(
        "click",
        (event) => {

          event.preventDefault();

          setMode("news");

        }
      );

    }
  }

  /* =========================================================
     TRENDING
  ========================================================= */

  function setupTrending() {

    $$(".trend").forEach(
      (button) => {

        button.addEventListener(
          "click",
          (event) => {

            event.preventDefault();

            const query =
              button.dataset.query ||
              button.textContent.trim();

            const input =
              $("#searchInput");

            if (input) {
              input.value = query;
            }

            doSearch(
              query,
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
          (event) => {

            event.preventDefault();

            const query =
              button.dataset.quick;

            if (query) {

              const input =
                $("#searchInput");

              if (input) {
                input.value = query;
              }

              doSearch(
                query,
                "web"
              );

            }

          }
        );

      }
    );
  }

  /* =========================================================
     RUNTIME CSS
  ========================================================= */

  function injectUtilityStyles() {

    if (
      document.getElementById(
        "hexoraRuntimeStyles"
      )
    ) {
      return;
    }

    const style =
      document.createElement("style");

    style.id =
      "hexoraRuntimeStyles";

    style.textContent = `

      #searchView.active {
        display: block !important;
      }

      #mapView.active {
        display: block !important;
      }

      /* SEARCHING */

      .hexora-searching {
        min-height: 330px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 50px 20px;
      }

      .hexora-loader {
        width: 92px;
        height: 92px;
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: 25px;
      }

      .hexora-loader-ring {
        position: absolute;
        width: 86px;
        height: 86px;
        border-radius: 50%;
        border: 3px solid
          rgba(0, 255, 255, .12);
        border-top-color:
          #00ffff;
        border-right-color:
          #00ffff;
        animation:
          hexoraSpin
          .9s
          linear
          infinite;
      }

      .hexora-loader-logo {
        width: 50px;
        height: 50px;
        border-radius: 15px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 26px;
        font-weight: 900;
        color: #00ffff;
        background:
          rgba(0, 255, 255, .08);
        border:
          1px solid
          rgba(0, 255, 255, .4);
        box-shadow:
          0 0 25px
          rgba(0, 255, 255, .2);
      }

      .hexora-searching-title {
        font-size: 22px;
        font-weight: 700;
        color: #ffffff;
        margin-bottom: 8px;
      }

      .hexora-searching-query {
        color:
          rgba(255,255,255,.65);
        font-size: 15px;
      }

      .hexora-searching-query strong {
        color: #00ffff;
      }

      .hexora-searching-dots {
        display: flex;
        gap: 7px;
        margin-top: 18px;
      }

      .hexora-searching-dots span {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #00ffff;
        animation:
          hexoraDot
          1.2s
          infinite
          ease-in-out;
      }

      .hexora-searching-dots
      span:nth-child(2) {
        animation-delay: .15s;
      }

      .hexora-searching-dots
      span:nth-child(3) {
        animation-delay: .30s;
      }

      @keyframes hexoraSpin {
        to {
          transform: rotate(360deg);
        }
      }

      @keyframes hexoraDot {

        0%, 80%, 100% {
          opacity: .25;
          transform: scale(.7);
        }

        40% {
          opacity: 1;
          transform: scale(1);
        }

      }

      /* EMPTY */

      .hexora-empty,
      .hexora-no-results,
      .hexora-error {
        text-align: center;
        padding: 70px 20px;
      }

      .hexora-search-logo,
      .hexora-no-results-logo,
      .hexora-error-logo {

        width: 64px;
        height: 64px;

        margin:
          0 auto 20px;

        display: flex;

        align-items: center;
        justify-content: center;

        border-radius: 18px;

        font-size: 28px;
        font-weight: 900;

        color: #00ffff;

        background:
          rgba(0,255,255,.06);

        border:
          1px solid
          rgba(0,255,255,.35);
      }

      .hexora-empty h2,
      .hexora-no-results h2,
      .hexora-error h2 {
        color: #fff;
        margin-bottom: 10px;
      }

      .hexora-empty p,
      .hexora-no-results p,
      .hexora-error p {
        color:
          rgba(255,255,255,.6);

        max-width: 520px;

        margin:
          0 auto 25px;
      }

      /* RETRY */

      .hexora-retry {

        border:
          1px solid
          rgba(0,255,255,.4);

        background:
          rgba(0,255,255,.08);

        color: #00ffff;

        padding:
          11px 20px;

        border-radius: 10px;

        cursor: pointer;

        font-weight: 600;
      }

      .hexora-retry:hover {
        background:
          rgba(0,255,255,.15);
      }

      /* RESULT */

      .hexora-result {

        display: flex;

        justify-content:
          space-between;

        gap: 20px;

        padding:
          20px 0;

        border-bottom:
          1px solid
          rgba(255,255,255,.08);
      }

      .hexora-result-body {
        flex: 1;
        min-width: 0;
      }

      .hexora-result-source {
        font-size: 13px;

        color:
          rgba(255,255,255,.5);

        margin-bottom: 5px;
      }

      .hexora-result-title {
        margin:
          0 0 5px;
      }

      .hexora-result-title a {
        color: #00ffff;

        text-decoration: none;

        font-size: 20px;
      }

      .hexora-result-title a:hover {
        text-decoration: underline;
      }

      .hexora-result-url {
        font-size: 12px;

        color:
          rgba(255,255,255,.42);

        white-space: nowrap;

        overflow: hidden;

        text-overflow: ellipsis;

        margin-bottom: 8px;
      }

      .hexora-result-description {
        color:
          rgba(255,255,255,.7);

        line-height: 1.6;

        margin: 0;
      }

      .hexora-result-date {
        color:
          rgba(255,255,255,.4);

        font-size: 12px;

        margin-top: 8px;
      }

      .hexora-result-image {
        width: 120px;
        height: 90px;

        flex-shrink: 0;

        overflow: hidden;

        border-radius: 10px;
      }

      .hexora-result-image img {
        width: 100%;
        height: 100%;

        object-fit: cover;
      }

      /* IMAGE SEARCH */

      .hexora-image-result {
        display: block;
      }

      .hexora-large-image {
        display: block;

        width: 100%;

        max-width: 420px;

        height: 240px;

        margin-bottom: 15px;

        overflow: hidden;

        border-radius: 14px;

        position: relative;

        background:
          rgba(255,255,255,.04);
      }

      .hexora-large-image img {
        width: 100%;
        height: 100%;

        object-fit: cover;

        display: block;
      }

      /* VIDEO SEARCH */

      .hexora-video-result {
        display: block;
      }

      .hexora-video-box {
        width: 100%;
        max-width: 520px;

        min-height: 100px;

        display: flex;

        align-items: center;

        justify-content: center;

        margin-bottom: 15px;

        border-radius: 14px;

        background:
          rgba(0,255,255,.05);

        border:
          1px solid
          rgba(0,255,255,.18);
      }

      .hexora-video-box a {
        color: #00ffff;

        text-decoration: none;

        font-weight: 700;

        font-size: 17px;

        padding: 15px 22px;
      }

      .hexora-video-box a:hover {
        text-decoration: underline;
      }

      .hexora-play {
        position: absolute;

        left: 50%;
        top: 50%;

        transform:
          translate(-50%, -50%);

        width: 55px;
        height: 55px;

        border-radius: 50%;

        display: flex;

        align-items: center;
        justify-content: center;

        background:
          rgba(0,0,0,.65);

        color: #00ffff;

        font-size: 24px;
      }

      /* NEWS */

      .hexora-news-item {
        display: block;

        color: #fff;

        text-decoration: none;

        padding: 10px 0;

        border-bottom:
          1px solid
          rgba(255,255,255,.08);
      }

      .hexora-news-item:hover {
        color: #00ffff;
      }

      /* MOBILE */

      @media (max-width: 650px) {

        .hexora-result {
          gap: 10px;
        }

        .hexora-result-title a {
          font-size: 17px;
        }

        .hexora-result-image {
          width: 82px;
          height: 65px;
        }

        .hexora-large-image {
          max-width: 100%;
          height: 210px;
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
      params.get("mode") || "web";

    if (!query) {
      return;
    }

    state.query = query;
    state.mode = mode;

    const input =
      $("#searchInput");

    if (input) {
      input.value = query;
    }

    updateModeButtons(mode);

    if (mode === "maps") {

      showMapView();

    } else {

      doSearch(
        query,
        mode
      );

    }
  }

  /* =========================================================
     URL UPDATE
  ========================================================= */

  function updateURL(query, mode) {

    try {

      const url =
        new URL(
          window.location.href
        );

      if (query) {

        url.searchParams.set(
          "q",
          query
        );

      } else {

        url.searchParams.delete(
          "q"
        );

      }

      if (mode) {

        url.searchParams.set(
          "mode",
          mode
        );

      } else {

        url.searchParams.delete(
          "mode"
        );

      }

      window.history.replaceState(
        {},
        "",
        url
      );

    } catch {
      /* Ignore URL errors */
    }
  }

  /* =========================================================
     PUBLIC SEARCH
  ========================================================= */

  const originalDoSearch =
    doSearch;

  window.hexoraSearch =
    async function (
      query,
      mode = "web"
    ) {

      updateURL(
        query,
        mode
      );

      return originalDoSearch(
        query,
        mode
      );
    };

  /* =========================================================
     INIT
  ========================================================= */

  function init() {

    console.log(
      "%cHEXORA frontend starting...",
      "color:#00ffff;font-weight:bold"
    );

    injectUtilityStyles();

    setupSearch();

    setupModes();

    setupHomeButtons();

    setupKeyboard();

    setupTrending();

    setupQuickActions();

    setupMapControls();

    setupFeatureButtons();

    updateModeButtons(
      state.mode
    );

    /*
     * News failure must not
     * break main search.
     */
    loadNews();

    /*
     * Map loads only when opened.
     */

    setTimeout(() => {

      loadURLState();

    }, 50);

    /*
     * Public API
     */

    window.HEXORA = {

      state,

      search:
        window.hexoraSearch,

      setMode,

      showHomeView,

      showSearchView,

      showMapView,

      initMap

    };

    console.log(
      "%cHEXORA ready",
      "color:#00ffff;font-weight:bold"
    );
  }

  /* =========================================================
     START
  ========================================================= */

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
```
