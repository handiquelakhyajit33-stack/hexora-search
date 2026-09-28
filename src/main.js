"use strict";

/* =========================================================
   HEXORA MAIN.JS
   Exact controller for current HEXORA index.html
   ========================================================= */

const CONFIG = {
  searchEndpoint: "/api/search",
  newsEndpoint: "/api/news",

  mapTiles: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  geocoder: "https://nominatim.openstreetmap.org/search",

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
  query: "",
  mode: "web",

  map: null,
  mapReady: false,
  mapLoading: false,

  userMarker: null,
  searchMarker: null
};


/* =========================================================
   DOM
   ========================================================= */

const homeView = document.getElementById("homeView");
const searchView = document.getElementById("searchView");
const mapView = document.getElementById("mapView");

const searchForm = document.getElementById("searchForm");
const searchInput = document.getElementById("searchInput");

const results = document.getElementById("results");
const resultMeta = document.getElementById("resultMeta");

const newsList = document.getElementById("newsList");

const mapSearchInput =
  document.getElementById("mapSearchInput");

const mapSearchBtn =
  document.getElementById("mapSearchBtn");

const openMapBtn =
  document.getElementById("openMapBtn");

const mapInfo =
  document.getElementById("mapInfo");


/* =========================================================
   HELPERS
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


function truncate(value, length = 220) {
  const text = String(value ?? "").trim();

  if (text.length <= length) {
    return text;
  }

  return text.slice(0, length).trim() + "…";
}


function getDomain(url) {
  try {
    return new URL(url).hostname
      .replace(/^www\./, "");
  } catch {
    return "";
  }
}


function formatDate(value) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString(
    undefined,
    {
      year: "numeric",
      month: "short",
      day: "numeric"
    }
  );
}


function modeLabel(mode) {
  const labels = {
    web: "Web",
    images: "Images",
    news: "News",
    videos: "Videos",
    maps: "Maps"
  };

  return labels[mode] || "Web";
}


/* =========================================================
   FETCH JSON
   ========================================================= */

async function fetchJSON(url) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      CONFIG.timeout
    );

  try {
    console.log(
      "[HEXORA REQUEST]",
      url
    );

    const response =
      await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json"
        },
        signal: controller.signal
      });

    const text =
      await response.text();

    let data = {};

    try {
      data = text
        ? JSON.parse(text)
        : {};
    } catch {
      data = {
        message: text
      };
    }

    if (!response.ok) {
      throw new Error(
        data?.error ||
        data?.message ||
        `HTTP ${response.status}`
      );
    }

    return data;

  } finally {
    clearTimeout(timer);
  }
}


/* =========================================================
   VIEW
   ========================================================= */

function showHome() {

  if (homeView) {
    homeView.style.display = "";
  }

  if (searchView) {
    searchView.style.display = "none";
    searchView.classList.remove("active");
  }

  if (mapView) {
    mapView.style.display = "none";
    mapView.classList.remove("active");
  }
}


function showSearch() {

  if (homeView) {
    homeView.style.display = "none";
  }

  if (mapView) {
    mapView.style.display = "none";
    mapView.classList.remove("active");
  }

  if (searchView) {
    searchView.style.display = "block";
    searchView.classList.add("active");
  }
}


function showMap() {

  if (homeView) {
    homeView.style.display = "none";
  }

  if (searchView) {
    searchView.style.display = "none";
    searchView.classList.remove("active");
  }

  if (mapView) {
    mapView.style.display = "block";
    mapView.classList.add("active");
  }
}


/* =========================================================
   ACTIVE BUTTON
   ========================================================= */

function updateActiveMode(mode) {

  document
    .querySelectorAll("[data-mode]")
    .forEach(button => {

      const buttonMode =
        String(
          button.dataset.mode || ""
        ).toLowerCase();

      button.classList.toggle(
        "active",
        buttonMode === mode
      );

    });
}


/* =========================================================
   LOADING
   ========================================================= */

function showLoading(query, mode) {

  if (!results) return;

  results.innerHTML = `
    <div class="hexora-loading">
      <div class="hexora-spinner"></div>

      <div class="hexora-loading-title">
        HEXORA is searching…
      </div>

      <div class="hexora-loading-text">
        Searching ${escapeHTML(
          modeLabel(mode)
        )} for
        “${escapeHTML(query)}”
      </div>
    </div>
  `;

  if (resultMeta) {
    resultMeta.textContent =
      `Searching ${modeLabel(mode)}…`;
  }
}


/* =========================================================
   NO RESULTS
   ========================================================= */

function showNoData(query, mode) {

  if (!results) return;

  results.innerHTML = `
    <div class="state hexora-no-data">

      <div class="no-data-icon">
        🔎
      </div>

      <h3>
        No data found
      </h3>

      <p>
        No ${escapeHTML(
          modeLabel(mode)
        )} data found for
        “${escapeHTML(query)}”
      </p>

    </div>
  `;

  if (resultMeta) {
    resultMeta.textContent =
      `No ${modeLabel(mode)} data found`;
  }
}


/* =========================================================
   ERROR
   ========================================================= */

function showError(error) {

  if (!results) return;

  results.innerHTML = `
    <div class="state">

      <div style="font-size:30px;margin-bottom:10px;">
        ⚠️
      </div>

      <strong>
        HEXORA search error
      </strong>

      <p>
        ${escapeHTML(
          error?.message ||
          "Something went wrong."
        )}
      </p>

    </div>
  `;

  if (resultMeta) {
    resultMeta.textContent =
      "Search error";
  }
}


/* =========================================================
   NORMALIZE RESULTS
   ========================================================= */

function getResults(data) {

  if (Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data?.results)) {
    return data.results;
  }

  if (Array.isArray(data?.items)) {
    return data.items;
  }

  if (Array.isArray(data?.data)) {
    return data.data;
  }

  return [];
}


/* =========================================================
   WEB RESULT
   ========================================================= */

function renderWeb(items) {

  return items.map(item => {

    const title =
      item.title ||
      item.name ||
      item.heading ||
      item.url ||
      "Untitled";

    const url =
      item.url ||
      item.page_url ||
      item.link ||
      item.canonical_url ||
      "#";

    const description =
      item.description ||
      item.snippet ||
      item.text ||
      item.content ||
      "";

    const domain =
      item.source_domain ||
      item.domain ||
      getDomain(url);

    return `
      <article class="search-result">

        <div class="result-source">
          ${escapeHTML(domain)}
        </div>

        <div class="result-title">

          <a
            href="${safeURL(url)}"
            target="_blank"
            rel="noopener noreferrer"
          >
            ${escapeHTML(title)}
          </a>

        </div>

        <div class="result-url">
          ${escapeHTML(url)}
        </div>

        ${
          description
            ? `
              <div class="result-description">
                ${escapeHTML(
                  truncate(description)
                )}
              </div>
            `
            : ""
        }

      </article>
    `;
  }).join("");
}


/* =========================================================
   IMAGE RESULT
   ========================================================= */

function renderImages(items) {

  const validImages =
    items.filter(item => {

      const image =
        item.image_url ||
        item.image ||
        item.thumbnail_url ||
        item.src;

      return Boolean(image);
    });


  if (!validImages.length) {
    return "";
  }


  return `
    <div class="hexora-image-section">

      <div class="hexora-image-grid">

        ${validImages.map(item => {

          const image =
            item.image_url ||
            item.image ||
            item.thumbnail_url ||
            item.src;

          const page =
            item.page_url ||
            item.url ||
            item.link ||
            "#";

          const title =
            item.title ||
            item.alt_text ||
            item.name ||
            "Image";

          const domain =
            item.source_domain ||
            item.domain ||
            getDomain(page);

          return `
            <article class="hexora-image-card">

              <a
                href="${safeURL(page)}"
                target="_blank"
                rel="noopener noreferrer"
              >

                <div class="hexora-image-box">

                  <img
                    src="${safeURL(image)}"
                    alt="${escapeHTML(title)}"
                    loading="lazy"
                    onerror="
                      this.closest(
                        '.hexora-image-card'
                      )?.remove()
                    "
                  >

                </div>

              </a>

              <div class="hexora-image-title">
                ${escapeHTML(
                  truncate(title, 90)
                )}
              </div>

              <div class="hexora-image-domain">
                ${escapeHTML(domain)}
              </div>

            </article>
          `;

        }).join("")}

      </div>

    </div>
  `;
}


/* =========================================================
   NEWS RESULT
   ========================================================= */

function renderNews(items) {

  return items.map(item => {

    const title =
      item.title ||
      item.name ||
      "News";

    const url =
      item.url ||
      item.link ||
      item.page_url ||
      "#";

    const description =
      item.description ||
      item.snippet ||
      item.summary ||
      "";

    const source =
      item.source_name ||
      item.source_domain ||
      item.domain ||
      getDomain(url);

    const image =
      item.image_url ||
      item.thumbnail_url ||
      "";

    const date =
      item.published_at ||
      item.date ||
      item.created_at ||
      "";


    return `
      <article class="search-result news-card">

        ${
          image
            ? `
              <a
                href="${safeURL(url)}"
                target="_blank"
                rel="noopener noreferrer"
              >

                <img
                  class="news-result-image"
                  src="${safeURL(image)}"
                  alt="${escapeHTML(title)}"
                  loading="lazy"
                >

              </a>
            `
            : ""
        }

        <div class="news-result-content">

          <div class="result-source">
            ${escapeHTML(source)}
          </div>

          <div class="result-title">

            <a
              href="${safeURL(url)}"
              target="_blank"
              rel="noopener noreferrer"
            >
              ${escapeHTML(title)}
            </a>

          </div>

          ${
            date
              ? `
                <div class="result-date">
                  ${escapeHTML(
                    formatDate(date)
                  )}
                </div>
              `
              : ""
          }

          ${
            description
              ? `
                <div class="result-description">
                  ${escapeHTML(
                    truncate(
                      description,
                      280
                    )
                  )}
                </div>
              `
              : ""
          }

        </div>

      </article>
    `;
  }).join("");
}


/* =========================================================
   VIDEO RESULT
   ========================================================= */

function renderVideos(items) {

  const validVideos =
    items.filter(item => {

      return Boolean(
        item.video_url ||
        item.video ||
        item.url ||
        item.page_url
      );

    });


  if (!validVideos.length) {
    return "";
  }


  return `
    <div class="hexora-video-section">

      <div class="hexora-video-grid">

        ${validVideos.map(item => {

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
            item.image_url ||
            item.thumbnail ||
            "";

          const title =
            item.title ||
            item.name ||
            "Video";

          const description =
            item.description ||
            item.snippet ||
            "";


          return `
            <article class="hexora-video-card">

              <a
                href="${safeURL(page)}"
                target="_blank"
                rel="noopener noreferrer"
                class="hexora-video-thumbnail"
              >

                ${
                  thumbnail
                    ? `
                      <img
                        src="${safeURL(thumbnail)}"
                        alt="${escapeHTML(title)}"
                        loading="lazy"
                      >
                    `
                    : `
                      <div class="hexora-video-empty">
                        ▶
                      </div>
                    `
                }

                <span class="hexora-play">
                  ▶
                </span>

              </a>

              <div class="hexora-video-title">
                ${escapeHTML(
                  truncate(title, 100)
                )}
              </div>

              ${
                description
                  ? `
                    <div class="hexora-video-description">
                      ${escapeHTML(
                        truncate(
                          description,
                          180
                        )
                      )}
                    </div>
                  `
                  : ""
              }

            </article>
          `;

        }).join("")}

      </div>

    </div>
  `;
}


/* =========================================================
   MAP SEARCH RESULT
   ========================================================= */

function renderMapResults(items) {

  return items.map(item => {

    const name =
      item.name ||
      item.title ||
      "Place";

    const address =
      item.address ||
      item.formatted_address ||
      item.location ||
      "";

    const lat =
      item.latitude ??
      item.lat;

    const lon =
      item.longitude ??
      item.lng ??
      item.lon;

    const url =
      item.url ||
      item.website ||
      item.page_url ||
      "#";


    return `
      <article class="search-result">

        <div style="font-size:24px;">
          📍
        </div>

        <div class="result-title">

          <a
            href="${safeURL(url)}"
            target="_blank"
            rel="noopener noreferrer"
          >
            ${escapeHTML(name)}
          </a>

        </div>

        ${
          address
            ? `
              <div class="result-description">
                ${escapeHTML(address)}
              </div>
            `
            : ""
        }

        ${
          lat != null &&
          lon != null
            ? `
              <div class="result-date">
                ${escapeHTML(
                  `${lat}, ${lon}`
                )}
              </div>
            `
            : ""
        }

      </article>
    `;
  }).join("");
}


/* =========================================================
   RENDER
   ========================================================= */

function renderResults(items, mode) {

  if (!results) return;

  let html = "";

  if (mode === "images") {
    html = renderImages(items);
  }

  else if (mode === "news") {
    html = renderNews(items);
  }

  else if (mode === "videos") {
    html = renderVideos(items);
  }

  else if (mode === "maps") {
    html = renderMapResults(items);
  }

  else {
    html = renderWeb(items);
  }


  /*
   * If category-specific fields don't exist,
   * don't show Web results accidentally.
   */

  if (!html.trim()) {
    showNoData(
      state.query,
      mode
    );

    return;
  }


  results.innerHTML = html;


  if (resultMeta) {

    resultMeta.textContent =
      `${items.length} ` +
      `${modeLabel(mode)} ` +
      `result` +
      `${items.length === 1 ? "" : "s"} found`;

  }


  addSearchStyles();
}


/* =========================================================
   MAIN SEARCH
   ========================================================= */

async function doSearch(
  query,
  mode = "web"
) {

  query =
    String(query || "").trim();

  mode =
    String(mode || "web").toLowerCase();


  const allowed = [
    "web",
    "images",
    "news",
    "videos",
    "maps"
  ];


  if (!allowed.includes(mode)) {
    mode = "web";
  }


  if (!query) {

    state.query = "";
    state.mode = mode;

    showHome();

    return;
  }


  state.query = query;
  state.mode = mode;


  updateActiveMode(mode);


  /*
   * MAP
   */

  if (mode === "maps") {

    showMap();

    await searchMapLocation(query);

    updateURL();

    return;
  }


  /*
   * WEB / IMAGES / NEWS / VIDEOS
   */

  showSearch();

  showLoading(
    query,
    mode
  );


  try {

    /*
     * THIS IS THE IMPORTANT PART.
     *
     * Every tab sends its own mode.
     */

    const url =
      `${CONFIG.searchEndpoint}` +
      `?q=${encodeURIComponent(query)}` +
      `&mode=${encodeURIComponent(mode)}`;


    console.log(
      "[HEXORA]",
      "Query:",
      query,
      "Mode:",
      mode
    );


    const data =
      await fetchJSON(url);


    const items =
      getResults(data);


    console.log(
      "[HEXORA]",
      "Mode:",
      mode,
      "Results:",
      items.length
    );


    if (!items.length) {

      showNoData(
        query,
        mode
      );

      return;
    }


    renderResults(
      items,
      mode
    );


    updateURL();


  } catch (error) {

    console.error(
      "[HEXORA SEARCH ERROR]",
      error
    );

    showError(error);
  }
}


/* =========================================================
   MODE CLICK
   ========================================================= */

async function selectMode(mode) {

  mode =
    String(mode || "")
      .toLowerCase();


  /*
   * AI / Engine / Workspace / Profile
   * are not search API modes yet.
   *
   * Do not send them as web search.
   */

  if (
    ![
      "web",
      "images",
      "news",
      "videos",
      "maps"
    ].includes(mode)
  ) {

    updateActiveMode(mode);

    if (mode === "ai") {
      alert(
        "HEXORA AI module is not connected yet."
      );
    }

    else if (mode === "engine") {
      alert(
        "HEXORA Engine module is not connected yet."
      );
    }

    else if (mode === "workspace") {
      alert(
        "HEXORA Workspace is not connected yet."
      );
    }

    else if (mode === "profile") {
      alert(
        "HEXORA Profile / Sign In is not connected yet."
      );
    }

    return;
  }


  await doSearch(
    state.query,
    mode
  );
}


/* =========================================================
   SEARCH FORM
   ========================================================= */

function setupSearch() {

  if (!searchForm) {
    console.error(
      "[HEXORA] #searchForm not found"
    );

    return;
  }


  searchForm.addEventListener(
    "submit",
    async event => {

      event.preventDefault();


      const query =
        searchInput?.value?.trim() || "";


      if (!query) {

        searchInput?.focus();

        return;
      }


      await doSearch(
        query,
        state.mode || "web"
      );

    }
  );
}


/* =========================================================
   ALL MODE BUTTONS
   ========================================================= */

function setupModeButtons() {

  document
    .querySelectorAll("[data-mode]")
    .forEach(button => {

      button.addEventListener(
        "click",
        async event => {

          event.preventDefault();


          const mode =
            String(
              button.dataset.mode || ""
            ).toLowerCase();


          if (!mode) return;


          await selectMode(mode);

        }
      );

    });
}


/* =========================================================
   HOME BUTTONS
   ========================================================= */

function setupHomeButtons() {

  document
    .querySelectorAll("[data-home]")
    .forEach(button => {

      button.addEventListener(
        "click",
        event => {

          event.preventDefault();


          state.query = "";
          state.mode = "web";


          if (searchInput) {
            searchInput.value = "";
          }


          updateActiveMode("web");

          showHome();


          history.replaceState(
            {},
            "",
            window.location.pathname
          );

        }
      );

    });
}


/* =========================================================
   MAP LIBRE
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


      /*
       * CSS
       */

      if (
        !document.querySelector(
          `link[href="${CONFIG.mapLibreCSS}"]`
        )
      ) {

        const link =
          document.createElement("link");

        link.rel = "stylesheet";
        link.href =
          CONFIG.mapLibreCSS;

        document.head.appendChild(link);
      }


      /*
       * JS
       */

      const existing =
        document.querySelector(
          `script[src="${CONFIG.mapLibreJS}"]`
        );


      if (existing) {

        existing.addEventListener(
          "load",
          () => resolve(
            window.maplibregl
          ),
          { once: true }
        );

        existing.addEventListener(
          "error",
          reject,
          { once: true }
        );

        return;
      }


      const script =
        document.createElement(
          "script"
        );

      script.src =
        CONFIG.mapLibreJS;

      script.async = true;


      script.onload = () => {

        if (window.maplibregl) {

          resolve(
            window.maplibregl
          );

        } else {

          reject(
            new Error(
              "MapLibre failed to load."
            )
          );

        }

      };


      script.onerror = () => {

        reject(
          new Error(
            "Could not load MapLibre."
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
   MAP INITIALIZATION
   ========================================================= */

async function initMap() {

  if (
    state.mapReady &&
    state.map
  ) {

    setTimeout(
      () => state.map.resize(),
      100
    );

    return state.map;
  }


  /*
   * IMPORTANT:
   *
   * Current HTML uses #hexoraMap
   */

  const container =
    document.getElementById(
      "hexoraMap"
    );


  if (!container) {

    console.error(
      "[HEXORA MAP] #hexoraMap not found"
    );

    return null;
  }


  if (state.mapLoading) {
    return null;
  }


  state.mapLoading = true;


  try {

    const maplibregl =
      await loadMapLibre();


    state.map =
      new maplibregl.Map({

        container:

          "hexoraMap",

        style: {

          version: 8,

          sources: {

            "osm": {

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


    state.map.addControl(
      new maplibregl.NavigationControl(),
      "top-right"
    );


    state.map.on(
      "load",
      () => {

        state.mapReady = true;

        setTimeout(
          () => state.map.resize(),
          200
        );

      }
    );


    return state.map;


  } catch (error) {

    console.error(
      "[HEXORA MAP ERROR]",
      error
    );

    return null;


  } finally {

    state.mapLoading = false;

  }
}


/* =========================================================
   MAP SEARCH
   ========================================================= */

async function searchMapLocation(
  query
) {

  const map =
    await initMap();


  if (!map) return;


  try {

    if (mapInfo) {

      mapInfo.style.display =
        "block";

      mapInfo.textContent =
        `Searching for ${query}…`;

    }


    const url =
      `${CONFIG.geocoder}` +
      `?q=${encodeURIComponent(query)}` +
      `&format=json` +
      `&limit=1`;


    const response =
      await fetch(url, {
        headers: {
          Accept:
            "application/json"
        }
      });


    if (!response.ok) {

      throw new Error(
        `Location search failed (${response.status})`
      );

    }


    const data =
      await response.json();


    if (
      !Array.isArray(data) ||
      !data.length
    ) {

      if (mapInfo) {

        mapInfo.style.display =
          "block";

        mapInfo.textContent =
          "No data found";

      }

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

      return;
    }


    /*
     * Remove previous marker
     */

    if (state.searchMarker) {

      state.searchMarker.remove();

    }


    if (window.maplibregl) {

      state.searchMarker =
        new window.maplibregl.Marker()
          .setLngLat([
            lon,
            lat
          ])
          .setPopup(
            new window.maplibregl.Popup({
              offset: 25
            }).setHTML(
              `<strong>
                ${escapeHTML(
                  place.display_name ||
                  query
                )}
              </strong>`
            )
          )
          .addTo(map);

    }


    map.flyTo({

      center: [
        lon,
        lat
      ],

      zoom: 12,

      essential: true

    });


    if (mapInfo) {

      mapInfo.style.display =
        "block";

      mapInfo.textContent =
        place.display_name ||
        query;

    }


  } catch (error) {

    console.error(
      "[HEXORA MAP SEARCH]",
      error
    );

    if (mapInfo) {

      mapInfo.style.display =
        "block";

      mapInfo.textContent =
        "Could not search this location.";

    }

  }
}


/* =========================================================
   MAP SEARCH FORM
   ========================================================= */

function setupMapSearch() {

  const form =
    document.querySelector(
      ".map-search"
    );


  if (!form) return;


  form.addEventListener(
    "submit",
    async event => {

      event.preventDefault();


      const query =
        mapSearchInput?.value?.trim() ||
        "";


      if (!query) {

        mapSearchInput?.focus();

        return;
      }


      state.query = query;
      state.mode = "maps";


      updateActiveMode(
        "maps"
      );


      showMap();


      await searchMapLocation(
        query
      );


      updateURL();

    }
  );
}


/* =========================================================
   LOCATION
   ========================================================= */

function setupLocationButton() {

  const button =
    document.getElementById(
      "locateBtn"
    );


  if (!button) return;


  button.addEventListener(
    "click",
    event => {

      event.preventDefault();


      if (
        !navigator.geolocation
      ) {

        alert(
          "Location is not supported by this browser."
        );

        return;
      }


      navigator.geolocation.getCurrentPosition(

        position => {

          const lat =
            position.coords.latitude;

          const lon =
            position.coords.longitude;


          initMap().then(map => {

            if (!map) return;


            if (state.userMarker) {

              state.userMarker.remove();

            }


            if (window.maplibregl) {

              state.userMarker =
                new window.maplibregl.Marker()
                  .setLngLat([
                    lon,
                    lat
                  ])
                  .setPopup(
                    new window.maplibregl.Popup({
                      offset: 25
                    }).setHTML(
                      "<strong>Your location</strong>"
                    )
                  )
                  .addTo(map);

            }


            map.flyTo({

              center: [
                lon,
                lat
              ],

              zoom: 15,

              essential: true

            });

          });

        },


        error => {

          console.error(
            "[HEXORA LOCATION]",
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
  );
}


/* =========================================================
   OPEN MAP
   ========================================================= */

function setupOpenMap() {

  if (!openMapBtn) return;


  openMapBtn.addEventListener(
    "click",
    async event => {

      event.preventDefault();


      state.mode = "maps";

      updateActiveMode(
        "maps"
      );

      showMap();


      await initMap();

    }
  );
}


/* =========================================================
   3D BUTTON
   ========================================================= */

function setup3DButtons() {

  const buttons =
    document.querySelectorAll(
      "#3dMapBtn, #high3dMapBtn"
    );


  buttons.forEach(button => {

    button.addEventListener(
      "click",
      event => {

        event.preventDefault();


        if (!state.map) return;


        const currentPitch =
          state.map.getPitch();


        state.map.easeTo({

          pitch:
            currentPitch > 20
              ? 0
              : button.id ===
                "high3dMapBtn"
              ? 75
              : 55

        });

      }
    );

  });
}


/* =========================================================
   RESET MAP
   ========================================================= */

function setupResetMap() {

  const button =
    document.getElementById(
      "resetMapBtn"
    );


  if (!button) return;


  button.addEventListener(
    "click",
    event => {

      event.preventDefault();


      if (!state.map) return;


      state.map.flyTo({

        center:
          CONFIG.defaultCenter,

        zoom:
          CONFIG.defaultZoom,

        pitch: 0,

        bearing: 0,

        essential: true

      });

    }
  );
}


/* =========================================================
   FULLSCREEN MAP
   ========================================================= */

function setupFullscreen() {

  const button =
    document.getElementById(
      "fullscreenMapBtn"
    );


  if (!button) return;


  button.addEventListener(
    "click",
    async event => {

      event.preventDefault();


      const target =
        document.getElementById(
          "mapView"
        );


      if (!target) return;


      try {

        if (
          !document.fullscreenElement
        ) {

          await target.requestFullscreen();

        } else {

          await document.exitFullscreen();

        }

      } catch (error) {

        console.error(
          "[HEXORA FULLSCREEN]",
          error
        );

      }

    }
  );
}


/* =========================================================
   MAP STYLE BUTTONS
   ========================================================= */

function setupMapStyleButtons() {

  /*
   * Current map uses OpenStreetMap.
   *
   * Satellite data is NOT fabricated.
   * Until a real satellite tile source is
   * connected, Earth/Street remain the
   * available real map layer.
   */


  const satelliteButtons =
    document.querySelectorAll(
      "#satelliteMapBtn"
    );


  satelliteButtons.forEach(button => {

    button.addEventListener(
      "click",
      event => {

        event.preventDefault();

        alert(
          "Real satellite imagery source is not connected yet."
        );

      }
    );

  });


  const earthButton =
    document.getElementById(
      "earthMapBtn"
    );


  if (earthButton) {

    earthButton.addEventListener(
      "click",
      event => {

        event.preventDefault();

        if (!state.map) return;

        state.map.flyTo({

          center:
            CONFIG.defaultCenter,

          zoom:
            CONFIG.defaultZoom,

          pitch: 0,

          bearing: 0

        });

      }
    );

  }


  const streetButton =
    document.getElementById(
      "streetMapBtn"
    );


  if (streetButton) {

    streetButton.addEventListener(
      "click",
      event => {

        event.preventDefault();

        if (!state.map) return;

        state.map.easeTo({
          pitch: 0
        });

      }
    );

  }
}


/* =========================================================
   HOME NEWS
   ========================================================= */

async function loadHomeNews() {

  if (!newsList) return;


  try {

    const data =
      await fetchJSON(
        CONFIG.newsEndpoint
      );


    const items =
      getResults(data)
        .slice(0, 5);


    if (!items.length) {

      newsList.innerHTML = `
        <div class="data-empty">
          No data found.
        </div>
      `;

      return;
    }


    newsList.innerHTML =
      items.map(item => {

        const title =
          item.title ||
          "News";


        const url =
          item.url ||
          item.link ||
          item.page_url ||
          "#";


        const description =
          item.description ||
          item.snippet ||
          "";


        return `
          <div class="data-row">

            ${
              item.image_url
                ? `
                  <img
                    class="data-thumb"
                    src="${safeURL(
                      item.image_url
                    )}"
                    alt=""
                    loading="lazy"
                  >
                `
                : `
                  <div class="data-thumb"></div>
                `
            }

            <div class="data-copy">

              <b>

                <a
                  href="${safeURL(url)}"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  ${escapeHTML(
                    truncate(
                      title,
                      80
                    )
                  )}
                </a>

              </b>

              ${
                description
                  ? `
                    <p>
                      ${escapeHTML(
                        truncate(
                          description,
                          100
                        )
                      )}
                    </p>
                  `
                  : ""
              }

            </div>

          </div>
        `;

      }).join("");


  } catch (error) {

    console.error(
      "[HEXORA HOME NEWS]",
      error
    );

  }
}


/* =========================================================
   URL
   ========================================================= */

function updateURL() {

  const params =
    new URLSearchParams();


  if (state.query) {

    params.set(
      "q",
      state.query
    );

  }


  if (
    state.mode &&
    state.mode !== "web"
  ) {

    params.set(
      "mode",
      state.mode
    );

  }


  const query =
    params.toString();


  const url =
    query
      ? `${window.location.pathname}?${query}`
      : window.location.pathname;


  history.replaceState(
    {},
    "",
    url
  );
}


/* =========================================================
   RESTORE URL
   ========================================================= */

async function restoreURL() {

  const params =
    new URLSearchParams(
      window.location.search
    );


  const query =
    params.get("q")?.trim() ||
    "";


  const mode =
    params.get("mode")?.toLowerCase() ||
    "web";


  if (!query) {

    showHome();

    updateActiveMode(
      "web"
    );

    return;
  }


  if (searchInput) {

    searchInput.value =
      query;

  }


  await doSearch(
    query,
    mode
  );
}


/* =========================================================
   SEARCH CSS
   ========================================================= */

function addSearchStyles() {

  if (
    document.getElementById(
      "hexoraSearchStyles"
    )
  ) {
    return;
  }


  const style =
    document.createElement(
      "style"
    );


  style.id =
    "hexoraSearchStyles";


  style.textContent = `

    .hexora-loading {
      padding:55px 20px;
      text-align:center;
    }

    .hexora-spinner {
      width:48px;
      height:48px;
      margin:0 auto 18px;
      border:4px solid rgba(0,223,255,.15);
      border-top-color:#00dfff;
      border-radius:50%;
      animation:
        hexoraSpin
        1s linear infinite;
    }

    .hexora-loading-title {
      font-size:19px;
      font-weight:850;
      color:#f7fbff;
    }

    .hexora-loading-text {
      margin-top:7px;
      color:#71879b;
      font-size:12px;
    }

    @keyframes hexoraSpin {
      to {
        transform:rotate(360deg);
      }
    }

    .hexora-no-data {
      text-align:center;
      padding:55px 20px;
    }

    .no-data-icon {
      font-size:42px;
      margin-bottom:10px;
    }

    .hexora-no-data h3 {
      margin:0;
      font-size:22px;
      color:#fff;
    }

    .hexora-no-data p {
      color:#71879b;
      font-size:13px;
    }

    .hexora-image-section {
      width:100%;
    }

    .hexora-image-grid {
      display:grid;
      grid-template-columns:
        repeat(
          auto-fill,
          minmax(190px,1fr)
        );
      gap:16px;
    }

    .hexora-image-card {
      overflow:hidden;
      border-radius:15px;
      background:
        rgba(5,20,33,.78);
      border:
        1px solid
        rgba(71,203,255,.12);
    }

    .hexora-image-card a {
      display:block;
    }

    .hexora-image-box {
      width:100%;
      height:190px;
      background:#06111d;
      overflow:hidden;
    }

    .hexora-image-box img {
      width:100%;
      height:100%;
      object-fit:cover;
      display:block;
      transition:
        transform .25s ease;
    }

    .hexora-image-card:hover
    .hexora-image-box img {
      transform:scale(1.04);
    }

    .hexora-image-title {
      padding:
        11px 11px 3px;
      font-size:13px;
      font-weight:700;
    }

    .hexora-image-domain {
      padding:
        3px 11px 12px;
      color:#71879b;
      font-size:10px;
    }

    .hexora-video-section {
      width:100%;
    }

    .hexora-video-grid {
      display:grid;
      grid-template-columns:
        repeat(
          auto-fill,
          minmax(260px,1fr)
        );
      gap:17px;
    }

    .hexora-video-card {
      overflow:hidden;
      border-radius:15px;
      background:
        rgba(5,20,33,.78);
      border:
        1px solid
        rgba(71,203,255,.12);
    }

    .hexora-video-thumbnail {
      height:175px;
      position:relative;
      display:block;
      overflow:hidden;
      background:#030b12;
    }

    .hexora-video-thumbnail img {
      width:100%;
      height:100%;
      object-fit:cover;
    }

    .hexora-video-empty {
      width:100%;
      height:100%;
      display:grid;
      place-items:center;
      font-size:45px;
      color:#00dfff;
    }

    .hexora-play {
      position:absolute;
      left:50%;
      top:50%;
      transform:
        translate(-50%,-50%);
      width:52px;
      height:52px;
      border-radius:50%;
      display:grid;
      place-items:center;
      background:
        rgba(0,0,0,.72);
      color:#fff;
      font-size:20px;
    }

    .hexora-video-title {
      padding:
        12px 12px 4px;
      font-weight:750;
      font-size:14px;
    }

    .hexora-video-description {
      padding:
        4px 12px 14px;
      color:#71879b;
      font-size:12px;
      line-height:1.5;
    }

    .news-card {
      display:flex;
      gap:16px;
    }

    .news-result-image {
      width:180px;
      height:110px;
      object-fit:cover;
      border-radius:11px;
      flex:none;
    }

    .news-result-content {
      min-width:0;
    }

    @media(max-width:600px) {

      .hexora-image-grid {
        grid-template-columns:
          repeat(2,minmax(0,1fr));
        gap:9px;
      }

      .hexora-image-box {
        height:130px;
      }

      .hexora-video-grid {
        grid-template-columns:1fr;
      }

      .news-card {
        display:block;
      }

      .news-result-image {
        width:100%;
        height:180px;
        margin-bottom:12px;
      }

    }

  `;


  document.head.appendChild(
    style
  );
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
        !["INPUT","TEXTAREA"].includes(
          document.activeElement?.tagName
        )
      ) {

        event.preventDefault();

        searchInput?.focus();

      }

    }
  );
}


/* =========================================================
   INITIALIZE
   ========================================================= */

async function initHEXORA() {

  console.log(
    "%cHEXORA",
    "font-size:28px;font-weight:900"
  );

  console.log(
    "[HEXORA] Starting..."
  );


  addSearchStyles();

  setupSearch();

  setupModeButtons();

  setupHomeButtons();

  setupMapSearch();

  setupLocationButton();

  setupOpenMap();

  setup3DButtons();

  setupResetMap();

  setupFullscreen();

  setupMapStyleButtons();

  setupKeyboard();


  updateActiveMode(
    "web"
  );


  await loadHomeNews();

  await restoreURL();


  console.log(
    "[HEXORA] Ready."
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
    initHEXORA,
    { once:true }
  );

} else {

  initHEXORA();

}


/* =========================================================
   PUBLIC API
   ========================================================= */

window.hexoraSearch =
  async function(
    query,
    mode = "web"
  ) {

    if (searchInput) {
      searchInput.value =
        String(query || "");
    }

    await doSearch(
      query,
      mode
    );

    updateURL();

  };


window.hexoraSetMode =
  async function(mode) {

    await selectMode(
      mode
    );

    updateURL();

  };
