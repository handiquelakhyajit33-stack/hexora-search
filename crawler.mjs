import * as cheerio from "cheerio";

const USER_AGENT =
  process.env.HEXORA_USER_AGENT ||
  "HEXORA-Bot/1.0 (+search engine crawler)";

const REQUEST_TIMEOUT =
  Number(process.env.CRAWL_TIMEOUT_MS || 15000);

const DOMAIN_DELAY =
  Number(process.env.CRAWL_DOMAIN_DELAY_MS || 1500);

const MAX_CONTENT =
  Number(process.env.CRAWL_MAX_CONTENT || 100000);

const MAX_LINKS =
  Number(process.env.CRAWL_MAX_LINKS || 100);

const MAX_IMAGES =
  Number(process.env.CRAWL_MAX_IMAGES || 50);

const MAX_VIDEOS =
  Number(process.env.CRAWL_MAX_VIDEOS || 30);

const MAX_PLACES =
  Number(process.env.CRAWL_MAX_PLACES || 20);

const ALLOWED_SCHEMES =
  new Set(["http:", "https:"]);


/* =========================================
   URL NORMALIZATION
========================================= */

export function normalizeUrl(input, base = null) {
  try {
    const url = base
      ? new URL(input, base)
      : new URL(input);

    if (!ALLOWED_SCHEMES.has(url.protocol)) {
      return null;
    }

    url.hash = "";

    const removeParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid",
      "mc_cid",
      "mc_eid"
    ];

    for (const param of removeParams) {
      url.searchParams.delete(param);
    }

    if (
      url.pathname.length > 1 &&
      url.pathname.endsWith("/")
    ) {
      url.pathname =
        url.pathname.slice(0, -1);
    }

    url.hostname =
      url.hostname.toLowerCase();

    return url.toString();

  } catch {
    return null;
  }
}


/* =========================================
   ROBOTS.TXT
========================================= */

const robotsCache = new Map();

async function canCrawl(url) {
  try {
    const target = new URL(url);
    const origin = target.origin;

    const cached = robotsCache.get(origin);

    if (
      cached &&
      cached.expires > Date.now()
    ) {
      return cached.allowed;
    }

    const robotsUrl =
      `${origin}/robots.txt`;

    const controller =
      new AbortController();

    const timer =
      setTimeout(
        () => controller.abort(),
        8000
      );

    let response;

    try {
      response = await fetch(
        robotsUrl,
        {
          headers: {
            "User-Agent": USER_AGENT
          },
          signal: controller.signal
        }
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      robotsCache.set(
        origin,
        {
          allowed: true,
          expires: Date.now() + 3600000
        }
      );

      return true;
    }

    const text =
      await response.text();

    const rules =
      parseRobots(text);

    const allowed =
      isPathAllowed(
        target.pathname,
        rules
      );

    robotsCache.set(
      origin,
      {
        allowed,
        expires: Date.now() + 3600000
      }
    );

    return allowed;

  } catch {
    return false;
  }
}


function parseRobots(text) {
  const lines =
    text.split(/\r?\n/);

  let active = false;

  const disallow = [];
  const allow = [];

  for (const raw of lines) {
    const line =
      raw
        .split("#")[0]
        .trim();

    if (!line) continue;

    const separator =
      line.indexOf(":");

    if (separator === -1) continue;

    const key =
      line
        .slice(0, separator)
        .trim()
        .toLowerCase();

    const value =
      line
        .slice(separator + 1)
        .trim();

    if (key === "user-agent") {
      active =
        value === "*" ||
        value.toLowerCase() ===
          "hexora-bot";

      continue;
    }

    if (!active) continue;

    if (
      key === "disallow" &&
      value
    ) {
      disallow.push(value);
    }

    if (
      key === "allow" &&
      value
    ) {
      allow.push(value);
    }
  }

  return {
    disallow,
    allow
  };
}


function isPathAllowed(
  pathname,
  rules
) {
  let bestLength = -1;
  let bestAllow = true;

  for (const rule of rules.disallow) {
    if (pathname.startsWith(rule)) {
      if (rule.length > bestLength) {
        bestLength = rule.length;
        bestAllow = false;
      }
    }
  }

  for (const rule of rules.allow) {
    if (pathname.startsWith(rule)) {
      if (rule.length >= bestLength) {
        bestLength = rule.length;
        bestAllow = true;
      }
    }
  }

  return bestAllow;
}


/* =========================================
   FETCH PAGE
========================================= */

export async function fetchPage(url) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT
    );

  try {
    const response =
      await fetch(
        url,
        {
          redirect: "follow",
          headers: {
            "User-Agent": USER_AGENT,
            "Accept":
              "text/html,application/xhtml+xml",
            "Accept-Language":
              "en-US,en;q=0.8"
          },
          signal:
            controller.signal
        }
      );

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        finalUrl: response.url
      };
    }

    const contentType =
      response.headers.get(
        "content-type"
      ) || "";

    if (
      !contentType.includes("text/html") &&
      !contentType.includes(
        "application/xhtml+xml"
      )
    ) {
      return {
        ok: false,
        status: response.status,
        finalUrl: response.url,
        reason: "not-html"
      };
    }

    const html =
      await response.text();

    return {
      ok: true,
      status: response.status,
      finalUrl: response.url,
      html
    };

  } catch (error) {
    return {
      ok: false,
      status: 0,
      finalUrl: url,
      reason:
        error?.name === "AbortError"
          ? "timeout"
          : String(
              error?.message || error
            )
    };

  } finally {
    clearTimeout(timer);
  }
}


/* =========================================
   IMAGE HELPERS
========================================= */

function getAbsoluteImageUrl(
  value,
  pageUrl
) {
  if (!value) return null;

  const cleaned =
    String(value)
      .trim()
      .split(",")[0]
      .trim()
      .split(/\s+/)[0];

  if (!cleaned) return null;

  return normalizeUrl(
    cleaned,
    pageUrl
  );
}


function extractImages(
  $,
  pageUrl
) {
  const results = [];
  const seen = new Set();

  function addImage(
    imageUrl,
    alt = "",
    title = ""
  ) {
    const normalized =
      getAbsoluteImageUrl(
        imageUrl,
        pageUrl
      );

    if (!normalized) return;

    if (seen.has(normalized)) return;

    if (
      results.length >= MAX_IMAGES
    ) {
      return;
    }

    seen.add(normalized);

    results.push({
      image_url: normalized,
      alt_text:
        String(alt || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 500),
      title:
        String(title || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 500)
    });
  }

  /*
   * OpenGraph image
   */
  addImage(
    $('meta[property="og:image"]')
      .attr("content"),
    $('meta[property="og:image:alt"]')
      .attr("content") || ""
  );

  /*
   * Twitter image
   */
  addImage(
    $('meta[name="twitter:image"]')
      .attr("content"),
    ""
  );

  /*
   * Normal img tags
   */
  $("img").each(
    (_, element) => {
      if (
        results.length >= MAX_IMAGES
      ) {
        return;
      }

      const image =
        $(element);

      const src =
        image.attr("src") ||
        image.attr("data-src") ||
        image.attr("data-lazy-src");

      const srcset =
        image.attr("srcset") ||
        image.attr("data-srcset");

      const selected =
        src ||
        (
          srcset
            ? srcset
                .split(",")
                .pop()
                .trim()
                .split(/\s+/)[0]
            : null
        );

      addImage(
        selected,
        image.attr("alt") || "",
        image.attr("title") || ""
      );
    }
  );

  return results;
}


/* =========================================
   VIDEO HELPERS
========================================= */

function normalizeVideoUrl(
  value,
  pageUrl
) {
  if (!value) return null;

  let url;

  try {
    url =
      new URL(
        value,
        pageUrl
      );
  } catch {
    return null;
  }

  if (
    !ALLOWED_SCHEMES.has(
      url.protocol
    )
  ) {
    return null;
  }

  url.hash = "";

  const host =
    url.hostname
      .toLowerCase();

  /*
   * YouTube
   */
  if (
    host === "youtube.com" ||
    host === "www.youtube.com"
  ) {
    const id =
      url.searchParams.get("v");

    if (id) {
      return `https://www.youtube.com/watch?v=${id}`;
    }
  }

  /*
   * YouTube short URL
   */
  if (
    host === "youtu.be"
  ) {
    const id =
      url.pathname
        .replace(/^\/+/, "")
        .split("/")[0];

    if (id) {
      return `https://www.youtube.com/watch?v=${id}`;
    }
  }

  /*
   * Vimeo
   */
  if (
    host === "vimeo.com" ||
    host === "www.vimeo.com"
  ) {
    return url.toString();
  }

  return url.toString();
}


function extractVideos(
  $,
  pageUrl
) {
  const results = [];
  const seen = new Set();

  function addVideo(
    videoUrl,
    title = "",
    description = "",
    thumbnailUrl = null
  ) {
    const normalized =
      normalizeVideoUrl(
        videoUrl,
        pageUrl
      );

    if (!normalized) return;

    if (seen.has(normalized)) return;

    if (
      results.length >= MAX_VIDEOS
    ) {
      return;
    }

    const host =
      new URL(normalized)
        .hostname
        .toLowerCase();

    const isKnownVideo =
      host.includes("youtube.") ||
      host === "youtu.be" ||
      host.includes("vimeo.") ||
      normalized
        .toLowerCase()
        .includes(".mp4") ||
      normalized
        .toLowerCase()
        .includes(".webm") ||
      normalized
        .toLowerCase()
        .includes("/video/");

    if (!isKnownVideo) {
      return;
    }

    seen.add(normalized);

    results.push({
      video_url: normalized,
      title:
        String(title || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 500),
      description:
        String(description || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 1000),
      thumbnail_url:
        thumbnailUrl
          ? getAbsoluteImageUrl(
              thumbnailUrl,
              pageUrl
            )
          : null
    });
  }

  /*
   * iframe videos
   */
  $("iframe[src]").each(
    (_, element) => {
      const iframe =
        $(element);

      addVideo(
        iframe.attr("src"),
        iframe.attr("title") || ""
      );
    }
  );

  /*
   * video tags
   */
  $("video").each(
    (_, element) => {
      const video =
        $(element);

      const poster =
        video.attr("poster") || null;

      video.find("source[src]").each(
        (_, source) => {
          addVideo(
            $(source).attr("src"),
            video.attr("title") || "",
            "",
            poster
          );
        }
      );

      if (video.attr("src")) {
        addVideo(
          video.attr("src"),
          video.attr("title") || "",
          "",
          poster
        );
      }
    }
  );

  /*
   * Normal links to video pages
   */
  $("a[href]").each(
    (_, element) => {
      const link =
        $(element);

      const href =
        link.attr("href");

      if (!href) return;

      const text =
        link.text()
          .replace(/\s+/g, " ")
          .trim();

      addVideo(
        href,
        text
      );
    }
  );

  /*
   * JSON-LD VideoObject
   */
  $("script[type='application/ld+json']").each(
    (_, element) => {
      const raw =
        $(element).html();

      if (!raw) return;

      try {
        const json =
          JSON.parse(raw);

        const objects =
          Array.isArray(json)
            ? json
            : [json];

        for (const item of objects) {
          if (!item) continue;

          const candidates = [
            item,
            ...(Array.isArray(item["@graph"])
              ? item["@graph"]
              : [])
          ];

          for (const obj of candidates) {
            const type =
              obj?.["@type"];

            const isVideo =
              type === "VideoObject" ||
              (
                Array.isArray(type) &&
                type.includes("VideoObject")
              );

            if (!isVideo) continue;

            addVideo(
              obj.contentUrl ||
              obj.embedUrl ||
              obj.url,
              obj.name || "",
              obj.description || "",
              obj.thumbnailUrl || null
            );
          }
        }

      } catch {
        // invalid JSON-LD ignored
      }
    }
  );

  return results;
}


/* =========================================
   PLACE HELPERS
========================================= */

function getTypeList(type) {
  if (Array.isArray(type)) {
    return type;
  }

  if (type) {
    return [type];
  }

  return [];
}


function extractPlaces(
  $,
  pageUrl
) {
  const results = [];

  function addPlace(obj) {
    if (
      !obj ||
      results.length >= MAX_PLACES
    ) {
      return;
    }

    const types =
      getTypeList(
        obj["@type"]
      );

    const placeTypes = [
      "Place",
      "LocalBusiness",
      "Restaurant",
      "Hotel",
      "Store",
      "Organization"
    ];

    const valid =
      types.some(
        type =>
          placeTypes.includes(type)
      );

    if (!valid) return;

    const address =
      obj.address || {};

    const geo =
      obj.geo || {};

    const latitude =
      Number(
        geo.latitude
      );

    const longitude =
      Number(
        geo.longitude
      );

    const name =
      String(
        obj.name || ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 500);

    const addressText =
      typeof address === "string"
        ? address
        : [
            address.streetAddress,
            address.addressLocality,
            address.addressRegion,
            address.postalCode,
            address.addressCountry
          ]
            .filter(Boolean)
            .join(", ");

    if (
      !name &&
      !addressText &&
      !Number.isFinite(latitude) &&
      !Number.isFinite(longitude)
    ) {
      return;
    }

    results.push({
      name,
      address:
        String(addressText || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 1000),

      city:
        String(
          address.addressLocality || ""
        ).slice(0, 200),

      district:
        String(
          address.addressRegion || ""
        ).slice(0, 200),

      state:
        String(
          address.addressRegion || ""
        ).slice(0, 200),

      country:
        String(
          address.addressCountry || ""
        ).slice(0, 100),

      latitude:
        Number.isFinite(latitude)
          ? latitude
          : null,

      longitude:
        Number.isFinite(longitude)
          ? longitude
          : null
    });
  }

  /*
   * JSON-LD structured data
   */
  $("script[type='application/ld+json']").each(
    (_, element) => {
      const raw =
        $(element).html();

      if (!raw) return;

      try {
        const json =
          JSON.parse(raw);

        const objects =
          Array.isArray(json)
            ? json
            : [json];

        for (const item of objects) {
          if (!item) continue;

          const candidates = [
            item,
            ...(Array.isArray(item["@graph"])
              ? item["@graph"]
              : [])
          ];

          for (const obj of candidates) {
            addPlace(obj);
          }
        }

      } catch {
        // invalid JSON-LD ignored
      }
    }
  );

  /*
   * Deduplicate places.
   */
  const unique = [];
  const seen = new Set();

  for (const place of results) {
    const key =
      [
        place.name,
        place.address,
        place.latitude,
        place.longitude
      ].join("|");

    if (seen.has(key)) continue;

    seen.add(key);
    unique.push(place);
  }

  return unique.slice(
    0,
    MAX_PLACES
  );
}


/* =========================================
   PARSE HTML
========================================= */

export function parsePage(
  html,
  pageUrl
) {
  const $ =
    cheerio.load(
      html,
      {
        decodeEntities: true
      }
    );

  /*
   * Extract rich data BEFORE
   * removing elements.
   */
  const images =
    extractImages(
      $,
      pageUrl
    );

  const videos =
    extractVideos(
      $,
      pageUrl
    );

  const places =
    extractPlaces(
      $,
      pageUrl
    );

  const title =
    $("title")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);

  const description =
    $('meta[name="description"]')
      .attr("content") ||
    $('meta[property="og:description"]')
      .attr("content") ||
    "";

  const canonical =
    $('link[rel="canonical"]')
      .attr("href");

  const finalCanonical =
    canonical
      ? normalizeUrl(
          canonical,
          pageUrl
        )
      : pageUrl;

  const author =
    $('meta[name="author"]')
      .attr("content") ||
    "";

  const published =
    $('meta[property="article:published_time"]')
      .attr("content") ||
    $('meta[name="date"]')
      .attr("content") ||
    $('meta[itemprop="datePublished"]')
      .attr("content") ||
    null;

  const lang =
    $("html")
      .attr("lang") ||
    detectLanguage(
      $("body").text()
    );

  /*
   * Remove non-text elements
   * only after media extraction.
   */
  $(
    "script,style,noscript,template,svg,canvas,iframe,video"
  ).remove();

  const bodyText =
    $("body")
      .text()
      .replace(/\s+/g, " ")
      .trim();

  const content =
    bodyText.slice(
      0,
      MAX_CONTENT
    );

  /*
   * Extract links.
   */
  const links =
    new Set();

  $("a[href]").each(
    (_, element) => {
      if (
        links.size >= MAX_LINKS
      ) {
        return;
      }

      const href =
        $(element)
          .attr("href");

      const normalized =
        normalizeUrl(
          href,
          pageUrl
        );

      if (normalized) {
        links.add(normalized);
      }
    }
  );

  return {
    url:
      finalCanonical,

    title:
      title || finalCanonical,

    description:
      String(description)
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 1000),

    content,

    language:
      String(lang)
        .toLowerCase()
        .slice(0, 20),

    author:
      String(author)
        .slice(0, 300),

    image_url:
      images[0]?.image_url || null,

    published_at:
      published,

    links:
      [...links],

    images,

    videos,

    places
  };
}


/* =========================================
   LANGUAGE DETECTION
========================================= */

function detectLanguage(text) {
  const sample =
    String(text || "")
      .slice(0, 5000);

  if (/[\u0C00-\u0C7F]/.test(sample)) {
    return "as";
  }

  if (/[\u0900-\u097F]/.test(sample)) {
    return "hi";
  }

  if (/[\u0980-\u09FF]/.test(sample)) {
    return "bn";
  }

  if (/[\u4E00-\u9FFF]/.test(sample)) {
    return "zh";
  }

  if (/[\u3040-\u30FF]/.test(sample)) {
    return "ja";
  }

  if (/[\uAC00-\uD7AF]/.test(sample)) {
    return "ko";
  }

  if (/[\u0B80-\u0BFF]/.test(sample)) {
    return "ta";
  }

  if (/[\u0A80-\u0AFF]/.test(sample)) {
    return "gu";
  }

  if (/[\u0A00-\u0A7F]/.test(sample)) {
    return "pa";
  }

  return "en";
}


/* =========================================
   DOMAIN RATE LIMIT
========================================= */

const lastVisit =
  new Map();

async function respectDomainDelay(url) {
  try {
    const hostname =
      new URL(url).hostname;

    const previous =
      lastVisit.get(hostname) || 0;

    const wait =
      DOMAIN_DELAY -
      (Date.now() - previous);

    if (wait > 0) {
      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            wait
          )
      );
    }

    lastVisit.set(
      hostname,
      Date.now()
    );

  } catch {
    // ignore
  }
}


/* =========================================
   SAVE MEDIA DATA
========================================= */

async function saveImages(
  supabase,
  pageUrl,
  images
) {
  if (!images?.length) return;

  try {
    const domain =
      new URL(pageUrl)
        .hostname
        .toLowerCase();

    const rows =
      images.map(
        image => ({
          page_url:
            pageUrl,

          image_url:
            image.image_url,

          alt_text:
            image.alt_text || null,

          title:
            image.title || null,

          source_domain:
            domain,

          updated_at:
            new Date().toISOString()
        })
      );

    const { error } =
      await supabase
        .from("images")
        .upsert(
          rows,
          {
            onConflict:
              "page_url,image_url"
          }
        );

    if (error) {
      console.error(
        "Images save error:",
        error.message
      );
    }

  } catch (error) {
    console.error(
      "Images processing error:",
      error?.message || error
    );
  }
}


async function saveVideos(
  supabase,
  pageUrl,
  videos
) {
  if (!videos?.length) return;

  try {
    const domain =
      new URL(pageUrl)
        .hostname
        .toLowerCase();

    const rows =
      videos.map(
        video => ({
          page_url:
            pageUrl,

          video_url:
            video.video_url,

          title:
            video.title || null,

          description:
            video.description || null,

          source_domain:
            domain,

          thumbnail_url:
            video.thumbnail_url || null,

          updated_at:
            new Date().toISOString()
        })
      );

    const { error } =
      await supabase
        .from("videos")
        .upsert(
          rows,
          {
            onConflict:
              "page_url,video_url"
          }
        );

    if (error) {
      console.error(
        "Videos save error:",
        error.message
      );
    }

  } catch (error) {
    console.error(
      "Videos processing error:",
      error?.message || error
    );
  }
}


async function savePlaces(
  supabase,
  pageUrl,
  places
) {
  if (!places?.length) return;

  try {
    const domain =
      new URL(pageUrl)
        .hostname
        .toLowerCase();

    const rows =
      places.map(
        place => ({
          page_url:
            pageUrl,

          name:
            place.name || null,

          address:
            place.address || null,

          city:
            place.city || null,

          district:
            place.district || null,

          state:
            place.state || null,

          country:
            place.country || null,

          latitude:
            place.latitude,

          longitude:
            place.longitude,

          source_domain:
            domain,

          updated_at:
            new Date().toISOString()
        })
      );

    const { error } =
      await supabase
        .from("places")
        .upsert(
          rows,
          {
            onConflict:
              "page_url,name,latitude,longitude"
          }
        );

    if (error) {
      console.error(
        "Places save error:",
        error.message
      );
    }

  } catch (error) {
    console.error(
      "Places processing error:",
      error?.message || error
    );
  }
}


/* =========================================
   CRAWL ONE URL
========================================= */

export async function crawlUrl(
  supabase,
  url
) {
  const normalized =
    normalizeUrl(url);

  if (!normalized) {
    return {
      ok: false,
      reason: "invalid-url"
    };
  }

  const allowed =
    await canCrawl(
      normalized
    );

  if (!allowed) {
    return {
      ok: false,
      reason:
        "robots-disallowed"
    };
  }

  await respectDomainDelay(
    normalized
  );

  const fetched =
    await fetchPage(
      normalized
    );

  if (!fetched.ok) {
    return {
      ok: false,
      reason:
        fetched.reason ||
        `HTTP ${fetched.status}`
    };
  }

  const parsed =
    parsePage(
      fetched.html,
      fetched.finalUrl
    );

  /*
   * Save main page.
   */
  const record = {
    url:
      parsed.url,

    title:
      parsed.title,

    description:
      parsed.description,

    content:
      parsed.content,

    language:
      parsed.language,

    author:
      parsed.author,

    image_url:
      parsed.image_url,

    published_at:
      parsed.published_at,

    last_crawled_at:
      new Date().toISOString(),

    updated_at:
      new Date().toISOString()
  };

  const { error } =
    await supabase
      .from("pages")
      .upsert(
        record,
        {
          onConflict: "url"
        }
      );

  if (error) {
    throw error;
  }

  /*
   * IMPORTANT:
   * Media errors never stop the page crawl.
   */
  await saveImages(
    supabase,
    parsed.url,
    parsed.images
  );

  await saveVideos(
    supabase,
    parsed.url,
    parsed.videos
  );

  await savePlaces(
    supabase,
    parsed.url,
    parsed.places
  );

  /*
   * Add discovered links.
   */
  if (
    parsed.links.length
  ) {
    const queueRows =
      parsed.links.map(
        link => ({
          url: link,
          status: "pending",
          discovered_from:
            parsed.url,
          priority:
            calculatePriority(
              link,
              parsed.url
            )
        })
      );

    for (
      let i = 0;
      i < queueRows.length;
      i += 100
    ) {
      const chunk =
        queueRows.slice(
          i,
          i + 100
        );

      const result =
        await supabase
          .from("crawl_queue")
          .upsert(
            chunk,
            {
              onConflict: "url",
              ignoreDuplicates: true
            }
          );

      if (result.error) {
        console.error(
          "Queue insert:",
          result.error.message
        );
      }
    }
  }

  return {
    ok: true,

    url:
      parsed.url,

    title:
      parsed.title,

    links:
      parsed.links.length,

    images:
      parsed.images.length,

    videos:
      parsed.videos.length,

    places:
      parsed.places.length,

    language:
      parsed.language
  };
}


/* =========================================
   PRIORITY
========================================= */

function calculatePriority(
  url,
  sourceUrl
) {
  let priority = 1;

  try {
    const target =
      new URL(url);

    const source =
      new URL(sourceUrl);

    if (
      target.hostname ===
      source.hostname
    ) {
      priority += 2;
    }

    if (
      target.hostname.endsWith(".gov") ||
      target.hostname.includes(".gov.") ||
      target.hostname.endsWith(".edu") ||
      target.hostname.includes(".edu.")
    ) {
      priority += 3;
    }

    if (
      target.protocol === "https:"
    ) {
      priority += 1;
    }

  } catch {
    // keep default
  }

  return priority;
}


/* =========================================
   CRAWL BATCH
========================================= */

export async function crawlBatch(
  supabase,
  batchSize = 10
) {
  const { data, error } =
    await supabase
      .from("crawl_queue")
      .select(
        "id,url,priority,status"
      )
      .eq(
        "status",
        "pending"
      )
      .order(
        "priority",
        {
          ascending: false
        }
      )
      .order(
        "id",
        {
          ascending: true
        }
      )
      .limit(batchSize);

  if (error) {
    throw error;
  }

  const jobs =
    data || [];

  let success = 0;
  let failed = 0;

  for (const job of jobs) {
    await supabase
      .from("crawl_queue")
      .update({
        status:
          "processing",

        started_at:
          new Date().toISOString()
      })
      .eq(
        "id",
        job.id
      );

    try {
      const result =
        await crawlUrl(
          supabase,
          job.url
        );

      if (result.ok) {
        success++;

        console.log(
          "Crawled:",
          result.url,
          "| images:",
          result.images,
          "| videos:",
          result.videos,
          "| places:",
          result.places
        );

        await supabase
          .from("crawl_queue")
          .update({
            status:
              "done",

            finished_at:
              new Date().toISOString(),

            error:
              null
          })
          .eq(
            "id",
            job.id
          );

      } else {
        failed++;

        await supabase
          .from("crawl_queue")
          .update({
            status:
              "failed",

            finished_at:
              new Date().toISOString(),

            error:
              result.reason
          })
          .eq(
            "id",
            job.id
          );
      }

    } catch (error) {
      failed++;

      console.error(
        "Crawler error:",
        job.url,
        error
      );

      await supabase
        .from("crawl_queue")
        .update({
          status:
            "failed",

          finished_at:
            new Date().toISOString(),

          error:
            String(
              error?.message ||
              error
            ).slice(0, 1000)
        })
        .eq(
          "id",
          job.id
        );
    }
  }

  return {
    requested:
      jobs.length,

    success,

    failed
  };
}
