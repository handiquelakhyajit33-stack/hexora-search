const app =
  document.getElementById("app");

const params =
  new URLSearchParams(
    window.location.search
  );

let currentQuery =
  params.get("q") || "";

let currentMode =
  params.get("mode") || "web";

const allowedModes = [
  "web",
  "images",
  "news",
  "videos",
  "maps"
];

if (
  !allowedModes.includes(
    currentMode
  )
) {
  currentMode = "web";
}

/* -------------------------------------------------------
   PAGE
------------------------------------------------------- */

app.innerHTML = `
<div class="hexora-app">

  <header class="topbar">

    <div class="brand">
      <a href="/" class="logo">
        HEXORA
      </a>
    </div>

    <nav class="nav">
      <a href="?mode=web">Web</a>
      <a href="?mode=images">Images</a>
      <a href="?mode=news">News</a>
      <a href="?mode=videos">Videos</a>
      <a href="?mode=maps">Maps</a>
    </nav>

  </header>

  <main>

    <section class="search-section">

      <div class="search-box">

        <input
          id="searchInput"
          type="search"
          autocomplete="off"
          placeholder="Search HEXORA..."
        />

        <button
          id="clearBtn"
          type="button"
          aria-label="Clear"
        >
          ×
        </button>

        <button
          id="searchBtn"
          type="button"
        >
          Search
        </button>

      </div>

      <div class="search-tabs">

        <button
          class="search-tab"
          data-mode="web"
        >
          Web
        </button>

        <button
          class="search-tab"
          data-mode="images"
        >
          Images
        </button>

        <button
          class="search-tab"
          data-mode="news"
        >
          News
        </button>

        <button
          class="search-tab"
          data-mode="videos"
        >
          Videos
        </button>

        <button
          class="search-tab"
          data-mode="maps"
        >
          Maps
        </button>

      </div>

    </section>

    <section
      id="status"
      class="status"
    ></section>

    <section
      id="results"
      class="results"
    ></section>

  </main>

</div>
`;

/* -------------------------------------------------------
   ELEMENTS
------------------------------------------------------- */

const searchInput =
  document.getElementById(
    "searchInput"
  );

const searchBtn =
  document.getElementById(
    "searchBtn"
  );

const clearBtn =
  document.getElementById(
    "clearBtn"
  );

const results =
  document.getElementById(
    "results"
  );

const status =
  document.getElementById(
    "status"
  );

const tabs =
  document.querySelectorAll(
    ".search-tab"
  );

/* -------------------------------------------------------
   STYLE
------------------------------------------------------- */

const style =
  document.createElement(
    "style"
  );

style.textContent = `
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family:
    Arial,
    Helvetica,
    sans-serif;
  background: #fff;
  color: #202124;
}

.hexora-app {
  min-height: 100vh;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 28px;
  border-bottom: 1px solid #eee;
}

.logo {
  text-decoration: none;
  color: #111;
  font-size: 25px;
  font-weight: 800;
  letter-spacing: 1px;
}

.nav {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
}

.nav a {
  color: #555;
  text-decoration: none;
  font-size: 14px;
}

.nav a:hover {
  color: #111;
}

main {
  width: min(1100px, 94%);
  margin: 0 auto;
}

.search-section {
  padding-top: 25px;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: 1px solid #dfe1e5;
  border-radius: 30px;
  padding: 6px 8px 6px 18px;
  box-shadow:
    0 1px 4px rgba(0,0,0,.08);
}

.search-box input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  font-size: 17px;
  background: transparent;
  padding: 10px 0;
}

.search-box button {
  border: 0;
  cursor: pointer;
}

#clearBtn {
  background: transparent;
  font-size: 25px;
  color: #777;
}

#searchBtn {
  border-radius: 22px;
  padding: 10px 18px;
  background: #111;
  color: #fff;
}

.search-tabs {
  display: flex;
  gap: 22px;
  overflow-x: auto;
  padding: 18px 5px 0;
  border-bottom: 1px solid #eee;
}

.search-tab {
  background: transparent;
  border: 0;
  padding: 10px 2px;
  color: #666;
  cursor: pointer;
  white-space: nowrap;
  font-size: 14px;
}

.search-tab.active {
  color: #111;
  border-bottom: 3px solid #111;
  font-weight: 700;
}

.status {
  padding: 18px 4px 5px;
  color: #666;
  font-size: 14px;
}

.results {
  padding: 10px 4px 50px;
}

.web-result {
  padding: 18px 0;
  border-bottom: 1px solid #eee;
}

.web-result h2 {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 500;
}

.web-result h2 a {
  color: #1a0dab;
  text-decoration: none;
}

.web-result h2 a:hover {
  text-decoration: underline;
}

.result-url {
  color: #188038;
  font-size: 13px;
  margin-bottom: 6px;
  word-break: break-all;
}

.result-description {
  color: #4d5156;
  line-height: 1.55;
  font-size: 14px;
}

.result-meta {
  margin-top: 8px;
  color: #777;
  font-size: 12px;
}

.image-grid {
  display: grid;
  grid-template-columns:
    repeat(4, minmax(0, 1fr));
  gap: 15px;
  padding-top: 10px;
}

.image-card {
  border: 1px solid #eee;
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
}

.image-card img {
  width: 100%;
  height: 180px;
  object-fit: cover;
  display: block;
}

.image-card-body {
  padding: 10px;
}

.image-card-title {
  font-size: 14px;
  line-height: 1.4;
}

.image-card a {
  color: inherit;
  text-decoration: none;
}

.news-result {
  padding: 16px 0;
  border-bottom: 1px solid #eee;
}

.news-result h2 {
  margin: 0 0 7px;
  font-size: 19px;
  font-weight: 600;
}

.news-result h2 a {
  color: #1a0dab;
  text-decoration: none;
}

.news-source {
  color: #188038;
  font-size: 13px;
  margin-bottom: 6px;
}

.news-date {
  color: #777;
  font-size: 12px;
  margin-bottom: 7px;
}

.video-result {
  padding: 17px 0;
  border-bottom: 1px solid #eee;
}

.video-result h2 {
  margin: 0 0 7px;
  font-size: 19px;
}

.video-result h2 a {
  color: #1a0dab;
  text-decoration: none;
}

.map-result {
  padding: 17px 0;
  border-bottom: 1px solid #eee;
}

.map-result h2 {
  margin: 0 0 7px;
  font-size: 19px;
}

.map-result h2 a {
  color: #1a0dab;
  text-decoration: none;
}

.empty {
  padding: 45px 10px;
  text-align: center;
  color: #666;
}

.error {
  padding: 25px 0;
  color: #b00020;
}

@media (max-width: 700px) {

  .topbar {
    padding: 15px;
    align-items: flex-start;
    gap: 15px;
    flex-direction: column;
  }

  .nav {
    gap: 15px;
    width: 100%;
    overflow-x: auto;
  }

  main {
    width: 94%;
  }

  .search-box {
    padding-left: 14px;
  }

  #searchBtn {
    padding: 9px 13px;
  }

  .search-tabs {
    gap: 18px;
  }

  .image-grid {
    grid-template-columns:
      repeat(2, minmax(0, 1fr));
  }

  .image-card img {
    height: 145px;
  }

  .web-result h2,
  .news-result h2,
  .video-result h2,
  .map-result h2 {
    font-size: 17px;
  }
}
`;

document.head.appendChild(style);

/* -------------------------------------------------------
   HELPERS
------------------------------------------------------- */

function setActiveTab(
  mode
) {
  tabs.forEach(tab => {
    tab.classList.toggle(
      "active",
      tab.dataset.mode === mode
    );
  });
}

function updateUrl(
  query,
  mode
) {
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

  url.searchParams.set(
    "mode",
    mode
  );

  window.history.replaceState(
    {},
    "",
    url
  );
}

function escapeHtml(
  value
) {
  return String(
    value || ""
  )
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll(
      "'",
      "&#039;"
    );
}

function formatDate(
  value
) {
  if (!value) return "";

  const date =
    new Date(value);

  if (
    !Number.isFinite(
      date.getTime()
    )
  ) {
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

/* -------------------------------------------------------
   WEB RENDERER
------------------------------------------------------- */

function renderWeb(
  items
) {
  if (!items.length) {
    return `
      <div class="empty">
        No relevant web results found.
      </div>
    `;
  }

  return items.map(item => {

    const title =
      escapeHtml(
        item.title ||
        "Untitled"
      );

    const description =
      escapeHtml(
        item.description ||
        ""
      );

    const url =
      escapeHtml(
        item.url || ""
      );

    return `
      <article class="web-result">

        <h2>
          <a
            href="${url}"
            target="_blank"
            rel="noopener noreferrer"
          >
            ${title}
          </a>
        </h2>

        <div class="result-url">
          ${url}
        </div>

        <div class="result-description">
          ${description}
        </div>

        ${
          item.published_at
            ? `
              <div class="result-meta">
                ${escapeHtml(
                  formatDate(
                    item.published_at
                  )
                )}
              </div>
            `
            : ""
        }

      </article>
    `;
  }).join("");
}

/* -------------------------------------------------------
   IMAGE RENDERER
------------------------------------------------------- */

function renderImages(
  items
) {
  if (!items.length) {
    return `
      <div class="empty">
        No indexed images found for this search.
      </div>
    `;
  }

  return `
    <div class="image-grid">

      ${items.map(item => {

        const image =
          escapeHtml(
            item.image_url
          );

        const title =
          escapeHtml(
            item.title ||
            "Image"
          );

        const url =
          escapeHtml(
            item.url || "#"
          );

        return `
          <article
            class="image-card"
          >

            <a
              href="${url}"
              target="_blank"
              rel="noopener noreferrer"
            >

              <img
                src="${image}"
                alt="${title}"
                loading="lazy"
                onerror="this.parentElement.parentElement.style.display='none'"
              />

              <div
                class="image-card-body"
              >
                <div
                  class="image-card-title"
                >
                  ${title}
                </div>
              </div>

            </a>

          </article>
        `;
      }).join("")}

    </div>
  `;
}

/* -------------------------------------------------------
   NEWS RENDERER
------------------------------------------------------- */

function renderNews(
  items
) {
  if (!items.length) {
    return `
      <div class="empty">
        No relevant news found.
      </div>
    `;
  }

  return items.map(item => {

    const title =
      escapeHtml(
        item.title ||
        "News"
      );

    const description =
      escapeHtml(
        item.description ||
        ""
      );

    const url =
      escapeHtml(
        item.url || ""
      );

    const source =
      escapeHtml(
        item.source_name ||
        item.source_domain ||
        ""
      );

    const date =
      escapeHtml(
        formatDate(
          item.published_at
        )
      );

    return `
      <article
        class="news-result"
      >

        <h2>
          <a
            href="${url}"
            target="_blank"
            rel="noopener noreferrer"
          >
            ${title}
          </a>
        </h2>

        ${
          source
            ? `
              <div class="news-source">
                ${source}
              </div>
            `
            : ""
        }

        ${
          date
            ? `
              <div class="news-date">
                ${date}
              </div>
            `
            : ""
        }

        <div
          class="result-description"
        >
          ${description}
        </div>

      </article>
    `;
  }).join("");
}

/* -------------------------------------------------------
   VIDEO RENDERER
------------------------------------------------------- */

function renderVideos(
  items
) {
  if (!items.length) {
    return `
      <div class="empty">
        No indexed video results found.
      </div>
    `;
  }

  return items.map(item => {

    const title =
      escapeHtml(
        item.title ||
        "Video"
      );

    const description =
      escapeHtml(
        item.description ||
        ""
      );

    const url =
      escapeHtml(
        item.url || ""
      );

    return `
      <article
        class="video-result"
      >

        <h2>
          <a
            href="${url}"
            target="_blank"
            rel="noopener noreferrer"
          >
            ${title}
          </a>
        </h2>

        <div class="result-url">
          ${url}
        </div>

        <div
          class="result-description"
        >
          ${description}
        </div>

      </article>
    `;
  }).join("");
}

/* -------------------------------------------------------
   MAP RENDERER
------------------------------------------------------- */

function renderMaps(
  items
) {
  if (!items.length) {
    return `
      <div class="empty">
        No indexed place/location results found.
      </div>
    `;
  }

  return items.map(item => {

    const title =
      escapeHtml(
        item.title ||
        "Place"
      );

    const description =
      escapeHtml(
        item.description ||
        ""
      );

    const url =
      escapeHtml(
        item.url || ""
      );

    return `
      <article
        class="map-result"
      >

        <h2>
          <a
            href="${url}"
            target="_blank"
            rel="noopener noreferrer"
          >
            ${title}
          </a>
        </h2>

        <div class="result-url">
          ${url}
        </div>

        <div
          class="result-description"
        >
          ${description}
        </div>

      </article>
    `;
  }).join("");
}

/* -------------------------------------------------------
   SEARCH
------------------------------------------------------- */

async function doSearch(
  query,
  mode = currentMode
) {
  query =
    String(query || "")
      .trim();

  mode =
    allowedModes.includes(mode)
      ? mode
      : "web";

  currentQuery = query;
  currentMode = mode;

  searchInput.value =
    query;

  setActiveTab(mode);

  updateUrl(
    query,
    mode
  );

  if (!query) {
    status.textContent = "";
    results.innerHTML = `
      <div class="empty">
        Type something to search HEXORA.
      </div>
    `;
    return;
  }

  status.textContent =
    `Searching ${mode}...`;

  results.innerHTML = "";

  try {

    const response =
      await fetch(
        `/api/search?q=${encodeURIComponent(
          query
        )}&mode=${encodeURIComponent(
          mode
        )}&page=1&limit=30`
      );

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    const data =
      await response.json();

    if (!data.ok) {
      throw new Error(
        data.error ||
        "Search failed"
      );
    }

    const items =
      Array.isArray(
        data.results
      )
        ? data.results
        : [];

    status.textContent =
      `${data.total || items.length} results for "${query}"`;

    if (mode === "web") {
      results.innerHTML =
        renderWeb(items);
    }

    else if (
      mode === "images"
    ) {
      results.innerHTML =
        renderImages(items);
    }

    else if (
      mode === "news"
    ) {
      results.innerHTML =
        renderNews(items);
    }

    else if (
      mode === "videos"
    ) {
      results.innerHTML =
        renderVideos(items);
    }

    else if (
      mode === "maps"
    ) {
      results.innerHTML =
        renderMaps(items);
    }

  } catch (error) {

    console.error(
      "HEXORA search error:",
      error
    );

    status.textContent = "";

    results.innerHTML = `
      <div class="error">
        HEXORA search service error.
        Please try again.
      </div>
    `;
  }
}

/* -------------------------------------------------------
   EVENTS
------------------------------------------------------- */

searchBtn.addEventListener(
  "click",
  () => {
    doSearch(
      searchInput.value,
      currentMode
    );
  }
);

searchInput.addEventListener(
  "keydown",
  event => {
    if (
      event.key ===
      "Enter"
    ) {
      event.preventDefault();

      doSearch(
        searchInput.value,
        currentMode
      );
    }
  }
);

clearBtn.addEventListener(
  "click",
  () => {
    searchInput.value = "";
    currentQuery = "";

    updateUrl(
      "",
      currentMode
    );

    status.textContent = "";

    results.innerHTML = `
      <div class="empty">
        Type something to search HEXORA.
      </div>
    `;

    searchInput.focus();
  }
);

tabs.forEach(tab => {

  tab.addEventListener(
    "click",
    () => {

      const mode =
        tab.dataset.mode;

      const query =
        searchInput.value.trim();

      currentMode = mode;

      setActiveTab(mode);

      if (query) {
        doSearch(
          query,
          mode
        );
      } else {
        updateUrl(
          "",
          mode
        );

        status.textContent =
          `HEXORA ${mode} search`;

        results.innerHTML = `
          <div class="empty">
            Search in ${mode}.
          </div>
        `;
      }
    }
  );

});

/* -------------------------------------------------------
   INITIAL LOAD
------------------------------------------------------- */

setActiveTab(
  currentMode
);

if (currentQuery) {
  doSearch(
    currentQuery,
    currentMode
  );
} else {
  results.innerHTML = `
    <div class="empty">
      Search the web with HEXORA.
    </div>
  `;
}
