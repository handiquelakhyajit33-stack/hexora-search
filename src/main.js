const app = document.getElementById("app");

if (!app) {
  throw new Error("HEXORA: #app element not found in index.html");
}

/* =========================================================
   HEXORA SEARCH — MAIN.JS
   Web      -> /api/search
   News     -> /api/news
   Maps     -> MapLibre + OpenStreetMap + Nominatim
   ========================================================= */

app.innerHTML = `
<div class="site">

  <!-- ================= HEADER ================= -->
  <header class="nav">

    <div class="brand">
      <div class="nmark">H</div>
      <div>
        <strong>HEXORA</strong>
        <small>SEARCH THE WORLD</small>
      </div>
    </div>

    <nav class="main-nav">
      <a class="active" href="/" data-nav="home">⌂<span>Home</span></a>
      <a href="#web" data-nav="web">◎<span>Web</span></a>
      <a href="#images" data-nav="images">▧<span>Images</span></a>
      <a href="#news" data-nav="news">▤<span>News</span></a>
      <a href="#maps" data-nav="maps">⌖<span>Maps</span></a>
      <a href="#more" data-nav="more">⌄<span>More</span></a>
    </nav>

    <div class="right">
      <span class="weather-icon">☀️</span>
      <b>
        Assam<br>
        <em>HEXORA</em>
      </b>
      <button class="circle-btn" type="button" id="menuBtn">☰</button>
    </div>

  </header>


  <!-- ================= HERO ================= -->
  <section class="hero" id="hero">

    <div class="hero-shade"></div>

    <div class="hero-content">

      <div class="hero-logo">HEXORA</div>
      <div class="hero-tag">SEARCH THE WORLD</div>

      <form id="searchForm" class="search">

        <span class="search-icon">⌕</span>

        <input
          id="q"
          autocomplete="off"
          spellcheck="false"
          placeholder="Search anything... (e.g. Assam, AI, Python, Cricket, News, Maps)"
        >

        <button type="submit" aria-label="Search">
          ⌕
        </button>

      </form>


      <!-- SEARCH MODES -->
      <div class="search-tabs">

        <button type="button" class="mode-btn active" data-mode="web">
          ◎ &nbsp;Web
        </button>

        <button type="button" class="mode-btn" data-mode="images">
          ▧ &nbsp;Images
        </button>

        <button type="button" class="mode-btn" data-mode="news">
          ▤ &nbsp;News
        </button>

        <button type="button" class="mode-btn" data-mode="maps">
          ⌖ &nbsp;Maps
        </button>

        <button type="button" class="mode-btn" data-mode="videos">
          ▶ &nbsp;Videos
        </button>

        <button type="button" class="mode-btn" data-mode="shopping">
          ▢ &nbsp;Shopping
        </button>

      </div>


      <!-- TRENDING -->
      <div class="trending">

        <b>⌁ Trending Searches</b>

        <button type="button">Assam news</button>
        <button type="button">India vs Australia</button>
        <button type="button">Python tutorial</button>
        <button type="button">AI tools</button>
        <button type="button">Travel Assam</button>
        <button type="button">Education</button>
        <button type="button">Cricket</button>

      </div>

    </div>
  </section>


  <!-- ================= HOME ================= -->
  <section id="homeContent" class="home-grid">

    <div class="panel news">

      <div class="panel-title">
        <span>▤</span>
        <b>Latest News</b>
        <button type="button" class="view-all" data-mode="news">
          View all →
        </button>
      </div>

      <div id="homeNews">

        <div class="news-row">
          <div class="thumb">ASSAM</div>
          <div>
            <small>HEXORA</small>
            <b>Loading latest indexed news...</b>
            <time>Updating...</time>
          </div>
        </div>

        <div class="news-row">
          <div class="thumb">AI</div>
          <div>
            <small>Technology</small>
            <b>HEXORA is loading real indexed information.</b>
            <time>Please wait...</time>
          </div>
        </div>

      </div>

    </div>


    <div class="panel feature">

      <div class="feature-img">

        <span>ASSAM</span>

        <div>
          <h2>Explore Assam with HEXORA</h2>
          <p>
            Search places, information and the independent web index.
          </p>
        </div>

      </div>


      <div class="related">

        <b>⌕ Related Searches</b>

        <button type="button">Assam tourism</button>
        <button type="button">Best colleges in Assam</button>
        <button type="button">Python for beginners</button>
        <button type="button">Latest news</button>
        <button type="button">Cricket live score</button>
        <button type="button">Travel destinations</button>

      </div>

    </div>


    <div class="panel quick">

      <div class="panel-title">
        ϟ <b>Quick Access</b>
      </div>

      <div class="quick-grid">

        <button type="button" data-mode="maps">
          ⌖
          <b>HEXORA Map</b>
          <small>Explore places</small>
        </button>

        <button type="button" data-mode="images">
          ▧
          <b>HEXORA Images</b>
          <small>Search images</small>
        </button>

        <button type="button" data-mode="news">
          ▤
          <b>HEXORA News</b>
          <small>Latest updates</small>
        </button>

        <button type="button" data-mode="videos">
          ▶
          <b>HEXORA Videos</b>
          <small>Watch & learn</small>
        </button>

        <button type="button" data-mode="web">
          ☁
          <b>HEXORA Search</b>
          <small>Search the web</small>
        </button>

        <button type="button" data-mode="web">
          文
          <b>HEXORA Language</b>
          <small>Search any language</small>
        </button>

      </div>


      <div class="map-card">

        <div>
          <b>Explore the World with HEXORA Map</b>

          <small>
            Find places, locate yourself and explore real map data.
          </small>

          <button type="button" id="openMapBtn">
            Open Map →
          </button>
        </div>

      </div>

    </div>

  </section>


  <!-- ================= SEARCH VIEW ================= -->
  <section id="searchView" class="search-view">

    <div id="resultMeta"></div>

    <div id="results"></div>

  </section>


  <!-- ================= MAP VIEW ================= -->
  <section id="mapView" class="map-view">

    <div class="map-topbar">

      <div class="map-search">

        <span>⌕</span>

        <input
          id="mapSearchInput"
          type="search"
          autocomplete="off"
          placeholder="Search a place..."
        >

        <button type="button" id="mapSearchBtn">
          Search
        </button>

      </div>

    </div>


    <div id="hexoraMap"></div>


    <div class="map-controls">

      <button type="button" id="locateBtn">
        ⌖ <span>My Location</span>
      </button>

      <button type="button" id="roadBtn" class="map-control-active">
        🗺 <span>Road</span>
      </button>

      <button type="button" id="satelliteBtn">
        🛰 <span>Satellite</span>
      </button>

      <button type="button" id="resetMapBtn">
        ↺ <span>Reset</span>
      </button>

      <button type="button" id="fullscreenMapBtn">
        ⛶ <span>Fullscreen</span>
      </button>

    </div>


    <div id="mapPlaceInfo" class="map-place-info"></div>

  </section>


  <!-- ================= FOOTER ================= -->
  <footer>

    <div class="brand mini">

      <div class="nmark">H</div>

      <div>
        <strong>HEXORA</strong>
        <small>SEARCH THE WORLD</small>
      </div>

    </div>

    <div>
      About　 Privacy　 Terms　 Help　 Contact
    </div>

    <div>
      Made with ❤️ in India 🇮🇳
    </div>

  </footer>

</div>
`;


/* =========================================================
   CSS
   ========================================================= */

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
    sans-serif;

  background:
    radial-gradient(
      circle at top,
      #182235 0%,
      #090d16 45%,
      #05070b 100%
    );

  color: #fff;
  min-height: 100vh;
}

button,
input {
  font: inherit;
}

button {
  cursor: pointer;
}

.site {
  min-height: 100vh;
  overflow-x: hidden;
}


/* ================= HEADER ================= */

.nav {
  height: 74px;

  display: flex;
  align-items: center;
  justify-content: space-between;

  padding: 0 5%;

  border-bottom: 1px solid rgba(255,255,255,.08);

  background: rgba(6,9,15,.72);

  backdrop-filter: blur(18px);

  position: relative;
  z-index: 100;
}

.brand {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 170px;
}

.nmark {
  width: 39px;
  height: 39px;

  border-radius: 12px;

  display: flex;
  align-items: center;
  justify-content: center;

  background:
    linear-gradient(
      135deg,
      #9f7cff,
      #5f8cff
    );

  font-size: 20px;
  font-weight: 900;

  box-shadow:
    0 0 28px rgba(120,100,255,.3);
}

.brand strong {
  display: block;
  font-size: 15px;
  letter-spacing: 2px;
}

.brand small {
  display: block;
  color: #8894a8;
  font-size: 8px;
  letter-spacing: 1.4px;
  margin-top: 2px;
}

.main-nav {
  display: flex;
  align-items: center;
  gap: 7px;
}

.main-nav a {
  color: #9ca8ba;
  text-decoration: none;

  padding: 10px 13px;

  border-radius: 12px;

  display: flex;
  align-items: center;
  gap: 7px;

  font-size: 14px;

  transition: .2s;
}

.main-nav a:hover,
.main-nav a.active {
  color: #fff;
  background: rgba(255,255,255,.07);
}

.main-nav a:first-letter {
  font-size: 18px;
}

.right {
  min-width: 170px;

  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 11px;

  color: #d8dfeb;
}

.right b {
  font-size: 11px;
  line-height: 1.25;
}

.right em {
  color: #7f8da4;
  font-style: normal;
  font-size: 9px;
}

.weather-icon {
  font-size: 17px;
}

.circle-btn {
  border: 0;
  background: rgba(255,255,255,.07);
  color: #fff;

  width: 36px;
  height: 36px;

  border-radius: 50%;
}


/* ================= HERO ================= */

.hero {
  position: relative;

  min-height: 475px;

  display: flex;
  align-items: center;
  justify-content: center;

  overflow: hidden;

  background:
    radial-gradient(
      circle at 50% 38%,
      rgba(92,103,255,.23),
      transparent 42%
    );
}

.hero::before {
  content: "";

  position: absolute;
  inset: 0;

  background:
    linear-gradient(
      180deg,
      rgba(255,255,255,.025),
      transparent 35%
    );
}

.hero-shade {
  position: absolute;
  inset: 0;

  background:
    radial-gradient(
      circle at center,
      transparent 0,
      rgba(3,6,11,.22) 60%,
      rgba(3,6,11,.65) 100%
    );
}

.hero-content {
  position: relative;
  z-index: 2;

  width: min(940px, 92%);

  text-align: center;

  padding-top: 28px;
}

.hero-logo {
  font-size: clamp(52px, 9vw, 92px);

  line-height: .9;

  font-weight: 950;

  letter-spacing: 7px;

  background:
    linear-gradient(
      135deg,
      #ffffff,
      #b9c7ff,
      #8e78ff
    );

  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;

  text-shadow:
    0 0 45px rgba(111,104,255,.2);
}

.hero-tag {
  margin-top: 13px;

  color: #8996ab;

  font-size: 11px;

  letter-spacing: 5px;
}


/* ================= SEARCH ================= */

.search {
  width: min(760px, 100%);

  margin: 34px auto 0;

  height: 62px;

  display: flex;
  align-items: center;

  padding: 0 10px 0 20px;

  border-radius: 20px;

  border: 1px solid rgba(255,255,255,.13);

  background:
    rgba(13,18,28,.88);

  box-shadow:
    0 25px 70px rgba(0,0,0,.35),
    inset 0 1px 0 rgba(255,255,255,.03);
}

.search-icon {
  color: #8e9bb0;
  font-size: 24px;
  margin-right: 10px;
}

.search input {
  flex: 1;

  min-width: 0;

  border: 0;
  outline: 0;

  color: #fff;

  background: transparent;

  font-size: 15px;
}

.search input::placeholder {
  color: #667287;
}

.search > button {
  width: 44px;
  height: 44px;

  border: 0;
  border-radius: 14px;

  color: #fff;

  background:
    linear-gradient(
      135deg,
      #8a73ff,
      #567cff
    );

  font-size: 21px;
}


/* ================= SEARCH TABS ================= */

.search-tabs {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;

  gap: 7px;

  margin-top: 19px;
}

.mode-btn {
  border: 1px solid rgba(255,255,255,.07);

  background: rgba(255,255,255,.035);

  color: #9ca8ba;

  border-radius: 11px;

  padding: 9px 13px;

  font-size: 12px;

  transition: .2s;
}

.mode-btn:hover,
.mode-btn.active {
  color: #fff;

  background:
    rgba(125,111,255,.15);

  border-color:
    rgba(140,125,255,.3);
}


/* ================= TRENDING ================= */

.trending {
  margin-top: 24px;

  display: flex;

  justify-content: center;

  align-items: center;

  flex-wrap: wrap;

  gap: 7px;
}

.trending b {
  color: #68758b;
  font-size: 10px;

  margin-right: 4px;
}

.trending button,
.related button {
  border: 0;

  background: transparent;

  color: #8794a9;

  font-size: 10px;

  padding: 5px 7px;

  border-radius: 8px;
}

.trending button:hover,
.related button:hover {
  color: #fff;
  background: rgba(255,255,255,.06);
}


/* ================= HOME ================= */

.home-grid {
  width: min(1180px, 90%);

  margin: 0 auto;

  display: grid;

  grid-template-columns:
    1fr 1fr;

  gap: 16px;

  padding: 0 0 50px;
}

.panel {
  background:
    linear-gradient(
      145deg,
      rgba(19,26,39,.92),
      rgba(10,14,22,.92)
    );

  border:
    1px solid rgba(255,255,255,.07);

  border-radius: 20px;

  overflow: hidden;

  box-shadow:
    0 18px 50px rgba(0,0,0,.18);
}

.panel-title {
  min-height: 54px;

  display: flex;
  align-items: center;

  gap: 9px;

  padding: 0 18px;

  border-bottom:
    1px solid rgba(255,255,255,.055);

  color: #aeb9c9;

  font-size: 12px;
}

.panel-title b {
  color: #fff;
}

.view-all {
  margin-left: auto;

  border: 0;

  background: transparent;

  color: #8491a6;

  font-size: 10px;
}

.news-row {
  display: flex;

  gap: 13px;

  padding: 15px 18px;

  border-bottom:
    1px solid rgba(255,255,255,.04);
}

.news-row:last-child {
  border-bottom: 0;
}

.thumb {
  width: 76px;
  height: 55px;

  flex: 0 0 auto;

  border-radius: 11px;

  display: flex;
  align-items: center;
  justify-content: center;

  background:
    linear-gradient(
      135deg,
      #26304a,
      #111827
    );

  color: #aab5ff;

  font-size: 10px;
  font-weight: 800;

  letter-spacing: 1px;
}

.news-row small {
  color: #718097;
  display: block;
  font-size: 9px;
  margin-bottom: 4px;
}

.news-row b {
  display: block;

  font-size: 11px;

  line-height: 1.45;

  color: #dce3ed;
}

.news-row time {
  display: block;

  color: #68758a;

  font-size: 9px;

  margin-top: 6px;
}


/* ================= FEATURE ================= */

.feature-img {
  min-height: 205px;

  padding: 25px;

  display: flex;
  align-items: flex-end;

  position: relative;

  background:
    radial-gradient(
      circle at 30% 30%,
      rgba(97,125,255,.4),
      transparent 50%
    ),
    linear-gradient(
      145deg,
      #17223a,
      #101622
    );
}

.feature-img > span {
  position: absolute;

  top: 18px;
  right: 18px;

  font-size: 10px;

  color: #b8c3ff;

  border: 1px solid rgba(255,255,255,.1);

  padding: 6px 9px;

  border-radius: 8px;
}

.feature-img h2 {
  margin: 0 0 7px;

  font-size: 21px;
}

.feature-img p {
  margin: 0;

  color: #9aa7bb;

  font-size: 11px;

  line-height: 1.6;
}

.related {
  padding: 17px 20px 20px;
}

.related > b {
  display: block;

  color: #fff;

  font-size: 11px;

  margin-bottom: 9px;
}


/* ================= QUICK ================= */

.quick {
  grid-column: 1 / -1;
}

.quick-grid {
  display: grid;

  grid-template-columns:
    repeat(6, 1fr);

  gap: 10px;

  padding: 17px;
}

.quick-grid button {
  min-height: 100px;

  border: 1px solid rgba(255,255,255,.055);

  border-radius: 15px;

  background: rgba(255,255,255,.025);

  color: #8996aa;

  display: flex;

  flex-direction: column;

  align-items: flex-start;

  justify-content: center;

  gap: 6px;

  padding: 14px;

  text-align: left;

  transition: .2s;
}

.quick-grid button:hover {
  transform: translateY(-2px);

  border-color:
    rgba(125,115,255,.25);

  background:
    rgba(110,100,255,.08);
}

.quick-grid button:first-letter {
  font-size: 21px;
}

.quick-grid b {
  color: #e5e9f0;
  font-size: 11px;
}

.quick-grid small {
  color: #657286;
  font-size: 9px;
}


/* ================= MAP CARD ================= */

.map-card {
  min-height: 160px;

  margin: 0 17px 17px;

  border-radius: 17px;

  padding: 24px;

  display: flex;

  align-items: flex-end;

  position: relative;

  overflow: hidden;

  background:
    radial-gradient(
      circle at 60% 30%,
      rgba(79,146,255,.28),
      transparent 40%
    ),
    linear-gradient(
      135deg,
      #17253c,
      #0d1624
    );
}

.map-card::after {
  content: "HEXORA MAP";

  position: absolute;

  right: -15px;
  top: 25px;

  font-size: 40px;

  font-weight: 900;

  color: rgba(255,255,255,.025);

  transform: rotate(-12deg);
}

.map-card b,
.map-card small {
  display: block;
  position: relative;
  z-index: 2;
}

.map-card b {
  font-size: 15px;
}

.map-card small {
  color: #8592a7;
  font-size: 10px;
  margin-top: 5px;
}

.map-card button {
  margin-top: 13px;

  border: 0;

  background: rgba(255,255,255,.08);

  color: #fff;

  border-radius: 10px;

  padding: 9px 12px;

  font-size: 10px;
}


/* ================= SEARCH RESULTS ================= */

.search-view {
  width: min(900px, 92%);

  margin: 0 auto;

  display: none;

  padding: 25px 0 70px;
}

.search-view.active {
  display: block;
}

#resultMeta {
  color: #77849a;

  font-size: 11px;

  margin-bottom: 18px;
}

.result {
  position: relative;

  padding: 20px 0;

  border-bottom:
    1px solid rgba(255,255,255,.07);
}

.result h2 {
  margin: 5px 0 7px;

  font-size: 19px;
}

.result h2 a {
  color: #9eafff;
  text-decoration: none;
}

.result h2 a:hover {
  text-decoration: underline;
}

.result .url {
  color: #71809a;

  font-size: 10px;

  white-space: nowrap;

  overflow: hidden;

  text-overflow: ellipsis;

  max-width: 100%;
}

.result p {
  color: #a0acbd;

  font-size: 12px;

  line-height: 1.65;

  margin: 9px 0 0;
}

.result-image {
  width: 105px;
  height: 75px;

  object-fit: cover;

  border-radius: 11px;

  float: right;

  margin-left: 15px;
}

.empty {
  padding: 60px 20px;

  text-align: center;

  color: #7c899d;

  border:
    1px dashed rgba(255,255,255,.08);

  border-radius: 18px;

  background: rgba(255,255,255,.02);
}


/* ================= MAP VIEW ================= */

.map-view {
  display: none;

  width: 100%;

  position: relative;

  background: #0b111b;

  min-height: 650px;

  border-top:
    1px solid rgba(255,255,255,.07);
}

.map-view.active {
  display: block;
}

.map-topbar {
  position: absolute;

  z-index: 30;

  top: 16px;
  left: 50%;

  transform: translateX(-50%);

  width: min(680px, 92%);
}

.map-search {
  height: 52px;

  display: flex;
  align-items: center;

  padding: 0 7px 0 17px;

  border-radius: 15px;

  background:
    rgba(7,11,18,.92);

  border:
    1px solid rgba(255,255,255,.12);

  box-shadow:
    0 15px 45px rgba(0,0,0,.35);

  backdrop-filter: blur(15px);
}

.map-search span {
  color: #8996a9;
  margin-right: 10px;
}

.map-search input {
  flex: 1;

  min-width: 0;

  background: transparent;

  border: 0;

  outline: 0;

  color: #fff;

  font-size: 13px;
}

.map-search input::placeholder {
  color: #69768a;
}

.map-search button {
  border: 0;

  border-radius: 10px;

  padding: 9px 13px;

  color: #fff;

  background:
    linear-gradient(
      135deg,
      #7565ff,
      #4f7fff
    );

  font-size: 10px;
}

#hexoraMap {
  width: 100%;
  height: 650px;
}

.map-controls {
  position: absolute;

  z-index: 30;

  left: 18px;
  bottom: 22px;

  display: flex;

  flex-direction: column;

  gap: 7px;
}

.map-controls button {
  min-width: 130px;

  padding: 10px 13px;

  border-radius: 11px;

  border:
    1px solid rgba(255,255,255,.1);

  background:
    rgba(7,11,18,.9);

  color: #dbe2ee;

  font-size: 10px;

  text-align: left;

  backdrop-filter: blur(10px);
}

.map-controls button:hover,
.map-controls button.map-control-active {
  background:
    rgba(105,95,255,.28);

  border-color:
    rgba(145,130,255,.4);
}

.map-place-info {
  display: none;

  position: absolute;

  z-index: 30;

  right: 18px;
  bottom: 22px;

  max-width: 300px;

  padding: 15px;

  border-radius: 13px;

  background:
    rgba(7,11,18,.93);

  border:
    1px solid rgba(255,255,255,.1);

  color: #dce3ed;

  font-size: 11px;

  backdrop-filter: blur(12px);
}

.map-place-info.show {
  display: block;
}


/* MAPLIBRE */

.maplibregl-popup-content {
  background: #101722 !important;
  color: #fff !important;

  border-radius: 12px !important;

  border:
    1px solid rgba(255,255,255,.1);
}

.maplibregl-popup-tip {
  border-top-color: #101722 !important;
}

.maplibregl-ctrl-group {
  background: rgba(10,14,22,.9) !important;
}

.maplibregl-ctrl button {
  filter: invert(1);
}


/* ================= FOOTER ================= */

footer {
  min-height: 100px;

  padding: 25px 5%;

  display: flex;

  align-items: center;

  justify-content: space-between;

  gap: 20px;

  color: #667287;

  font-size: 9px;

  border-top:
    1px solid rgba(255,255,255,.06);
}

.mini {
  min-width: auto;
}

.mini .nmark {
  width: 31px;
  height: 31px;
  font-size: 15px;
  border-radius: 9px;
}


/* ================= MOBILE ================= */

@media (max-width: 900px) {

  .nav {
    padding: 0 4%;
  }

  .main-nav {
    display: none;
  }

  .right {
    min-width: auto;
  }

  .right b {
    display: none;
  }

  .home-grid {
    grid-template-columns: 1fr;
  }

  .quick {
    grid-column: auto;
  }

  .quick-grid {
    grid-template-columns:
      repeat(3, 1fr);
  }

}

@media (max-width: 600px) {

  .nav {
    height: 64px;
  }

  .brand strong {
    font-size: 13px;
  }

  .hero {
    min-height: 430px;
  }

  .hero-logo {
    letter-spacing: 4px;
  }

  .hero-tag {
    letter-spacing: 3px;
    font-size: 9px;
  }

  .search {
    height: 56px;

    margin-top: 28px;

    border-radius: 17px;
  }

  .search input {
    font-size: 13px;
  }

  .search-tabs {
    gap: 5px;
  }

  .mode-btn {
    padding: 8px 10px;
    font-size: 10px;
  }

  .trending {
    justify-content: flex-start;
    text-align: left;
  }

  .trending b {
    width: 100%;
  }

  .home-grid {
    width: 94%;
  }

  .feature-img {
    min-height: 190px;
  }

  .quick-grid {
    grid-template-columns:
      repeat(2, 1fr);

    padding: 12px;
  }

  .quick-grid button {
    min-height: 88px;
  }

  .map-controls {
    left: 10px;
    bottom: 10px;
  }

  .map-controls button {
    min-width: auto;
    width: 46px;
    height: 46px;

    display: flex;
    align-items: center;
    justify-content: center;

    padding: 0;

    border-radius: 50%;
  }

  .map-controls button span {
    display: none;
  }

  .map-place-info {
    left: 10px;
    right: 10px;
    bottom: 10px;
    max-width: none;
    margin-bottom: 235px;
  }

  #hexoraMap {
    height: 620px;
  }

  footer {
    flex-direction: column;
    text-align: center;
    padding: 30px 15px;
  }

}

`;

document.head.appendChild(style);


/* =========================================================
   HELPERS
   ========================================================= */

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


/* =========================================================
   ELEMENTS
   ========================================================= */

const form = document.getElementById("searchForm");
const input = document.getElementById("q");

const home = document.getElementById("homeContent");

const searchView = document.getElementById("searchView");
const resultMeta = document.getElementById("resultMeta");
const results = document.getElementById("results");

const hero = document.getElementById("hero");
const heroContent = document.querySelector(".hero-content");

const searchTabs = document.querySelector(".search-tabs");
const trending = document.querySelector(".trending");

const mapView = document.getElementById("mapView");
const mapSearchInput = document.getElementById("mapSearchInput");
const mapSearchBtn = document.getElementById("mapSearchBtn");

const homeNews = document.getElementById("homeNews");

let currentMode = "web";

let map = null;
let userMarker = null;
let searchMarker = null;

let defaultMapCenter = [92.9376, 26.2006];
let defaultMapZoom = 7;


/* =========================================================
   LOAD MAPLIBRE
   ========================================================= */

function loadScript(src) {
  return new Promise((resolve, reject) => {

    const existing = document.querySelector(
      'script[src="' + src + '"]'
    );

    if (existing) {
      if (window.maplibregl) {
        resolve();
        return;
      }

      existing.addEventListener("load", resolve);
      existing.addEventListener("error", reject);

      return;
    }

    const script = document.createElement("script");

    script.src = src;
    script.async = true;

    script.onload = resolve;
    script.onerror = reject;

    document.head.appendChild(script);
  });
}


function loadCSS(href) {

  if (
    document.querySelector(
      'link[href="' + href + '"]'
    )
  ) {
    return;
  }

  const link = document.createElement("link");

  link.rel = "stylesheet";
  link.href = href;

  document.head.appendChild(link);
}


/* =========================================================
   MAP
   ========================================================= */

async function initMap() {

  if (map) {
    setTimeout(() => {
      map.resize();
    }, 100);

    return;
  }

  try {

    loadCSS(
      "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css"
    );

    await loadScript(
      "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"
    );

    if (!window.maplibregl) {
      throw new Error("MapLibre could not be loaded");
    }


    /*
     * REAL OPENSTREETMAP RASTER MAP
     *
     * This uses actual OSM map tiles.
     * No fake map data.
     */

    const style = {

      version: 8,

      sources: {

        "hexora-osm": {

          type: "raster",

          tiles: [
            "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          ],

          tileSize: 256,

          attribution:
            "© OpenStreetMap contributors"

        }

      },

      layers: [

        {

          id: "hexora-osm-layer",

          type: "raster",

          source: "hexora-osm",

          minzoom: 0,

          maxzoom: 19

        }

      ]

    };


    map = new maplibregl.Map({

      container: "hexoraMap",

      style,

      center: defaultMapCenter,

      zoom: defaultMapZoom,

      pitch: 0,

      bearing: 0,

      attributionControl: true

    });


    map.addControl(
      new maplibregl.NavigationControl({
        visualizePitch: true
      }),
      "top-right"
    );


    map.addControl(
      new maplibregl.FullscreenControl(),
      "top-right"
    );


    map.on("load", () => {

      setTimeout(() => {
        map.resize();
      }, 200);

    });


    map.on("error", event => {

      console.error(
        "HEXORA MAP ERROR:",
        event
      );

    });


  } catch (error) {

    console.error(
      "HEXORA Map initialization error:",
      error
    );

    document.getElementById("hexoraMap").innerHTML = `
      <div style="
        height:100%;
        display:flex;
        align-items:center;
        justify-content:center;
        text-align:center;
        padding:30px;
        color:#8996aa;
        background:#0b111b;
      ">
        <div>
          <div style="font-size:35px;margin-bottom:12px;">⌖</div>
          <b style="color:#fff;">
            HEXORA Map could not load
          </b>
          <br><br>
          <small>
            Please check your internet connection.
          </small>
        </div>
      </div>
    `;
  }

}


/* =========================================================
   SHOW HOME
   ========================================================= */

function showHome() {

  home.style.display = "";

  searchView.classList.remove("active");

  mapView.classList.remove("active");

  hero.style.minHeight = "475px";
  hero.style.height = "";

  heroContent.style.paddingTop = "28px";

  document.querySelector(".hero-tag").style.display = "";
  trending.style.display = "";
  searchTabs.style.display = "";

}


/* =========================================================
   SHOW SEARCH
   ========================================================= */

function showSearch() {

  home.style.display = "none";

  searchView.classList.add("active");

  mapView.classList.remove("active");

  hero.style.minHeight = "170px";
  hero.style.height = "170px";

  heroContent.style.paddingTop = "22px";

  document.querySelector(".hero-logo").style.fontSize =
    window.innerWidth < 600 ? "32px" : "38px";

  document.querySelector(".hero-tag").style.display = "none";

  trending.style.display = "none";

  searchTabs.style.display = "none";

}


/* =========================================================
   SHOW MAP
   ========================================================= */

async function showMap() {

  currentMode = "maps";

  home.style.display = "none";

  searchView.classList.remove("active");

  mapView.classList.add("active");

  hero.style.minHeight = "0";
  hero.style.height = "0";

  heroContent.style.display = "none";

  await initMap();

  setTimeout(() => {

    if (map) {
      map.resize();
    }

  }, 150);

}


/* =========================================================
   MODE BUTTONS
   ========================================================= */

function setActiveMode(mode) {

  currentMode = mode;

  document
    .querySelectorAll(".mode-btn")
    .forEach(button => {

      button.classList.toggle(
        "active",
        button.dataset.mode === mode
      );

    });

}


/* =========================================================
   SEARCH
   ========================================================= */

async function doSearch(query, mode = "web") {

  query = String(query || "").trim();

  if (!query) {
    input.focus();
    return;
  }


  setActiveMode(mode);


  if (mode === "maps") {

    await showMap();

    mapSearchInput.value = query;

    await searchMapPlace(query);

    return;
  }


  showSearch();

  input.value = query;

  resultMeta.textContent =
    `Searching HEXORA for "${query}"…`;

  results.innerHTML = `
    <div class="empty">
      🔎 HEXORA is searching...
    </div>
  `;


  history.replaceState(
    {},
    "",
    "?q=" + encodeURIComponent(query)
  );


  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      15000
    );


  try {

    let endpoint = "/api/search?q=" +
      encodeURIComponent(query);


    /*
     * If backend later supports modes,
     * it can automatically receive mode.
     */

    endpoint +=
      "&mode=" +
      encodeURIComponent(mode);


    const response = await fetch(
      endpoint,
      {
        method: "GET",

        headers: {
          "Accept": "application/json"
        },

        signal: controller.signal
      }
    );


    clearTimeout(timeout);


    let data;

    try {

      data = await response.json();

    } catch {

      throw new Error(
        "HEXORA returned invalid JSON"
      );

    }


    if (
      !response.ok ||
      data.ok === false
    ) {

      throw new Error(
        data.error ||
        "HEXORA search failed"
      );

    }


    const rows =
      Array.isArray(data.results)
        ? data.results
        : [];


    resultMeta.textContent =
      `About ${
        Number(data.total || rows.length)
      } indexed results for "${query}"`;


    if (!rows.length) {

      results.innerHTML = `
        <div class="empty">

          No matching indexed pages found.

          <br><br>

          HEXORA is continuously expanding
          its independent web index.

        </div>
      `;

      return;
    }


    results.innerHTML =
      rows.map(item => {

        const title =
          item.title ||
          item.url ||
          "Untitled";


        const url =
          item.url ||
          "#";


        const description =
          item.description ||
          "No description available.";


        const image =
          item.image_url
            ? `
              <img
                class="result-image"
                src="${esc(item.image_url)}"
                alt=""
                loading="lazy"
                onerror="this.style.display='none'"
              >
            `
            : "";


        const score =
          Number.isFinite(
            Number(item.score)
          )
            ? Number(item.score)
            : null;


        return `

          <article class="result">

            ${image}

            <h2>

              <a
                href="${esc(url)}"
                target="_blank"
                rel="noopener noreferrer"
              >
                ${esc(title)}
              </a>

            </h2>

            <div class="url">
              ${esc(url)}
            </div>

            <p>
              ${esc(description)}
            </p>

            ${
              score !== null
                ? `
                  <small
                    style="
                      display:block;
                      margin-top:7px;
                      color:#68758a;
                      font-size:9px;
                    "
                  >
                    HEXORA relevance: ${score}
                  </small>
                `
                : ""
            }

          </article>

        `;

      }).join("");


  } catch (error) {

    clearTimeout(timeout);

    console.error(
      "HEXORA search error:",
      error
    );


    resultMeta.textContent = "";


    if (
      error &&
      error.name === "AbortError"
    ) {

      results.innerHTML = `
        <div class="empty">

          HEXORA search timed out.

          <br><br>

          Please try the search again.

        </div>
      `;

      return;
    }


    results.innerHTML = `
      <div class="empty">

        HEXORA search service error:

        <br><br>

        ${esc(
          error &&
          error.message
            ? error.message
            : "Unknown error"
        )}

      </div>
    `;

  }

}


/* =========================================================
   REAL NEWS
   ========================================================= */

async function loadRealNews() {

  try {

    const response = await fetch(
      "/api/news",
      {
        method: "GET",

        headers: {
          "Accept": "application/json"
        }
      }
    );


    if (!response.ok) {
      throw new Error(
        "News API returned " +
        response.status
      );
    }


    const data =
      await response.json();


    const rows =
      Array.isArray(data.results)
        ? data.results
        : Array.isArray(data.items)
          ? data.items
          : [];


    if (!rows.length) {
      return;
    }


    homeNews.innerHTML =
      rows.slice(0, 5).map(item => {

        const title =
          item.title ||
          item.name ||
          "Untitled";


        const url =
          item.url ||
          item.link ||
          "#";


        const source =
          item.source ||
          item.publisher ||
          "News";


        const date =
          item.published_at ||
          item.publishedAt ||
          item.date ||
          "Recently indexed";


        const image =
          item.image_url ||
          item.image ||
          "";


        const thumb = image
          ? `
            <img
              src="${esc(image)}"
              alt=""
              loading="lazy"
              style="
                width:76px;
                height:55px;
                object-fit:cover;
                border-radius:11px;
              "
              onerror="this.style.display='none'"
            >
          `
          : `
            <div class="thumb">
              NEWS
            </div>
          `;


        return `

          <div class="news-row">

            ${thumb}

            <div>

              <small>
                ${esc(source)}
              </small>

              <b>
                <a
                  href="${esc(url)}"
                  target="_blank"
                  rel="noopener noreferrer"
                  style="
                    color:#dce3ed;
                    text-decoration:none;
                  "
                >
                  ${esc(title)}
                </a>
              </b>

              <time>
                ${esc(String(date))}
              </time>

            </div>

          </div>

        `;

      }).join("");


  } catch (error) {

    console.error(
      "HEXORA news error:",
      error
    );

  }

}


/* =========================================================
   NOMINATIM MAP SEARCH
   ========================================================= */

async function searchMapPlace(query) {

  query = String(query || "").trim();

  if (!query) {
    return;
  }


  if (!map) {
    await initMap();
  }


  const info =
    document.getElementById(
      "mapPlaceInfo"
    );


  info.classList.add("show");

  info.innerHTML =
    "⌕ Searching real map data...";


  try {

    const url =
      "https://nominatim.openstreetmap.org/search" +
      "?format=jsonv2" +
      "&q=" +
      encodeURIComponent(query) +
      "&limit=8" +
      "&addressdetails=1";


    const response =
      await fetch(
        url,
        {
          method: "GET",

          headers: {
            "Accept":
              "application/json"
          }
        }
      );


    if (!response.ok) {

      throw new Error(
        "Place search failed"
      );

    }


    const places =
      await response.json();


    if (
      !Array.isArray(places) ||
      !places.length
    ) {

      info.innerHTML = `
        No real map place found for
        <b>${esc(query)}</b>.
      `;

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
        "Invalid map coordinates"
      );

    }


    map.flyTo({

      center: [
        lon,
        lat
      ],

      zoom: 15,

      speed: 1.2,

      essential: true

    });


    if (searchMarker) {
      searchMarker.remove();
    }


    searchMarker =
      new maplibregl.Marker({
        color: "#7565ff"
      })
      .setLngLat([
        lon,
        lat
      ])
      .addTo(map);


    const displayName =
      place.display_name ||
      query;


    info.innerHTML = `

      <b style="font-size:13px;">
        ${esc(
          place.name ||
          query
        )}
      </b>

      <br>

      <span style="
        display:block;
        margin-top:6px;
        color:#8d9ab0;
        line-height:1.5;
      ">
        ${esc(displayName)}
      </span>

    `;


  } catch (error) {

    console.error(
      "HEXORA map search error:",
      error
    );


    info.innerHTML = `
      Map search error:
      <br><br>
      ${esc(error.message)}
    `;

  }

}


/* =========================================================
   MY LOCATION
   ========================================================= */

function locateUser() {

  if (!navigator.geolocation) {

    alert(
      "This browser does not support location."
    );

    return;
  }


  const info =
    document.getElementById(
      "mapPlaceInfo"
    );


  info.classList.add("show");

  info.innerHTML =
    "⌖ Getting your device location...";


  navigator.geolocation.getCurrentPosition(

    position => {

      const lat =
        position.coords.latitude;

      const lon =
        position.coords.longitude;


      if (!map) {
        return;
      }


      map.flyTo({

        center: [
          lon,
          lat
        ],

        zoom: 16,

        speed: 1.2,

        essential: true

      });


      if (userMarker) {
        userMarker.remove();
      }


      userMarker =
        new maplibregl.Marker({
          color: "#4f8cff"
        })
        .setLngLat([
          lon,
          lat
        ])
        .setPopup(
          new maplibregl.Popup({
            offset: 25
          }).setHTML(
            "<b>HEXORA</b><br>Your device location"
          )
        )
        .addTo(map);


      userMarker.togglePopup();


      info.innerHTML = `
        <b>Your current device location</b>
        <br><br>
        <span style="color:#8d9ab0;">
          Latitude: ${lat.toFixed(6)}
          <br>
          Longitude: ${lon.toFixed(6)}
        </span>
      `;

    },

    error => {

      console.error(
        "HEXORA geolocation error:",
        error
      );


      let message =
        "Location permission was not available.";


      if (error.code === 1) {
        message =
          "Location permission denied. Enable location permission for this website.";
      }

      if (error.code === 2) {
        message =
          "Your device location could not be determined.";
      }

      if (error.code === 3) {
        message =
          "Location request timed out.";
      }


      info.classList.add("show");

      info.innerHTML =
        esc(message);

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

  if (!map) {
    return;
  }


  map.flyTo({

    center:
      defaultMapCenter,

    zoom:
      defaultMapZoom,

    pitch: 0,

    bearing: 0,

    speed: 1,

    essential: true

  });


  if (searchMarker) {

    searchMarker.remove();

    searchMarker = null;

  }


  document
    .getElementById("mapPlaceInfo")
    .classList.remove("show");

}


/* =========================================================
   SATELLITE
   ========================================================= */

function satelliteMessage() {

  /*
   * Do NOT fake satellite imagery.
   *
   * A real satellite provider must be configured
   * before switching the layer.
   */

  const info =
    document.getElementById(
      "mapPlaceInfo"
    );


  info.classList.add("show");

  info.innerHTML = `
    <b>Satellite layer</b>
    <br><br>
    <span style="color:#8d9ab0;line-height:1.5;">
      Real satellite imagery provider is not
      configured yet. HEXORA is keeping the
      real road map active instead of showing
      fake satellite imagery.
    </span>
  `;

}


/* =========================================================
   FULLSCREEN
   ========================================================= */

function fullscreenMap() {

  const element =
    document.getElementById(
      "hexoraMap"
    );


  if (!document.fullscreenElement) {

    if (element.requestFullscreen) {

      element.requestFullscreen();

    }

  } else {

    if (document.exitFullscreen) {

      document.exitFullscreen();

    }

  }

}


/* =========================================================
   EVENT: SEARCH FORM
   ========================================================= */

form.addEventListener(
  "submit",
  event => {

    event.preventDefault();

    doSearch(
      input.value,
      currentMode
    );

  }
);


/* =========================================================
   EVENT: MODE BUTTONS
   ========================================================= */

document
  .querySelectorAll(".mode-btn")
  .forEach(button => {

    button.addEventListener(
      "click",
      () => {

        const mode =
          button.dataset.mode ||
          "web";


        const query =
          input.value.trim();


        setActiveMode(mode);


        if (mode === "maps") {

          showMap().then(() => {

            if (query) {

              mapSearchInput.value =
                query;

              searchMapPlace(query);

            }

          });

          return;
        }


        if (!query) {

          if (mode === "web") {
            showHome();
          }

          input.focus();

          return;
        }


        doSearch(
          query,
          mode
        );

      }
    );

  });


/* =========================================================
   EVENT: TRENDING
   ========================================================= */

document
  .querySelectorAll(
    ".trending button"
  )
  .forEach(button => {

    button.addEventListener(
      "click",
      () => {

        setActiveMode("web");

        doSearch(
          button.textContent,
          "web"
        );

      }
    );

  });


/* =========================================================
   EVENT: RELATED
   ========================================================= */

document
  .querySelectorAll(
    ".related button"
  )
  .forEach(button => {

    button.addEventListener(
      "click",
      () => {

        setActiveMode("web");

        doSearch(
          button.textContent,
          "web"
        );

      }
    );

  });


/* =========================================================
   EVENT: QUICK ACCESS
   ========================================================= */

document
  .querySelectorAll(
    ".quick-grid button"
  )
  .forEach(button => {

    button.addEventListener(
      "click",
      () => {

        const mode =
          button.dataset.mode ||
          "web";


        if (mode === "maps") {

          showMap();

          return;

        }


        const query =
          input.value.trim();


        if (query) {

          doSearch(
            query,
            mode
          );

        } else {

          setActiveMode(mode);

          input.focus();

        }

      }
    );

  });


/* =========================================================
   OPEN MAP
   ========================================================= */

document
  .getElementById(
    "openMapBtn"
  )
  .addEventListener(
    "click",
    () => {

      showMap();

    }
  );


/* =========================================================
   MAP SEARCH
   ========================================================= */

mapSearchBtn.addEventListener(
  "click",
  () => {

    searchMapPlace(
      mapSearchInput.value
    );

  }
);


mapSearchInput.addEventListener(
  "keydown",
  event => {

    if (
      event.key === "Enter"
    ) {

      event.preventDefault();

      searchMapPlace(
        mapSearchInput.value
      );

    }

  }
);


/* =========================================================
   MAP CONTROLS
   ========================================================= */

document
  .getElementById(
    "locateBtn"
  )
  .addEventListener(
    "click",
    locateUser
  );


document
  .getElementById(
    "roadBtn"
  )
  .addEventListener(
    "click",
    () => {

      if (map) {

        map.setPitch(0);

        map.setBearing(0);

      }

    }
  );


document
  .getElementById(
    "satelliteBtn"
  )
  .addEventListener(
    "click",
    satelliteMessage
  );


document
  .getElementById(
    "resetMapBtn"
  )
  .addEventListener(
    "click",
    resetMap
  );


document
  .getElementById(
    "fullscreenMapBtn"
  )
  .addEventListener(
    "click",
    fullscreenMap
  );


/* =========================================================
   VIEW ALL NEWS
   ========================================================= */

document
  .querySelector(
    ".view-all"
  )
  .addEventListener(
    "click",
    () => {

      const query =
        input.value.trim();


      if (query) {

        doSearch(
          query,
          "news"
        );

      } else {

        doSearch(
          "latest news",
          "news"
        );

      }

    }
  );


/* =========================================================
   HEADER NAV
   ========================================================= */

document
  .querySelectorAll(
    ".main-nav a"
  )
  .forEach(link => {

    link.addEventListener(
      "click",
      event => {

        event.preventDefault();

        const mode =
          link.dataset.nav;


        document
          .querySelectorAll(
            ".main-nav a"
          )
          .forEach(item => {

            item.classList.remove(
              "active"
            );

          });


        link.classList.add(
          "active"
        );


        if (mode === "home") {

          history.replaceState(
            {},
            "",
            "/"
          );

          setActiveMode("web");

          showHome();

          return;

        }


        if (mode === "maps") {

          showMap();

          return;

        }


        if (
          mode === "web" ||
          mode === "images" ||
          mode === "news"
        ) {

          const query =
            input.value.trim();


          if (query) {

            doSearch(
              query,
              mode
            );

          } else {

            setActiveMode(mode);

            showSearch();

            resultMeta.textContent =
              `HEXORA ${mode} search`;

            results.innerHTML = `
              <div class="empty">
                Enter a search query above.
              </div>
            `;

          }

          return;

        }

      }
    );

  });


/* =========================================================
   MENU
   ========================================================= */

document
  .getElementById(
    "menuBtn"
  )
  .addEventListener(
    "click",
    () => {

      document
        .querySelector(".main-nav")
        .classList.toggle(
          "mobile-open"
        );

    }
  );


/* =========================================================
   INITIAL QUERY
   ========================================================= */

const initialQuery =
  new URLSearchParams(
    window.location.search
  ).get("q");


if (initialQuery) {

  doSearch(
    initialQuery,
    "web"
  );

} else {

  showHome();

}


/* =========================================================
   REAL NEWS LOAD
   ========================================================= */

loadRealNews();

console.log(
  "HEXORA main.js loaded successfully."
);
