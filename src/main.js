/* =========================================================
   HEXORA SEARCH ENGINE - main.js
   Full frontend controller
   ========================================================= */

"use strict";

/* =========================================================
   CONFIG
   ========================================================= */

const CONFIG = {
  searchEndpoint: "/api/search",
  newsEndpoint: "/api/news",

  mapTiles: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  geocoder: "https://nominatim.openstreetmap.org/search",

  mapLibreJS: "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js",
  mapLibreCSS: "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css",

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
   DOM HELPERS
   ========================================================= */

function $(selector) {
  return document.querySelector(selector);
}

function $$(selector) {
  return Array.from(document.querySelectorAll(selector));
}


/* =========================================================
   BASIC HELPERS
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
    const url = new URL(String(value || ""), window.location.origin);

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


function truncate(value, length = 180) {
  const text = String(value ?? "").trim();

  if (text.length <= length) {
    return text;
  }

  return text.slice(0, length).trim() + "…";
}


function formatDate(value) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}


function modeName(mode) {
  const names = {
    web: "Web",
    images: "Images",
    news: "News",
    videos: "Videos",
    maps: "Maps",
    ai: "AI"
  };

  return names[mode] || "Web";
}


/* =========================================================
   FETCH
   ========================================================= */

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
      data = {
        message: text || ""
      };
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


/* =========================================================
   VIEW HELPERS
   ========================================================= */

function getSearchView() {
  return $("#searchView");
}


function getHomeView() {
  return $("#homeView");
}


function getMapView() {
  return $("#mapView");
}


function showHomeView() {
  const home = getHomeView();
  const search = getSearchView();
  const map = getMapView();

  if (home) {
    home.style.display = "";
    home.classList.add("active");
  }

  if (search) {
    search.style.display = "none";
    search.classList.remove("active");
  }

  if (map) {
    map.style.display = "none";
    map.classList.remove("active");
  }
}


function showSearchView() {
  const home = getHomeView();
  const search = getSearchView();
  const map = getMapView();

  if (home) {
    home.style.display = "none";
    home.classList.remove("active");
  }

  if (search) {
    search.style.display = "block";
    search.classList.add("active");
  }

  if (map) {
    map.style.display = "none";
    map.classList.remove("active");
  }
}


function showMapView() {
  const home = getHomeView();
  const search = getSearchView();
  const map = getMapView();

  if (home) {
    home.style.display = "none";
    home.classList.remove("active");
  }

  if (search) {
    search.style.display = "none";
    search.classList.remove("active");
  }

  if (map) {
    map.style.display = "block";
    map.classList.add("active");
  }
}


/* =========================================================
   SEARCH UI
   ========================================================= */

function getResultsContainer() {
  return (
    $("#searchResults") ||
    $("#results") ||
    $(".search-results") ||
    $(".results")
  );
}


function getSearchInput() {
  return (
    $("#searchInput") ||
    document.querySelector('input[name="q"]') ||
    document.querySelector('input[type="search"]')
  );
}


function showSearching(query, mode = "web") {
  const container = getResultsContainer();

  if (!container) return;

  const label = modeName(mode);

  container.innerHTML = `
    <div class="hexora-search-loading" style="
      padding:40px 20px;
      text-align:center;
    ">
      <div style="
        width:48px;
        height:48px;
        margin:0 auto 16px;
        border:4px solid rgba(0,220,255,.18);
        border-top-color:#00dcff;
        border-radius:50%;
        animation:hexoraSpin 1s linear infinite;
      "></div>

      <div style="
        font-size:18px;
        font-weight:700;
        margin-bottom:6px;
      ">
        HEXORA is searching…
      </div>

      <div style="
        opacity:.65;
        font-size:14px;
      ">
        ${escapeHTML(label)} search for
        “${escapeHTML(query)}”
      </div>
    </div>
  `;

  addLoadingAnimation();
}


function addLoadingAnimation() {
  if (document.getElementById("hexoraLoadingStyle")) {
    return;
  }

  const style = document.createElement("style");

  style.id = "hexoraLoadingStyle";

  style.textContent = `
    @keyframes hexoraSpin {
      from {
        transform: rotate(0deg);
      }

      to {
        transform: rotate(360deg);
      }
    }
  `;

  document.head.appendChild(style);
}


function showNoResults(query, mode = "web") {
  const container = getResultsContainer();

  if (!container) return;

  const label = modeName(mode);

  container.innerHTML = `
    <div class="hexora-no-results" style="
      padding:50px 20px;
      text-align:center;
    ">
      <div style="
        font-size:42px;
        margin-bottom:12px;
      ">
        🔎
      </div>

      <div style="
        font-size:22px;
        font-weight:700;
        margin-bottom:8px;
      ">
        No data found
      </div>

      <div style="
        opacity:.65;
        font-size:14px;
      ">
        No ${escapeHTML(label)}
        results found for
        “${escapeHTML(query)}”
      </div>
    </div>
  `;
}


function showSearchError(error) {
  const container = getResultsContainer();

  if (!container) return;

  const message =
    error?.name === "AbortError"
      ? "Search request timed out."
      : error?.message || "Something went wrong.";

  container.innerHTML = `
    <div style="
      padding:40px 20px;
      text-align:center;
    ">
      <div style="
        font-size:36px;
        margin-bottom:10px;
      ">
        ⚠️
      </div>

      <div style="
        font-size:20px;
        font-weight:700;
        margin-bottom:8px;
      ">
        HEXORA search error
      </div>

      <div style="
        opacity:.7;
        font-size:14px;
      ">
        ${escapeHTML(message)}
      </div>
    </div>
  `;
}


/* =========================================================
   RESULT NORMALIZATION
   ========================================================= */

function normalizeResults(data) {
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
   WEB RESULTS
   ========================================================= */

function renderWebResults(items) {
  return items.map((item, index) => {
    const title =
      item.title ||
      item.name ||
      item.heading ||
      item.url ||
      "Untitled result";

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
      <article class="hexora-result web-result"
        data-result-index="${index}">

        <div class="result-domain">
          ${escapeHTML(domain)}
        </div>

        <a
          class="result-title"
          href="${safeURL(url)}"
          target="_blank"
          rel="noopener noreferrer"
        >
          ${escapeHTML(title)}
        </a>

        <div class="result-url">
          ${escapeHTML(url)}
        </div>

        ${
          description
            ? `
              <div class="result-description">
                ${escapeHTML(truncate(description, 260))}
              </div>
            `
            : ""
        }

      </article>
    `;
  }).join("");
}


/* =========================================================
   IMAGE RESULTS
   ========================================================= */

function renderImageResults(items) {
  return `
    <div class="hexora-image-grid">
      ${items.map((item, index) => {
        const image =
          item.image_url ||
          item.image ||
          item.thumbnail_url ||
          item.src ||
          "";

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

        if (!image) {
          return "";
        }

        return `
          <article
            class="hexora-image-card"
            data-result-index="${index}"
          >

            <a
              href="${safeURL(page)}"
              target="_blank"
              rel="noopener noreferrer"
            >
              <img
                src="${safeURL(image)}"
                alt="${escapeHTML(title)}"
                loading="lazy"
                onerror="this.closest('.hexora-image-card')?.remove()"
              >
            </a>

            <div class="image-card-title">
              ${escapeHTML(truncate(title, 90))}
            </div>

            <div class="image-card-domain">
              ${escapeHTML(domain)}
            </div>

          </article>
        `;
      }).join("")}
    </div>
  `;
}


/* =========================================================
   NEWS RESULTS
   ========================================================= */

function renderNewsResults(items) {
  return items.map((item, index) => {
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
      <article
        class="hexora-result news-result"
        data-result-index="${index}"
      >

        ${
          image
            ? `
              <div class="news-image">
                <a
                  href="${safeURL(url)}"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <img
                    src="${safeURL(image)}"
                    alt="${escapeHTML(title)}"
                    loading="lazy"
                    onerror="this.style.display='none'"
                  >
                </a>
              </div>
            `
            : ""
        }

        <div class="news-content">

          <div class="result-domain">
            ${escapeHTML(source)}
          </div>

          <a
            class="result-title"
            href="${safeURL(url)}"
            target="_blank"
            rel="noopener noreferrer"
          >
            ${escapeHTML(title)}
          </a>

          ${
            date
              ? `
                <div class="result-date">
                  ${escapeHTML(formatDate(date))}
                </div>
              `
              : ""
          }

          ${
            description
              ? `
                <div class="result-description">
                  ${escapeHTML(truncate(description, 280))}
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
   VIDEO RESULTS
   ========================================================= */

function renderVideoResults(items) {
  return `
    <div class="hexora-video-grid">

      ${items.map((item, index) => {
        const video =
          item.video_url ||
          item.video ||
          item.url ||
          "";

        const page =
          item.page_url ||
          item.link ||
          item.url ||
          "#";

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
          <article
            class="hexora-video-card"
            data-result-index="${index}"
          >

            ${
              thumbnail
                ? `
                  <a
                    href="${safeURL(page)}"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="video-thumbnail"
                  >
                    <img
                      src="${safeURL(thumbnail)}"
                      alt="${escapeHTML(title)}"
                      loading="lazy"
                      onerror="this.style.display='none'"
                    >

                    <span class="video-play">
                      ▶
                    </span>
                  </a>
                `
                : `
                  <a
                    href="${safeURL(page)}"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="video-no-thumbnail"
                  >
                    ▶
                  </a>
                `
            }

            <div class="video-title">
              <a
                href="${safeURL(page)}"
                target="_blank"
                rel="noopener noreferrer"
              >
                ${escapeHTML(title)}
              </a>
            </div>

            ${
              description
                ? `
                  <div class="video-description">
                    ${escapeHTML(truncate(description, 180))}
                  </div>
                `
                : ""
            }

          </article>
        `;
      }).join("")}

    </div>
  `;
}


/* =========================================================
   MAP RESULTS
   ========================================================= */

function renderMapResults(items) {
  return items.map((item, index) => {
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
      <article
        class="hexora-result map-result"
        data-result-index="${index}"
      >

        <div style="font-size:24px;margin-bottom:8px;">
          📍
        </div>

        <a
          class="result-title"
          href="${safeURL(url)}"
          target="_blank"
          rel="noopener noreferrer"
        >
          ${escapeHTML(name)}
        </a>

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
          lat != null && lon != null
            ? `
              <div class="result-date">
                ${escapeHTML(String(lat))},
                ${escapeHTML(String(lon))}
              </div>
            `
            : ""
        }

      </article>
    `;
  }).join("");
}


/* =========================================================
   GET DOMAIN
   ========================================================= */

function getDomain(value) {
  try {
    const url = new URL(String(value || ""));

    return url.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}


/* =========================================================
   RENDER RESULTS
   ========================================================= */

function renderResults(items, mode = "web") {
  const container = getResultsContainer();

  if (!container) return;

  if (!items.length) {
    showNoResults(state.query, mode);
    return;
  }

  let html = "";

  if (mode === "images") {
    html = renderImageResults(items);
  } else if (mode === "news") {
    html = renderNewsResults(items);
  } else if (mode === "videos") {
    html = renderVideoResults(items);
  } else if (mode === "maps") {
    html = renderMapResults(items);
  } else {
    html = renderWebResults(items);
  }

  container.innerHTML = `
    <div class="hexora-results-header">
      <div>
        ${escapeHTML(items.length)}
        ${escapeHTML(modeName(mode))}
        result${items.length === 1 ? "" : "s"}
        found
      </div>
    </div>

    ${html}
  `;

  addResultStyles();
}


/* =========================================================
   RESULT STYLES
   ========================================================= */

function addResultStyles() {
  if (document.getElementById("hexoraResultStyle")) {
    return;
  }

  const style = document.createElement("style");

  style.id = "hexoraResultStyle";

  style.textContent = `
    .hexora-results-header {
      margin:10px 0 20px;
      opacity:.65;
      font-size:13px;
    }

    .hexora-result {
      padding:18px 0;
      border-bottom:1px solid rgba(255,255,255,.08);
    }

    .result-domain {
      font-size:12px;
      opacity:.6;
      margin-bottom:5px;
    }

    .result-title {
      display:inline-block;
      font-size:20px;
      font-weight:700;
      text-decoration:none;
      color:inherit;
      margin-bottom:5px;
    }

    .result-title:hover {
      text-decoration:underline;
    }

    .result-url {
      font-size:12px;
      opacity:.5;
      overflow-wrap:anywhere;
      margin-bottom:8px;
    }

    .result-description {
      font-size:14px;
      line-height:1.6;
      opacity:.78;
      max-width:850px;
    }

    .result-date {
      font-size:12px;
      opacity:.55;
      margin:5px 0;
    }

    .hexora-image-grid {
      display:grid;
      grid-template-columns:repeat(auto-fill,minmax(190px,1fr));
      gap:16px;
    }

    .hexora-image-card {
      overflow:hidden;
      border-radius:14px;
      background:rgba(255,255,255,.04);
      border:1px solid rgba(255,255,255,.08);
    }

    .hexora-image-card img {
      width:100%;
      height:180px;
      display:block;
      object-fit:cover;
    }

    .image-card-title {
      padding:10px 10px 3px;
      font-size:14px;
      font-weight:600;
    }

    .image-card-domain {
      padding:3px 10px 12px;
      font-size:11px;
      opacity:.55;
    }

    .hexora-video-grid {
      display:grid;
      grid-template-columns:repeat(auto-fill,minmax(260px,1fr));
      gap:18px;
    }

    .hexora-video-card {
      overflow:hidden;
      border-radius:14px;
      background:rgba(255,255,255,.04);
      border:1px solid rgba(255,255,255,.08);
    }

    .video-thumbnail {
      position:relative;
      display:block;
      height:170px;
      overflow:hidden;
    }

    .video-thumbnail img {
      width:100%;
      height:100%;
      object-fit:cover;
    }

    .video-play {
      position:absolute;
      left:50%;
      top:50%;
      transform:translate(-50%,-50%);
      width:48px;
      height:48px;
      border-radius:50%;
      display:flex;
      align-items:center;
      justify-content:center;
      background:rgba(0,0,0,.7);
      color:white;
      font-size:20px;
    }

    .video-no-thumbnail {
      height:170px;
      display:flex;
      align-items:center;
      justify-content:center;
      font-size:50px;
      text-decoration:none;
    }

    .video-title {
      padding:12px 12px 4px;
      font-weight:700;
    }

    .video-title a {
      color:inherit;
      text-decoration:none;
    }

    .video-description {
      padding:4px 12px 14px;
      opacity:.65;
      font-size:13px;
    }

    .news-result {
      display:flex;
      gap:16px;
    }

    .news-image {
      flex:0 0 180px;
    }

    .news-image img {
      width:180px;
      height:110px;
      object-fit:cover;
      border-radius:10px;
    }

    .news-content {
      flex:1;
      min-width:0;
    }

    @media(max-width:600px) {

      .hexora-image-grid {
        grid-template-columns:repeat(2,minmax(0,1fr));
        gap:10px;
      }

      .hexora-image-card img {
        height:130px;
      }

      .hexora-video-grid {
        grid-template-columns:1fr;
      }

      .news-result {
        display:block;
      }

      .news-image {
        margin-bottom:10px;
      }

      .news-image img {
        width:100%;
        height:180px;
      }

      .result-title {
        font-size:18px;
      }
    }
  `;

  document.head.appendChild(style);
}


/* =========================================================
   UPDATE MODE BUTTONS
   ========================================================= */

function updateModeButtons(mode) {
  $$("[data-mode]").forEach(button => {
    const buttonMode =
      String(button.dataset.mode || "").toLowerCase();

    button.classList.toggle(
      "active",
      buttonMode === mode
    );

    button.setAttribute(
      "aria-selected",
      buttonMode === mode ? "true" : "false"
    );
  });
}


/* =========================================================
   MAIN SEARCH FUNCTION
   ========================================================= */

async function doSearch(query, mode = "web") {
  query = String(query || "").trim();

  mode = String(mode || "web").toLowerCase();

  const allowedModes = [
    "web",
    "images",
    "news",
    "videos",
    "maps"
  ];

  if (!allowedModes.includes(mode)) {
    mode = "web";
  }

  state.query = query;
  state.mode = mode;

  if (!query) {
    showHomeView();
    return;
  }

  /*
   * MAPS
   *
   * Maps mode uses the map interface.
   */
  if (mode === "maps") {
    showMapView();
    updateModeButtons(mode);

    await searchMapLocation(query);

    return;
  }

  showSearchView();

  updateModeButtons(mode);

  showSearching(query, mode);

  try {

    /*
     * IMPORTANT:
     *
     * The selected mode is explicitly sent to server.mjs:
     *
     * /api/search?q=Google&mode=images
     * /api/search?q=Google&mode=news
     * /api/search?q=Google&mode=videos
     * /api/search?q=Google&mode=web
     *
     * This is the main fix.
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

    const data = await fetchJSON(url);

    const items = normalizeResults(data);

    console.log(
      "[HEXORA RESULTS]",
      mode,
      items.length,
      data
    );

    if (!items.length) {
      showNoResults(query, mode);
      return;
    }

    renderResults(items, mode);

  } catch (error) {
    console.error(
      "[HEXORA SEARCH ERROR]",
      error
    );

    showSearchError(error);
  }
}


/* =========================================================
   SET MODE
   ========================================================= */

async function setMode(mode) {
  mode = String(mode || "web").toLowerCase();

  const allowedModes = [
    "web",
    "images",
    "news",
    "videos",
    "maps"
  ];

  if (!allowedModes.includes(mode)) {
    return;
  }

  state.mode = mode;

  updateModeButtons(mode);

  /*
   * If Maps selected, open map.
   */

  if (mode === "maps") {
    showMapView();

    if (state.query) {
      await searchMapLocation(state.query);
    } else {
      await initMap();
    }

    return;
  }

  /*
   * Other modes use the same search query.
   */

  if (state.query) {
    await doSearch(
      state.query,
      mode
    );

    return;
  }

  showSearchView();

  const input = getSearchInput();

  if (input) {
    input.focus();
  }
}


/* =========================================================
   SEARCH FORM
   ========================================================= */

function setupSearch() {
  const form =
    $("#searchForm") ||
    document.querySelector("form.search-box");

  if (!form) {
    console.warn(
      "[HEXORA] Search form not found."
    );

    return;
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();

    const input =
      form.querySelector("#searchInput") ||
      form.querySelector('input[name="q"]') ||
      form.querySelector('input[type="search"]');

    const query =
      input?.value?.trim() || "";

    if (!query) {
      if (input) input.focus();
      return;
    }

    await doSearch(
      query,
      state.mode || "web"
    );

    updateURL();
  });
}


/* =========================================================
   MODE BUTTONS
   ========================================================= */

function setupModes() {
  /*
   * IMPORTANT:
   *
   * We use ALL [data-mode] buttons.
   *
   * This fixes sidebar + hero mode buttons.
   */

  $$("[data-mode]").forEach(button => {
    button.addEventListener("click", async event => {
      event.preventDefault();

      const mode =
        String(button.dataset.mode || "")
          .toLowerCase();

      if (!mode) return;

      await setMode(mode);

      updateURL();
    });
  });
}


/* =========================================================
   HOME BUTTONS
   ========================================================= */

function setupHomeButtons() {
  $$("[data-home]").forEach(button => {
    button.addEventListener("click", event => {
      event.preventDefault();

      state.query = "";
      state.mode = "web";

      updateModeButtons("web");

      showHomeView();

      const input = getSearchInput();

      if (input) {
        input.value = "";
      }

      history.replaceState(
        {},
        "",
        window.location.pathname
      );
    });
  });
}


/* =========================================================
   KEYBOARD
   ========================================================= */

function setupKeyboard() {
  document.addEventListener("keydown", event => {

    /*
     * "/" focuses search
     */

    if (
      event.key === "/" &&
      !["INPUT", "TEXTAREA"].includes(
        document.activeElement?.tagName
      )
    ) {
      event.preventDefault();

      const input = getSearchInput();

      if (input) {
        input.focus();
      }
    }

    /*
     * Escape clears focus
     */

    if (event.key === "Escape") {
      const input = getSearchInput();

      if (input) {
        input.blur();
      }
    }
  });
}


/* =========================================================
   NEWS FEED
   ========================================================= */

async function loadNews() {
  /*
   * This is only for a dedicated latest-news area
   * if the HTML contains #newsFeed.
   */

  const feed =
    $("#newsFeed") ||
    $(".news-feed");

  if (!feed) {
    return;
  }

  try {
    feed.innerHTML = `
      <div style="padding:20px;text-align:center;">
        Loading news…
      </div>
    `;

    const data = await fetchJSON(
      `${CONFIG.newsEndpoint}`
    );

    const items = normalizeResults(data);

    if (!items.length) {
      feed.innerHTML = `
        <div style="padding:20px;text-align:center;">
          No data found
        </div>
      `;

      return;
    }

    feed.innerHTML = renderNewsResults(items);

  } catch (error) {
    console.error(
      "[HEXORA NEWS]",
      error
    );

    feed.innerHTML = `
      <div style="padding:20px;text-align:center;">
        Unable to load news.
      </div>
    `;
  }
}


/* =========================================================
   MAP - LOAD MAPLIBRE
   ========================================================= */

function loadMapLibre() {
  return new Promise((resolve, reject) => {

    if (window.maplibregl) {
      resolve(window.maplibregl);
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
      link.href = CONFIG.mapLibreCSS;

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
        () => resolve(window.maplibregl)
      );

      existing.addEventListener(
        "error",
        reject
      );

      return;
    }

    const script =
      document.createElement("script");

    script.src = CONFIG.mapLibreJS;
    script.async = true;

    script.onload = () => {
      if (window.maplibregl) {
        resolve(window.maplibregl);
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

    document.head.appendChild(script);
  });
}


/* =========================================================
   MAP INITIALIZATION
   ========================================================= */

async function initMap() {
  if (state.mapReady && state.map) {
    setTimeout(() => {
      state.map.resize();
    }, 100);

    return state.map;
  }

  const mapContainer =
    $("#map") ||
    $("#mapContainer") ||
    $(".map-container");

  if (!mapContainer) {
    console.warn(
      "[HEXORA MAP] Map container not found."
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
        container: mapContainer,
        style: {
          version: 8,

          sources: {
            "osm-tiles": {
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

    state.map.on(
      "load",
      () => {
        state.mapReady = true;

        setTimeout(() => {
          state.map.resize();
        }, 100);
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

async function searchMapLocation(query) {
  const map =
    await initMap();

  if (!map) {
    return;
  }

  try {

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

    const results =
      await response.json();

    if (!Array.isArray(results) || !results.length) {
      console.warn(
        "[HEXORA MAP] No location found."
      );

      return;
    }

    const result =
      results[0];

    const lat =
      Number(result.lat);

    const lon =
      Number(result.lon);

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon)
    ) {
      return;
    }

    state.lastLocation = {
      lat,
      lon,
      name:
        result.display_name || query
    };

    /*
     * Remove previous search marker
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
            }).setHTML(`
              <strong>
                ${escapeHTML(
                  result.display_name || query
                )}
              </strong>
            `)
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

  } catch (error) {
    console.error(
      "[HEXORA MAP SEARCH]",
      error
    );
  }
}


/* =========================================================
   USER LOCATION
   ========================================================= */

function getUserLocation() {
  if (!navigator.geolocation) {
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

      state.lastLocation = {
        lat,
        lon,
        name: "Your location"
      };

      showMapView();

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


/* =========================================================
   MAP BUTTONS
   ========================================================= */

function setupMapButtons() {

  const locationButtons =
    $$(
      "#myLocationBtn, " +
      "#locateMeBtn, " +
      "[data-map-location]"
    );

  locationButtons.forEach(button => {
    button.addEventListener(
      "click",
      event => {
        event.preventDefault();

        getUserLocation();
      }
    );
  });


  const satelliteButtons =
    $$(
      "#satelliteMapBtn, " +
      "[data-map-satellite]"
    );

  satelliteButtons.forEach(button => {
    button.addEventListener(
      "click",
      event => {
        event.preventDefault();

        /*
         * Satellite layer depends on
         * a configured tile source.
         *
         * Do not fake satellite data.
         */

        alert(
          "Satellite layer is not configured yet."
        );
      }
    );
  });


  const threeDButtons =
    $$(
      "#3dMapBtn, " +
      "[data-map-3d]"
    );

  threeDButtons.forEach(button => {
    button.addEventListener(
      "click",
      event => {
        event.preventDefault();

        if (!state.map) {
          return;
        }

        const currentPitch =
          state.map.getPitch();

        state.map.easeTo({
          pitch:
            currentPitch > 20
              ? 0
              : 60,
          bearing:
            state.map.getBearing()
        });
      }
    );
  });
}


/* =========================================================
   FEATURE BUTTONS
   ========================================================= */

function setupFeatureButtons() {

  /*
   * Any element with data-search-query
   * can launch a search.
   */

  $$("[data-search-query]")
    .forEach(button => {

      button.addEventListener(
        "click",
        async event => {

          event.preventDefault();

          const query =
            button.dataset.searchQuery
              ?.trim();

          if (!query) return;

          const mode =
            button.dataset.mode ||
            "web";

          const input =
            getSearchInput();

          if (input) {
            input.value = query;
          }

          await doSearch(
            query,
            mode
          );

          updateURL();
        }
      );
    });
}


/* =========================================================
   URL STATE
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


async function restoreFromURL() {
  const params =
    new URLSearchParams(
      window.location.search
    );

  const query =
    params.get("q")?.trim() || "";

  const mode =
    params.get("mode")?.toLowerCase() ||
    "web";

  if (!query) {
    showHomeView();

    return;
  }

  const input =
    getSearchInput();

  if (input) {
    input.value = query;
  }

  await doSearch(
    query,
    mode
  );
}


/* =========================================================
   POPSTATE
   ========================================================= */

function setupHistory() {
  window.addEventListener(
    "popstate",
    () => {
      restoreFromURL();
    }
  );
}


/* =========================================================
   GLOBAL API
   ========================================================= */

window.hexoraSearch =
  async function (
    query,
    mode = "web"
  ) {

    const input =
      getSearchInput();

    if (input) {
      input.value =
        String(query || "");
    }

    await doSearch(
      query,
      mode
    );

    updateURL();
  };


window.hexoraSetMode =
  async function (mode) {
    await setMode(mode);

    updateURL();
  };


window.hexoraCurrentState =
  function () {
    return {
      query: state.query,
      mode: state.mode
    };
  };


/* =========================================================
   INITIALIZATION
   ========================================================= */

async function initHEXORA() {

  console.log(
    "%cHEXORA",
    "font-size:28px;font-weight:bold;"
  );

  console.log(
    "[HEXORA] Initializing search engine..."
  );

  setupSearch();

  setupModes();

  setupHomeButtons();

  setupKeyboard();

  setupMapButtons();

  setupFeatureButtons();

  setupHistory();

  updateModeButtons(
    state.mode
  );

  /*
   * Add result styles immediately.
   */

  addResultStyles();

  /*
   * Restore search from URL.
   */

  await restoreFromURL();

  /*
   * Latest news feed if present.
   */

  loadNews();

  console.log(
    "[HEXORA] Ready."
  );
}


/* =========================================================
   START
   ========================================================= */

if (
  document.readyState === "loading"
) {
  document.addEventListener(
    "DOMContentLoaded",
    initHEXORA,
    { once: true }
  );
} else {
  initHEXORA();
}
