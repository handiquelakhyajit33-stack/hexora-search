"use strict";

/* =========================================================
   HEXORA SEARCH + HEXORA EARTH
   REAL MAP / REAL SATELLITE / REAL LOCATION
   ========================================================= */

const CONFIG = {
  searchEndpoint: "/api/search",
  newsEndpoint: "/api/news",

  map: {
    defaultCenter: [91.7362, 26.1445],
    defaultZoom: 4,

    osmTiles:
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",

    satelliteTiles:
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",

    geocoder:
      "https://nominatim.openstreetmap.org/search"
  }
};

let map = null;
let mapMarker = null;
let mapStyleType = "street";
let mapReady = false;


/* =========================================================
   HELPERS
   ========================================================= */

function $(selector) {
  return document.querySelector(selector);
}

function $$(selector) {
  return Array.from(document.querySelectorAll(selector));
}

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeURL(url) {
  try {
    const value = String(url || "").trim();

    if (!value) {
      return "#";
    }

    if (
      value.startsWith("http://") ||
      value.startsWith("https://")
    ) {
      return value;
    }

    return new URL(
      value,
      window.location.origin
    ).href;
  } catch {
    return "#";
  }
}

function formatDate(value) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}


/* =========================================================
   MAPLIBRE LOADER
   ========================================================= */

function loadMapLibre() {
  return new Promise((resolve, reject) => {

    if (window.maplibregl) {
      resolve(window.maplibregl);
      return;
    }

    const existing = document.querySelector(
      'script[data-hexora-maplibre="true"]'
    );

    if (existing) {

      existing.addEventListener(
        "load",
        () => {
          if (window.maplibregl) {
            resolve(window.maplibregl);
          } else {
            reject(
              new Error(
                "MapLibre loaded but unavailable."
              )
            );
          }
        },
        { once: true }
      );

      existing.addEventListener(
        "error",
        () => {
          reject(
            new Error(
              "MapLibre failed to load."
            )
          );
        },
        { once: true }
      );

      return;
    }

    const link = document.createElement("link");

    link.rel = "stylesheet";
    link.href =
      "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css";

    link.dataset.hexoraMaplibre = "true";

    document.head.appendChild(link);

    const script = document.createElement("script");

    script.src =
      "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js";

    script.async = true;
    script.dataset.hexoraMaplibre = "true";

    script.onload = () => {

      if (window.maplibregl) {
        resolve(window.maplibregl);
      } else {
        reject(
          new Error(
            "MapLibre failed to initialize."
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
   MAP STYLES
   ========================================================= */

function streetStyle() {

  return {
    version: 8,

    sources: {

      hexoraOSM: {
        type: "raster",

        tiles: [
          CONFIG.map.osmTiles
        ],

        tileSize: 256,

        attribution:
          "© OpenStreetMap contributors"
      }

    },

    layers: [

      {
        id: "hexora-osm",

        type: "raster",

        source: "hexoraOSM"
      }

    ]
  };
}


function satelliteStyle() {

  return {
    version: 8,

    sources: {

      hexoraSatellite: {
        type: "raster",

        tiles: [
          CONFIG.map.satelliteTiles
        ],

        tileSize: 256,

        attribution:
          "© Esri"
      }

    },

    layers: [

      {
        id: "hexora-satellite",

        type: "raster",

        source: "hexoraSatellite"
      }

    ]
  };
}


/* =========================================================
   MAP INITIALIZATION
   ========================================================= */

async function initializeMap() {

  const container =
    $("#hexoraMap");

  if (!container) {
    return null;
  }

  if (map) {
    return map;
  }

  try {

    const maplibregl =
      await loadMapLibre();

    map =
      new maplibregl.Map({

        container:
          "hexoraMap",

        style:
          streetStyle(),

        center:
          CONFIG.map.defaultCenter,

        zoom:
          CONFIG.map.defaultZoom,

        pitch: 0,

        bearing: 0,

        attributionControl:
          true,

        antialias:
          true

      });


    /* -----------------------------------------
       Navigation
       ----------------------------------------- */

    map.addControl(

      new maplibregl.NavigationControl({
        visualizePitch: true
      }),

      "top-right"

    );


    /* -----------------------------------------
       Globe projection
       ----------------------------------------- */

    map.on(
      "load",
      () => {

        mapReady = true;

        try {

          map.setProjection({
            type: "globe"
          });

        } catch (error) {

          console.warn(
            "HEXORA globe projection unavailable:",
            error
          );

        }

      }
    );


    /* -----------------------------------------
       Error handling
       ----------------------------------------- */

    map.on(
      "error",
      (event) => {

        console.error(
          "HEXORA Map error:",
          event
        );

      }
    );


    return map;

  } catch (error) {

    console.error(
      "HEXORA Map loading error:",
      error
    );

    const info =
      $("#mapInfo");

    if (info) {

      info.textContent =
        "HEXORA Earth could not be loaded.";

      info.style.display =
        "block";

    }

    return null;
  }
}


/* =========================================================
   OPEN MAP
   ========================================================= */

async function openMap(options = {}) {

  const mapView =
    $("#mapView");

  const searchView =
    $("#searchView");

  const home =
    $("#homeView");

  if (!mapView) {
    return null;
  }

  if (searchView) {
    searchView.classList.remove(
      "active"
    );
  }

  if (home) {
    home.style.display =
      "none";
  }

  mapView.classList.add(
    "active"
  );

  const instance =
    await initializeMap();

  if (!instance) {
    return null;
  }

  setTimeout(() => {

    try {
      instance.resize();
    } catch {}

    if (options.center) {

      instance.flyTo({

        center:
          options.center,

        zoom:
          options.zoom || 13,

        speed:
          1.2,

        essential:
          true

      });

    }

  }, 200);

  return instance;
}


/* =========================================================
   CLOSE MAP
   ========================================================= */

function closeMap() {

  const mapView =
    $("#mapView");

  if (mapView) {

    mapView.classList.remove(
      "active"
    );

  }
}


/* =========================================================
   CHANGE MAP TYPE
   ========================================================= */

function changeMapStyle(type) {

  if (!map) {
    return;
  }

  const center =
    map.getCenter().toArray();

  const zoom =
    map.getZoom();

  const pitch =
    map.getPitch();

  const bearing =
    map.getBearing();

  mapStyleType =
    type === "satellite"
      ? "satellite"
      : "street";

  const style =
    mapStyleType === "satellite"
      ? satelliteStyle()
      : streetStyle();

  map.setStyle(style);

  map.once(
    "style.load",
    () => {

      try {

        map.jumpTo({

          center,
          zoom,
          pitch,
          bearing

        });

        map.setProjection({
          type: "globe"
        });

      } catch {}

    }
  );
}


/* =========================================================
   EARTH VIEW
   ========================================================= */

function earthView() {

  if (!map) {
    return;
  }

  try {

    map.setProjection({
      type: "globe"
    });

    map.easeTo({

      zoom: 2.5,

      pitch: 20,

      bearing: 0,

      duration: 1200

    });

  } catch (error) {

    console.error(
      "HEXORA Earth view error:",
      error
    );

  }
}


/* =========================================================
   STREET VIEW
   ========================================================= */

function streetView() {

  if (!map) {
    return;
  }

  changeMapStyle(
    "street"
  );

}


/* =========================================================
   SATELLITE VIEW
   ========================================================= */

function satelliteView() {

  if (!map) {
    return;
  }

  changeMapStyle(
    "satellite"
  );

}


/* =========================================================
   3D CAMERA
   ========================================================= */

function enable3D() {

  if (!map) {
    return;
  }

  try {

    map.easeTo({

      pitch: 65,

      bearing: -20,

      duration: 1200,

      essential: true

    });

  } catch (error) {

    console.error(
      "HEXORA 3D error:",
      error
    );

  }
}


/* =========================================================
   HIGH 3D CAMERA
   ========================================================= */

function enableHigh3D() {

  if (!map) {
    return;
  }

  try {

    map.easeTo({

      pitch: 80,

      bearing: -35,

      zoom:
        Math.max(
          map.getZoom(),
          10
        ),

      duration: 1400,

      essential: true

    });

  } catch (error) {

    console.error(
      "HEXORA High 3D error:",
      error
    );

  }
}


/* =========================================================
   MAP SEARCH
   ========================================================= */

async function searchMapPlace(query) {

  const value =
    String(query || "")
      .trim();

  if (!value) {
    return;
  }

  const info =
    $("#mapInfo");

  if (info) {

    info.textContent =
      "Searching place...";

    info.style.display =
      "block";

  }

  try {

    const url =
      new URL(
        CONFIG.map.geocoder
      );

    url.searchParams.set(
      "q",
      value
    );

    url.searchParams.set(
      "format",
      "json"
    );

    url.searchParams.set(
      "limit",
      "5"
    );

    url.searchParams.set(
      "addressdetails",
      "1"
    );


    const response =
      await fetch(
        url.toString(),
        {
          headers: {
            Accept:
              "application/json"
          }
        }
      );


    if (!response.ok) {

      throw new Error(
        `Geocoder HTTP ${response.status}`
      );

    }


    const places =
      await response.json();


    if (
      !Array.isArray(places) ||
      !places.length
    ) {

      if (info) {

        info.textContent =
          "Place not found.";

      }

      return;
    }


    const place =
      places[0];


    const lat =
      Number(place.lat);

    const lon =
      Number(place.lon);


    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon)
    ) {

      throw new Error(
        "Invalid coordinates."
      );

    }


    await openMap({

      center: [
        lon,
        lat
      ],

      zoom: 13

    });


    if (!map) {
      return;
    }


    map.flyTo({

      center: [
        lon,
        lat
      ],

      zoom: 13,

      pitch: 45,

      speed: 1.2,

      essential: true

    });


    addMapMarker([
      lon,
      lat
    ]);


    if (info) {

      info.textContent =
        place.display_name ||
        value;

    }

  } catch (error) {

    console.error(
      "HEXORA place search error:",
      error
    );

    if (info) {

      info.textContent =
        "Place search failed. Try again.";

    }

  }
}


/* =========================================================
   MAP MARKER
   ========================================================= */

function addMapMarker(
  coordinates
) {

  if (
    !map ||
    !window.maplibregl
  ) {
    return;
  }

  if (mapMarker) {

    mapMarker.remove();

    mapMarker = null;

  }


  mapMarker =
    new window.maplibregl.Marker({
      color: "#00e5ff"
    })
      .setLngLat(
        coordinates
      )
      .addTo(map);
}


/* =========================================================
   REAL DEVICE LOCATION
   ========================================================= */

function locateUser() {

  if (
    !navigator.geolocation
  ) {

    const info =
      $("#mapInfo");

    if (info) {

      info.textContent =
        "Your browser does not support GPS location.";

    }

    return;

  }


  const info =
    $("#mapInfo");


  if (info) {

    info.textContent =
      "Getting your real location...";

    info.style.display =
      "block";

  }


  navigator.geolocation.getCurrentPosition(

    async (position) => {

      const latitude =
        position.coords.latitude;

      const longitude =
        position.coords.longitude;

      const accuracy =
        position.coords.accuracy;


      await openMap({

        center: [
          longitude,
          latitude
        ],

        zoom: 16

      });


      if (!map) {
        return;
      }


      map.flyTo({

        center: [
          longitude,
          latitude
        ],

        zoom: 16,

        pitch: 55,

        speed: 1.2,

        essential: true

      });


      addMapMarker([
        longitude,
        latitude
      ]);


      if (info) {

        info.textContent =
          `Your location • Accuracy ±${Math.round(
            accuracy
          )} m`;

      }

    },


    (error) => {

      console.error(
        "HEXORA GPS error:",
        error
      );

      if (info) {

        if (
          error.code === 1
        ) {

          info.textContent =
            "Location permission denied. Allow location access in your browser.";

        } else {

          info.textContent =
            "Could not get your current location.";

        }

      }

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
   RESET MAP
   ========================================================= */

function resetMap() {

  if (!map) {
    return;
  }

  if (mapMarker) {

    mapMarker.remove();

    mapMarker = null;

  }


  try {

    map.setProjection({
      type: "globe"
    });

  } catch {}


  map.flyTo({

    center:
      CONFIG.map.defaultCenter,

    zoom:
      CONFIG.map.defaultZoom,

    pitch:
      0,

    bearing:
      0,

    speed:
      1.2,

    essential:
      true

  });


  const info =
    $("#mapInfo");

  if (info) {

    info.textContent =
      "";

    info.style.display =
      "none";

  }
}


/* =========================================================
   FULLSCREEN
   ========================================================= */

function fullscreenMap() {

  const mapView =
    $("#mapView");

  if (!mapView) {
    return;
  }

  if (
    !document.fullscreenElement
  ) {

    if (
      mapView.requestFullscreen
    ) {

      mapView.requestFullscreen();

    }

  } else {

    if (
      document.exitFullscreen
    ) {

      document.exitFullscreen();

    }

  }


  setTimeout(() => {

    if (map) {

      try {
        map.resize();
      } catch {}

    }

  }, 500);
}


/* =========================================================
   SEARCH ENGINE
   ========================================================= */

async function performSearch(
  query
) {

  const value =
    String(query || "")
      .trim();

  if (!value) {
    return;
  }

  closeMap();


  const home =
    $("#homeView");

  const searchView =
    $("#searchView");

  if (home) {

    home.style.display =
      "none";

  }

  if (searchView) {

    searchView.classList.add(
      "active"
    );

  }


  const resultMeta =
    $("#resultMeta");

  const results =
    $("#results");


  if (resultMeta) {

    resultMeta.textContent =
      `Searching for "${value}"...`;

  }


  if (results) {

    results.innerHTML = `
      <div class="search-loading">
        Searching HEXORA...
      </div>
    `;

  }


  try {

    const url =
      new URL(
        CONFIG.searchEndpoint,
        window.location.origin
      );

    url.searchParams.set(
      "q",
      value
    );


    const response =
      await fetch(
        url.toString(),
        {
          headers: {
            Accept:
              "application/json"
          }
        }
      );


    if (!response.ok) {

      throw new Error(
        `Search HTTP ${response.status}`
      );

    }


    const data =
      await response.json();


    const items =
      Array.isArray(data)
        ? data
        : Array.isArray(data.results)
          ? data.results
          : Array.isArray(data.data)
            ? data.data
            : [];


    renderSearchResults(
      items,
      value
    );

  } catch (error) {

    console.error(
      "HEXORA Search error:",
      error
    );


    if (resultMeta) {

      resultMeta.textContent =
        `Search: "${value}"`;

    }


    if (results) {

      results.innerHTML = `

        <div class="search-error">

          <h3>
            HEXORA Search Error
          </h3>

          <p>
            Search service is temporarily unavailable.
            Please try again.
          </p>

        </div>

      `;

    }

  }
}


/* =========================================================
   SEARCH RESULTS
   ========================================================= */

function renderSearchResults(
  items,
  query
) {

  const resultMeta =
    $("#resultMeta");

  const results =
    $("#results");


  if (resultMeta) {

    resultMeta.textContent =
      `${items.length} result${
        items.length === 1
          ? ""
          : "s"
      } for "${query}"`;

  }


  if (!results) {
    return;
  }


  if (!items.length) {

    results.innerHTML = `

      <div class="search-empty">

        <h3>
          No results found
        </h3>

        <p>
          Try another search query.
        </p>

      </div>

    `;

    return;
  }


  results.innerHTML =
    items
      .map((item) => {

        const title =
          item.title ||
          item.name ||
          "Untitled";


        const description =
          item.description ||
          item.snippet ||
          item.content ||
          "";


        const url =
          item.url ||
          item.link ||
          "#";


        const source =
          item.source_name ||
          item.source ||
          item.source_domain ||
          "";


        const date =
          item.published_at ||
          item.date ||
          item.publishedAt ||
          "";


        return `

          <article
            class="search-result"
          >

            <div
              class="result-source"
            >
              ${escapeHTML(source)}
            </div>


            <h2
              class="result-title"
            >

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


            <div
              class="result-url"
            >
              ${escapeHTML(url)}
            </div>


            <p
              class="result-description"
            >
              ${escapeHTML(
                description
              )}
            </p>


            ${
              date
                ? `

                  <div
                    class="result-date"
                  >
                    ${escapeHTML(
                      formatDate(date)
                    )}
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
   NEWS
   ========================================================= */

async function loadNews() {

  const newsList =
    $("#newsList");

  if (!newsList) {
    return;
  }

  try {

    const response =
      await fetch(
        CONFIG.newsEndpoint,
        {
          headers: {
            Accept:
              "application/json"
          }
        }
      );


    if (!response.ok) {

      throw new Error(
        `News HTTP ${response.status}`
      );

    }


    const data =
      await response.json();


    const items =
      Array.isArray(data)
        ? data
        : Array.isArray(data.results)
          ? data.results
          : Array.isArray(data.data)
            ? data.data
            : [];


    renderNews(items);

  } catch (error) {

    console.error(
      "HEXORA News error:",
      error
    );


    newsList.innerHTML = `

      <div class="news-error">
        News is temporarily unavailable.
      </div>

    `;

  }
}


/* =========================================================
   RENDER NEWS
   ========================================================= */

function renderNews(items) {

  const newsList =
    $("#newsList");

  if (!newsList) {
    return;
  }


  if (!items.length) {

    newsList.innerHTML = `

      <div class="news-empty">
        No news available right now.
      </div>

    `;

    return;
  }


  newsList.innerHTML =
    items
      .slice(0, 20)
      .map((item) => {

        const title =
          item.title ||
          "Untitled news";


        const description =
          item.description ||
          item.snippet ||
          "";


        const url =
          item.url ||
          item.link ||
          "#";


        const image =
          item.image_url ||
          item.image ||
          "";


        const source =
          item.source_name ||
          item.source ||
          item.source_domain ||
          "";


        const date =
          item.published_at ||
          item.date ||
          "";


        return `

          <article
            class="news-card"
          >

            ${
              image
                ? `

                  <img
                    src="${escapeHTML(
                      safeURL(image)
                    )}"
                    alt="${escapeHTML(
                      title
                    )}"
                    loading="lazy"
                    onerror="this.style.display='none'"
                  >

                `
                : ""
            }


            <div
              class="news-card-content"
            >

              ${
                source
                  ? `

                    <div
                      class="news-source"
                    >
                      ${escapeHTML(
                        source
                      )}
                    </div>

                  `
                  : ""
              }


              <h3>

                <a
                  href="${escapeHTML(
                    safeURL(url)
                  )}"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  ${escapeHTML(
                    title
                  )}
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


              ${
                date
                  ? `

                    <small>
                      ${escapeHTML(
                        formatDate(date)
                      )}
                    </small>

                  `
                  : ""
              }

            </div>

          </article>

        `;

      })
      .join("");
}


/* =========================================================
   HOME
   ========================================================= */

function showHome() {

  const home =
    $("#homeView");

  const searchView =
    $("#searchView");

  const mapView =
    $("#mapView");


  if (home) {

    home.style.display =
      "";

  }


  if (searchView) {

    searchView.classList.remove(
      "active"
    );

  }


  if (mapView) {

    mapView.classList.remove(
      "active"
    );

  }


  window.scrollTo({

    top: 0,

    behavior: "smooth"

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


  if (!form || !input) {
    return;
  }


  form.addEventListener(
    "submit",
    (event) => {

      event.preventDefault();


      const query =
        input.value.trim();


      if (!query) {

        input.focus();

        return;

      }


      performSearch(query);

    }
  );
}


/* =========================================================
   MAP SEARCH FORM
   ========================================================= */

function setupMapSearch() {

  const form =
    $(".map-search-panel");

  const input =
    $("#mapSearchInput");

  const button =
    $("#mapSearchBtn");


  if (form && input) {

    form.addEventListener(
      "submit",
      (event) => {

        event.preventDefault();

        searchMapPlace(
          input.value
        );

      }
    );

  }


  if (button && input) {

    button.addEventListener(
      "click",
      (event) => {

        event.preventDefault();

        searchMapPlace(
          input.value
        );

      }
    );

  }
}


/* =========================================================
   NAVIGATION
   ========================================================= */

function setupNavigation() {

  $$("[data-mode]")
    .forEach((button) => {

      button.addEventListener(
        "click",
        () => {

          const mode =
            button.dataset.mode;


          if (mode === "maps") {

            openMap();

            return;

          }


          const input =
            $("#searchInput");


          if (!input) {
            return;
          }


          if (
            mode === "news"
          ) {

            input.value =
              "latest news";

          } else if (
            mode === "images"
          ) {

            input.value =
              "images";

          } else if (
            mode === "videos"
          ) {

            input.value =
              "videos";

          } else if (
            mode === "shopping"
          ) {

            input.value =
              "shopping";

          }


          input.focus();

        }
      );

    });


  $$("[data-trending]")
    .forEach((button) => {

      button.addEventListener(
        "click",
        () => {

          const query =
            button.dataset.trending ||
            button.textContent.trim();


          const input =
            $("#searchInput");


          if (input) {

            input.value =
              query;

          }


          performSearch(
            query
          );

        }
      );

    });


  $$("[data-quick]")
    .forEach((button) => {

      button.addEventListener(
        "click",
        () => {

          const action =
            button.dataset.quick;


          if (
            action ===
            "location"
          ) {

            openMap()
              .then(
                locateUser
              );

            return;

          }


          if (
            action ===
            "place"
          ) {

            openMap()
              .then(() => {

                const input =
                  $("#mapSearchInput");

                if (input) {
                  input.focus();
                }

              });

            return;

          }


          if (
            action ===
            "directions"
          ) {

            openMap()
              .then(() => {

                const input =
                  $("#mapSearchInput");

                if (input) {
                  input.focus();
                }

              });

            return;

          }


          if (
            action ===
            "satellite"
          ) {

            openMap()
              .then(
                satelliteView
              );

          }

        }
      );

    });
}


/* =========================================================
   MAP BUTTONS
   ========================================================= */

function setupMapButtons() {

  const earthBtn =
    $("#earthMapBtn");

  const satelliteBtn =
    $("#satelliteMapBtn");

  const streetBtn =
    $("#streetMapBtn");

  const terrainBtn =
    $("#3dMapBtn");

  const high3DBtn =
    $("#high3dMapBtn");

  const locateBtn =
    $("#locateBtn");

  const resetBtn =
    $("#resetMapBtn");

  const fullscreenBtn =
    $("#fullscreenMapBtn");


  if (earthBtn) {

    earthBtn.addEventListener(
      "click",
      () => {

        openMap()
          .then(
            earthView
          );

      }
    );

  }


  if (satelliteBtn) {

    satelliteBtn.addEventListener(
      "click",
      () => {

        openMap()
          .then(
            satelliteView
          );

      }
    );

  }


  if (streetBtn) {

    streetBtn.addEventListener(
      "click",
      () => {

        openMap()
          .then(
            streetView
          );

      }
    );

  }


  if (terrainBtn) {

    terrainBtn.addEventListener(
      "click",
      () => {

        openMap()
          .then(
            enable3D
          );

      }
    );

  }


  if (high3DBtn) {

    high3DBtn.addEventListener(
      "click",
      () => {

        openMap()
          .then(
            enableHigh3D
          );

      }
    );

  }


  if (locateBtn) {

    locateBtn.addEventListener(
      "click",
      locateUser
    );

  }


  if (resetBtn) {

    resetBtn.addEventListener(
      "click",
      resetMap
    );

  }


  if (fullscreenBtn) {

    fullscreenBtn.addEventListener(
      "click",
      fullscreenMap
    );

  }


  const openMapBtn =
    $("#openMapBtn");

  if (openMapBtn) {

    openMapBtn.addEventListener(
      "click",
      () => openMap()
    );

  }


  const previewBtn =
    $("#mapPreviewBtn");

  if (previewBtn) {

    previewBtn.addEventListener(
      "click",
      () => openMap()
    );

  }
}


/* =========================================================
   MAP PREVIEW
   ========================================================= */

async function initializePreviewMap() {

  const container =
    $("#mapPreview");

  if (!container) {
    return;
  }


  try {

    const maplibregl =
      await loadMapLibre();


    const preview =
      new maplibregl.Map({

        container:
          "mapPreview",

        style:
          satelliteStyle(),

        center:
          CONFIG.map.defaultCenter,

        zoom:
          3.5,

        interactive:
          false,

        attributionControl:
          false

      });


    preview.on(
      "load",
      () => {

        try {

          preview.setProjection({
            type: "globe"
          });

        } catch {}

      }
    );


  } catch (error) {

    console.error(
      "HEXORA preview map error:",
      error
    );

  }
}


/* =========================================================
   BRAND / HOME
   ========================================================= */

function setupBrand() {

  $$(
    ".logo, [data-home]"
  ).forEach((element) => {

    element.addEventListener(
      "click",
      (event) => {

        event.preventDefault();

        showHome();

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
        event.key === "/" &&
        document.activeElement?.tagName !==
          "INPUT" &&
        document.activeElement?.tagName !==
          "TEXTAREA"
      ) {

        event.preventDefault();


        const input =
          $("#searchInput");


        if (input) {

          input.focus();

        }

      }


      if (
        event.key === "Escape"
      ) {

        showHome();

      }

    }
  );
}


/* =========================================================
   START HEXORA
   ========================================================= */

document.addEventListener(
  "DOMContentLoaded",
  () => {

    setupSearch();

    setupMapSearch();

    setupNavigation();

    setupMapButtons();

    setupBrand();

    setupKeyboard();

    loadNews();

    initializePreviewMap();

  }
);


/* =========================================================
   HEXORA GLOBAL API
   ========================================================= */

window.HEXORA = {

  config:
    CONFIG,

  search:
    performSearch,

  openMap,

  closeMap,

  searchMapPlace,

  locateUser,

  resetMap,

  fullscreenMap,

  enable3D,

  enableHigh3D,

  earth:
    () => {

      openMap()
        .then(
          earthView
        );

    },

  satellite:
    () => {

      openMap()
        .then(
          satelliteView
        );

    },

  street:
    () => {

      openMap()
        .then(
          streetView
        );

    }

};
