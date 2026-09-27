/* =========================================================
   HEXORA SEARCH — MAIN.JS
   Frontend only
   ========================================================= */

(() => {
  "use strict";

  const CONFIG = {
    searchEndpoint: "/api/search",
    newsEndpoint: "/api/news",

    map: {
      center: [91.7362, 26.1445],
      zoom: 5,
      tiles: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      geocoder: "https://nominatim.openstreetmap.org/search"
    },

    timeout: 15000
  };

  const state = {
    mode: "web",
    query: "",
    map: null,
    mapReady: false,
    mapLoading: false,
    markers: [],
    lastLocation: null
  };

  /* =========================================================
     HELPERS
     ========================================================= */

  const $ = (selector) =>
    document.querySelector(selector);

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

  function cleanQuery(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function formatDate(value) {
    if (!value) return "";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return date.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric"
    });
  }

  function domainFromURL(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }

  /* =========================================================
     FETCH JSON
     ========================================================= */

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

      const text = await response.text();

      let data = null;

      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        throw new Error("Server returned invalid JSON.");
      }

      if (!response.ok) {
        throw new Error(
          data?.error ||
          `Request failed (${response.status})`
        );
      }

      return data;

    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error("Request timed out.");
      }

      throw error;

    } finally {
      clearTimeout(timer);
    }
  }

  /* =========================================================
     SEARCH
     ========================================================= */

  async function performSearch(
    query,
    mode = state.mode
  ) {
    query = cleanQuery(query);

    if (!query) {
      return;
    }

    state.query = query;
    state.mode = mode;

    const input = $("#searchInput");

    if (input) {
      input.value = query;
    }

    if (mode === "maps") {
      await openMapView();
      await searchMapPlace(query);
      return;
    }

    showSearchView();

    const results = $("#results");
    const meta = $("#resultMeta");

    if (results) {
      results.innerHTML = `
        <div class="hexora-loading">
          <div class="loader"></div>
          <span>Searching HEXORA...</span>
        </div>
      `;
    }

    if (meta) {
      meta.textContent = `Searching for "${query}"...`;
    }

    try {
      const url =
        `${CONFIG.searchEndpoint}?q=${encodeURIComponent(query)}&mode=${encodeURIComponent(mode)}`;

      const data = await fetchJSON(url);

      renderSearchResults(
        data,
        query,
        mode
      );

      updateURL(query, mode);

    } catch (error) {
      console.error(
        "HEXORA search error:",
        error
      );

      if (results) {
        results.innerHTML = `
          <div class="hexora-empty">
            <div class="empty-icon">⌕</div>

            <h3>
              HEXORA search is temporarily unavailable
            </h3>

            <p>
              ${escapeHTML(error.message)}
            </p>

            <button
              class="hexora-retry"
              id="retrySearchBtn"
            >
              Try Again
            </button>
          </div>
        `;

        $("#retrySearchBtn")?.addEventListener(
          "click",
          () => performSearch(query, mode)
        );
      }

      if (meta) {
        meta.textContent =
          `Could not complete search for "${query}".`;
      }
    }
  }

  /* =========================================================
     SEARCH RESULTS
     ========================================================= */

  function renderSearchResults(
    data,
    query,
    mode
  ) {
    const results = $("#results");
    const meta = $("#resultMeta");

    if (!results) {
      return;
    }

    let items = [];

    if (Array.isArray(data)) {
      items = data;
    } else if (Array.isArray(data?.results)) {
      items = data.results;
    } else if (Array.isArray(data?.data)) {
      items = data.data;
    }

    if (meta) {
      const total =
        Number.isFinite(data?.total)
          ? data.total
          : items.length;

      meta.textContent =
        `${total.toLocaleString("en-IN")} result${total === 1 ? "" : "s"} for "${query}"`;
    }

    if (!items.length) {
      results.innerHTML = `
        <div class="hexora-empty">

          <div class="empty-icon">⌕</div>

          <h3>
            No matching results found
          </h3>

          <p>
            HEXORA could not find indexed pages
            matching this query yet.
          </p>

        </div>
      `;

      return;
    }

    results.innerHTML = items
      .map((item, index) =>
        renderResultCard(
          item,
          index,
          mode
        )
      )
      .join("");
  }

  function renderResultCard(
    item,
    index,
    mode
  ) {
    const title =
      item.title ||
      item.name ||
      "Untitled page";

    const description =
      item.description ||
      item.snippet ||
      item.content ||
      "";

    const url =
      item.url ||
      item.link ||
      "#";

    const domain =
      item.source_domain ||
      item.domain ||
      domainFromURL(url);

    const image =
      item.image_url ||
      item.image ||
      "";

    const date =
      item.published_at ||
      item.fetched_at ||
      item.date;

    const imageHTML = image
      ? `
        <div class="result-image-wrap">
          <img
            class="result-image"
            src="${escapeHTML(image)}"
            alt=""
            loading="lazy"
            referrerpolicy="no-referrer"
            onerror="this.style.display='none'"
          >
        </div>
      `
      : "";

    return `
      <article
        class="hexora-result"
        data-result-index="${index}"
      >

        <div class="result-top">

          <div class="result-source">

            ${
              domain
                ? `
                  <span class="source-dot"></span>
                  <span>
                    ${escapeHTML(domain)}
                  </span>
                `
                : ""
            }

          </div>

          ${
            date
              ? `
                <time>
                  ${escapeHTML(
                    formatDate(date)
                  )}
                </time>
              `
              : ""
          }

        </div>

        <div class="result-body">

          <div class="result-main">

            <h2 class="result-title">

              <a
                href="${escapeHTML(url)}"
                target="_blank"
                rel="noopener noreferrer"
              >
                ${escapeHTML(title)}
              </a>

            </h2>

            ${
              domain
                ? `
                  <div class="result-url">
                    ${escapeHTML(domain)}
                  </div>
                `
                : ""
            }

            <p class="result-description">
              ${escapeHTML(
                String(description)
                  .replace(/\s+/g, " ")
                  .slice(0, 400)
              )}
            </p>

          </div>

          ${imageHTML}

        </div>

      </article>
    `;
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
        <div class="loader"></div>
        <span>Loading latest indexed news...</span>
      </div>
    `;

    try {
      const data =
        await fetchJSON(CONFIG.newsEndpoint);

      let items = [];

      if (Array.isArray(data)) {
        items = data;
      } else if (Array.isArray(data?.results)) {
        items = data.results;
      } else if (Array.isArray(data?.data)) {
        items = data.data;
      }

      if (!items.length) {
        container.innerHTML = `
          <div class="news-empty">
            No indexed news available yet.
          </div>
        `;
        return;
      }

      container.innerHTML = items
        .slice(0, 12)
        .map(renderNewsCard)
        .join("");

    } catch (error) {
      console.error(
        "HEXORA news error:",
        error
      );

      container.innerHTML = `
        <div class="news-empty">
          Latest news could not be loaded.
        </div>
      `;
    }
  }

  function renderNewsCard(item) {
    const title =
      item.title ||
      "Untitled news";

    const description =
      item.description ||
      "";

    const url =
      item.url ||
      "#";

    const source =
      item.source_name ||
      item.source_domain ||
      domainFromURL(url);

    const image =
      item.image_url ||
      "";

    const date =
      item.published_at ||
      item.fetched_at;

    return `
      <article class="news-card">

        ${
          image
            ? `
              <a
                href="${escapeHTML(url)}"
                target="_blank"
                rel="noopener noreferrer"
                class="news-image-link"
              >
                <img
                  src="${escapeHTML(image)}"
                  alt=""
                  loading="lazy"
                  referrerpolicy="no-referrer"
                  onerror="this.parentElement.style.display='none'"
                >
              </a>
            `
            : ""
        }

        <div class="news-content">

          <div class="news-source">
            ${escapeHTML(source)}
          </div>

          <h3>
            <a
              href="${escapeHTML(url)}"
              target="_blank"
              rel="noopener noreferrer"
            >
              ${escapeHTML(title)}
            </a>
          </h3>

          ${
            description
              ? `
                <p>
                  ${escapeHTML(
                    String(description).slice(0, 200)
                  )}
                </p>
              `
              : ""
          }

          ${
            date
              ? `
                <time>
                  ${escapeHTML(formatDate(date))}
                </time>
              `
              : ""
          }

        </div>

      </article>
    `;
  }

  /* =========================================================
     VIEWS
     ========================================================= */

  function showSearchView() {
    $("#searchView")?.classList.add("active");
    $("#mapView")?.classList.remove("active");

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }

  function showHomeView() {
    $("#searchView")?.classList.remove("active");
    $("#mapView")?.classList.remove("active");

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
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

      const existing =
        document.querySelector(
          'script[data-hexora-maplibre]'
        );

      if (existing) {

        existing.addEventListener(
          "load",
          () => resolve(window.maplibregl)
        );

        existing.addEventListener(
          "error",
          () =>
            reject(
              new Error(
                "Map library failed to load."
              )
            )
        );

        return;
      }

      const script =
        document.createElement("script");

      script.src =
        "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js";

      script.async = true;

      script.dataset.hexoraMaplibre =
        "true";

      script.onload = () => {

        if (window.maplibregl) {
          resolve(window.maplibregl);
        } else {
          reject(
            new Error(
              "MapLibre is unavailable."
            )
          );
        }
      };

      script.onerror = () =>
        reject(
          new Error(
            "Could not load map library."
          )
        );

      document.head.appendChild(script);
    });
  }

  /* =========================================================
     MAP INITIALIZATION
     ========================================================= */

  async function initMap() {

    if (state.mapReady) {
      return state.map;
    }

    if (state.mapLoading) {
      return null;
    }

    const mapElement = $("#hexoraMap");

    if (!mapElement) {
      return null;
    }

    state.mapLoading = true;

    try {

      const maplibregl =
        await loadMapLibre();

      state.map =
        new maplibregl.Map({

          container: "hexoraMap",

          center:
            CONFIG.map.center,

          zoom:
            CONFIG.map.zoom,

          attributionControl:
            true,

          style: {
            version: 8,

            sources: {
              "hexora-osm": {
                type: "raster",

                tiles: [
                  CONFIG.map.tiles
                ],

                tileSize: 256,

                attribution:
                  "© OpenStreetMap contributors"
              }
            },

            layers: [
              {
                id:
                  "hexora-osm-layer",

                type: "raster",

                source:
                  "hexora-osm"
              }
            ]
          }
        });

      state.map.addControl(
        new maplibregl.NavigationControl({
          showCompass: true,
          showZoom: true,
          visualizePitch: true
        }),
        "top-right"
      );

      state.map.on(
        "load",
        () => {

          state.mapReady = true;
          state.mapLoading = false;

          state.map.resize();

          updateMapInfo(
            "HEXORA Map ready"
          );
        }
      );

      state.map.on(
        "error",
        event => {

          console.error(
            "HEXORA Map error:",
            event
          );

          updateMapInfo(
            "Map data/tile error."
          );
        }
      );

      return state.map;

    } catch (error) {

      state.mapLoading = false;

      console.error(
        "Map initialization error:",
        error
      );

      updateMapInfo(
        error.message
      );

      return null;
    }
  }

  async function openMapView() {

    $("#searchView")?.classList.remove("active");
    $("#mapView")?.classList.add("active");

    const map =
      await initMap();

    if (map) {
      setTimeout(
        () => map.resize(),
        200
      );
    }

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }

  function updateMapInfo(message) {
    const info = $("#mapInfo");

    if (info) {
      info.textContent =
        message || "";
    }
  }

  function clearMarkers() {

    state.markers.forEach(
      marker => {
        try {
          marker.remove();
        } catch {}
      }
    );

    state.markers = [];
  }

  function addMarker(
    lng,
    lat,
    title = ""
  ) {

    if (!state.mapReady) {
      return null;
    }

    const maplibregl =
      window.maplibregl;

    const marker =
      new maplibregl.Marker()
        .setLngLat([
          Number(lng),
          Number(lat)
        ])
        .addTo(state.map);

    if (title) {

      const popup =
        new maplibregl.Popup({
          offset: 25
        }).setText(title);

      marker.setPopup(popup);
    }

    state.markers.push(marker);

    return marker;
  }

  /* =========================================================
     MAP SEARCH
     ========================================================= */

  async function searchMapPlace(query) {

    query = cleanQuery(query);

    if (!query) {
      return;
    }

    await openMapView();

    const map = await initMap();

    if (!map) {
      return;
    }

    updateMapInfo(
      `Searching map for "${query}"...`
    );

    try {

      const url =
        `${CONFIG.map.geocoder}?format=jsonv2&limit=5&q=${encodeURIComponent(query)}`;

      const response =
        await fetch(url, {
          headers: {
            Accept: "application/json"
          }
        });

      if (!response.ok) {
        throw new Error(
          `Map search failed (${response.status})`
        );
      }

      const places =
        await response.json();

      if (
        !Array.isArray(places) ||
        !places.length
      ) {

        updateMapInfo(
          `No map place found for "${query}".`
        );

        return;
      }

      const place = places[0];

      const lat =
        Number(place.lat);

      const lon =
        Number(place.lon);

      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lon)
      ) {
        throw new Error(
          "Invalid location returned."
        );
      }

      clearMarkers();

      map.flyTo({
        center: [
          lon,
          lat
        ],
        zoom: 14,
        speed: 1.2,
        essential: true
      });

      addMarker(
        lon,
        lat,
        place.display_name
      );

      updateMapInfo(
        place.display_name
      );

    } catch (error) {

      console.error(
        "Map search error:",
        error
      );

      updateMapInfo(
        `Map search failed: ${error.message}`
      );
    }
  }

  /* =========================================================
     DEVICE LOCATION
     ========================================================= */

  function locateUser() {

    if (!navigator.geolocation) {

      updateMapInfo(
        "This browser does not support location."
      );

      return;
    }

    updateMapInfo(
      "Requesting your device location..."
    );

    navigator.geolocation.getCurrentPosition(

      position => {

        const lat =
          position.coords.latitude;

        const lng =
          position.coords.longitude;

        state.lastLocation = {
          lat,
          lng
        };

        initMap().then(
          map => {

            if (!map) {
              return;
            }

            clearMarkers();

            map.flyTo({
              center: [
                lng,
                lat
              ],
              zoom: 16,
              speed: 1.3,
              essential: true
            });

            addMarker(
              lng,
              lat,
              "Your current location"
            );

            updateMapInfo(
              "Current device location"
            );
          }
        );
      },

      error => {

        let message =
          "Unable to get your location.";

        if (
          error.code ===
          error.PERMISSION_DENIED
        ) {
          message =
            "Location permission was denied.";
        }

        if (
          error.code ===
          error.POSITION_UNAVAILABLE
        ) {
          message =
            "Your location is currently unavailable.";
        }

        if (
          error.code ===
          error.TIMEOUT
        ) {
          message =
            "Location request timed out.";
        }

        updateMapInfo(message);

        console.error(
          "Geolocation error:",
          error
        );
      },

      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
      }
    );
  }

  /* =========================================================
     MAP RESET
     ========================================================= */

  function resetMap() {

    if (!state.map) {
      return;
    }

    clearMarkers();

    state.map.flyTo({

      center:
        CONFIG.map.center,

      zoom:
        CONFIG.map.zoom,

      pitch: 0,

      bearing: 0,

      speed: 1.2,

      essential: true
    });

    updateMapInfo(
      "HEXORA Map"
    );
  }

  /* =========================================================
     FULLSCREEN
     ========================================================= */

  async function fullscreenMap() {

    const element =
      $("#hexoraMap");

    if (!element) {
      return;
    }

    try {

      if (document.fullscreenElement) {

        await document.exitFullscreen();

      } else if (
        element.requestFullscreen
      ) {

        await element.requestFullscreen();

      } else {

        element.classList.toggle(
          "hexora-map-fullscreen"
        );
      }

    } catch (error) {

      console.error(
        "Fullscreen error:",
        error
      );
    }

    if (state.map) {
      setTimeout(
        () => state.map.resize(),
        200
      );
    }
  }

  /* =========================================================
     SATELLITE
     ========================================================= */

  function satelliteMode() {

    /*
      Real satellite imagery is NOT faked here.
      It needs a real imagery tile source/provider.
    */

    updateMapInfo(
      "Satellite imagery is not configured yet. HEXORA Map is currently using real OpenStreetMap data."
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

      const map =
        new maplibregl.Map({

          container:
            "mapPreview",

          center:
            CONFIG.map.center,

          zoom: 4,

          interactive: false,

          attributionControl: false,

          style: {
            version: 8,

            sources: {
              previewOSM: {
                type: "raster",

                tiles: [
                  CONFIG.map.tiles
                ],

                tileSize: 256
              }
            },

            layers: [
              {
                id:
                  "previewOSMLayer",

                type: "raster",

                source:
                  "previewOSM"
              }
            ]
          }
        });

      map.on(
        "error",
        error => {
          console.error(
            "Preview map error:",
            error
          );
        }
      );

    } catch (error) {

      console.error(
        "Preview map error:",
        error
      );
    }
  }

  /* =========================================================
     MODES
     ========================================================= */

  function setMode(mode) {

    state.mode =
      String(mode || "web")
        .toLowerCase();

    $$(".mode").forEach(
      button => {

        const buttonMode =
          String(
            button.dataset.mode ||
            button.textContent ||
            ""
          )
            .trim()
            .toLowerCase();

        button.classList.toggle(
          "active",
          buttonMode === state.mode
        );
      }
    );

    const input =
      $("#searchInput");

    if (!input) {
      return;
    }

    const placeholders = {
      web:
        "Search the world...",
      images:
        "Search images...",
      news:
        "Search latest news...",
      maps:
        "Search places and maps...",
      videos:
        "Search videos...",
      shopping:
        "Search products..."
    };

    input.placeholder =
      placeholders[state.mode] ||
      placeholders.web;
  }

  /* =========================================================
     TRENDING
     ========================================================= */

  function setupTrending() {

    $$(".trend").forEach(
      button => {

        button.addEventListener(
          "click",
          () => {

            const query =
              cleanQuery(
                button.dataset.query ||
                button.textContent
              );

            if (!query) {
              return;
            }

            const input =
              $("#searchInput");

            if (input) {
              input.value =
                query;
            }

            performSearch(
              query,
              "web"
            );
          }
        );
      }
    );
  }

  /* =========================================================
     QUERY BUTTONS
     ========================================================= */

  function bindQueryButtons() {

    $$("[data-query]").forEach(
      button => {

        if (
          button.classList.contains("trend")
        ) {
          return;
        }

        button.addEventListener(
          "click",
          () => {

            const query =
              cleanQuery(
                button.dataset.query
              );

            if (!query) {
              return;
            }

            const input =
              $("#searchInput");

            if (input) {
              input.value =
                query;
            }

            performSearch(
              query,
              state.mode
            );
          }
        );
      }
    );
  }

  /* =========================================================
     MOBILE MENU
     ========================================================= */

  function setupMobileMenu() {

    const button =
      $("#mobileMenu");

    const menu =
      $("#mobileNav");

    if (!button || !menu) {
      return;
    }

    button.addEventListener(
      "click",
      () => {

        const open =
          menu.classList.toggle(
            "active"
          );

        button.setAttribute(
          "aria-expanded",
          open ? "true" : "false"
        );
      }
    );

    menu
      .querySelectorAll("a")
      .forEach(
        link => {

          link.addEventListener(
            "click",
            () => {
              menu.classList.remove(
                "active"
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
      button => {

        button.addEventListener(
          "click",
          async () => {

            const action =
              button.dataset.quick;

            switch (action) {

              case "location":

                await openMapView();
                locateUser();

                break;

              case "place":

                await openMapView();

                $("#mapSearchInput")?.focus();

                break;

              case "directions":

                await openMapView();

                updateMapInfo(
                  "Search a destination on HEXORA Map."
                );

                $("#mapSearchInput")?.focus();

                break;

              case "satellite":

                await openMapView();
                satelliteMode();

                break;

              default:
                break;
            }
          }
        );
      }
    );
  }

  /* =========================================================
     NAVIGATION
     ========================================================= */

  function setupNavigation() {

    $$("[data-home]").forEach(
      element => {

        element.addEventListener(
          "click",
          event => {

            event.preventDefault();

            showHomeView();
          }
        );
      }
    );

    $("#openMapBtn")?.addEventListener(
      "click",
      openMapView
    );

    $("#mapPreviewBtn")?.addEventListener(
      "click",
      openMapView
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
      event => {

        event.preventDefault();

        const query =
          cleanQuery(input.value);

        if (!query) {
          input.focus();
          return;
        }

        performSearch(
          query,
          state.mode
        );
      }
    );

    input.addEventListener(
      "keydown",
      event => {

        if (event.key === "Escape") {

          input.value = "";

          input.focus();
        }
      }
    );
  }

  /* =========================================================
     MAP SEARCH FORM
     ========================================================= */

  function setupMapSearch() {

    const input =
      $("#mapSearchInput");

    const button =
      $("#mapSearchBtn");

    button?.addEventListener(
      "click",
      () => {

        const query =
          cleanQuery(input?.value);

        if (query) {
          searchMapPlace(query);
        }
      }
    );

    input?.addEventListener(
      "keydown",
      event => {

        if (event.key === "Enter") {

          event.preventDefault();

          const query =
            cleanQuery(input.value);

          if (query) {
            searchMapPlace(query);
          }
        }
      }
    );
  }

  /* =========================================================
     MAP CONTROLS
     ========================================================= */

  function setupMapControls() {

    $("#locateBtn")?.addEventListener(
      "click",
      locateUser
    );

    $("#resetMapBtn")?.addEventListener(
      "click",
      resetMap
    );

    $("#fullscreenMapBtn")?.addEventListener(
      "click",
      fullscreenMap
    );
  }

  /* =========================================================
     MODE EVENTS
     ========================================================= */

  function setupModes() {

    $$(".mode").forEach(
      button => {

        button.addEventListener(
          "click",
          () => {

            const mode =
              button.dataset.mode ||
              button.textContent
                .trim()
                .toLowerCase();

            setMode(mode);

            const input =
              $("#searchInput");

            if (
              state.query &&
              input?.value
            ) {

              performSearch(
                input.value,
                state.mode
              );
            }
          }
        );
      }
    );

    setMode("web");
  }

  /* =========================================================
     URL STATE
     ========================================================= */

  function updateURL(
    query,
    mode
  ) {

    try {

      const url =
        new URL(
          window.location.href
        );

      url.searchParams.set(
        "q",
        query
      );

      url.searchParams.set(
        "mode",
        mode
      );

      history.replaceState(
        {},
        "",
        url
      );

    } catch {}
  }

  function loadURLState() {

    try {

      const params =
        new URLSearchParams(
          window.location.search
        );

      const query =
        cleanQuery(
          params.get("q")
        );

      const mode =
        params.get("mode") ||
        "web";

      setMode(mode);

      if (query) {

        const input =
          $("#searchInput");

        if (input) {
          input.value =
            query;
        }

        performSearch(
          query,
          mode
        );
      }

    } catch (error) {

      console.error(
        "URL state error:",
        error
      );
    }
  }

  /* =========================================================
     RUNTIME CSS
     ========================================================= */

  function injectRuntimeCSS() {

    if (
      document.getElementById(
        "hexoraRuntimeCSS"
      )
    ) {
      return;
    }

    const style =
      document.createElement("style");

    style.id =
      "hexoraRuntimeCSS";

    style.textContent = `

      .hexora-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        padding: 40px 20px;
        opacity: .8;
      }

      .loader {
        width: 18px;
        height: 18px;
        border: 2px solid currentColor;
        border-top-color: transparent;
        border-radius: 50%;
        animation: hexoraSpin .7s linear infinite;
      }

      @keyframes hexoraSpin {
        to {
          transform: rotate(360deg);
        }
      }

      .hexora-empty {
        text-align: center;
        padding: 60px 20px;
      }

      .empty-icon {
        font-size: 42px;
        margin-bottom: 12px;
        opacity: .7;
      }

      .hexora-retry {
        margin-top: 18px;
        padding: 10px 18px;
        border-radius: 10px;
        border: 1px solid currentColor;
        background: transparent;
        color: inherit;
        cursor: pointer;
      }

      .result-body {
        display: flex;
        gap: 20px;
        justify-content: space-between;
      }

      .result-main {
        min-width: 0;
        flex: 1;
      }

      .result-image-wrap {
        width: 160px;
        min-width: 160px;
        height: 100px;
        overflow: hidden;
        border-radius: 12px;
      }

      .result-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .result-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .result-source {
        display: flex;
        align-items: center;
        gap: 7px;
        font-size: 13px;
        opacity: .75;
      }

      .source-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: currentColor;
      }

      .result-url {
        font-size: 13px;
        opacity: .65;
        margin: 4px 0 7px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .result-description {
        line-height: 1.6;
      }

      .news-empty {
        padding: 30px 0;
        opacity: .7;
      }

      .hexora-map-fullscreen {
        position: fixed !important;
        inset: 0 !important;
        z-index: 99999 !important;
      }

      @media (max-width: 640px) {

        .result-body {
          gap: 12px;
        }

        .result-image-wrap {
          width: 92px;
          min-width: 92px;
          height: 72px;
        }

        .result-top {
          align-items: flex-start;
        }

      }

    `;

    document.head.appendChild(style);
  }

  /* =========================================================
     INITIALIZE
     ========================================================= */

  async function init() {

    try {

      injectRuntimeCSS();

      setupMobileMenu();

      setupSearch();

      setupMapSearch();

      setupMapControls();

      setupQuickActions();

      setupNavigation();

      setupModes();

      setupTrending();

      bindQueryButtons();

      await initMapPreview();

      loadNews();

      loadURLState();

      console.log(
        "HEXORA frontend initialized."
      );

    } catch (error) {

      console.error(
        "HEXORA initialization error:",
        error
      );
    }
  }

  /* =========================================================
     GLOBAL HEXORA API
     ========================================================= */

  window.HEXORA = {

    search: performSearch,

    searchMap: searchMapPlace,

    openMap: openMapView,

    locate: locateUser,

    resetMap: resetMap,

    setMode: setMode,

    loadNews: loadNews,

    state: state
  };

  /* =========================================================
     START
     ========================================================= */

  if (
    document.readyState === "loading"
  ) {

    document.addEventListener(
      "DOMContentLoaded",
      init,
      { once: true }
    );

  } else {

    init();

  }

})();
