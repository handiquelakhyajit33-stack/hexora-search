```js
/* =========================================================
   HEXORA SEARCH ENGINE
   MAIN.JS — FRONTEND
   HEXORA MAP — INDEPENDENT 3D GLOBE
   ========================================================= */

(() => {
  "use strict";

  /* =======================================================
     CONFIG
     ======================================================= */

  const CONFIG = {
    searchEndpoint: "/api/search",
    newsEndpoint: "/api/news",

    map: {
      longitude: 91.7362,
      latitude: 26.1445,
      globeHeight: 6500000,

      nominatim:
        "https://nominatim.openstreetmap.org/search"
    },

    timeout: 15000
  };

  const state = {
    mode: "web",
    query: "",

    viewer: null,
    mapReady: false,
    mapLoading: false,

    searchMarker: null,
    locationMarker: null,

    lastLocation: null
  };

  /* =======================================================
     HELPERS
     ======================================================= */

  const $ = selector =>
    document.querySelector(selector);

  const $$ = selector =>
    Array.from(
      document.querySelectorAll(selector)
    );

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

  function domainFromURL(url) {
    try {
      return new URL(url)
        .hostname
        .replace(/^www\./, "");
    } catch {
      return "";
    }
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
        day: "numeric",
        month: "short",
        year: "numeric"
      }
    );
  }

  async function fetchJSON(
    url,
    options = {}
  ) {
    const controller =
      new AbortController();

    const timer =
      setTimeout(
        () => controller.abort(),
        CONFIG.timeout
      );

    try {
      const response =
        await fetch(
          url,
          {
            ...options,

            signal:
              controller.signal,

            headers: {
              Accept:
                "application/json",

              ...(options.headers || {})
            }
          }
        );

      const text =
        await response.text();

      let data = null;

      try {
        data = text
          ? JSON.parse(text)
          : null;
      } catch {
        throw new Error(
          "Server returned invalid JSON."
        );
      }

      if (!response.ok) {
        throw new Error(
          data?.error ||
          `Request failed (${response.status})`
        );
      }

      return data;

    } catch (error) {

      if (
        error.name ===
        "AbortError"
      ) {
        throw new Error(
          "Request timed out."
        );
      }

      throw error;

    } finally {
      clearTimeout(timer);
    }
  }

  /* =======================================================
     SEARCH
     ======================================================= */

  async function performSearch(
    query,
    mode = state.mode
  ) {
    query =
      cleanQuery(query);

    if (!query) return;

    state.query = query;
    state.mode = mode;

    const input =
      $("#searchInput");

    if (input) {
      input.value =
        query;
    }

    if (
      mode === "maps"
    ) {
      await openMapView();
      await searchMapPlace(query);
      return;
    }

    showSearchView();

    const results =
      $("#results");

    const meta =
      $("#resultMeta");

    if (results) {
      results.innerHTML = `
        <div class="hexora-loading">
          <div class="loader"></div>
          <span>
            Searching HEXORA...
          </span>
        </div>
      `;
    }

    if (meta) {
      meta.textContent =
        `Searching for "${query}"...`;
    }

    try {

      const url =
        `${CONFIG.searchEndpoint}?q=${encodeURIComponent(query)}&mode=${encodeURIComponent(mode)}`;

      const data =
        await fetchJSON(url);

      renderSearchResults(
        data,
        query,
        mode
      );

      updateURL(
        query,
        mode
      );

    } catch (error) {

      console.error(
        "HEXORA search error:",
        error
      );

      if (results) {

        results.innerHTML = `
          <div class="hexora-empty">

            <div class="empty-icon">
              ⌕
            </div>

            <h3>
              HEXORA search is temporarily unavailable
            </h3>

            <p>
              ${escapeHTML(
                error.message
              )}
            </p>

            <button
              class="hexora-retry"
              id="retrySearchBtn"
            >
              Try Again
            </button>

          </div>
        `;

        $(
          "#retrySearchBtn"
        )?.addEventListener(
          "click",
          () =>
            performSearch(
              query,
              mode
            )
        );
      }

      if (meta) {
        meta.textContent =
          `Could not complete search for "${query}".`;
      }
    }
  }

  function renderSearchResults(
    data,
    query,
    mode
  ) {
    const results =
      $("#results");

    const meta =
      $("#resultMeta");

    if (!results) return;

    let items = [];

    if (
      Array.isArray(data)
    ) {
      items = data;

    } else if (
      Array.isArray(
        data?.results
      )
    ) {
      items =
        data.results;

    } else if (
      Array.isArray(
        data?.data
      )
    ) {
      items =
        data.data;
    }

    const total =
      Number.isFinite(
        data?.total
      )
        ? data.total
        : items.length;

    if (meta) {
      meta.textContent =
        `${total.toLocaleString("en-IN")} result${total === 1 ? "" : "s"} for "${query}"`;
    }

    if (!items.length) {

      results.innerHTML = `
        <div class="hexora-empty">

          <div class="empty-icon">
            ⌕
          </div>

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

    results.innerHTML =
      items
        .map(
          (item, index) =>
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

          ${
            image
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
              : ""
          }

        </div>

      </article>
    `;
  }

  /* =======================================================
     NEWS
     ======================================================= */

  async function loadNews() {

    const container =
      $("#newsList");

    if (!container) return;

    container.innerHTML = `
      <div class="hexora-loading">

        <div class="loader"></div>

        <span>
          Loading latest indexed news...
        </span>

      </div>
    `;

    try {

      const data =
        await fetchJSON(
          CONFIG.newsEndpoint
        );

      let items = [];

      if (
        Array.isArray(data)
      ) {
        items = data;

      } else if (
        Array.isArray(
          data?.results
        )
      ) {
        items =
          data.results;

      } else if (
        Array.isArray(
          data?.data
        )
      ) {
        items =
          data.data;
      }

      if (!items.length) {

        container.innerHTML = `
          <div class="news-empty">
            No indexed news available yet.
          </div>
        `;

        return;
      }

      container.innerHTML =
        items
          .slice(0, 12)
          .map(
            renderNewsCard
          )
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

  function renderNewsCard(
    item
  ) {
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
                    String(
                      description
                    ).slice(0, 200)
                  )}
                </p>
              `
              : ""
          }

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

      </article>
    `;
  }

  /* =======================================================
     VIEW
     ======================================================= */

  function showSearchView() {

    $("#searchView")
      ?.classList.add(
        "active"
      );

    $("#mapView")
      ?.classList.remove(
        "active"
      );

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }

  function showHomeView() {

    $("#searchView")
      ?.classList.remove(
        "active"
      );

    $("#mapView")
      ?.classList.remove(
        "active"
      );

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }

  /* =======================================================
     CESIUM 3D EARTH
     ======================================================= */

  function loadCesium() {

    return new Promise(
      (resolve, reject) => {

        if (
          window.Cesium
        ) {
          resolve(
            window.Cesium
          );
          return;
        }

        const existing =
          document.querySelector(
            'script[data-hexora-cesium]'
          );

        if (existing) {

          existing.addEventListener(
            "load",
            () =>
              resolve(
                window.Cesium
              )
          );

          existing.addEventListener(
            "error",
            () =>
              reject(
                new Error(
                  "Cesium failed to load."
                )
              )
          );

          return;
        }

        const script =
          document.createElement(
            "script"
          );

        script.src =
          "https://cesium.com/downloads/cesiumjs/releases/1.136/Build/Cesium/Cesium.js";

        script.async =
          true;

        script.dataset.hexoraCesium =
          "true";

        script.onload =
          () => {

            if (
              window.Cesium
            ) {

              resolve(
                window.Cesium
              );

            } else {

              reject(
                new Error(
                  "Cesium is unavailable."
                )
              );
            }
          };

        script.onerror =
          () =>
            reject(
              new Error(
                "Could not load HEXORA Earth engine."
              )
            );

        document.head.appendChild(
          script
        );
      }
    );
  }

  function loadCesiumCSS() {

    if (
      document.querySelector(
        'link[data-hexora-cesium-css]'
      )
    ) {
      return;
    }

    const link =
      document.createElement(
        "link"
      );

    link.rel =
      "stylesheet";

    link.href =
      "https://cesium.com/downloads/cesiumjs/releases/1.136/Build/Cesium/Widgets/widgets.css";

    link.dataset.hexoraCesiumCss =
      "true";

    document.head.appendChild(
      link
    );
  }

  async function initHexoraEarth() {

    if (
      state.viewer
    ) {
      return state.viewer;
    }

    if (
      state.mapLoading
    ) {
      return null;
    }

    const container =
      $("#hexoraMap");

    if (!container) {

      console.error(
        "HEXORA: #hexoraMap not found."
      );

      return null;
    }

    state.mapLoading =
      true;

    try {

      loadCesiumCSS();

      const Cesium =
        await loadCesium();

      /*
       * Remove old content.
       */

      container.innerHTML = "";

      /*
       * Independent OpenStreetMap
       * imagery.
       */

      const imageryProvider =
        new Cesium.OpenStreetMapImageryProvider(
          {
            url:
              "https://tile.openstreetmap.org/"
          }
        );

      /*
       * Create 3D Earth.
       */

      const viewer =
        new Cesium.Viewer(
          container,
          {
            baseLayer:
              new Cesium.ImageryLayer(
                imageryProvider
              ),

            animation:
              false,

            timeline:
              false,

            baseLayerPicker:
              false,

            geocoder:
              false,

            homeButton:
              true,

            sceneModePicker:
              true,

            navigationHelpButton:
              false,

            fullscreenButton:
              false,

            infoBox:
              false,

            selectionIndicator:
              true,

            scene3DOnly:
              false,

            shouldAnimate:
              true
          }
        );

      state.viewer =
        viewer;

      state.mapReady =
        true;

      state.mapLoading =
        false;

      /*
       * Lighting.
       */

      viewer.scene.globe.enableLighting =
        true;

      /*
       * Atmosphere.
       */

      viewer.scene.skyAtmosphere.show =
        true;

      viewer.scene.fog.enabled =
        true;

      /*
       * Earth background.
       */

      viewer.scene.backgroundColor =
        Cesium.Color.BLACK;

      /*
       * Initial HEXORA view.
       */

      viewer.camera.flyTo({

        destination:
          Cesium.Cartesian3.fromDegrees(
            CONFIG.map.longitude,
            CONFIG.map.latitude,
            CONFIG.map.globeHeight
          ),

        orientation: {

          heading:
            0,

          pitch:
            Cesium.Math.toRadians(
              -90
            ),

          roll:
            0
        },

        duration:
          1.8
      });

      /*
       * Resize after creation.
       */

      setTimeout(
        () => {

          try {
            viewer.resize();
          } catch {}

        },
        300
      );

      updateMapInfo(
        "HEXORA 3D Earth ready"
      );

      return viewer;

    } catch (error) {

      state.mapLoading =
        false;

      console.error(
        "HEXORA Earth error:",
        error
      );

      updateMapInfo(
        error.message
      );

      return null;
    }
  }

  async function openMapView() {

    $("#searchView")
      ?.classList.remove(
        "active"
      );

    $("#mapView")
      ?.classList.add(
        "active"
      );

    const viewer =
      await initHexoraEarth();

    if (viewer) {

      setTimeout(
        () => {

          try {
            viewer.resize();
          } catch {}

        },
        300
      );
    }

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }

  function updateMapInfo(
    message
  ) {

    const info =
      $("#mapInfo");

    if (info) {
      info.textContent =
        message || "";
    }
  }

  /* =======================================================
     MARKERS
     ======================================================= */

  function removeEntity(
    entity
  ) {

    if (
      !entity ||
      !state.viewer
    ) {
      return;
    }

    try {

      state.viewer.entities
        .remove(entity);

    } catch {}
  }

  function createMarker(
    longitude,
    latitude,
    title,
    type = "place"
  ) {

    if (
      !state.viewer
    ) {
      return null;
    }

    const Cesium =
      window.Cesium;

    return state.viewer.entities.add(
      {
        position:
          Cesium.Cartesian3.fromDegrees(
            Number(longitude),
            Number(latitude),
            50
          ),

        point: {

          pixelSize:
            type === "location"
              ? 15
              : 12,

          color:
            type === "location"
              ? Cesium.Color.CYAN
              : Cesium.Color.WHITE,

          outlineColor:
            Cesium.Color.BLACK,

          outlineWidth:
            3,

          heightReference:
            Cesium.HeightReference.CLAMP_TO_GROUND
        },

        label: {

          text:
            String(title || ""),

          font:
            "14px sans-serif",

          showBackground:
            true,

          backgroundColor:
            Cesium.Color.BLACK
              .withAlpha(
                0.75
              ),

          pixelOffset:
            new Cesium.Cartesian2(
              0,
              -25
            ),

          heightReference:
            Cesium.HeightReference.CLAMP_TO_GROUND
        }
      }
    );
  }

  /* =======================================================
     PLACE SEARCH
     ======================================================= */

  async function searchMapPlace(
    query
  ) {

    query =
      cleanQuery(query);

    if (!query) return;

    await openMapView();

    const viewer =
      await initHexoraEarth();

    if (!viewer) return;

    updateMapInfo(
      `Searching HEXORA Map for "${query}"...`
    );

    try {

      const url =
        `${CONFIG.map.nominatim}?format=jsonv2&limit=8&addressdetails=1&q=${encodeURIComponent(query)}`;

      const response =
        await fetch(
          url,
          {
            headers: {
              Accept:
                "application/json"
            }
          }
        );

      if (!response.ok) {

        throw new Error(
          `Map search failed (${response.status})`
        );
      }

      const places =
        await response.json();

      if (
        !Array.isArray(
          places
        ) ||
        !places.length
      ) {

        updateMapInfo(
          `No place found for "${query}".`
        );

        return;
      }

      const place =
        places[0];

      const latitude =
        Number(place.lat);

      const longitude =
        Number(place.lon);

      if (
        !Number.isFinite(
          latitude
        ) ||
        !Number.isFinite(
          longitude
        )
      ) {

        throw new Error(
          "Invalid map location."
        );
      }

      removeEntity(
        state.searchMarker
      );

      state.searchMarker =
        createMarker(
          longitude,
          latitude,
          place.display_name,
          "place"
        );

      const Cesium =
        window.Cesium;

      viewer.camera.flyTo({

        destination:
          Cesium.Cartesian3.fromDegrees(
            longitude,
            latitude,
            3000
          ),

        orientation: {

          heading:
            0,

          pitch:
            Cesium.Math.toRadians(
              -65
            ),

          roll:
            0
        },

        duration:
          2
      });

      updateMapInfo(
        place.display_name
      );

    } catch (error) {

      console.error(
        "HEXORA map search error:",
        error
      );

      updateMapInfo(
        `Map search failed: ${error.message}`
      );
    }
  }

  /* =======================================================
     GPS
     ======================================================= */

  function locateUser() {

    if (
      !navigator.geolocation
    ) {

      updateMapInfo(
        "GPS is not supported by this browser."
      );

      return;
    }

    updateMapInfo(
      "Requesting device GPS..."
    );

    navigator.geolocation.getCurrentPosition(

      async position => {

        const latitude =
          position.coords.latitude;

        const longitude =
          position.coords.longitude;

        const accuracy =
          position.coords.accuracy;

        state.lastLocation = {
          latitude,
          longitude,
          accuracy
        };

        await openMapView();

        const viewer =
          await initHexoraEarth();

        if (!viewer) return;

        removeEntity(
          state.locationMarker
        );

        state.locationMarker =
          createMarker(
            longitude,
            latitude,
            "Your current location",
            "location"
          );

        const Cesium =
          window.Cesium;

        viewer.camera.flyTo({

          destination:
            Cesium.Cartesian3.fromDegrees(
              longitude,
              latitude,
              1500
            ),

          orientation: {

            heading:
              0,

            pitch:
              Cesium.Math.toRadians(
                -65
              ),

            roll:
              0
          },

          duration:
            2
        });

        updateMapInfo(
          `Current device location • ±${Math.round(accuracy)}m`
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
            "Device location unavailable.";
        }

        if (
          error.code ===
          error.TIMEOUT
        ) {
          message =
            "GPS request timed out.";
        }

        updateMapInfo(
          message
        );

        console.error(
          "HEXORA GPS:",
          error
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

  /* =======================================================
     EARTH CONTROLS
     ======================================================= */

  function resetMap() {

    if (
      !state.viewer
    ) {
      return;
    }

    const Cesium =
      window.Cesium;

    state.viewer.camera.flyTo({

      destination:
        Cesium.Cartesian3.fromDegrees(
          CONFIG.map.longitude,
          CONFIG.map.latitude,
          CONFIG.map.globeHeight
        ),

      orientation: {

        heading:
          0,

        pitch:
          Cesium.Math.toRadians(
            -90
          ),

        roll:
          0
      },

      duration:
        1.5
    });

    updateMapInfo(
      "HEXORA Earth"
    );
  }

  function globeView() {

    if (
      !state.viewer
    ) {
      return;
    }

    const Cesium =
      window.Cesium;

    state.viewer.camera.flyTo({

      destination:
        Cesium.Cartesian3.fromDegrees(
          78,
          25,
          13000000
        ),

      orientation: {

        heading:
          0,

        pitch:
          Cesium.Math.toRadians(
            -75
          ),

        roll:
          0
      },

      duration:
        1.8
    });

    updateMapInfo(
      "HEXORA 3D Globe"
    );
  }

  function topView() {

    if (
      !state.viewer
    ) {
      return;
    }

    const Cesium =
      window.Cesium;

    const cartographic =
      state.viewer.camera
        .positionCartographic;

    state.viewer.camera.flyTo({

      destination:
        Cesium.Cartesian3.fromRadians(

          cartographic.longitude,

          cartographic.latitude,

          2500000
        ),

      orientation: {

        heading:
          0,

        pitch:
          Cesium.Math.toRadians(
            -90
          ),

        roll:
          0
      },

      duration:
        1
    });

    updateMapInfo(
      "HEXORA top view"
    );
  }

  async function fullscreenMap() {

    const element =
      $("#hexoraMap");

    if (!element) return;

    try {

      if (
        document.fullscreenElement
      ) {

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
        "Fullscreen:",
        error
      );
    }

    setTimeout(
      () => {

        try {
          state.viewer?.resize();
        } catch {}

      },
      300
    );
  }

  function satelliteMode() {

    updateMapInfo(
      "HEXORA satellite imagery layer is not connected yet."
    );
  }

  /* =======================================================
     MAP PREVIEW
     ======================================================= */

  async function initMapPreview() {

    const preview =
      $("#mapPreview");

    if (!preview) return;

    preview.innerHTML = `
      <div class="hexora-preview-earth">

        <div class="hexora-preview-globe">
        </div>

        <div class="hexora-preview-text">
          HEXORA EARTH
        </div>

      </div>
    `;
  }

  /* =======================================================
     MODES
     ======================================================= */

  function setMode(
    mode
  ) {

    state.mode =
      String(
        mode || "web"
      )
        .toLowerCase();

    $$(".mode")
      .forEach(
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
            buttonMode ===
              state.mode
          );
        }
      );

    const input =
      $("#searchInput");

    if (!input) return;

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
      placeholders[
        state.mode
      ] ||
      placeholders.web;
  }

  /* =======================================================
     TRENDING
     ======================================================= */

  function setupTrending() {

    $$(".trend")
      .forEach(
        button => {

          button.addEventListener(
            "click",
            () => {

              const query =
                cleanQuery(
                  button.dataset.query ||
                  button.textContent
                );

              if (!query) return;

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

  function bindQueryButtons() {

    $$("[data-query]")
      .forEach(
        button => {

          if (
            button.classList.contains(
              "trend"
            )
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

              if (!query) return;

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

  /* =======================================================
     MOBILE MENU
     ======================================================= */

  function setupMobileMenu() {

    const button =
      $("#mobileMenu");

    const menu =
      $("#mobileNav");

    if (
      !button ||
      !menu
    ) {
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
          open
            ? "true"
            : "false"
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

  /* =======================================================
     QUICK ACTIONS
     ======================================================= */

  function setupQuickActions() {

    $$("[data-quick]")
      .forEach(
        button => {

          button.addEventListener(
            "click",
            async () => {

              const action =
                button.dataset.quick;

              switch (
                action
              ) {

                case "location":

                  await openMapView();

                  locateUser();

                  break;

                case "place":

                  await openMapView();

                  $("#mapSearchInput")
                    ?.focus();

                  break;

                case "directions":

                  await openMapView();

                  updateMapInfo(
                    "Search a destination on HEXORA Map."
                  );

                  $("#mapSearchInput")
                    ?.focus();

                  break;

                case "satellite":

                  await openMapView();

                  satelliteMode();

                  break;
              }
            }
          );
        }
      );
  }

  /* =======================================================
     NAVIGATION
     ======================================================= */

  function setupNavigation() {

    $$("[data-home]")
      .forEach(
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

    $("#openMapBtn")
      ?.addEventListener(
        "click",
        openMapView
      );

    $("#mapPreviewBtn")
      ?.addEventListener(
        "click",
        openMapView
      );
  }

  /* =======================================================
     SEARCH FORM
     ======================================================= */

  function setupSearch() {

    const form =
      $("#searchForm");

    const input =
      $("#searchInput");

    if (
      !form ||
      !input
    ) {
      return;
    }

    form.addEventListener(
      "submit",
      event => {

        event.preventDefault();

        const query =
          cleanQuery(
            input.value
          );

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

        if (
          event.key ===
          "Escape"
        ) {

          input.value =
            "";

          input.focus();
        }
      }
    );
  }

  /* =======================================================
     MAP SEARCH
     ======================================================= */

  function setupMapSearch() {

    const input =
      $("#mapSearchInput");

    const button =
      $("#mapSearchBtn");

    button?.addEventListener(
      "click",
      () => {

        const query =
          cleanQuery(
            input?.value
          );

        if (query) {
          searchMapPlace(
            query
          );
        }
      }
    );

    input?.addEventListener(
      "keydown",
      event => {

        if (
          event.key ===
          "Enter"
        ) {

          event.preventDefault();

          const query =
            cleanQuery(
              input.value
            );

          if (query) {
            searchMapPlace(
              query
            );
          }
        }
      }
    );
  }

  /* =======================================================
     MAP CONTROLS
     ======================================================= */

  function setupMapControls() {

    $("#locateBtn")
      ?.addEventListener(
        "click",
        locateUser
      );

    $("#resetMapBtn")
      ?.addEventListener(
        "click",
        resetMap
      );

    $("#fullscreenMapBtn")
      ?.addEventListener(
        "click",
        fullscreenMap
      );

    $("#globeBtn")
      ?.addEventListener(
        "click",
        globeView
      );

    $("#topViewBtn")
      ?.addEventListener(
        "click",
        topView
      );

    $("#satelliteBtn")
      ?.addEventListener(
        "click",
        satelliteMode
      );
  }

  /* =======================================================
     MODES
     ======================================================= */

  function setupModes() {

    $$(".mode")
      .forEach(
        button => {

          button.addEventListener(
            "click",
            () => {

              const mode =
                button.dataset.mode ||
                button.textContent
                  .trim()
                  .toLowerCase();

              setMode(
                mode
              );

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

    setMode(
      "web"
    );
  }

  /* =======================================================
     URL STATE
     ======================================================= */

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

      setMode(
        mode
      );

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
        "URL state:",
        error
      );
    }
  }

  /* =======================================================
     RUNTIME CSS
     ======================================================= */

  function injectRuntimeCSS() {

    if (
      $("#hexoraRuntimeCSS")
    ) {
      return;
    }

    const style =
      document.createElement(
        "style"
      );

    style.id =
      "hexoraRuntimeCSS";

    style.textContent = `

      .hexora-loading {
        display:flex;
        align-items:center;
        justify-content:center;
        gap:12px;
        padding:40px 20px;
        opacity:.8;
      }

      .loader {
        width:18px;
        height:18px;
        border:2px solid currentColor;
        border-top-color:transparent;
        border-radius:50%;
        animation:hexoraSpin .7s linear infinite;
      }

      @keyframes hexoraSpin {
        to {
          transform:rotate(360deg);
        }
      }

      .hexora-empty {
        text-align:center;
        padding:60px 20px;
      }

      .empty-icon {
        font-size:42px;
        margin-bottom:12px;
        opacity:.7;
      }

      .hexora-retry {
        margin-top:18px;
        padding:10px 18px;
        border-radius:10px;
        border:1px solid currentColor;
        background:transparent;
        color:inherit;
        cursor:pointer;
      }

      .result-body {
        display:flex;
        gap:20px;
        justify-content:space-between;
      }

      .result-main {
        min-width:0;
        flex:1;
      }

      .result-image-wrap {
        width:160px;
        min-width:160px;
        height:100px;
        overflow:hidden;
        border-radius:12px;
      }

      .result-image {
        width:100%;
        height:100%;
        object-fit:cover;
      }

      .result-top {
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:12px;
      }

      .result-source {
        display:flex;
        align-items:center;
        gap:7px;
        font-size:13px;
        opacity:.75;
      }

      .source-dot {
        width:7px;
        height:7px;
        border-radius:50%;
        background:currentColor;
      }

      .result-url {
        font-size:13px;
        opacity:.65;
        margin:4px 0 7px;
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
      }

      .result-description {
        line-height:1.6;
      }

      .news-empty {
        padding:30px 0;
        opacity:.7;
      }

      /*
       * HEXORA MAP
       */

      #hexoraMap {
        width:100%;
        min-height:650px;
        position:relative;
        overflow:hidden;
        background:#02050a;
      }

      #hexoraMap .cesium-viewer {
        width:100%;
        height:100%;
      }

      #hexoraMap .cesium-widget {
        width:100%;
        height:100%;
      }

      .hexora-map-fullscreen {
        position:fixed !important;
        inset:0 !important;
        z-index:99999 !important;
      }

      /*
       * Preview
       */

      .hexora-preview-earth {
        position:relative;
        width:100%;
        min-height:260px;
        height:100%;
        display:flex;
        align-items:center;
        justify-content:center;
        overflow:hidden;
        background:
          radial-gradient(
            circle at 50% 50%,
            #173f62 0%,
            #081524 48%,
            #02060b 80%
          );
      }

      .hexora-preview-globe {
        width:170px;
        height:170px;
        border-radius:50%;

        background:
          radial-gradient(
            circle at 30% 28%,
            #7ec8df,
            #226384 42%,
            #0b263a 72%,
            #02060b 100%
          );

        box-shadow:
          0 0 70px
          rgba(
            70,
            190,
            255,
            .35
          );
      }

      .hexora-preview-text {
        position:absolute;
        left:20px;
        bottom:20px;
        font-size:13px;
        font-weight:800;
        letter-spacing:.2em;
        opacity:.8;
      }

      /*
       * Mobile
       */

      @media(
        max-width:640px
      ) {

        #hexoraMap {
          min-height:
            calc(
              100vh - 120px
            );
        }

        .result-body {
          gap:12px;
        }

        .result-image-wrap {
          width:92px;
          min-width:92px;
          height:72px;
        }

        .result-top {
          align-items:flex-start;
        }

      }

    `;

    document.head.appendChild(
      style
    );
  }

  /* =======================================================
     INIT
     ======================================================= */

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
        "HEXORA initialized."
      );

    } catch (error) {

      console.error(
        "HEXORA initialization error:",
        error
      );
    }
  }

  /* =======================================================
     PUBLIC HEXORA API
     ======================================================= */

  window.HEXORA = {

    search:
      performSearch,

    searchMap:
      searchMapPlace,

    openMap:
      openMapView,

    locate:
      locateUser,

    resetMap:
      resetMap,

    globe:
      globeView,

    topView:
      topView,

    fullscreen:
      fullscreenMap,

    setMode:
      setMode,

    loadNews:
      loadNews,

    state:
      state
  };

  if (
    document.readyState ===
    "loading"
  ) {

    document.addEventListener(
      "DOMContentLoaded",
      init,
      {
        once:true
      }
    );

  } else {

    init();

  }

})();
```
