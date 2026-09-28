"use strict";

/* =========================================================
   HEXORA SEARCH + HEXORA EARTH
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


/* =========================================================
   GLOBAL STATE
   ========================================================= */

let map = null;
let previewMap = null;
let mapMarker = null;

let currentMapMode = "earth";

let mapLibrePromise = null;


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
   SECURITY HELPERS
   ========================================================= */

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
      value.startsWith("https://") ||
      value.startsWith("http://")
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
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
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


/* =========================================================
   MAPLIBRE LOADER
   ========================================================= */

function loadMapLibre() {

  if (window.maplibregl) {
    return Promise.resolve(
      window.maplibregl
    );
  }

  if (mapLibrePromise) {
    return mapLibrePromise;
  }

  mapLibrePromise = new Promise(
    (resolve, reject) => {

      const existing =
        document.querySelector(
          'script[data-hexora-maplibre="true"]'
        );

      if (existing) {

        existing.addEventListener(
          "load",
          () => {

            if (window.maplibregl) {
              resolve(
                window.maplibregl
              );
            } else {
              reject(
                new Error(
                  "MapLibre unavailable"
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
                "MapLibre loading failed"
              )
            );
          },
          { once: true }
        );

        return;
      }


      /* MapLibre CSS */

      if (
        !document.querySelector(
          'link[data-hexora-maplibre-css="true"]'
        )
      ) {

        const css =
          document.createElement("link");

        css.rel = "stylesheet";

        css.href =
          "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css";

        css.dataset.hexoraMaplibreCss =
          "true";

        document.head.appendChild(css);
      }


      /* MapLibre JS */

      const script =
        document.createElement("script");

      script.src =
        "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js";

      script.async = true;

      script.dataset.hexoraMaplibre =
        "true";


      script.onload = () => {

        if (window.maplibregl) {
          resolve(
            window.maplibregl
          );
        } else {
          reject(
            new Error(
              "MapLibre failed"
            )
          );
        }

      };


      script.onerror = () => {

        reject(
          new Error(
            "Could not load MapLibre"
          )
        );

      };


      document.head.appendChild(script);
    }
  );

  return mapLibrePromise;
}


/* =========================================================
   STREET STYLE
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


/* =========================================================
   SATELLITE STYLE
   ========================================================= */

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
   APPLY GLOBE PROJECTION
   ========================================================= */

function applyGlobeProjection() {

  if (!map) {
    return;
  }

  try {

    if (
      typeof map.setProjection ===
      "function"
    ) {

      map.setProjection({
        type: "globe"
      });

    }

  } catch (error) {

    console.warn(
      "HEXORA globe projection:",
      error
    );

  }
}


/* =========================================================
   INITIALIZE HEXORA EARTH
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


    map = new maplibregl.Map({

      container:
        "hexoraMap",

      style:
        satelliteStyle(),

      center:
        CONFIG.map.defaultCenter,

      zoom:
        CONFIG.map.defaultZoom,

      pitch: 0,

      bearing: 0,

      attributionControl:
        true,

      renderWorldCopies:
        false,

      maxPitch:
        85

    });


    map.addControl(

      new maplibregl.NavigationControl({
        visualizePitch: true
      }),

      "top-right"

    );


    map.on(
      "load",
      () => {

        applyGlobeProjection();

      }
    );


    map.on(
      "error",
      event => {

        console.error(
          "HEXORA Earth error:",
          event
        );

      }
    );


    return map;

  } catch (error) {

    console.error(
      "HEXORA Earth loading error:",
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
   OPEN HEXORA EARTH
   ========================================================= */

async function openMap(options = {}) {

  const mapView =
    $("#mapView");

  const home =
    $("#homeView");

  const searchView =
    $("#searchView");


  if (!mapView) {
    return;
  }


  if (home) {
    home.style.display =
      "none";
  }


  if (searchView) {
    searchView.classList.remove(
      "active"
    );
  }


  mapView.classList.add(
    "active"
  );


  const instance =
    await initializeMap();


  if (!instance) {
    return;
  }


  setTimeout(() => {

    instance.resize();


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

  }, 150);

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
   SATELLITE
   ========================================================= */

function showSatellite() {

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


  currentMapMode =
    "satellite";


  map.setStyle(
    satelliteStyle()
  );


  map.once(
    "style.load",
    () => {

      map.jumpTo({

        center,
        zoom,
        pitch,
        bearing

      });

      applyGlobeProjection();

    }
  );
}


/* =========================================================
   STREET
   ========================================================= */

function showStreet() {

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


  currentMapMode =
    "street";


  map.setStyle(
    streetStyle()
  );


  map.once(
    "style.load",
    () => {

      map.jumpTo({

        center,
        zoom,
        pitch,
        bearing

      });

      applyGlobeProjection();

    }
  );
}


/* =========================================================
   EARTH MODE
   ========================================================= */

function showEarth() {

  if (!map) {
    return;
  }


  currentMapMode =
    "earth";


  showSatellite();

}


/* =========================================================
   3D EARTH
   ========================================================= */

function enable3D() {

  if (!map) {
    return;
  }


  try {

    map.easeTo({

      pitch: 65,

      bearing:
        map.getBearing() - 20,

      duration:
        1200

    });

  } catch (error) {

    console.error(
      "HEXORA 3D error:",
      error
    );

  }

}


/* =========================================================
   HIGH 3D
   ========================================================= */

function enableHigh3D() {

  if (!map) {
    return;
  }


  try {

    map.easeTo({

      pitch: 78,

      bearing:
        map.getBearing() - 30,

      duration:
        1400

    });

  } catch (error) {

    console.error(
      "HEXORA High 3D:",
      error
    );

  }

}


/* =========================================================
   RESET EARTH
   ========================================================= */

function resetMap() {

  if (!map) {
    return;
  }


  if (mapMarker) {

    mapMarker.remove();

    mapMarker = null;

  }


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


  applyGlobeProjection();


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

  }


  mapMarker =
    new window.maplibregl.Marker({
      color: "#00dfff"
    })
      .setLngLat(
        coordinates
      )
      .addTo(map);

}


/* =========================================================
   REAL GPS LOCATION
   ========================================================= */

function locateUser() {

  if (
    !navigator.geolocation
  ) {

    showMapInfo(
      "This browser does not support GPS location."
    );

    return;

  }


  showMapInfo(
    "Getting your real location..."
  );


  navigator.geolocation.getCurrentPosition(

    async position => {

      const latitude =
        position.coords.latitude;

      const longitude =
        position.coords.longitude;


      await openMap({

        center: [
          longitude,
          latitude
        ],

        zoom: 15

      });


      if (!map) {
        return;
      }


      map.flyTo({

        center: [
          longitude,
          latitude
        ],

        zoom: 15,

        speed: 1.2,

        essential: true

      });


      addMapMarker([
        longitude,
        latitude
      ]);


      showMapInfo(
        "📍 Your current real location"
      );

    },


    error => {

      console.error(
        "HEXORA GPS:",
        error
      );


      if (
        error.code === 1
      ) {

        showMapInfo(
          "Location permission was denied."
        );

      } else {

        showMapInfo(
          "Current location is unavailable."
        );

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
   MAP INFO
   ========================================================= */

function showMapInfo(
  message
) {

  const info =
    $("#mapInfo");

  if (!info) {
    return;
  }


  info.textContent =
    message;

  info.style.display =
    "block";

}


/* =========================================================
   PLACE SEARCH
   ========================================================= */

async function searchMapPlace(
  query
) {

  const value =
    String(query || "")
      .trim();


  if (!value) {
    return;
  }


  showMapInfo(
    `Searching HEXORA Earth for "${value}"...`
  );


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
      places.length === 0
    ) {

      showMapInfo(
        "Place not found."
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
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {

      throw new Error(
        "Invalid coordinates"
      );

    }


    await openMap({

      center: [
        longitude,
        latitude
      ],

      zoom: 14

    });


    if (!map) {
      return;
    }


    map.flyTo({

      center: [
        longitude,
        latitude
      ],

      zoom: 14,

      speed: 1.2,

      essential: true

    });


    addMapMarker([
      longitude,
      latitude
    ]);


    showMapInfo(
      place.display_name ||
      value
    );


  } catch (error) {

    console.error(
      "HEXORA Earth search:",
      error
    );


    showMapInfo(
      "Place search failed. Please try again."
    );

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

  const input =
    $("#mapSearchInput");

  const button =
    $("#mapSearchBtn");


  if (form && input) {

    form.addEventListener(
      "submit",
      event => {

        event.preventDefault();

        searchMapPlace(
          input.value
        );

      }
    );

  }


  if (
    button &&
    input
  ) {

    button.addEventListener(
      "click",
      event => {

        event.preventDefault();

        searchMapPlace(
          input.value
        );

      }
    );

  }

}


/* =========================================================
   FULLSCREEN MAP
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


  setTimeout(
    () => {

      if (map) {
        map.resize();
      }

    },
    500
  );

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


  const meta =
    $("#resultMeta");

  const results =
    $("#results");


  if (meta) {

    meta.textContent =
      `Searching HEXORA for "${value}"...`;

  }


  if (results) {

    results.innerHTML = `
      <div class="state">
        🔎 HEXORA is searching the web...
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
      "HEXORA Search:",
      error
    );


    if (meta) {

      meta.textContent =
        `Search: "${value}"`;

    }


    if (results) {

      results.innerHTML = `
        <div class="state">
          <h3>HEXORA Search Error</h3>
          <p>
            The search service is temporarily
            unavailable. Please try again.
          </p>
        </div>
      `;

    }

  }

}


/* =========================================================
   RENDER SEARCH RESULTS
   ========================================================= */

function renderSearchResults(
  items,
  query
) {

  const meta =
    $("#resultMeta");

  const results =
    $("#results");


  if (meta) {

    meta.textContent =
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
      <div class="state">
        <h3>No web results found</h3>

        <p>
          HEXORA could not find matching
          indexed results for this search.
        </p>
      </div>
    `;

    return;

  }


  results.innerHTML =
    items
      .map(item => {

        const title =
          item.title ||
          item.name ||
          "Untitled result";


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

          <article class="search-result">

            ${
              source
                ? `
                  <div class="result-source">
                    ${escapeHTML(source)}
                  </div>
                `
                : ""
            }

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


            ${
              description
                ? `
                  <p class="result-description">
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
                  <div class="result-date">
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

  const list =
    $("#newsList");


  if (!list) {
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
      "HEXORA News:",
      error
    );


    list.innerHTML = `
      <div class="data-empty">
        News is temporarily unavailable.
      </div>
    `;

  }

}


/* =========================================================
   RENDER NEWS
   ========================================================= */

function renderNews(
  items
) {

  const list =
    $("#newsList");


  if (!list) {
    return;
  }


  if (!items.length) {

    list.innerHTML = `
      <div class="data-empty">
        No news available right now.
      </div>
    `;

    return;

  }


  list.innerHTML =
    items
      .slice(0, 20)
      .map(item => {

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

          <article class="data-row">

            ${
              image
                ? `
                  <img
                    class="data-thumb"
                    src="${escapeHTML(
                      safeURL(image)
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

              ${
                source
                  ? `
                    <div
                      style="
                      color:#43eaff;
                      font-size:9px;
                      margin-bottom:3px
                      "
                    >
                      ${escapeHTML(source)}
                    </div>
                  `
                  : ""
              }


              <b>

                <a
                  href="${escapeHTML(
                    safeURL(url)
                  )}"
                  target="_blank"
                  rel="noopener noreferrer"
                >

                  ${escapeHTML(title)}

                </a>

              </b>


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
                    <p>
                      ${escapeHTML(
                        formatDate(date)
                      )}
                    </p>
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
    event => {

      event.preventDefault();


      const query =
        input.value.trim();


      if (!query) {

        input.focus();

        return;

      }


      performSearch(
        query
      );

    }
  );

}


/* =========================================================
   NAVIGATION
   ========================================================= */

function setupNavigation() {

  $$("[data-mode]")
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const mode =
            button.dataset.mode;


          if (
            mode === "maps"
          ) {

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

          }

          else if (
            mode === "images"
          ) {

            input.value =
              "images";

          }

          else if (
            mode === "videos"
          ) {

            input.value =
              "videos";

          }

          else if (
            mode === "web"
          ) {

            input.value =
              "";

          }


          input.focus();

        }
      );

    });


  $$("[data-home]")
    .forEach(button => {

      button.addEventListener(
        "click",
        event => {

          event.preventDefault();

          showHome();

        }
      );

    });

}


/* =========================================================
   MAP BUTTONS
   ========================================================= */

function setupMapButtons() {

  const open =
    $("#openMapBtn");

  const earth =
    $("#earthMapBtn");

  const satellite =
    $$("#satelliteMapBtn");

  const street =
    $("#streetMapBtn");

  const threeD =
    $("#3dMapBtn");

  const high3D =
    $("#high3dMapBtn");

  const locate =
    $("#locateBtn");

  const reset =
    $("#resetMapBtn");

  const fullscreen =
    $("#fullscreenMapBtn");


  if (open) {

    open.addEventListener(
      "click",
      () => openMap()
    );

  }


  if (earth) {

    earth.addEventListener(
      "click",
      () => {

        showEarth();

      }
    );

  }


  satellite.forEach(
    button => {

      button.addEventListener(
        "click",
        () => {

          if (
            map &&
            map.isStyleLoaded()
          ) {

            showSatellite();

          } else {

            openMap()
              .then(
                () =>
                  showSatellite()
              );

          }

        }
      );

    }
  );


  if (street) {

    street.addEventListener(
      "click",
      () => {

        if (map) {

          showStreet();

        }

      }
    );

  }


  if (threeD) {

    threeD.addEventListener(
      "click",
      () => {

        if (map) {

          enable3D();

        }

      }
    );

  }


  if (high3D) {

    high3D.addEventListener(
      "click",
      () => {

        if (map) {

          enableHigh3D();

        }

      }
    );

  }


  if (locate) {

    locate.addEventListener(
      "click",
      locateUser
    );

  }


  if (reset) {

    reset.addEventListener(
      "click",
      resetMap
    );

  }


  if (fullscreen) {

    fullscreen.addEventListener(
      "click",
      fullscreenMap
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


  if (previewMap) {
    return;
  }


  try {

    const maplibregl =
      await loadMapLibre();


    previewMap =
      new maplibregl.Map({

        container:
          "mapPreview",

        style:
          satelliteStyle(),

        center:
          CONFIG.map.defaultCenter,

        zoom:
          2.6,

        pitch:
          15,

        bearing:
          0,

        interactive:
          false,

        attributionControl:
          false,

        renderWorldCopies:
          false

      });


    previewMap.on(
      "load",
      () => {

        try {

          if (
            typeof previewMap.setProjection ===
            "function"
          ) {

            previewMap.setProjection({
              type: "globe"
            });

          }

        } catch {}

      }
    );


  } catch (error) {

    console.error(
      "HEXORA preview map:",
      error
    );

  }

}


/* =========================================================
   MAP PREVIEW SATELLITE
   ========================================================= */

function setupPreviewSatellite() {

  const buttons =
    $$("#satelliteMapBtn");


  buttons.forEach(
    button => {

      button.addEventListener(
        "click",
        () => {

          openMap()
            .then(
              () => {

                if (map) {

                  showSatellite();

                }

              }
            );

        }
      );

    }
  );

}


/* =========================================================
   BRAND / HOME
   ========================================================= */

function setupBrand() {

  $$(".brand")
    .forEach(element => {

      element.addEventListener(
        "click",
        event => {

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
    event => {

      const active =
        document.activeElement;


      if (
        event.key === "/" &&
        active?.tagName !== "INPUT" &&
        active?.tagName !== "TEXTAREA"
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
   FULLSCREEN RESIZE
   ========================================================= */

document.addEventListener(
  "fullscreenchange",
  () => {

    setTimeout(
      () => {

        if (map) {
          map.resize();
        }

      },
      300
    );

  }
);


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

    setupPreviewSatellite();

    setupBrand();

    setupKeyboard();

    loadNews();

    initializePreviewMap();

  }
);


/* =========================================================
   HEXORA PUBLIC API
   ========================================================= */

window.HEXORA = {

  config:
    CONFIG,


  search:
    performSearch,


  openMap:
    openMap,


  closeMap:
    closeMap,


  searchMapPlace:
    searchMapPlace,


  locateUser:
    locateUser,


  resetMap:
    resetMap,


  fullscreenMap:
    fullscreenMap,


  earth() {

    openMap()
      .then(
        () => {

          showEarth();

        }
      );

  },


  satellite() {

    openMap()
      .then(
        () => {

          showSatellite();

        }
      );

  },


  street() {

    openMap()
      .then(
        () => {

          showStreet();

        }
      );

  },


  threeD() {

    openMap()
      .then(
        () => {

          enable3D();

        }
      );

  },


  high3D() {

    openMap()
      .then(
        () => {

          enableHigh3D();

        }
      );

  }

};
