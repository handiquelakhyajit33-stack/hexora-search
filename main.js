const app = document.getElementById("app");

app.innerHTML = `
<div class="hexora-app">

  <header class="topbar">
    <a class="logo" href="/">
      <span class="logo-mark">O</span>
      <span>HEXORA</span>
    </a>

    <nav class="main-nav">
      <a class="active" href="/">⌂ <span>Home</span></a>
      <a href="?mode=ai">✦ <span>AI</span></a>
      <a href="?mode=web">◉ <span>Web</span></a>
      <a href="?mode=images">▧ <span>Images</span></a>
      <a href="?mode=news">▤ <span>News</span></a>
      <a href="?mode=videos">▶ <span>Videos</span></a>
      <a href="?mode=maps">⌖ <span>Maps</span></a>
      <a href="?mode=shopping">▢ <span>Shopping</span></a>
    </nav>

    <div class="top-actions">
      <span class="india">🇮🇳</span>
      <button id="themeBtn" class="icon-btn" aria-label="Theme">☾</button>
      <button id="menuBtn" class="icon-btn" aria-label="Menu">☰</button>
    </div>
  </header>

  <main>

    <!-- HOME -->
    <section id="homePage" class="home-page">

      <div class="hero">

        <div class="hero-overlay"></div>

        <div class="hero-content">

          <div class="hero-logo">
            HEX<span>O</span>RA
          </div>

          <div class="tagline">
            SEARCH THE WORLD
          </div>

          <form id="searchForm" class="main-search">

            <span class="search-icon">⌕</span>

            <input
              id="q"
              type="search"
              autocomplete="off"
              placeholder="Search anything..."
              aria-label="Search HEXORA"
            />

            <button
              type="button"
              id="clearBtn"
              class="clear-btn"
              hidden
            >×</button>

            <button
              type="button"
              id="voiceBtn"
              class="voice-btn"
              aria-label="Voice search"
            >🎙</button>

            <button
              type="submit"
              class="search-btn"
              aria-label="Search"
            >→</button>

          </form>

          <div class="search-modes">

            <button data-mode="web" class="mode active">
              ◉ Web
            </button>

            <button data-mode="ai" class="mode">
              ✦ AI
            </button>

            <button data-mode="images" class="mode">
              ▧ Images
            </button>

            <button data-mode="news" class="mode">
              ▤ News
            </button>

            <button data-mode="videos" class="mode">
              ▶ Videos
            </button>

            <button data-mode="maps" class="mode">
              ⌖ Maps
            </button>

            <button data-mode="shopping" class="mode">
              ▢ Shopping
            </button>

          </div>

          <div class="trending">
            <strong>🔥 Trending</strong>

            <button>Assam news</button>
            <button>AI tools</button>
            <button>Python</button>
            <button>India news</button>
            <button>Travel Assam</button>
            <button>Education</button>
            <button>Cricket</button>
          </div>

        </div>
      </div>

      <section class="home-content">

        <div class="feature-grid">

          <button class="feature-card ai-card" data-mode="ai">
            <div class="feature-icon">✦</div>
            <div>
              <h3>HEXORA AI</h3>
              <p>Ask questions and explore information.</p>
            </div>
            <span>→</span>
          </button>

          <button class="feature-card image-card" data-mode="images">
            <div class="feature-icon">▧</div>
            <div>
              <h3>Images</h3>
              <p>Explore images from the web.</p>
            </div>
            <span>→</span>
          </button>

          <button class="feature-card shopping-card" data-mode="shopping">
            <div class="feature-icon">▢</div>
            <div>
              <h3>Shopping</h3>
              <p>Discover products and prices.</p>
            </div>
            <span>→</span>
          </button>

        </div>

        <div class="home-columns">

          <section class="home-panel">
            <div class="panel-head">
              <h2>▤ Latest News</h2>
              <button id="newsLink">View all →</button>
            </div>

            <div id="newsList">
              <div class="loading">
                Loading latest news...
              </div>
            </div>
          </section>

          <section class="home-panel explore-panel">

            <div class="explore-image">
              <div class="explore-overlay">
                <span>🇮🇳 INDIA</span>
                <h2>Explore with HEXORA</h2>
                <p>
                  Search information, places, news and more.
                </p>
              </div>
            </div>

            <div class="related-home">
              <strong>⌕ Popular searches</strong>

              <button>Assam tourism</button>
              <button>AI tools</button>
              <button>Python tutorial</button>
              <button>India news</button>
              <button>Latest technology</button>
              <button>Cricket</button>
            </div>

          </section>

        </div>

      </section>

    </section>

    <!-- SEARCH PAGE -->
    <section id="searchPage" class="search-page">

      <div class="results-header">

        <form id="resultsSearchForm" class="results-search">

          <span>⌕</span>

          <input
            id="resultsInput"
            type="search"
            autocomplete="off"
            placeholder="Search HEXORA..."
          />

          <button
            type="button"
            id="resultsClear"
          >×</button>

          <button type="submit">→</button>

        </form>

        <div class="results-tabs">

          <button data-mode="web" class="result-tab active">
            All
          </button>

          <button data-mode="web" class="result-tab">
            Web
          </button>

          <button data-mode="ai" class="result-tab">
            AI
          </button>

          <button data-mode="images" class="result-tab">
            Images
          </button>

          <button data-mode="news" class="result-tab">
            News
          </button>

          <button data-mode="videos" class="result-tab">
            Videos
          </button>

          <button data-mode="maps" class="result-tab">
            Maps
          </button>

          <button data-mode="shopping" class="result-tab">
            Shopping
          </button>

        </div>

      </div>

      <div class="results-layout">

        <section class="results-main">

          <div id="resultMeta" class="result-meta"></div>

          <div id="results">

            <div class="search-loading">
              <div class="spinner"></div>
              <b>Searching HEXORA...</b>
              <span>Finding relevant results</span>
            </div>

          </div>

        </section>

        <aside class="results-side">

          <div class="side-card ai-side">

            <div class="side-title">
              ✦ HEXORA AI
            </div>

            <p>
              Ask HEXORA about your search.
            </p>

            <button id="aiAskBtn">
              Ask HEXORA AI →
            </button>

          </div>

          <div class="side-card">

            <div class="side-title">
              🔥 Popular
            </div>

            <button class="side-search">Python tutorial</button>
            <button class="side-search">AI tools</button>
            <button class="side-search">Assam news</button>
            <button class="side-search">Travel Assam</button>

          </div>

          <div class="side-card shopping-side">

            <div class="side-title">
              ▢ Shopping
            </div>

            <p>
              Search products with HEXORA.
            </p>

            <button data-mode="shopping">
              Explore Shopping →
            </button>

          </div>

        </aside>

      </div>

    </section>

  </main>

  <footer>

    <div class="footer-brand">
      <div class="footer-logo">HEXORA</div>
      <small>🇮🇳 Made in India</small>
    </div>

    <div class="footer-links">
      <a href="#about">About</a>
      <a href="#support">Support</a>
      <a href="#privacy">Privacy</a>
      <a href="#terms">Terms</a>
      <a href="#contact">Contact</a>
      <a href="#help">Help</a>
    </div>

    <div class="footer-copy">
      Better Search. Brighter Future.
    </div>

  </footer>

</div>
`;

const style = document.createElement("style");

style.textContent = `

* {
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
}

body {
  margin: 0;
  font-family:
    Inter,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    Arial,
    sans-serif;

  background: #f7f9fd;
  color: #102347;
}

button,
input {
  font: inherit;
}

button {
  cursor: pointer;
}

a {
  color: inherit;
}

/* TOP BAR */

.topbar {
  height: 68px;
  background: rgba(255,255,255,.96);
  backdrop-filter: blur(18px);
  border-bottom: 1px solid #e6ebf3;

  display: flex;
  align-items: center;

  padding: 0 30px;
  gap: 28px;

  position: sticky;
  top: 0;
  z-index: 100;
}

.logo {
  text-decoration: none;
  display: flex;
  align-items: center;
  gap: 7px;

  font-size: 24px;
  font-weight: 900;
  letter-spacing: -1px;

  min-width: 150px;
}

.logo-mark {
  width: 25px;
  height: 25px;

  border: 6px solid #2767ff;
  border-radius: 8px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  color: transparent;

  transform: rotate(45deg);
}

.logo-mark::after {
  content: "";
  width: 7px;
  height: 7px;
  background: #9b63ff;
  border-radius: 2px;
}

.main-nav {
  display: flex;
  justify-content: center;
  align-items: center;

  gap: 20px;
  flex: 1;

  height: 100%;
}

.main-nav a {
  text-decoration: none;
  font-size: 12px;
  color: #51627d;

  display: flex;
  align-items: center;
  gap: 4px;

  height: 100%;

  border-bottom: 2px solid transparent;
}

.main-nav a:hover,
.main-nav a.active {
  color: #1764ff;
  border-bottom-color: #1764ff;
}

.top-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.india {
  font-size: 20px;
}

.icon-btn {
  border: 0;
  background: transparent;

  width: 34px;
  height: 34px;

  border-radius: 50%;

  color: #263958;
}

.icon-btn:hover {
  background: #eef3ff;
}

/* HERO */

.hero {
  min-height: 515px;

  position: relative;

  overflow: hidden;

  background:
    linear-gradient(
      180deg,
      rgba(10,71,135,.05),
      rgba(0,35,55,.20)
    ),
    url("https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=2000&q=85")
    center/cover;
}

.hero-overlay {
  position: absolute;
  inset: 0;

  background:
    linear-gradient(
      180deg,
      rgba(255,255,255,.15),
      rgba(255,255,255,.03) 45%,
      rgba(0,27,45,.32)
    );
}

.hero-content {
  position: relative;
  z-index: 2;

  max-width: 1050px;
  margin: auto;

  text-align: center;

  padding: 78px 20px 45px;
}

.hero-logo {
  color: white;

  font-size: clamp(55px, 8vw, 92px);

  font-weight: 900;

  letter-spacing: 5px;

  text-shadow:
    0 5px 25px rgba(0,0,0,.22);
}

.hero-logo span {
  color: #9d68ff;
}

.tagline {
  color: white;

  font-size: 13px;
  letter-spacing: 6px;
  font-weight: 700;

  margin-top: -6px;

  text-shadow: 0 2px 8px rgba(0,0,0,.25);
}

/* SEARCH */

.main-search {
  width: min(850px, 100%);

  height: 68px;

  margin: 30px auto 18px;

  padding: 6px 7px 6px 22px;

  background: white;

  border: 1px solid rgba(255,255,255,.7);

  border-radius: 40px;

  display: flex;
  align-items: center;

  box-shadow:
    0 14px 45px rgba(0,25,70,.25);
}

.search-icon {
  font-size: 29px;
  color: #365071;
}

.main-search input {
  flex: 1;

  min-width: 0;

  border: 0;
  outline: 0;

  background: transparent;

  padding: 0 13px;

  font-size: 16px;

  color: #132744;
}

.main-search input::placeholder {
  color: #8290a6;
}

.voice-btn,
.clear-btn {
  border: 0;
  background: transparent;

  color: #51647f;

  width: 40px;
  height: 40px;

  border-radius: 50%;
}

.voice-btn:hover,
.clear-btn:hover {
  background: #eef3ff;
}

.search-btn {
  width: 55px;
  height: 55px;

  border: 0;
  border-radius: 50%;

  background:
    linear-gradient(135deg,#2168ff,#604cff);

  color: white;

  font-size: 27px;

  box-shadow: 0 6px 18px #2365ff55;
}

.search-btn:hover {
  transform: translateY(-1px);
}

/* MODES */

.search-modes {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;

  gap: 9px;
}

.mode {
  border: 1px solid rgba(255,255,255,.75);

  background: rgba(255,255,255,.90);

  color: #18345b;

  border-radius: 25px;

  padding: 9px 16px;

  font-size: 12px;
  font-weight: 700;

  box-shadow: 0 5px 15px rgba(0,20,50,.12);
}

.mode:hover,
.mode.active {
  background: #1767ff;
  color: white;
  border-color: #1767ff;
}

.trending {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;

  gap: 8px;

  margin-top: 30px;
}

.trending strong {
  color: white;

  font-size: 13px;

  margin-right: 5px;
}

.trending button {
  border: 1px solid rgba(255,255,255,.65);

  background: rgba(255,255,255,.84);

  color: #17365d;

  border-radius: 20px;

  padding: 7px 12px;

  font-size: 11px;
}

/* HOME CONTENT */

.home-content {
  max-width: 1450px;

  margin: -1px auto 0;

  padding: 22px;
}

.feature-grid {
  display: grid;

  grid-template-columns:
    repeat(3,1fr);

  gap: 17px;
}

.feature-card {
  border: 1px solid #e1e8f2;

  background: white;

  border-radius: 16px;

  padding: 20px;

  display: flex;
  align-items: center;

  gap: 15px;

  text-align: left;

  color: #102347;

  box-shadow: 0 8px 25px rgba(30,65,110,.06);

  transition: .2s;
}

.feature-card:hover {
  transform: translateY(-3px);

  box-shadow:
    0 15px 35px rgba(30,65,110,.12);
}

.feature-icon {
  width: 46px;
  height: 46px;

  border-radius: 13px;

  display: flex;
  align-items: center;
  justify-content: center;

  background: #eef3ff;

  color: #3269ff;

  font-size: 23px;

  flex: none;
}

.feature-card h3 {
  margin: 0 0 4px;

  font-size: 15px;
}

.feature-card p {
  margin: 0;

  color: #718098;

  font-size: 12px;
}

.feature-card > span {
  margin-left: auto;

  color: #2166ff;

  font-size: 22px;
}

/* PANELS */

.home-columns {
  display: grid;

  grid-template-columns:
    1fr 1fr;

  gap: 18px;

  margin-top: 18px;
}

.home-panel {
  background: white;

  border: 1px solid #e2e9f2;

  border-radius: 16px;

  overflow: hidden;

  box-shadow: 0 8px 25px rgba(30,65,110,.05);
}

.panel-head {
  padding: 18px;

  display: flex;
  align-items: center;

  border-bottom: 1px solid #edf1f6;
}

.panel-head h2 {
  font-size: 15px;

  margin: 0;
}

.panel-head button {
  margin-left: auto;

  border: 0;

  background: transparent;

  color: #1765ff;

  font-size: 12px;
}

.news-row {
  display: flex;

  gap: 13px;

  padding: 13px 17px;

  border-bottom: 1px solid #edf1f6;
}

.news-thumb {
  width: 100px;
  height: 67px;

  flex: none;

  object-fit: cover;

  border-radius: 9px;

  background:
    linear-gradient(135deg,#2571ff,#6e49e9);
}

.news-info small {
  color: #1765ff;

  font-size: 10px;
}

.news-info b {
  display: block;

  font-size: 13px;

  line-height: 1.4;

  margin-top: 3px;
}

.news-info time {
  display: block;

  color: #8a96a9;

  font-size: 10px;

  margin-top: 5px;
}

.explore-image {
  height: 260px;

  background:
    linear-gradient(
      180deg,
      transparent,
      rgba(0,20,40,.8)
    ),
    url("https://images.unsplash.com/photo-1532375810709-75b1da00537c?auto=format&fit=crop&w=1200&q=85")
    center/cover;

  position: relative;
}

.explore-overlay {
  position: absolute;

  bottom: 0;

  padding: 22px;

  color: white;
}

.explore-overlay span {
  background: #1767ff;

  padding: 6px 10px;

  border-radius: 15px;

  font-size: 10px;
}

.explore-overlay h2 {
  margin: 10px 0 4px;

  font-size: 23px;
}

.explore-overlay p {
  margin: 0;

  font-size: 12px;
}

.related-home {
  padding: 16px;

  display: flex;

  flex-wrap: wrap;

  gap: 7px;
}

.related-home strong {
  width: 100%;

  font-size: 13px;

  margin-bottom: 2px;
}

.related-home button {
  border: 1px solid #e1e8f1;

  background: #f7f9fc;

  color: #315071;

  padding: 7px 11px;

  border-radius: 20px;

  font-size: 10px;
}

/* SEARCH PAGE */

.search-page {
  display: none;

  background: #fff;

  min-height: calc(100vh - 68px);
}

.search-page.active {
  display: block;
}

.results-header {
  border-bottom: 1px solid #e6ebf2;

  padding: 18px 28px 0;

  position: sticky;

  top: 68px;

  background: rgba(255,255,255,.96);

  backdrop-filter: blur(14px);

  z-index: 50;
}

.results-search {
  width: min(820px,100%);

  height: 50px;

  border: 1px solid #dce4ef;

  border-radius: 28px;

  display: flex;

  align-items: center;

  padding: 4px 6px 4px 17px;

  box-shadow: 0 5px 18px rgba(20,50,90,.06);
}

.results-search > span {
  font-size: 22px;
}

.results-search input {
  flex: 1;

  min-width: 0;

  border: 0;
  outline: 0;

  padding: 0 10px;

  font-size: 14px;
}

.results-search button {
  border: 0;

  background: transparent;

  color: #66748a;

  width: 36px;
  height: 36px;

  border-radius: 50%;
}

.results-search button[type="submit"] {
  background: #1767ff;

  color: white;

  font-size: 20px;
}

.results-tabs {
  display: flex;

  gap: 22px;

  margin-top: 15px;

  overflow-x: auto;
}

.result-tab {
  border: 0;

  background: transparent;

  padding: 9px 2px 12px;

  color: #66758c;

  white-space: nowrap;

  border-bottom: 2px solid transparent;

  font-size: 12px;
}

.result-tab:hover,
.result-tab.active {
  color: #1765ff;

  border-bottom-color: #1765ff;
}

/* RESULTS */

.results-layout {
  max-width: 1250px;

  margin: auto;

  padding: 20px 28px 70px;

  display: grid;

  grid-template-columns:
    minmax(0,820px)
    280px;

  gap: 45px;
}

.result-meta {
  color: #8792a4;

  font-size: 11px;

  margin-bottom: 6px;
}

.result {
  padding: 18px 0;

  border-bottom: 1px solid #edf1f5;
}

.result-source {
  color: #19824e;

  font-size: 11px;

  margin-bottom: 5px;

  white-space: nowrap;

  overflow: hidden;

  text-overflow: ellipsis;
}

.result h2 {
  margin: 0;

  font-size: 19px;

  line-height: 1.3;
}

.result h2 a {
  color: #1259c7;

  text-decoration: none;
}

.result h2 a:hover {
  text-decoration: underline;
}

.result p {
  margin: 7px 0 0;

  color: #526078;

  font-size: 13px;

  line-height: 1.55;
}

.result-date {
  color: #8b96a7;

  font-size: 10px;

  margin-top: 6px;
}

/* SIDE */

.results-side {
  padding-top: 20px;
}

.side-card {
  border: 1px solid #e3e9f1;

  border-radius: 15px;

  padding: 16px;

  margin-bottom: 15px;

  background: #fff;
}

.side-title {
  font-weight: 800;

  font-size: 13px;

  color: #17345c;
}

.side-card p {
  color: #758298;

  font-size: 11px;

  line-height: 1.5;
}

.side-card button {
  width: 100%;

  border: 0;

  background: #f5f7fb;

  border-radius: 9px;

  padding: 9px;

  text-align: left;

  color: #315071;

  font-size: 11px;

  margin-top: 5px;
}

.ai-side button,
.shopping-side button {
  background: #1767ff;

  color: white;

  text-align: center;
}

/* LOADING */

.search-loading {
  padding: 70px 10px;

  display: flex;

  flex-direction: column;

  align-items: center;

  gap: 9px;

  color: #63718a;
}

.search-loading b {
  color: #17345c;
}

.search-loading span {
  font-size: 11px;
}

.spinner {
  width: 32px;
  height: 32px;

  border: 3px solid #e3eaff;

  border-top-color: #1767ff;

  border-radius: 50%;

  animation:
    spin .7s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.empty {
  padding: 50px 5px;

  color: #7c8799;

  font-size: 13px;
}

/* FOOTER */

footer {
  background: #fff;

  border-top: 1px solid #e3e9f1;

  padding: 25px 35px;

  display: flex;

  align-items: center;

  justify-content: space-between;

  gap: 20px;
}

.footer-logo {
  font-size: 20px;

  font-weight: 900;

  letter-spacing: 1px;
}

.footer-brand small {
  display: block;

  color: #758298;

  font-size: 10px;

  margin-top: 5px;
}

.footer-links {
  display: flex;

  gap: 18px;

  flex-wrap: wrap;

  justify-content: center;
}

.footer-links a {
  text-decoration: none;

  color: #64728a;

  font-size: 11px;
}

.footer-links a:hover {
  color: #1765ff;
}

.footer-copy {
  color: #718097;

  font-size: 10px;
}

/* DARK MODE */

body.dark {
  background: #07101f;

  color: #eef4ff;
}

body.dark .topbar,
body.dark footer,
body.dark .search-page,
body.dark .home-panel,
body.dark .feature-card,
body.dark .side-card {
  background: #0c1729;

  border-color: #1c2b43;
}

body.dark .main-nav a,
body.dark .icon-btn,
body.dark .footer-links a,
body.dark .footer-copy {
  color: #aab8ce;
}

body.dark .results-header {
  background: rgba(12,23,41,.95);

  border-color: #1c2b43;
}

body.dark .results-search {
  background: #111f34;

  border-color: #293b57;
}

body.dark .results-search input {
  color: white;

  background: transparent;
}

body.dark .result {
  border-color: #1c2b43;
}

body.dark .result p,
body.dark .side-card p,
body.dark .footer-brand small {
  color: #9baac0;
}

body.dark .result h2 a {
  color: #70a1ff;
}

body.dark .related-home button,
body.dark .side-card button {
  background: #132238;

  border-color: #233652;

  color: #b7c5da;
}

body.dark .home-panel {
  box-shadow: none;
}

/* MOBILE */

@media(max-width:900px) {

  .main-nav {
    gap: 11px;
  }

  .main-nav a span {
    display: none;
  }

  .main-nav a {
    font-size: 18px;
  }

  .results-layout {
    grid-template-columns: 1fr;
  }

  .results-side {
    display: none;
  }

  .home-columns {
    grid-template-columns: 1fr;
  }
}

@media(max-width:650px) {

  .topbar {
    height: 58px;

    padding: 0 12px;

    gap: 8px;
  }

  .logo {
    min-width: 105px;

    font-size: 19px;
  }

  .logo-mark {
    width: 19px;
    height: 19px;

    border-width: 4px;
  }

  .main-nav {
    justify-content: flex-start;

    overflow-x: auto;

    gap: 12px;

    scrollbar-width: none;
  }

  .main-nav::-webkit-scrollbar {
    display: none;
  }

  .main-nav a {
    flex: none;

    font-size: 16px;
  }

  .top-actions {
    gap: 3px;
  }

  .india {
    font-size: 17px;
  }

  .icon-btn {
    width: 28px;
    height: 28px;
  }

  .hero {
    min-height: 450px;
  }

  .hero-content {
    padding: 60px 12px 30px;
  }

  .hero-logo {
    font-size: 47px;

    letter-spacing: 3px;
  }

  .tagline {
    font-size: 9px;

    letter-spacing: 3px;
  }

  .main-search {
    height: 56px;

    margin-top: 22px;

    padding-left: 14px;
  }

  .search-icon {
    font-size: 23px;
  }

  .main-search input {
    font-size: 13px;

    padding: 0 7px;
  }

  .voice-btn {
    display: none;
  }

  .search-btn {
    width: 44px;
    height: 44px;

    font-size: 21px;
  }

  .search-modes {
    justify-content: flex-start;

    overflow-x: auto;

    flex-wrap: nowrap;

    scrollbar-width: none;

    padding-bottom: 5px;
  }

  .search-modes::-webkit-scrollbar {
    display: none;
  }

  .mode {
    white-space: nowrap;

    flex: none;

    padding: 8px 12px;

    font-size: 10px;
  }

  .trending {
    justify-content: flex-start;

    flex-wrap: nowrap;

    overflow-x: auto;

    scrollbar-width: none;

    margin-top: 20px;

    padding-bottom: 5px;
  }

  .trending::-webkit-scrollbar {
    display: none;
  }

  .trending strong,
  .trending button {
    white-space: nowrap;

    flex: none;

    font-size: 9px;
  }

  .home-content {
    padding: 10px;
  }

  .feature-grid {
    grid-template-columns: 1fr;

    gap: 10px;
  }

  .feature-card {
    padding: 15px;
  }

  .home-columns {
    gap: 12px;

    margin-top: 12px;
  }

  .news-row {
    padding: 11px;
  }

  .news-thumb {
    width: 78px;
    height: 58px;
  }

  .news-info b {
    font-size: 11px;
  }

  .explore-image {
    height: 220px;
  }

  .explore-overlay h2 {
    font-size: 20px;
  }

  .results-header {
    top: 58px;

    padding: 10px 10px 0;
  }

  .results-search {
    height: 46px;
  }

  .results-tabs {
    gap: 17px;

    margin-top: 8px;
  }

  .result-tab {
    font-size: 10px;
  }

  .results-layout {
    padding: 12px 14px 60px;
  }

  .result {
    padding: 15px 0;
  }

  .result h2 {
    font-size: 17px;
  }

  .result p {
    font-size: 12px;
  }

  footer {
    padding: 22px 12px;

    flex-direction: column;

    text-align: center;
  }

  .footer-links {
    gap: 12px;
  }
}

`;

document.head.appendChild(style);


/* -----------------------------
   HELPERS
----------------------------- */

function esc(value = "") {
  return String(value).replace(
    /[&<>"']/g,
    char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[char])
  );
}


/* -----------------------------
   ELEMENTS
----------------------------- */

const homePage = document.getElementById("homePage");
const searchPage = document.getElementById("searchPage");

const searchForm = document.getElementById("searchForm");
const input = document.getElementById("q");

const resultsSearchForm =
  document.getElementById("resultsSearchForm");

const resultsInput =
  document.getElementById("resultsInput");

const resultMeta =
  document.getElementById("resultMeta");

const results =
  document.getElementById("results");

const newsList =
  document.getElementById("newsList");

const clearBtn =
  document.getElementById("clearBtn");

const resultsClear =
  document.getElementById("resultsClear");

const themeBtn =
  document.getElementById("themeBtn");


/* -----------------------------
   HOME / SEARCH SWITCH
----------------------------- */

function showHome() {

  homePage.style.display = "block";

  searchPage.classList.remove("active");

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}


function showSearchPage() {

  homePage.style.display = "none";

  searchPage.classList.add("active");

  window.scrollTo({
    top: 0,
    behavior: "instant"
  });
}


/* -----------------------------
   SEARCH
----------------------------- */

async function doSearch(query) {

  query = String(query || "").trim();

  if (!query) return;

  showSearchPage();

  resultsInput.value = query;

  resultMeta.textContent =
    "Searching HEXORA's own index...";

  results.innerHTML = `
    <div class="search-loading">
      <div class="spinner"></div>
      <b>Searching HEXORA...</b>
      <span>Finding relevant results</span>
    </div>
  `;

  history.replaceState(
    {},
    "",
    "?q=" + encodeURIComponent(query)
  );

  const start = performance.now();

  try {

    /*
      IMPORTANT:
      Existing backend API is kept unchanged.
    */

    const response = await fetch(
      "/api/search?q=" +
      encodeURIComponent(query)
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error || "Search failed"
      );
    }

    const elapsed =
      ((performance.now() - start) / 1000)
      .toFixed(2);

    const items =
      Array.isArray(data.results)
        ? data.results
        : [];

    resultMeta.textContent =
      `About ${Number(data.total || items.length).toLocaleString()} indexed results · ${elapsed}s`;

    if (!items.length) {

      results.innerHTML = `
        <div class="empty">
          <h3>No matching results found</h3>
          <p>
            HEXORA could not find a matching page
            in its current independent index.
          </p>
        </div>
      `;

      return;
    }

    results.innerHTML = items
      .map(item => {

        const title =
          item.title ||
          item.url ||
          "Untitled page";

        const url =
          item.url || "#";

        const domain =
          item.source_domain ||
          (() => {
            try {
              return new URL(url).hostname;
            } catch {
              return "";
            }
          })();

        const source =
          item.source_name ||
          domain;

        const snippet =
          item.snippet ||
          item.description ||
          "";

        let date = "";

        if (item.published_at) {

          try {

            date =
              new Date(
                item.published_at
              ).toLocaleString(
                "en-IN",
                {
                  day: "numeric",
                  month: "short",
                  year: "numeric"
                }
              );

          } catch {}
        }

        return `
          <article class="result">

            <div class="result-source">
              ${esc(source)}
              ${domain ? " · " + esc(domain) : ""}
            </div>

            <h2>
              <a
                href="${esc(url)}"
                target="_blank"
                rel="noopener noreferrer"
              >
                ${esc(title)}
              </a>
            </h2>

            ${
              date
                ? `<div class="result-date">${esc(date)}</div>`
                : ""
            }

            <p>
              ${esc(snippet)}
            </p>

          </article>
        `;

      })
      .join("");

  } catch (error) {

    resultMeta.textContent = "";

    results.innerHTML = `
      <div class="empty">
        <h3>HEXORA search service error</h3>
        <p>${esc(error.message)}</p>
      </div>
    `;
  }
}


/* -----------------------------
   MAIN SEARCH FORM
----------------------------- */

searchForm.addEventListener(
  "submit",
  event => {

    event.preventDefault();

    doSearch(input.value);
  }
);


/* -----------------------------
   RESULTS SEARCH FORM
----------------------------- */

resultsSearchForm.addEventListener(
  "submit",
  event => {

    event.preventDefault();

    doSearch(resultsInput.value);
  }
);


/* -----------------------------
   CLEAR BUTTONS
----------------------------- */

input.addEventListener(
  "input",
  () => {

    clearBtn.hidden =
      !input.value.trim();
  }
);

clearBtn.addEventListener(
  "click",
  () => {

    input.value = "";

    clearBtn.hidden = true;

    input.focus();
  }
);

resultsClear.addEventListener(
  "click",
  () => {

    resultsInput.value = "";

    resultsInput.focus();
  }
);


/* -----------------------------
   TRENDING SEARCHES
----------------------------- */

document
  .querySelectorAll(".trending button")
  .forEach(button => {

    button.addEventListener(
      "click",
      () => {

        const query =
          button.textContent.trim();

        input.value = query;

        doSearch(query);
      }
    );

  });


/* -----------------------------
   MODE BUTTONS
----------------------------- */

document
  .querySelectorAll("[data-mode]")
  .forEach(button => {

    button.addEventListener(
      "click",
      event => {

        event.preventDefault();

        const mode =
          button.dataset.mode;

        /*
          AI / Shopping / Images / News etc.
          are UI modes for now.

          Existing backend search remains untouched.
        */

        document
          .querySelectorAll(".mode")
          .forEach(x =>
            x.classList.toggle(
              "active",
              x.dataset.mode === mode
            )
          );

        document
          .querySelectorAll(".result-tab")
          .forEach(x =>
            x.classList.toggle(
              "active",
              x.dataset.mode === mode
            )
          );

        if (mode === "web") {

          if (
            resultsInput.value.trim()
          ) {
            doSearch(
              resultsInput.value
            );
          }

          return;
        }

        /*
          Do not create fake AI,
          shopping, image or news data.
          Keep these ready for real APIs
          later.
        */

        if (
          mode === "ai" ||
          mode === "shopping" ||
          mode === "images" ||
          mode === "news" ||
          mode === "videos" ||
          mode === "maps"
        ) {

          if (
            resultsInput.value.trim()
          ) {

            doSearch(
              resultsInput.value
            );

          } else {

            showSearchPage();

            resultsInput.focus();

          }

        }

      }
    );

  });


/* -----------------------------
   RESULT TABS
----------------------------- */

document
  .querySelectorAll(".result-tab")
  .forEach(tab => {

    tab.addEventListener(
      "click",
      () => {

        document
          .querySelectorAll(".result-tab")
          .forEach(x =>
            x.classList.remove("active")
          );

        tab.classList.add("active");

        const mode =
          tab.dataset.mode;

        if (
          mode === "web" &&
          resultsInput.value.trim()
        ) {

          doSearch(
            resultsInput.value
          );

        }

      }
    );

  });


/* -----------------------------
   NEWS
----------------------------- */

async function loadRealNews() {

  try {

    const response =
      await fetch("/api/news");

    const data =
      await response.json();

    const rows =
      Array.isArray(data.items)
        ? data.items
        : [];

    if (!rows.length) {

      newsList.innerHTML = `
        <div class="empty">
          No verified news available yet.
        </div>
      `;

      return;
    }

    newsList.innerHTML =
      rows
        .slice(0, 6)
        .map(news => {

          let date = "";

          if (news.published_at) {

            try {

              date =
                new Date(
                  news.published_at
                ).toLocaleString(
                  "en-IN",
                  {
                    day: "numeric",
                    month: "short",
                    hour: "numeric",
                    minute: "2-digit"
                  }
                );

            } catch {}

          }

          const image =
            news.image_url
              ? `
                <img
                  class="news-thumb"
                  src="${esc(news.image_url)}"
                  alt=""
                  loading="lazy"
                >
              `
              : `
                <div class="news-thumb"></div>
              `;

          return `
            <div class="news-row">

              ${image}

              <div class="news-info">

                <small>
                  ${esc(
                    news.source_name ||
                    news.source_domain ||
                    "News"
                  )}
                </small>

                <b>
                  ${esc(
                    news.title ||
                    "Latest news"
                  )}
                </b>

                ${
                  date
                    ? `<time>${esc(date)}</time>`
                    : ""
                }

              </div>

            </div>
          `;

        })
        .join("");

  } catch (error) {

    newsList.innerHTML = `
      <div class="empty">
        News feed is currently unavailable.
      </div>
    `;
  }
}

loadRealNews();


/* -----------------------------
   NEWS LINK
----------------------------- */

document
  .getElementById("newsLink")
  .addEventListener(
    "click",
    () => {

      showSearchPage();

      resultsInput.value =
        "latest news";

      doSearch(
        "latest news"
      );

    }
  );


/* -----------------------------
   AI BUTTON
----------------------------- */

document
  .getElementById("aiAskBtn")
  .addEventListener(
    "click",
    () => {

      const query =
        resultsInput.value.trim();

      if (query) {

        /*
          Existing search API is used.
          Real AI backend can be connected later.
        */

        doSearch(query);

      } else {

        resultsInput.focus();

      }

    }
  );


/* -----------------------------
   THEME
----------------------------- */

const savedTheme =
  localStorage.getItem(
    "hexora-theme"
  );

if (savedTheme === "dark") {

  document.body.classList.add("dark");

  themeBtn.textContent = "☀";

}

themeBtn.addEventListener(
  "click",
  () => {

    const dark =
      document.body.classList.toggle(
        "dark"
      );

    localStorage.setItem(
      "hexora-theme",
      dark ? "dark" : "light"
    );

    themeBtn.textContent =
      dark ? "☀" : "☾";

  }
);


/* -----------------------------
   VOICE SEARCH
----------------------------- */

const voiceBtn =
  document.getElementById("voiceBtn");

if (
  voiceBtn &&
  (
    "webkitSpeechRecognition"
    in window ||
    "SpeechRecognition"
    in window
  )
) {

  voiceBtn.addEventListener(
    "click",
    () => {

      const SpeechRecognition =
        window.SpeechRecognition ||
        window.webkitSpeechRecognition;

      const recognition =
        new SpeechRecognition();

      recognition.lang = "en-IN";

      recognition.interimResults =
        false;

      recognition.maxAlternatives = 1;

      recognition.start();

      recognition.onresult =
        event => {

          const text =
            event.results[0][0].transcript;

          input.value = text;

          clearBtn.hidden = false;

          doSearch(text);
        };

    }
  );

}


/* -----------------------------
   INITIAL QUERY
----------------------------- */

const initialQuery =
  new URLSearchParams(
    window.location.search
  ).get("q");

if (initialQuery) {

  doSearch(initialQuery);

}


/* -----------------------------
   HOME MODE LINKS
----------------------------- */

document
  .querySelectorAll(".main-nav a")
  .forEach(link => {

    link.addEventListener(
      "click",
      event => {

        const href =
          link.getAttribute("href");

        if (href === "/") {

          event.preventDefault();

          history.pushState(
            {},
            "",
            "/"
          );

          showHome();

        }

      }
    );

  });

`;
