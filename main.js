/* =========================================================
   HEXORA SEARCH ENGINE
   Frontend Controller
   SEARCH THE WORLD
   ========================================================= */

(() => {
  "use strict";

  /* =========================================================
     CONFIG
     ========================================================= */

  const CONFIG = {
    searchEndpoint: "/api/search",
    newsEndpoint: "/api/news",

    /*
     * Real OpenStreetMap raster tiles.
     * Do not use fake/demo map data.
     */
    osmTileUrl:
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",

    /*
     * Real Nominatim place search.
     */
    nominatimUrl:
      "https://nominatim.openstreetmap.org/search",

    mapLibreCss:
      "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css",

    mapLibreJs:
      "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js",

    defaultMapCenter: [91.7362, 26.1445], // Assam region
    defaultMapZoom: 5,

    requestTimeout: 15000
  };


  /* =========================================================
     DOM HELPERS
     ========================================================= */

  const $ = (selector) =>
    document.querySelector(selector);

  const $$ = (selector) =>
    Array.from(document.querySelectorAll(selector));


  /* =========================================================
     STATE
     ========================================================= */

  const state = {
    currentMode: "web",
    currentQuery: "",
    map: null,
    mapReady: false,
    mapScriptLoading: false,
    userMarker: null,
    searchMarker: null,
    mapStyle: "osm",
    lastLocation: null
  };


  /* =========================================================
     SAFE HTML
     ========================================================= */

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


  /* =========================================================
     TEXT HELPERS
     ========================================================= */

  function cleanQuery(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);
  }


  function getHostname(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  }


  function formatDate(dateValue) {
    if (!dateValue) return "";

    const date = new Date(dateValue);

    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  }


  /* =========================================================
     FETCH WITH TIMEOUT
     ========================================================= */

  async function fetchJSON(url, options = {}) {
    const controller =
      new AbortController();

    const timer =
      setTimeout(
        () =>
          controller.abort(),
        CONFIG.requestTimeout
      );

    try {
      const response =
        await fetch(url, {
          ...options,
          signal: controller.signal,
          headers: {
            Accept: "application/json",
            ...(options.headers || {})
          }
        });

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
    } finally {
      clearTimeout(timer);
    }
  }


  /* =========================================================
     VIEW HELPERS
     ========================================================= */

  function showHome() {
    const home =
      $("#homeContent");

    const searchView =
      $("#searchView");

    const mapView =
      $("#mapView");

    if (home) {
      home.style.display = "";
    }

    if (searchView) {
      searchView.style.display = "none";
    }

    if (mapView) {
      mapView.style.display = "none";
    }

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }


  function showSearchView() {
    const home =
      $("#homeContent");

    const searchView =
      $("#searchView");

    const mapView =
      $("#mapView");

    if (home) {
      home.style.display = "none";
    }

    if (searchView) {
      searchView.style.display = "";
    }

    if (mapView) {
      mapView.style.display = "none";
    }

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }


  function showMapView() {
    const home =
      $("#homeContent");

    const searchView =
      $("#searchView");

    const mapView =
      $("#mapView");

    if (home) {
      home.style.display = "none";
    }

    if (searchView) {
      searchView.style.display = "none";
    }

    if (mapView) {
      mapView.style.display = "";
    }

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });

    initializeMap()
      .then(() => {
        if (state.map) {
          setTimeout(() => {
            state.map.resize();
          }, 100);
        }
      })
      .catch((error) => {
        console.error(
          "Map initialization error:",
          error
        );

        setMapInfo(
          "HEXORA Map could not be loaded."
        );
      });
  }


  /* =========================================================
     SEARCH MODE
     ========================================================= */

  function setMode(mode) {
    state.currentMode =
      mode || "web";

    $$(".mode").forEach(button => {
      const active =
        button.dataset.mode ===
        state.currentMode;

      button.classList.toggle(
        "active",
        active
      );
    });
  }


  /* =========================================================
     SEARCH
     ========================================================= */

  async function doSearch(query) {
    query =
      cleanQuery(query);

    if (!query) {
      return;
    }

    state.currentQuery =
      query;

    const input =
      $("#searchInput");

    if (input) {
      input.value = query;
    }

    /*
     * Maps mode opens real map.
     */
    if (
      state.currentMode === "maps"
    ) {
      showMapView();

      const mapSearch =
        $("#mapSearchInput");

      if (mapSearch) {
        mapSearch.value = query;
      }

      setTimeout(() => {
        searchMapPlace(query);
      }, 300);

      return;
    }

    /*
     * Images/Videos/Shopping are not
     * fabricated. Only use a dedicated
     * backend endpoint if one exists.
     */
    if (
      state.currentMode === "images" ||
      state.currentMode === "videos" ||
      state.currentMode === "shopping"
    ) {
      showSearchView();

      renderServiceNotConnected(
        state.currentMode
      );

      return;
    }

    showSearchView();

    renderLoadingResults();

    const meta =
      $("#resultMeta");

    if (meta) {
      meta.textContent =
        `Searching HEXORA for "${query}"…`;
    }

    try {
      let data;

      if (
        state.currentMode === "news"
      ) {
        /*
         * Existing real news API.
         */
        data =
          await fetchJSON(
            `${CONFIG.newsEndpoint}?q=${encodeURIComponent(query)}`
          );
      } else {
        /*
         * Existing real web search API.
         */
        data =
          await fetchJSON(
            `${CONFIG.searchEndpoint}?q=${encodeURIComponent(query)}`
          );
      }

      renderResults(
        data,
        query
      );

      updateURL(query);

    } catch (error) {
      console.error(
        "HEXORA search error:",
        error
      );

      renderSearchError(
        error.message
      );
    }
  }


  /* =========================================================
     URL STATE
     ========================================================= */

  function updateURL(query) {
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

      window.history.replaceState(
        {},
        "",
        url
      );
    } catch {
      // Ignore URL errors.
    }
  }


  /* =========================================================
     RESULT RENDERING
     ========================================================= */

  function renderLoadingResults() {
    const results =
      $("#results");

    if (!results) return;

    results.innerHTML = `
      <div class="hexora-loading">
        <div class="hexora-spinner"></div>
        <p>Searching the world…</p>
      </div>
    `;
  }


  function renderSearchError(message) {
    const results =
      $("#results");

    const meta =
      $("#resultMeta");

    if (meta) {
      meta.textContent =
        "HEXORA Search";
    }

    if (!results) return;

    results.innerHTML = `
      <div class="hexora-empty">
        <h3>Search temporarily unavailable</h3>
        <p>
          ${escapeHTML(
            message ||
            "The search service did not return a response."
          )}
        </p>
      </div>
    `;
  }


  function renderServiceNotConnected(mode) {
    const results =
      $("#results");

    const meta =
      $("#resultMeta");

    if (meta) {
      meta.textContent =
        `${mode.charAt(0).toUpperCase() + mode.slice(1)} Search`;
    }

    if (!results) return;

    results.innerHTML = `
      <div class="hexora-empty">
        <div class="empty-icon">◈</div>
        <h3>
          ${escapeHTML(
            mode.charAt(0).toUpperCase() +
            mode.slice(1)
          )} service
        </h3>

        <p>
          This HEXORA service is not connected
          to a dedicated backend yet.
        </p>

        <p>
          HEXORA will not show fake results here.
        </p>
      </div>
    `;
  }


  function renderResults(data, query) {
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
      Array.isArray(data?.results)
    ) {
      items = data.results;
    } else if (
      Array.isArray(data?.items)
    ) {
      items = data.items;
    } else if (
      Array.isArray(data?.data)
    ) {
      items = data.data;
    }

    if (meta) {
      const total =
        Number.isFinite(
          Number(data?.total)
        )
          ? Number(data.total)
          : items.length;

      meta.textContent =
        `${total.toLocaleString()} result${
          total === 1 ? "" : "s"
        } for "${query}"`;
    }

    if (!items.length) {
      results.innerHTML = `
        <div class="hexora-empty">
          <div class="empty-icon">⌕</div>
          <h3>No indexed results found</h3>
          <p>
            HEXORA did not find a real indexed
            webpage matching this query.
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
              index
            )
        )
        .join("");
  }


  function renderResultCard(item, index) {
    const title =
      item.title ||
      item.name ||
      "Untitled result";

    const url =
      item.url ||
      item.link ||
      "";

    const description =
      item.description ||
      item.snippet ||
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
      getHostname(url);

    const date =
      item.published_at ||
      item.fetched_at ||
      "";

    const score =
      item.score;

    const imageHTML =
      image &&
      safeURL(image) !== "#"
        ? `
          <img
            class="result-image"
            src="${escapeHTML(
              safeURL(image)
            )}"
            alt=""
            loading="lazy"
            referrerpolicy="no-referrer"
            onerror="this.style.display='none'"
          >
        `
        : "";

    const scoreHTML =
      typeof score === "number"
        ? `
          <span class="result-score">
            ${escapeHTML(
              score.toFixed(1)
            )}
          </span>
        `
        : "";

    const dateHTML =
      date
        ? `
          <span class="result-date">
            ${escapeHTML(
              formatDate(date)
            )}
          </span>
        `
        : "";

    return `
      <article
        class="result-card"
        data-result-index="${index}"
      >

        <div class="result-main">

          <div class="result-source">
            ${escapeHTML(
              source || "Web"
            )}
            ${dateHTML}
            ${scoreHTML}
          </div>

          <h2 class="result-title">
            <a
              href="${escapeHTML(
                safeURL(url)
              )}"
              target="_blank"
              rel="noopener noreferrer"
            >
              ${escapeHTML(title)}
            </a>
          </h2>

          <div class="result-url">
            ${escapeHTML(url)}
          </div>

          <p class="result-description">
            ${escapeHTML(
              description
            )}
          </p>

        </div>

        ${
          imageHTML
            ? `<div class="result-media">
                 ${imageHTML}
               </div>`
            : ""
        }

      </article>
    `;
  }


  /* =========================================================
     REAL NEWS HOME
     ========================================================= */

  async function loadNews() {
    const newsList =
      $("#newsList");

    if (!newsList) {
      return;
    }

    newsList.innerHTML = `
      <div class="news-loading">
        Loading real HEXORA news…
      </div>
    `;

    try {
      /*
       * Existing endpoint.
       */
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
        Array.isArray(data?.results)
      ) {
        items = data.results;
      } else if (
        Array.isArray(data?.items)
      ) {
        items = data.items;
      } else if (
        Array.isArray(data?.data)
      ) {
        items = data.data;
      }

      if (!items.length) {
        newsList.innerHTML = `
          <div class="news-empty">
            No real news returned by HEXORA right now.
          </div>
        `;

        return;
      }

      newsList.innerHTML =
        items
          .slice(0, 8)
          .map(
            item =>
              renderNewsItem(item)
          )
          .join("");

    } catch (error) {
      console.error(
        "HEXORA news error:",
        error
      );

      newsList.innerHTML = `
        <div class="news-empty">
          HEXORA news is temporarily unavailable.
        </div>
      `;
    }
  }


  function renderNewsItem(item) {
    const title =
      item.title ||
      "Untitled news";

    const url =
      item.url ||
      item.link ||
      "#";

    const source =
      item.source_name ||
      item.source_domain ||
      getHostname(url) ||
      "News";

    const description =
      item.description ||
      "";

    const date =
      item.published_at ||
      item.fetched_at ||
      "";

    const image =
      item.image_url ||
      item.image ||
      item.thumbnail ||
      "";

    const imageHTML =
      image &&
      safeURL(image) !== "#"
        ? `
          <img
            src="${escapeHTML(
              safeURL(image)
            )}"
            alt=""
            loading="lazy"
            referrerpolicy="no-referrer"
            onerror="this.style.display='none'"
          >
        `
        : "";

    return `
      <article class="news-item">

        ${
          imageHTML
            ? `
              <div class="news-thumb">
                ${imageHTML}
              </div>
            `
            : ""
        }

        <div class="news-content">

          <div class="news-source">
            ${escapeHTML(source)}
            ${
              date
                ? ` · ${escapeHTML(
                    formatDate(date)
                  )}`
                : ""
            }
          </div>

          <h3>
            <a
              href="${escapeHTML(
                safeURL(url)
              )}"
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
                    description
                  )}
                </p>
              `
              : ""
          }

        </div>

      </article>
    `;
  }


  /* =========================================================
     MAPLIBRE LOADER
     ========================================================= */

  function loadMapLibre() {
    return new Promise(
      (resolve, reject) => {

        if (
          window.maplibregl
        ) {
          resolve(
            window.maplibregl
          );
          return;
        }

        if (
          state.mapScriptLoading
        ) {
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
                  "Map library timeout."
                )
              );
            }
          }, 15000);

          return;
        }

        state.mapScriptLoading =
          true;

        /*
         * CSS
         */
        if (
          !document.querySelector(
            'link[data-hexora-maplibre]'
          )
        ) {
          const link =
            document.createElement(
              "link"
            );

          link.rel =
            "stylesheet";

          link.href =
            CONFIG.mapLibreCss;

          link.dataset.hexoraMaplibre =
            "true";

          document.head.appendChild(
            link
          );
        }

        /*
         * JS
         */
        const script =
          document.createElement(
            "script"
          );

        script.src =
          CONFIG.mapLibreJs;

        script.async =
          true;

        script.onload = () => {

          state.mapScriptLoading =
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
                "MapLibre loaded but was unavailable."
              )
            );
          }
        };

        script.onerror = () => {

          state.mapScriptLoading =
            false;

          reject(
            new Error(
              "Unable to load MapLibre."
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
     MAP INFO
     ========================================================= */

  function setMapInfo(message) {
    const element =
      $("#mapInfo");

    if (element) {
      element.textContent =
        message || "";
    }
  }


  /* =========================================================
     MAP STYLE
     ========================================================= */

  function createOSMStyle() {
    return {
      version: 8,

      sources: {
        osm: {
          type: "raster",
          tiles: [
            CONFIG.osmTileUrl
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
    };
  }


  /* =========================================================
     MAP INITIALIZATION
     ========================================================= */

  async function initializeMap() {

    const mapElement =
      $("#hexoraMap");

    if (!mapElement) {
      return;
    }

    if (
      state.mapReady &&
      state.map
    ) {
      state.map.resize();
      return;
    }

    setMapInfo(
      "Loading real HEXORA Map…"
    );

    const maplibregl =
      await loadMapLibre();

    /*
     * Clear possible old map.
     */
    mapElement.innerHTML = "";

    state.map =
      new maplibregl.Map({
        container:
          mapElement,

        style:
          createOSMStyle(),

        center:
          CONFIG.defaultMapCenter,

        zoom:
          CONFIG.defaultMapZoom,

        attributionControl:
          true,

        maxZoom:
          19,

        pitch:
          0,

        bearing:
          0
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

        state.mapReady =
          true;

        setMapInfo(
          "Real OpenStreetMap data"
        );

        setTimeout(() => {
          state.map.resize();
        }, 100);
      }
    );

    state.map.on(
      "error",
      event => {
        console.error(
          "HEXORA map error:",
          event
        );

        setMapInfo(
          "Map tiles could not be loaded."
        );
      }
    );

    state.map.on(
      "click",
      event => {

        const lng =
          event.lngLat.lng;

        const lat =
          event.lngLat.lat;

        setMapInfo(
          `Location: ${lat.toFixed(
            5
          )}, ${lng.toFixed(5)}`
        );
      }
    );
  }


  /* =========================================================
     MAP PREVIEW
     ========================================================= */

  async function initializeMapPreview() {

    const preview =
      $("#mapPreview");

    if (!preview) {
      return;
    }

    /*
     * The preview uses a separate
     * MapLibre instance.
     */
    if (
      preview.dataset.mapReady ===
      "true"
    ) {
      return;
    }

    try {

      const maplibregl =
        await loadMapLibre();

      preview.innerHTML = "";

      const map =
        new maplibregl.Map({
          container:
            preview,

          style:
            createOSMStyle(),

          center:
            CONFIG.defaultMapCenter,

          zoom:
            CONFIG.defaultMapZoom,

          interactive:
            false,

          attributionControl:
            false
        });

      map.on(
        "load",
        () => {

          preview.dataset.mapReady =
            "true";

          setTimeout(() => {
            map.resize();
          }, 100);
        }
      );

    } catch (error) {

      console.error(
        "Map preview error:",
        error
      );

      preview.innerHTML = `
        <div class="map-preview-error">
          HEXORA Map unavailable
        </div>
      `;
    }
  }


  /* =========================================================
     GEOCODING / PLACE SEARCH
     ========================================================= */

  async function geocodePlace(query) {

    const clean =
      cleanQuery(query);

    if (!clean) {
      throw new Error(
        "Enter a place name."
      );
    }

    const url =
      `${CONFIG.nominatimUrl}?format=jsonv2` +
      `&q=${encodeURIComponent(clean)}` +
      `&limit=8` +
      `&addressdetails=1`;

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
        `Place search failed (${response.status})`
      );
    }

    const data =
      await response.json();

    if (
      !Array.isArray(data)
    ) {
      return [];
    }

    return data;
  }


  async function searchMapPlace(query) {

    query =
      cleanQuery(query);

    if (!query) {
      setMapInfo(
        "Enter a place to search."
      );
      return;
    }

    try {

      setMapInfo(
        `Searching real map data for "${query}"…`
      );

      await initializeMap();

      const places =
        await geocodePlace(query);

      if (!places.length) {

        setMapInfo(
          `No real map place found for "${query}".`
        );

        return;
      }

      const place =
        places[0];

      const lon =
        Number(place.lon);

      const lat =
        Number(place.lat);

      if (
        !Number.isFinite(lon) ||
        !Number.isFinite(lat)
      ) {
        throw new Error(
          "Invalid coordinates returned by map service."
        );
      }

      if (
        state.searchMarker
      ) {
        state.searchMarker.remove();
      }

      const maplibregl =
        window.maplibregl;

      state.searchMarker =
        new maplibregl.Marker({
          color: "#00cfff"
        })
          .setLngLat([
            lon,
            lat
          ])
          .setPopup(
            new maplibregl.Popup({
              offset: 25
            }).setHTML(`
              <strong>
                ${escapeHTML(
                  place.display_name
                )}
              </strong>
            `)
          )
          .addTo(
            state.map
          );

      state.map.flyTo({
        center: [
          lon,
          lat
        ],
        zoom: 15,
        speed: 1.2,
        essential: true
      });

      state.searchMarker
        .togglePopup();

      setMapInfo(
        place.display_name ||
        `${lat}, ${lon}`
      );

    } catch (error) {

      console.error(
        "Map place search error:",
        error
      );

      setMapInfo(
        error.message ||
        "Place search failed."
      );
    }
  }


  /* =========================================================
     CURRENT LOCATION
     ========================================================= */

  function locateUser() {

    if (
      !navigator.geolocation
    ) {
      setMapInfo(
        "This browser does not support location."
      );

      return;
    }

    setMapInfo(
      "Requesting your current location…"
    );

    navigator.geolocation.getCurrentPosition(
      position => {

        const lat =
          position.coords.latitude;

        const lon =
          position.coords.longitude;

        state.lastLocation = {
          lat,
          lon
        };

        const maplibregl =
          window.maplibregl;

        if (
          !state.map ||
          !maplibregl
        ) {
          setMapInfo(
            "HEXORA Map is still loading."
          );

          return;
        }

        if (
          state.userMarker
        ) {
          state.userMarker.remove();
        }

        state.userMarker =
          new maplibregl.Marker({
            color: "#00e5ff"
          })
            .setLngLat([
              lon,
              lat
            ])
            .setPopup(
              new maplibregl.Popup({
                offset: 25
              }).setText(
                "Your current location"
              )
            )
            .addTo(
              state.map
            );

        state.map.flyTo({
          center: [
            lon,
            lat
          ],
          zoom: 16,
          speed: 1.2,
          essential: true
        });

        setMapInfo(
          `Your location: ${lat.toFixed(
            5
          )}, ${lon.toFixed(5)}`
        );
      },

      error => {

        let message =
          "Unable to get your current location.";

        if (
          error.code ===
          error.PERMISSION_DENIED
        ) {
          message =
            "Location permission was denied. HEXORA will not use a fake location.";
        }

        if (
          error.code ===
          error.POSITION_UNAVAILABLE
        ) {
          message =
            "Your real location is currently unavailable.";
        }

        if (
          error.code ===
          error.TIMEOUT
        ) {
          message =
            "Location request timed out.";
        }

        console.warn(
          "Geolocation:",
          error
        );

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


  /* =========================================================
     MAP RESET
     ========================================================= */

  function resetMap() {

    if (
      !state.map
    ) {
      return;
    }

    state.map.flyTo({
      center:
        CONFIG.defaultMapCenter,

      zoom:
        CONFIG.defaultMapZoom,

      pitch:
        0,

      bearing:
        0,

      speed:
        1.2,

      essential:
        true
    });

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

    setMapInfo(
      "Real OpenStreetMap data"
    );
  }


  /* =========================================================
     MAP FULLSCREEN
     ========================================================= */

  function fullscreenMap() {

    const mapElement =
      $("#hexoraMap");

    if (!mapElement) {
      return;
    }

    if (
      document.fullscreenElement
    ) {
      document.exitFullscreen?.();
      return;
    }

    mapElement
      .requestFullscreen?.()
      .catch(error => {
        console.warn(
          "Fullscreen error:",
          error
        );
      });
  }


  /* =========================================================
     SATELLITE
     ========================================================= */

  function satelliteMessage() {

    /*
     * IMPORTANT:
     *
     * Do NOT display fake satellite imagery.
     *
     * A real satellite provider/API/key must
     * be configured before showing satellite.
     */

    setMapInfo(
      "Real satellite imagery is not configured yet. HEXORA will not show fake satellite data."
    );
  }


  /* =========================================================
     QUICK ACTIONS
     ========================================================= */

  function handleQuickAction(action) {

    switch (action) {

      case "location":

        showMapView();

        setTimeout(() => {
          locateUser();
        }, 500);

        break;


      case "place":

        showMapView();

        setTimeout(() => {

          const input =
            $("#mapSearchInput");

          if (input) {
            input.focus();
          }

        }, 500);

        break;


      case "directions":

        showMapView();

        setTimeout(() => {

          setMapInfo(
            "Search a destination on the real map. HEXORA can then use the destination coordinates for directions."
          );

          const input =
            $("#mapSearchInput");

          if (input) {
            input.focus();
          }

        }, 500);

        break;


      case "satellite":

        showMapView();

        setTimeout(() => {
          satelliteMessage();
        }, 500);

        break;

      default:
        break;
    }
  }


  /* =========================================================
     MOBILE MENU
     ========================================================= */

  function setupMobileMenu() {

    const menuButton =
      $("#mobileMenuBtn");

    const mobileMenu =
      $("#mobileMenu");

    if (
      !menuButton ||
      !mobileMenu
    ) {
      return;
    }

    menuButton.addEventListener(
      "click",
      () => {

        mobileMenu.classList.toggle(
          "open"
        );

        const opened =
          mobileMenu.classList.contains(
            "open"
          );

        menuButton.setAttribute(
          "aria-expanded",
          opened
            ? "true"
            : "false"
        );
      }
    );
  }


  /* =========================================================
     NAVIGATION
     ========================================================= */

  function setupNavigation() {

    /*
     * Header links.
     */
    $$(
      "[data-nav]"
    ).forEach(link => {

      link.addEventListener(
        "click",
        event => {

          event.preventDefault();

          const target =
            link.dataset.nav;

          if (
            target === "home"
          ) {
            showHome();
            return;
          }

          if (
            target === "web"
          ) {

            setMode("web");

            const input =
              $("#searchInput");

            if (input) {
              input.focus();
            }

            showHome();

            return;
          }

          if (
            target === "news"
          ) {

            setMode("news");

            showSearchView();

            const input =
              $("#searchInput");

            const query =
              input?.value ||
              "";

            if (query.trim()) {
              doSearch(query);
            } else {
              loadNews();
            }

            return;
          }

          if (
            target === "maps"
          ) {

            setMode("maps");

            showMapView();

            return;
          }
        }
      );
    });


    /*
     * Some versions of the UI use
     * regular href navigation rather
     * than data-nav.
     */
    $$(
      'a[href="#home"]'
    ).forEach(link => {

      link.addEventListener(
        "click",
        event => {
          event.preventDefault();
          showHome();
        }
      );

    });


    $$(
      'a[href="#maps"]'
    ).forEach(link => {

      link.addEventListener(
        "click",
        event => {
          event.preventDefault();

          setMode("maps");

          showMapView();
        }
      );

    });
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
      return;
    }

    form.addEventListener(
      "submit",
      event => {

        event.preventDefault();

        doSearch(
          input.value
        );
      }
    );


    /*
     * Search modes.
     */
    $$(".mode").forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const mode =
            button.dataset.mode ||
            "web";

          setMode(mode);

          const query =
            input.value.trim();

          if (
            mode === "maps"
          ) {

            showMapView();

            if (query) {

              const mapInput =
                $("#mapSearchInput");

              if (mapInput) {
                mapInput.value =
                  query;
              }

              setTimeout(() => {
                searchMapPlace(
                  query
                );
              }, 300);
            }

            return;
          }

          if (
            query &&
            (
              mode === "web" ||
              mode === "news"
            )
          ) {
            doSearch(query);
          }
        }
      );
    });


    /*
     * Trending searches.
     */
    $$(".trend").forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const query =
            button.dataset.query ||
            button.textContent ||
            "";

          input.value =
            cleanQuery(query);

          setMode("web");

          doSearch(
            input.value
          );
        }
      );
    });
  }


  /* =========================================================
     MAP CONTROLS
     ========================================================= */

  function setupMapControls() {

    const mapSearchForm =
      $("#mapSearchForm");

    const mapSearchButton =
      $("#mapSearchBtn");

    const mapSearchInput =
      $("#mapSearchInput");

    if (
      mapSearchForm &&
      mapSearchInput
    ) {

      mapSearchForm.addEventListener(
        "submit",
        event => {

          event.preventDefault();

          searchMapPlace(
            mapSearchInput.value
          );
        }
      );
    }


    if (
      mapSearchButton &&
      mapSearchInput
    ) {

      mapSearchButton.addEventListener(
        "click",
        () => {

          searchMapPlace(
            mapSearchInput.value
          );
        }
      );
    }


    const locateButton =
      $("#locateBtn");

    if (locateButton) {

      locateButton.addEventListener(
        "click",
        () => {

          if (!state.map) {

            showMapView();

            setTimeout(
              locateUser,
              500
            );

            return;
          }

          locateUser();
        }
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
     HOME MAP BUTTONS
     ========================================================= */

  function setupMapHomeButtons() {

    const openMap =
      $("#openMapBtn");

    if (openMap) {

      openMap.addEventListener(
        "click",
        () => {
          setMode("maps");
          showMapView();
        }
      );
    }


    const previewButton =
      $("#mapPreviewBtn");

    if (previewButton) {

      previewButton.addEventListener(
        "click",
        () => {
          setMode("maps");
          showMapView();
        }
      );
    }


    const viewNewsButton =
      $("#viewNewsBtn");

    if (viewNewsButton) {

      viewNewsButton.addEventListener(
        "click",
        () => {

          setMode("news");

          showSearchView();

          loadNews();
        }
      );
    }


    $(
      "[data-quick]"
    ).forEach(button => {

      button.addEventListener(
        "click",
        () => {

          handleQuickAction(
            button.dataset.quick
          );
        }
      );
    });
  }


  /* =========================================================
     INITIAL QUERY
     ========================================================= */

  function loadInitialQuery() {

    try {

      const params =
        new URLSearchParams(
          window.location.search
        );

      const query =
        cleanQuery(
          params.get("q") || ""
        );

      const input =
        $("#searchInput");

      if (query) {

        if (input) {
          input.value =
            query;
        }

        setMode("web");

        doSearch(
          query
        );

        return;
      }

      showHome();

    } catch {
      showHome();
    }
  }


  /* =========================================================
     RESIZE
     ========================================================= */

  function setupResize() {

    window.addEventListener(
      "resize",
      () => {

        if (
          state.map
        ) {
          state.map.resize();
        }
      }
    );
  }


  /* =========================================================
     CUSTOM SMALL CSS
     ========================================================= */

  function injectFunctionalCSS() {

    if (
      document.getElementById(
        "hexoraFunctionalCSS"
      )
    ) {
      return;
    }

    const style =
      document.createElement(
        "style"
      );

    style.id =
      "hexoraFunctionalCSS";

    style.textContent = `

      .hexora-loading,
      .hexora-empty,
      .news-loading,
      .news-empty {
        padding: 32px 20px;
        text-align: center;
        border-radius: 18px;
      }

      .hexora-spinner {
        width: 32px;
        height: 32px;
        margin: 0 auto 12px;
        border: 3px solid rgba(0, 210, 255, .18);
        border-top-color: #00d7ff;
        border-radius: 50%;
        animation: hexoraSpin .8s linear infinite;
      }

      @keyframes hexoraSpin {
        to {
          transform: rotate(360deg);
        }
      }

      .result-card {
        display: flex;
        justify-content: space-between;
        gap: 20px;
      }

      .result-main {
        min-width: 0;
        flex: 1;
      }

      .result-media {
        width: 150px;
        flex: 0 0 150px;
      }

      .result-image {
        width: 100%;
        height: 100px;
        object-fit: cover;
        border-radius: 14px;
      }

      .result-source {
        font-size: 12px;
        opacity: .72;
        margin-bottom: 6px;
      }

      .result-url {
        font-size: 12px;
        opacity: .65;
        overflow-wrap: anywhere;
        margin-bottom: 7px;
      }

      .result-description {
        line-height: 1.6;
      }

      .result-score {
        margin-left: 8px;
      }

      .result-date {
        margin-left: 8px;
      }

      .news-item {
        display: flex;
        gap: 14px;
      }

      .news-thumb {
        width: 90px;
        min-width: 90px;
        height: 70px;
        overflow: hidden;
        border-radius: 12px;
      }

      .news-thumb img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .news-content {
        min-width: 0;
      }

      .news-source {
        font-size: 11px;
        opacity: .65;
        margin-bottom: 5px;
      }

      .news-content h3 {
        margin: 0;
      }

      .news-content p {
        margin: 6px 0 0;
      }

      #hexoraMap,
      #mapPreview {
        min-height: 100%;
        width: 100%;
      }

      #hexoraMap {
        position: relative;
      }

      #mapView {
        min-height: 600px;
      }

      .map-preview-error {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        min-height: 220px;
      }

      @media (max-width: 650px) {

        .result-card {
          flex-direction: column;
        }

        .result-media {
          width: 100%;
          flex-basis: auto;
        }

        .result-image {
          height: 180px;
        }

        .news-thumb {
          width: 75px;
          min-width: 75px;
          height: 60px;
        }

        #mapView {
          min-height: 520px;
        }
      }

    `;

    document.head.appendChild(
      style
    );
  }


  /* =========================================================
     INITIALIZE
     ========================================================= */

  async function init() {

    console.log(
      "HEXORA frontend initializing…"
    );

    injectFunctionalCSS();

    setMode("web");

    setupSearch();

    setupNavigation();

    setupMobileMenu();

    setupMapControls();

    setupMapHomeButtons();

    setupResize();

    /*
     * Real news on home page.
     */
    loadNews();

    /*
     * Real map preview on home page.
     *
     * It does not request GPS permission.
     * It does not fake the user's location.
     */
    initializeMapPreview();

    /*
     * If ?q= exists, perform search.
     */
    loadInitialQuery();

    console.log(
      "HEXORA frontend ready."
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


  /* =========================================================
     OPTIONAL GLOBAL API
     ========================================================= */

  window.HEXORA = {
    search: doSearch,
    searchMap: searchMapPlace,
    openMap: showMapView,
    locate: locateUser,
    resetMap,
    loadNews
  };

})();
