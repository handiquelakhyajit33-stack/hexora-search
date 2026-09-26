const app = document.getElementById("app");

app.innerHTML = `
<div class="site">

  <header class="nav">

    <div class="brand">
      <div class="nmark">N</div>

      <div>
        <strong>HEXORA</strong>
        <small>SEARCH THE WORLD</small>
      </div>
    </div>

    <nav>
      <a class="active" href="/">⌂<span>Home</span></a>
      <a href="#web">◎<span>Web</span></a>
      <a href="#images">▧<span>Images</span></a>
      <a href="#news">▤<span>News</span></a>
      <a href="#maps">⌖<span>Maps</span></a>
      <a href="#more">⌄<span>More</span></a>
    </nav>

    <div class="right">
      ☀️
      <b>
        Assam<br>
        <em>28°C</em>
      </b>
      <i>◯</i>
      <strong>☰</strong>
    </div>

  </header>


  <section class="hero" id="hero">

    <div class="hero-shade"></div>

    <div class="hero-content">

      <div class="hero-logo">HEXORA</div>

      <div class="hero-tag">
        SEARCH THE WORLD
      </div>

      <form id="searchForm" class="search">

        <span>⌕</span>

        <input
          id="q"
          autocomplete="off"
          placeholder="Search anything... (e.g. Assam, AI, Python, Cricket, News, Maps)"
        >

        <button
          type="submit"
          aria-label="Search"
        >
          ⌕
        </button>

      </form>


      <div class="search-tabs">

        <button type="button" data-mode="web">
          ◎ &nbsp;Web
        </button>

        <button type="button" data-mode="images">
          ▧ &nbsp;Images
        </button>

        <button type="button" data-mode="news">
          ▤ &nbsp;News
        </button>

        <button type="button" data-mode="maps">
          ⌖ &nbsp;Maps
        </button>

        <button type="button" data-mode="videos">
          ▶ &nbsp;Videos
        </button>

        <button type="button" data-mode="shopping">
          ▢ &nbsp;Shopping
        </button>

      </div>


      <div class="trending">

        <b>⌁ Trending Searches</b>

        <button type="button">
          Assam news
        </button>

        <button type="button">
          India vs Australia
        </button>

        <button type="button">
          Python tutorial
        </button>

        <button type="button">
          AI tools
        </button>

        <button type="button">
          Travel Assam
        </button>

        <button type="button">
          Education
        </button>

        <button type="button">
          Cricket
        </button>

      </div>

    </div>

  </section>


  <section id="homeContent" class="home-grid">

    <div class="panel news">

      <div class="panel-title">
        ▤ <b>Latest News</b>
        <a href="#news">View all →</a>
      </div>

      <div class="news-row">

        <div class="thumb">
          ASSAM
        </div>

        <div>
          <small>India</small>

          <b>
            Search the latest information from HEXORA's own index
          </b>

          <time>
            Recently indexed
          </time>
        </div>

      </div>


      <div class="news-row">

        <div class="thumb">
          AI
        </div>

        <div>
          <small>Technology</small>

          <b>
            Discover indexed AI and technology pages
          </b>

          <time>
            Recently indexed
          </time>
        </div>

      </div>


      <div class="news-row">

        <div class="thumb">
          WEB
        </div>

        <div>
          <small>Web</small>

          <b>
            HEXORA continuously builds its independent index
          </b>

          <time>
            Recently indexed
          </time>
        </div>

      </div>

    </div>


    <div class="panel feature">

      <div class="feature-img">

        <span>
          Assam
        </span>

        <div>

          <h2>
            Explore Assam with HEXORA
          </h2>

          <p>
            Search places, information and the independent web index.
          </p>

        </div>

      </div>


      <div class="related">

        <b>
          ⌕ Related Searches
        </b>

        <button type="button">
          Assam tourism
        </button>

        <button type="button">
          Best colleges in Assam
        </button>

        <button type="button">
          Python for beginners
        </button>

        <button type="button">
          Latest news
        </button>

        <button type="button">
          Cricket live score
        </button>

        <button type="button">
          Travel destinations
        </button>

      </div>

    </div>


    <div class="panel quick">

      <div class="panel-title">
        ϟ <b>Quick Access</b>
      </div>


      <div class="quick-grid">

        <div>
          ⌖
          <b>HEXORA Map</b>
          <small>Explore places</small>
        </div>

        <div>
          ▧
          <b>HEXORA Images</b>
          <small>Beautiful moments</small>
        </div>

        <div>
          ▤
          <b>HEXORA News</b>
          <small>Latest updates</small>
        </div>

        <div>
          ▶
          <b>HEXORA Videos</b>
          <small>Watch & learn</small>
        </div>

        <div>
          ☁
          <b>HEXORA Weather</b>
          <small>Live weather</small>
        </div>

        <div>
          文
          <b>HEXORA Translate</b>
          <small>Any language</small>
        </div>

      </div>


      <div class="map-card">

        <div>

          <b>
            Explore the World with HEXORA Map
          </b>

          <small>
            Find places, get directions, explore in 3D
          </small>

          <button type="button">
            Open Map →
          </button>

        </div>

      </div>

    </div>

  </section>


  <section
    id="searchView"
    class="search-view"
  >

    <div id="resultMeta"></div>

    <div id="results"></div>

  </section>


  <footer>

    <div class="brand mini">

      <div class="nmark">
        N
      </div>

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
   HEXORA STYLE
========================================================= */

const style = document.createElement("style");

style.textContent = `

*{
  box-sizing:border-box;
}

html{
  scroll-behavior:smooth;
}

body{
  margin:0;
  font-family:Arial,Helvetica,sans-serif;
  color:#102347;
  background:#f8fbff;
}


/* NAV */

.nav{
  height:76px;
  background:#fff;
  display:flex;
  align-items:center;
  padding:0 38px;
  border-bottom:1px solid #e7edf6;
  gap:30px;
  position:relative;
  z-index:5;
}

.brand{
  display:flex;
  align-items:center;
  gap:9px;
  min-width:290px;
}

.brand strong{
  font-size:29px;
  letter-spacing:-1px;
}

.brand small{
  display:block;
  font-size:8px;
  letter-spacing:2.5px;
  margin-top:-1px;
}

.nmark{
  font-size:38px;
  font-weight:900;
  color:#1769ff;
  line-height:1;
}

.nav nav{
  display:flex;
  gap:28px;
  flex:1;
  justify-content:center;
  height:100%;
}

.nav nav a{
  text-decoration:none;
  color:#102347;
  font-size:22px;
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  gap:4px;
  border-bottom:3px solid transparent;
}

.nav nav a span{
  font-size:12px;
}

.nav nav a.active{
  color:#075cff;
  border-bottom-color:#1769ff;
}

.right{
  display:flex;
  align-items:center;
  gap:12px;
  font-size:20px;
}

.right b{
  font-size:12px;
  line-height:1.1;
}

.right em{
  font-style:normal;
  font-size:15px;
}

.right i{
  font-style:normal;
  font-size:30px;
}


/* HERO */

.hero{
  height:425px;
  position:relative;

  background:
    linear-gradient(
      180deg,
      #dff3ff 0%,
      #f7fbff 35%,
      #b9dff0 36%,
      #8dc1c9 58%,
      #4f8f78 78%,
      #1d5c48 100%
    );

  overflow:hidden;
}

.hero:before{
  content:"";
  position:absolute;
  left:-8%;
  right:-8%;
  bottom:0;
  height:52%;

  background:
    radial-gradient(
      ellipse at 8% 100%,
      #27684d 0 24%,
      transparent 25%
    ),
    radial-gradient(
      ellipse at 28% 100%,
      #3b7958 0 25%,
      transparent 26%
    ),
    radial-gradient(
      ellipse at 55% 100%,
      #2d7052 0 27%,
      transparent 28%
    ),
    radial-gradient(
      ellipse at 86% 100%,
      #235d48 0 25%,
      transparent 26%
    ),
    linear-gradient(
      180deg,
      transparent,
      #356f58
    );

  opacity:.9;
}

.hero:after{
  content:"";
  position:absolute;
  left:-5%;
  right:-5%;
  top:32%;
  height:22%;

  background:
    linear-gradient(
      170deg,
      transparent 0 28%,
      #6f9da0 29% 40%,
      #a9d0d0 41% 50%,
      #6b989a 51% 57%,
      transparent 58%
    );

  opacity:.55;
}

.hero-shade{
  position:absolute;
  inset:0;

  background:
    linear-gradient(
      180deg,
      rgba(255,255,255,.55),
      rgba(255,255,255,.05) 52%,
      rgba(0,55,55,.08) 100%
    );
}

.hero-content{
  position:relative;
  z-index:1;
  text-align:center;
  padding-top:48px;
}

.hero-logo{
  font-size:74px;
  font-weight:900;
  letter-spacing:5px;
  color:#102347;
}

.hero-tag{
  font-size:16px;
  letter-spacing:5px;
  font-weight:700;
  margin-top:-8px;
}


/* SEARCH */

.search{
  width:min(800px,90%);
  height:66px;
  background:#fff;
  border:1px solid #dce4ef;
  border-radius:38px;
  margin:26px auto 16px;
  display:flex;
  align-items:center;
  padding:5px 8px 5px 23px;
  box-shadow:0 8px 28px #10234720;
}

.search>span{
  font-size:31px;
}

.search input{
  flex:1;
  border:0;
  outline:0;
  font-size:17px;
  padding:0 14px;
  color:#243754;
}

.search button{
  width:53px;
  height:53px;
  border:0;
  border-radius:50%;
  background:#1265f5;
  color:#fff;
  font-size:28px;
  cursor:pointer;
}


/* TABS */

.search-tabs,
.trending{
  display:flex;
  justify-content:center;
  gap:9px;
  flex-wrap:wrap;
}

.search-tabs button,
.trending button,
.related button{
  background:#fff;
  border:1px solid #dbe3ee;
  border-radius:25px;
  padding:10px 18px;
  color:#17325d;
  font-weight:600;
  cursor:pointer;
}

.search-tabs button:hover,
.trending button:hover,
.related button:hover{
  border-color:#1265f5;
  color:#1265f5;
}

.trending{
  margin:40px auto 0;
  align-items:center;
}

.trending b{
  color:#0962ee;
}


/* HOME */

.home-grid{
  max-width:1470px;
  margin:-2px auto 25px;
  padding:0 28px;
  display:grid;
  grid-template-columns:1fr 1.05fr 1fr;
  gap:22px;
  position:relative;
  z-index:2;
}

.panel{
  background:#fff;
  border:1px solid #e2e9f2;
  border-radius:13px;
  box-shadow:0 5px 20px #193c6710;
  overflow:hidden;
}

.panel-title{
  padding:18px 20px;
  border-bottom:1px solid #edf1f6;
  font-size:16px;
  display:flex;
  gap:9px;
}

.panel-title a{
  margin-left:auto;
  color:#0863ff;
  font-size:12px;
  text-decoration:none;
}


/* NEWS */

.news-row{
  display:flex;
  gap:13px;
  padding:12px 18px;
  border-bottom:1px solid #edf1f6;
}

.thumb{
  width:120px;
  height:74px;
  border-radius:7px;

  background:
    linear-gradient(
      135deg,
      #2589ec,
      #173967
    );

  display:flex;
  align-items:center;
  justify-content:center;
  color:#fff;
  font-weight:800;
  flex:none;
  overflow:hidden;
}

.thumb img{
  width:100%;
  height:100%;
  object-fit:cover;
  border-radius:7px;
}

.news-row small{
  display:block;
  color:#0863ff;
}

.news-row b{
  display:block;
  font-size:14px;
  margin:3px 0;
}

.news-row time{
  color:#8994a6;
  font-size:11px;
}


/* FEATURE */

.feature{
  padding:0;
}

.feature-img{
  height:300px;

  background:
    linear-gradient(
      180deg,
      #55aef2,
      #165f80 45%,
      #123827
    );

  position:relative;
  color:#fff;
  display:flex;
  align-items:flex-end;
  padding:20px;
}

.feature-img:before{
  content:"";
  position:absolute;
  inset:0;

  background:
    radial-gradient(
      circle at 20% 25%,
      #fff8,
      transparent 22%
    ),
    linear-gradient(
      135deg,
      transparent 40%,
      #083d3a55
    );
}

.feature-img span{
  position:absolute;
  top:16px;
  left:16px;
  background:#1265f5;
  padding:7px 15px;
  border-radius:18px;
  font-size:12px;
}

.feature-img div{
  position:relative;
}

.feature-img h2{
  margin:0 0 7px;
  font-size:23px;
}

.feature-img p{
  margin:0;
  max-width:500px;
}

.related{
  padding:17px;
  display:flex;
  align-items:center;
  gap:8px;
  flex-wrap:wrap;
}

.related b{
  width:100%;
  margin-bottom:2px;
}

.related button{
  padding:8px 13px;
  font-size:11px;
}


/* QUICK */

.quick-grid{
  display:grid;
  grid-template-columns:repeat(3,1fr);
  gap:12px;
  padding:15px;
}

.quick-grid div{
  border:1px solid #e6edf6;
  border-radius:10px;
  min-height:108px;
  padding:17px;
  text-align:center;
  color:#1265f5;
  font-size:25px;
}

.quick-grid b,
.quick-grid small{
  display:block;
  color:#12305b;
  margin-top:8px;
  font-size:12px;
}

.quick-grid small{
  color:#8a94a5;
  font-size:10px;
}

.map-card{
  margin:0 15px 15px;
  min-height:110px;
  border-radius:12px;

  background:
    linear-gradient(
      135deg,
      #dff1ff,
      #f7fbff
    );

  display:flex;
  align-items:center;
  padding:18px;
}

.map-card b,
.map-card small{
  display:block;
}

.map-card small{
  margin:7px 0;
  color:#63748c;
  font-size:11px;
}

.map-card button{
  background:#1265f5;
  border:0;
  color:#fff;
  border-radius:18px;
  padding:8px 15px;
  cursor:pointer;
}


/* SEARCH RESULTS */

.search-view{
  max-width:980px;
  margin:auto;
  padding:25px 22px 60px;
  display:none;
}

.search-view.active{
  display:block;
}

.search-view #resultMeta{
  color:#738198;
  margin-bottom:10px;
}

.result{
  padding:17px 0;
  border-bottom:1px solid #e7edf4;
}

.result h2{
  font-size:20px;
  margin:0;
}

.result h2 a{
  color:#125db5;
  text-decoration:none;
}

.result h2 a:hover{
  text-decoration:underline;
}

.result .url{
  font-size:12px;
  color:#19814a;
  margin:6px 0;
  word-break:break-all;
}

.result p{
  color:#536075;
  line-height:1.5;
  margin:0;
}

.result-image{
  width:120px;
  height:75px;
  object-fit:cover;
  border-radius:8px;
  margin-bottom:8px;
  display:block;
}

.empty{
  padding:40px 0;
  color:#738198;
}


/* FOOTER */

footer{
  background:#fff;
  border-top:1px solid #e4eaf3;
  padding:22px 38px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  color:#617087;
  font-size:12px;
}

.mini{
  min-width:200px;
}

.mini strong{
  font-size:20px;
}

.mini .nmark{
  font-size:25px;
}


/* RESPONSIVE */

@media(max-width:1000px){

  .nav{
    height:64px;
    padding:0 12px;
  }

  .brand{
    min-width:auto;
  }

  .brand small,
  .nav nav a span{
    display:none;
  }

  .nav nav{
    gap:10px;
  }

  .home-grid{
    grid-template-columns:1fr;
  }

  .hero{
    height:470px;
  }

}


@media(max-width:600px){

  body{
    overflow-x:hidden;
  }

  .nav{
    height:58px;
    gap:8px;
    padding:0 10px;
  }

  .brand{
    gap:5px;
  }

  .brand strong{
    font-size:19px;
  }

  .brand .nmark{
    font-size:27px;
  }

  .brand small{
    display:none;
  }

  .right{
    font-size:14px;
    gap:7px;
  }

  .right b{
    font-size:9px;
  }

  .right em{
    font-size:11px;
  }

  .right i{
    font-size:20px;
  }

  .right strong{
    font-size:18px;
  }

  .hero{
    height:392px;

    background:
      linear-gradient(
        180deg,
        #e5f6ff 0%,
        #f7fbff 31%,
        #b9dbe2 32%,
        #7eafb2 55%,
        #4e8d70 75%,
        #235d49 100%
      );
  }

  .hero:before{
    height:49%;
    bottom:-4%;
    opacity:.95;
  }

  .hero:after{
    top:31%;
    height:21%;
  }

  .hero-content{
    padding-top:34px;
  }

  .hero-logo{
    font-size:46px;
    letter-spacing:3px;
  }

  .hero-tag{
    font-size:9px;
    letter-spacing:3px;
    margin-top:1px;
  }

  .search{
    width:calc(100% - 24px);
    height:55px;
    margin:20px auto 12px;
    padding-left:15px;
  }

  .search>span{
    font-size:25px;
  }

  .search input{
    font-size:14px;
    padding:0 8px;
  }

  .search button{
    width:45px;
    height:45px;
    font-size:23px;
  }

  .search-tabs{
    justify-content:flex-start;
    overflow-x:auto;
    flex-wrap:nowrap;
    padding:0 12px 5px;
    scrollbar-width:none;
  }

  .search-tabs::-webkit-scrollbar{
    display:none;
  }

  .search-tabs button{
    white-space:nowrap;
    padding:8px 13px;
    font-size:11px;
  }

  .trending{
    justify-content:flex-start;
    overflow-x:auto;
    flex-wrap:nowrap;
    padding:0 12px 5px;
    margin-top:20px;
    scrollbar-width:none;
  }

  .trending::-webkit-scrollbar{
    display:none;
  }

  .trending b,
  .trending button{
    white-space:nowrap;
    font-size:10px;
  }

  .home-grid{
    display:flex;
    flex-direction:column;
    gap:14px;
    padding:0 10px;
    margin:12px auto 18px;
  }

  .panel{
    border-radius:11px;
  }

  .panel-title{
    padding:14px 14px;
    font-size:14px;
  }

  .news-row{
    padding:10px 12px;
    gap:10px;
  }

  .thumb{
    width:88px;
    height:64px;
    font-size:12px;
  }

  .news-row b{
    font-size:12px;
  }

  .news-row small{
    font-size:10px;
  }

  .feature-img{
    height:225px;
    padding:16px;
  }

  .feature-img h2{
    font-size:20px;
  }

  .feature-img p{
    font-size:12px;
  }

  .related{
    padding:13px;
    gap:6px;
    overflow:hidden;
  }

  .related b{
    font-size:13px;
  }

  .related button{
    white-space:nowrap;
    font-size:9px;
    padding:7px 10px;
  }

  .quick-grid{
    grid-template-columns:repeat(2,1fr);
    gap:8px;
    padding:11px;
  }

  .quick-grid div{
    min-height:95px;
    padding:12px;
    font-size:21px;
  }

  .quick-grid b{
    font-size:10px;
  }

  .quick-grid small{
    font-size:9px;
  }

  .map-card{
    margin:0 11px 11px;
    min-height:100px;
    padding:13px;
  }

  .map-card b{
    font-size:13px;
  }

  .map-card small{
    font-size:9px;
  }

  .search-view{
    padding:18px 15px 45px;
  }

  .result{
    padding:15px 0;
  }

  .result h2{
    font-size:17px;
  }

  .result p{
    font-size:13px;
  }

  footer{
    padding:18px 12px;
    flex-direction:column;
    gap:9px;
    text-align:center;
    font-size:10px;
  }

  .mini{
    min-width:auto;
  }

}

`;

document.head.appendChild(style);


/* =========================================================
   HELPERS
========================================================= */

function esc(value = "") {

  return String(value).replace(
    /[&<>"']/g,
    function(char){

      return {
        "&":"&amp;",
        "<":"&lt;",
        ">":"&gt;",
        '"':"&quot;",
        "'":"&#039;"
      }[char];

    }
  );

}


/* =========================================================
   REAL HEXORA NEWS
========================================================= */

async function loadRealNews(){

  try{

    const response =
      await fetch(
        "/api/news",
        {
          method:"GET",
          headers:{
            "Accept":"application/json"
          }
        }
      );

    if(!response.ok){
      throw new Error(
        "News request failed: " +
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

    const panel =
      document.querySelector(".news");

    if(!panel){
      return;
    }

    if(!rows.length){

      panel.innerHTML = `
        <div class="panel-title">
          ▤ <b>Latest News</b>
        </div>

        <div class="empty">
          HEXORA news index is being updated.
        </div>
      `;

      return;
    }


    const list =
      rows
      .slice(0,6)
      .map(function(news){

        const date =
          news.published_at
            ? new Date(
                news.published_at
              ).toLocaleString(
                "en-IN",
                {
                  day:"numeric",
                  month:"short",
                  hour:"numeric",
                  minute:"2-digit"
                }
              )
            : "";


        const image =
          news.image_url
            ? `
              <img
                src="${esc(news.image_url)}"
                alt=""
                loading="lazy"
                onerror="this.style.display='none'"
              >
            `
            : "NEWS";


        return `
          <div class="news-row">

            <div class="thumb">
              ${image}
            </div>

            <div>

              <small>
                ${esc(
                  news.source_name ||
                  news.source_domain ||
                  "Web"
                )}
              </small>

              <b>
                ${esc(
                  news.title ||
                  "Untitled"
                )}
              </b>

              <time>
                ${esc(date)}
                ${
                  news.source_domain
                    ? " · Source: " +
                      esc(news.source_domain)
                    : ""
                }
              </time>

            </div>

          </div>
        `;

      })
      .join("");


    panel.innerHTML = `
      <div class="panel-title">
        ▤ <b>Latest News</b>
        <a href="#news">
          Live source feed
        </a>
      </div>

      ${list}
    `;

  }catch(error){

    console.error(
      "HEXORA news error:",
      error
    );

  }

}


/* =========================================================
   SEARCH ELEMENTS
========================================================= */

const form =
  document.getElementById(
    "searchForm"
  );

const input =
  document.getElementById(
    "q"
  );

const home =
  document.getElementById(
    "homeContent"
  );

const searchView =
  document.getElementById(
    "searchView"
  );

const meta =
  document.getElementById(
    "resultMeta"
  );

const results =
  document.getElementById(
    "results"
  );


/* =========================================================
   SHOW SEARCH PAGE
========================================================= */

function showSearch(){

  home.style.display = "none";

  const hero =
    document.getElementById(
      "hero"
    );

  const heroContent =
    document.querySelector(
      ".hero-content"
    );

  const heroLogo =
    document.querySelector(
      ".hero-logo"
    );

  const heroTag =
    document.querySelector(
      ".hero-tag"
    );

  const trending =
    document.querySelector(
      ".trending"
    );

  const searchTabs =
    document.querySelector(
      ".search-tabs"
    );


  hero.style.height =
    "170px";

  heroContent.style.paddingTop =
    "22px";

  heroLogo.style.fontSize =
    window.innerWidth < 600
      ? "32px"
      : "38px";

  heroTag.style.display =
    "none";

  trending.style.display =
    "none";

  searchTabs.style.display =
    "none";

  searchView.classList.add(
    "active"
  );

}


/* =========================================================
   HEXORA WEB SEARCH
========================================================= */

async function doSearch(query){

  query =
    String(query || "").trim();

  if(!query){
    return;
  }


  showSearch();

  input.value =
    query;


  meta.textContent =
    `Searching HEXORA for "${query}"…`;


  results.innerHTML = `
    <div class="empty">
      🔎 HEXORA is searching...
    </div>
  `;


  history.replaceState(
    {},
    "",
    "?q=" +
    encodeURIComponent(query)
  );


  const controller =
    new AbortController();


  const timeout =
    setTimeout(
      function(){
        controller.abort();
      },
      15000
    );


  try{

    /*
     * IMPORTANT:
     *
     * Railway HEXORA API
     *
     * NOT:
     * /.netlify/functions/search
     *
     * Correct:
     * /api/search
     */

    const response =
      await fetch(
        "/api/search?q=" +
        encodeURIComponent(query),
        {
          method:"GET",

          headers:{
            "Accept":
              "application/json"
          },

          signal:
            controller.signal
        }
      );


    clearTimeout(timeout);


    let data;

    try{

      data =
        await response.json();

    }catch(jsonError){

      throw new Error(
        "HEXORA returned invalid JSON"
      );

    }


    if(
      !response.ok ||
      data.ok === false
    ){

      throw new Error(
        data.error ||
        "HEXORA search failed"
      );

    }


    const rows =
      Array.isArray(data.results)
        ? data.results
        : [];


    meta.textContent =
      `About ${
        Number(data.total || rows.length)
      } indexed results for "${query}"`;


    if(!rows.length){

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
      rows
      .map(function(item){

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
                      color:#9aa6b7;
                      font-size:10px;
                    "
                  >
                    HEXORA relevance: ${score}
                  </small>
                `
                : ""
            }

          </article>

        `;

      })
      .join("");


  }catch(error){

    console.error(
      "HEXORA search error:",
      error
    );


    meta.textContent =
      "";


    if(
      error &&
      error.name === "AbortError"
    ){

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
   SEARCH FORM
========================================================= */

form.addEventListener(
  "submit",
  function(event){

    event.preventDefault();

    doSearch(
      input.value
    );

  }
);


/* =========================================================
   TRENDING SEARCHES
========================================================= */

document
  .querySelectorAll(
    ".trending button"
  )
  .forEach(
    function(button){

      button.addEventListener(
        "click",
        function(){

          doSearch(
            button.textContent
          );

        }
      );

    }
  );


/* =========================================================
   RELATED SEARCHES
========================================================= */

document
  .querySelectorAll(
    ".related button"
  )
  .forEach(
    function(button){

      button.addEventListener(
        "click",
        function(){

          doSearch(
            button.textContent
          );

        }
      );

    }
  );


/* =========================================================
   SEARCH TABS
========================================================= */

document
  .querySelectorAll(
    ".search-tabs button"
  )
  .forEach(
    function(button){

      button.addEventListener(
        "click",
        function(){

          const mode =
            button.dataset.mode ||
            "web";

          const query =
            input.value.trim();


          if(!query){

            input.focus();

            return;
          }


          /*
           * Web mode is the current
           * fully connected HEXORA
           * search endpoint.
           *
           * Other modes remain ready
           * for their dedicated APIs.
           */

          if(mode === "web"){

            doSearch(query);

            return;

          }


          if(mode === "news"){

            doSearch(
              query
            );

            return;

          }


          /*
           * Until dedicated image,
           * video, map and shopping
           * endpoints are connected,
           * keep the existing web
           * index safe instead of
           * showing fake results.
           */

          doSearch(query);

        }
      );

    }
  );


/* =========================================================
   INITIAL URL SEARCH
==================================

======================= */

const initialQuery =
  new URLSearchParams(
    window.location.search
  ).get("q");


if(initialQuery){

  doSearch(
    initialQuery
  );

}


/* =========================================================
   LOAD REAL NEWS
========================================================= */

loadRealNews();
