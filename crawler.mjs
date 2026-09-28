import * as cheerio from "cheerio";

const USER_AGENT =
  "HEXORA-Bot/1.0 (+https://hexora-search.com/crawler)";

const REQUEST_TIMEOUT = 15000;
const DOMAIN_DELAY = 1500;

const MAX_CONTENT = 100000;
const MAX_LINKS = 300;
const MAX_IMAGES = 100;
const MAX_VIDEOS = 50;
const MAX_PLACES = 20;

const RETRY_LIMIT = 5;
const ROBOTS_CACHE_MS = 60 * 60 * 1000;

const MIN_CONTENT_LENGTH = 200;

const robotsCache = new Map();
const domainLastRequest = new Map();

const PERMANENT_ERRORS = new Set([
  400,
  401,
  403,
  404,
  410,
  451,
]);

const SKIP_EXTENSIONS =
  /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|7z|tar|gz|exe|dmg|apk|ipa|mp3|wav|flac|mp4|mkv|avi|mov|webm)$/i;

const SEARCH_ENGINE_HOSTS = [
  "google.",
  "bing.com",
  "search.yahoo.",
  "duckduckgo.com",
  "yandex.",
  "baidu.com",
  "search.brave.com",
];

const SEARCH_PATHS = [
  "/search",
  "/webhp",
  "/results",
  "/searchall",
  "/find",
];

const NEWS_PATH_HINTS = [
  "/news/",
  "/news",
  "/article/",
  "/articles/",
  "/story/",
  "/stories/",
  "/latest/",
  "/breaking/",
  "/politics/",
  "/business/",
  "/world/",
  "/national/",
  "/international/",
  "/sports/",
  "/technology/",
  "/tech/",
  "/entertainment/",
  "/economy/",
  "/science/",
  "/health/",
  "/education/",
  "/crime/",
  "/local/",
];

const NEWS_JSON_TYPES = new Set([
  "NewsArticle",
  "ReportageNewsArticle",
  "AnalysisNewsArticle",
  "OpinionNewsArticle",
  "LiveBlogPosting",
  "Article",
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeUrl(input, baseUrl = null) {
  try {
    const url = baseUrl
      ? new URL(input, baseUrl)
      : new URL(input);

    url.hash = "";

    url.username = "";
    url.password = "";

    if (
      (url.protocol === "https:" && url.port === "443") ||
      (url.protocol === "http:" && url.port === "80")
    ) {
      url.port = "";
    }

    const removeParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "gclid",
      "fbclid",
      "ref",
      "ref_src",
    ];

    for (const key of removeParams) {
      url.searchParams.delete(key);
    }

    return url.toString();
  } catch {
    return null;
  }
}

function isHttpUrl(url) {
  return /^https?:\/\//i.test(url || "");
}

function isSearchEngineUrl(url) {
  try {
    const u = new URL(url);

    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();

    if (
      SEARCH_ENGINE_HOSTS.some((item) =>
        host.includes(item)
      )
    ) {
      return true;
    }

    if (
      SEARCH_PATHS.some((item) =>
        path === item || path.startsWith(`${item}/`)
      )
    ) {
      return true;
    }

    const badParams = [
      "q",
      "query",
      "search",
      "keyword",
      "keywords",
    ];

    let parameterCount = 0;

    for (const param of badParams) {
      if (u.searchParams.has(param)) {
        parameterCount++;
      }
    }

    if (parameterCount > 0 && path.includes("search")) {
      return true;
    }

    return false;
  } catch {
    return true;
  }
}

function isSkippableUrl(url) {
  if (!isHttpUrl(url)) return true;
  if (isSearchEngineUrl(url)) return true;
  if (SKIP_EXTENSIONS.test(url)) return true;

  return false;
}

async function waitForDomain(url) {
  try {
    const host = new URL(url).hostname;

    const last = domainLastRequest.get(host) || 0;
    const elapsed = Date.now() - last;

    if (elapsed < DOMAIN_DELAY) {
      await sleep(DOMAIN_DELAY - elapsed);
    }

    domainLastRequest.set(host, Date.now());
  } catch {
    // ignore
  }
}

async function fetchWithTimeout(
  url,
  options = {},
  timeout = REQUEST_TIMEOUT
) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, timeout);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

async function canCrawl(url) {
  try {
    const origin = new URL(url).origin;

    const cached = robotsCache.get(origin);

    if (
      cached &&
      Date.now() - cached.time < ROBOTS_CACHE_MS
    ) {
      return cached.allowed;
    }

    const robotsUrl = `${origin}/robots.txt`;

    let response;

    try {
      response = await fetchWithTimeout(
        robotsUrl,
        {
          headers: {
            "User-Agent": USER_AGENT,
          },
        },
        8000
      );
    } catch {
      // If robots.txt itself cannot be fetched,
      // do not kill the entire crawler.
      robotsCache.set(origin, {
        allowed: true,
        time: Date.now(),
      });

      return true;
    }

    if (response.status === 404) {
      robotsCache.set(origin, {
        allowed: true,
        time: Date.now(),
      });

      return true;
    }

    if (!response.ok) {
      /*
       * Be conservative for explicit robots failures,
       * but do not permanently stop normal crawling for
       * temporary server errors.
       */
      if (response.status >= 500) {
        robotsCache.set(origin, {
          allowed: true,
          time: Date.now(),
        });

        return true;
      }

      robotsCache.set(origin, {
        allowed: false,
        time: Date.now(),
      });

      return false;
    }

    const text = await response.text();

    const allowed = parseRobots(
      text,
      new URL(url)
    );

    robotsCache.set(origin, {
      allowed,
      time: Date.now(),
    });

    return allowed;
  } catch {
    return true;
  }
}

function parseRobots(text, targetUrl) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) =>
      line.split("#")[0].trim()
    );

  let applies = false;
  let rules = [];

  for (const line of lines) {
    if (!line) continue;

    const index = line.indexOf(":");

    if (index === -1) continue;

    const key = line
      .slice(0, index)
      .trim()
      .toLowerCase();

    const value = line
      .slice(index + 1)
      .trim();

    if (key === "user-agent") {
      applies =
        value === "*" ||
        value.toLowerCase() === "hexora-bot";
      continue;
    }

    if (applies && key === "disallow") {
      if (value) rules.push(value);
    }
  }

  const path =
    targetUrl.pathname || "/";

  for (const rule of rules) {
    if (rule === "/") return false;

    if (path.startsWith(rule)) {
      return false;
    }
  }

  return true;
}

async function fetchHtml(url) {
  await waitForDomain(url);

  const response = await fetchWithTimeout(
    url,
    {
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language":
          "en-US,en;q=0.8",
      },
    }
  );

  if (!response.ok) {
    const error = new Error(
      `HTTP ${response.status}`
    );

    error.status = response.status;

    throw error;
  }

  const contentType =
    response.headers.get("content-type") || "";

  if (
    !contentType.includes("text/html") &&
    !contentType.includes("application/xhtml+xml")
  ) {
    const error = new Error(
      `Unsupported content type: ${contentType}`
    );

    error.status = 415;

    throw error;
  }

  const html = await response.text();

  return {
    html: html.slice(0, 5_000_000),
    finalUrl: response.url || url,
  };
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(value, baseUrl) {
  try {
    if (!value) return null;

    const url = new URL(value, baseUrl);

    if (
      url.protocol !== "http:" &&
      url.protocol !== "https:"
    ) {
      return null;
    }

    return normalizeUrl(url.toString());
  } catch {
    return null;
  }
}

function detectLanguage(text) {
  const value = String(text || "");

  if (/[\u0980-\u09FF]/.test(value)) {
    return "bn";
  }

  if (/[\u0C00-\u0C7F]/.test(value)) {
    return "te";
  }

  if (/[\u0B80-\u0BFF]/.test(value)) {
    return "ta";
  }

  if (/[\u0900-\u097F]/.test(value)) {
    return "hi";
  }

  if (/[\u4E00-\u9FFF]/.test(value)) {
    return "zh";
  }

  if (/[\u3040-\u30FF]/.test(value)) {
    return "ja";
  }

  if (/[\uAC00-\uD7AF]/.test(value)) {
    return "ko";
  }

  if (/[\u0400-\u04FF]/.test(value)) {
    return "ru";
  }

  if (/[\u0600-\u06FF]/.test(value)) {
    return "ar";
  }

  if (/[\u0370-\u03FF]/.test(value)) {
    return "el";
  }

  return "en";
}

function firstMeta($, selectors) {
  for (const selector of selectors) {
    const value = $(selector)
      .first()
      .attr("content");

    if (value) {
      return cleanText(value);
    }
  }

  return "";
}

function parseDate($, jsonLd) {
  const metaDate = firstMeta($, [
    'meta[property="article:published_time"]',
    'meta[name="article:published_time"]',
    'meta[name="publishdate"]',
    'meta[name="date"]',
    'meta[itemprop="datePublished"]',
    'meta[property="datePublished"]',
  ]);

  if (metaDate) {
    const parsed = new Date(metaDate);

    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  const timeValue = $("time[datetime]")
    .first()
    .attr("datetime");

  if (timeValue) {
    const parsed = new Date(timeValue);

    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  for (const item of jsonLd) {
    const date =
      item.datePublished ||
      item.dateCreated;

    if (date) {
      const parsed = new Date(date);

      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }
  }

  return null;
}

function parseAuthor($, jsonLd) {
  const metaAuthor = firstMeta($, [
    'meta[name="author"]',
    'meta[property="article:author"]',
  ]);

  if (metaAuthor) return metaAuthor;

  const selectors = [
    '[itemprop="author"]',
    '[rel="author"]',
    ".author",
    ".byline",
  ];

  for (const selector of selectors) {
    const value = cleanText(
      $(selector).first().text()
    );

    if (value) return value;
  }

  for (const item of jsonLd) {
    const author = item.author;

    if (typeof author === "string") {
      return cleanText(author);
    }

    if (author?.name) {
      return cleanText(author.name);
    }
  }

  return "";
}

function collectJsonLd($) {
  const items = [];

  $('script[type="application/ld+json"]').each(
    (_, el) => {
      const raw = $(el).html();

      if (!raw) return;

      try {
        const parsed = JSON.parse(raw);

        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && typeof item === "object") {
              items.push(item);
            }
          }
        } else if (
          parsed &&
          typeof parsed === "object"
        ) {
          items.push(parsed);
        }
      } catch {
        // Some websites have invalid JSON-LD.
      }
    }
  );

  return items;
}

function flattenJsonLd(items) {
  const output = [];

  for (const item of items) {
    output.push(item);

    if (Array.isArray(item["@graph"])) {
      for (const graphItem of item["@graph"]) {
        if (
          graphItem &&
          typeof graphItem === "object"
        ) {
          output.push(graphItem);
        }
      }
    }
  }

  return output;
}

function jsonLdType(item) {
  const type = item?.["@type"];

  if (Array.isArray(type)) {
    return type.map(String);
  }

  return type ? [String(type)] : [];
}

function extractImages(
  $,
  pageUrl,
  jsonLd,
  pageTitle
) {
  const results = [];
  const seen = new Set();

  function addImage(
    imageUrl,
    altText = "",
    title = ""
  ) {
    const absolute = absoluteUrl(
      imageUrl,
      pageUrl
    );

    if (!absolute) return;
    if (seen.has(absolute)) return;

    seen.add(absolute);

    results.push({
      page_url: pageUrl,
      image_url: absolute,
      alt_text:
        cleanText(altText) ||
        cleanText(title) ||
        cleanText(pageTitle) ||
        "",
      title:
        cleanText(title) ||
        cleanText(pageTitle) ||
        "",
      source_domain:
        new URL(pageUrl).hostname,
    });
  }

  const ogImage = firstMeta($, [
    'meta[property="og:image"]',
    'meta[property="og:image:url"]',
    'meta[name="twitter:image"]',
    'meta[name="twitter:image:src"]',
  ]);

  if (ogImage) {
    addImage(
      ogImage,
      "",
      pageTitle
    );
  }

  $("img").each((_, el) => {
    if (results.length >= MAX_IMAGES) {
      return false;
    }

    const imageUrl =
      $(el).attr("src") ||
      $(el).attr("data-src") ||
      $(el).attr("data-lazy-src") ||
      $(el).attr("data-original") ||
      $(el).attr("data-lazy") ||
      $(el).attr("data-original-src");

    if (!imageUrl) return;

    addImage(
      imageUrl,
      $(el).attr("alt") || "",
      $(el).attr("title") || pageTitle
    );
  });

  for (const item of flattenJsonLd(jsonLd)) {
    if (results.length >= MAX_IMAGES) break;

    const image = item.image;

    if (typeof image === "string") {
      addImage(
        image,
        "",
        item.headline ||
          item.name ||
          pageTitle
      );
    } else if (Array.isArray(image)) {
      for (const imageItem of image) {
        if (results.length >= MAX_IMAGES) break;

        if (typeof imageItem === "string") {
          addImage(
            imageItem,
            "",
            item.headline ||
              item.name ||
              pageTitle
          );
        } else if (imageItem?.url) {
          addImage(
            imageItem.url,
            "",
            item.headline ||
              item.name ||
              pageTitle
          );
        }
      }
    } else if (image?.url) {
      addImage(
        image.url,
        "",
        item.headline ||
          item.name ||
          pageTitle
      );
    }
  }

  return results.slice(0, MAX_IMAGES);
}

function extractVideos(
  $,
  pageUrl,
  jsonLd,
  pageTitle
) {
  const results = [];
  const seen = new Set();

  function addVideo(
    videoUrl,
    title = "",
    description = "",
    thumbnailUrl = ""
  ) {
    const absolute = absoluteUrl(
      videoUrl,
      pageUrl
    );

    if (!absolute) return;
    if (seen.has(absolute)) return;

    seen.add(absolute);

    results.push({
      page_url: pageUrl,
      video_url: absolute,
      title:
        cleanText(title) ||
        cleanText(pageTitle) ||
        "",
      description: cleanText(description),
      source_domain:
        new URL(pageUrl).hostname,
      thumbnail_url:
        absoluteUrl(
          thumbnailUrl,
          pageUrl
        ) || null,
    });
  }

  $("video").each((_, el) => {
    if (results.length >= MAX_VIDEOS) {
      return false;
    }

    const src =
      $(el).attr("src");

    if (src) {
      addVideo(
        src,
        $(el).attr("title") ||
          pageTitle
      );
    }

    $(el)
      .find("source")
      .each((__, source) => {
        if (results.length >= MAX_VIDEOS) {
          return false;
        }

        const sourceUrl =
          $(source).attr("src");

        if (sourceUrl) {
          addVideo(
            sourceUrl,
            $(el).attr("title") ||
              pageTitle
          );
        }
      });
  });

  $("iframe").each((_, el) => {
    if (results.length >= MAX_VIDEOS) {
      return false;
    }

    const src = $(el).attr("src");

    if (!src) return;

    if (
      /youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com/i.test(
        src
      )
    ) {
      addVideo(
        src,
        $(el).attr("title") ||
          pageTitle
      );
    }
  });

  for (const item of flattenJsonLd(jsonLd)) {
    if (results.length >= MAX_VIDEOS) break;

    const types = jsonLdType(item);

    if (!types.includes("VideoObject")) {
      continue;
    }

    if (item.contentUrl) {
      addVideo(
        item.contentUrl,
        item.name ||
          pageTitle,
        item.description || "",
        item.thumbnailUrl || ""
      );
    } else if (item.embedUrl) {
      addVideo(
        item.embedUrl,
        item.name ||
          pageTitle,
        item.description || "",
        item.thumbnailUrl || ""
      );
    }
  }

  return results.slice(0, MAX_VIDEOS);
}

function extractPlaces(
  $,
  pageUrl,
  jsonLd
) {
  const results = [];
  const seen = new Set();

  const placeTypes = new Set([
    "Place",
    "LocalBusiness",
    "Restaurant",
    "Hotel",
    "Store",
    "Organization",
    "Airport",
    "Hospital",
    "School",
    "CollegeOrUniversity",
    "TouristAttraction",
    "Museum",
    "Park",
    "Zoo",
    "StadiumOrArena",
    "LandmarksOrHistoricalBuildings",
    "Library",
    "GovernmentOffice",
  ]);

  for (const item of flattenJsonLd(jsonLd)) {
    if (results.length >= MAX_PLACES) break;

    const types = jsonLdType(item);

    if (
      !types.some((type) =>
        placeTypes.has(type)
      )
    ) {
      continue;
    }

    const name = cleanText(item.name);

    if (!name) continue;

    const address = item.address;

    let addressText = "";
    let city = "";
    let state = "";
    let country = "";

    if (typeof address === "string") {
      addressText = cleanText(address);
    } else if (address) {
      addressText = cleanText(
        [
          address.streetAddress,
          address.addressLocality,
          address.addressRegion,
          address.postalCode,
          address.addressCountry,
        ]
          .filter(Boolean)
          .join(", ")
      );

      city =
        cleanText(
          address.addressLocality
        );

      state =
        cleanText(
          address.addressRegion
        );

      country =
        cleanText(
          typeof address.addressCountry ===
            "string"
            ? address.addressCountry
            : address.addressCountry?.name
        );
    }

    const geo = item.geo || {};

    const latitude =
      Number(geo.latitude);

    const longitude =
      Number(geo.longitude);

    const key = [
      name,
      addressText,
      latitude,
      longitude,
    ].join("|");

    if (seen.has(key)) continue;

    seen.add(key);

    results.push({
      page_url: pageUrl,
      name,
      address: addressText,
      city,
      district: "",
      state,
      country,
      latitude:
        Number.isFinite(latitude)
          ? latitude
          : null,
      longitude:
        Number.isFinite(longitude)
          ? longitude
          : null,
      source_domain:
        new URL(pageUrl).hostname,
    });
  }

  return results;
}

function isNewsPage(
  $,
  pageUrl,
  jsonLd,
  publishedAt
) {
  const types = new Set();

  for (const item of flattenJsonLd(jsonLd)) {
    for (const type of jsonLdType(item)) {
      types.add(type);
    }
  }

  if (
    [...types].some((type) =>
      NEWS_JSON_TYPES.has(type)
    )
  ) {
    return true;
  }

  const ogType =
    firstMeta($, [
      'meta[property="og:type"]',
    ]).toLowerCase();

  if (
    ogType === "article" ||
    ogType === "newsarticle"
  ) {
    return true;
  }

  const articleTime = firstMeta($, [
    'meta[property="article:published_time"]',
    'meta[name="article:published_time"]',
  ]);

  if (articleTime) {
    return true;
  }

  try {
    const path =
      new URL(pageUrl)
        .pathname
        .toLowerCase();

    if (
      NEWS_PATH_HINTS.some((hint) =>
        path.startsWith(hint)
      )
    ) {
      return true;
    }
  } catch {
    // ignore
  }

  /*
   * A date alone is not enough to call every dated page news,
   * but combined with an article/main element it is useful.
   */
  if (
    publishedAt &&
    ($("article").length > 0 ||
      $("main").length > 0)
  ) {
    return true;
  }

  return false;
}

function extractSourceName(
  $,
  jsonLd,
  pageUrl
) {
  const metaName = firstMeta($, [
    'meta[property="og:site_name"]',
    'meta[name="application-name"]',
    'meta[name="publisher"]',
    'meta[name="site_name"]',
  ]);

  if (metaName) return metaName;

  for (const item of flattenJsonLd(jsonLd)) {
    const publisher = item.publisher;

    if (typeof publisher === "string") {
      return cleanText(publisher);
    }

    if (publisher?.name) {
      return cleanText(
        publisher.name
      );
    }
  }

  try {
    return new URL(pageUrl).hostname.replace(
      /^www\./i,
      ""
    );
  } catch {
    return "";
  }
}

function extractNews(
  $,
  pageUrl,
  jsonLd,
  title,
  description,
  publishedAt,
  images
) {
  if (
    !isNewsPage(
      $,
      pageUrl,
      jsonLd,
      publishedAt
    )
  ) {
    return null;
  }

  let newsTitle = title;

  let newsDescription = description;

  let newsDate = publishedAt;

  let newsImage = null;

  for (const item of flattenJsonLd(jsonLd)) {
    const types = jsonLdType(item);

    if (
      types.some((type) =>
        NEWS_JSON_TYPES.has(type)
      )
    ) {
      newsTitle =
        cleanText(
          item.headline ||
            item.name ||
            newsTitle
        );

      newsDescription =
        cleanText(
          item.description ||
            newsDescription
        );

      if (item.datePublished) {
        const parsed = new Date(
          item.datePublished
        );

        if (!Number.isNaN(parsed.getTime())) {
          newsDate =
            parsed.toISOString();
        }
      }

      const image = item.image;

      if (typeof image === "string") {
        newsImage =
          absoluteUrl(
            image,
            pageUrl
          );
      } else if (
        Array.isArray(image) &&
        image.length
      ) {
        newsImage =
          absoluteUrl(
            image[0],
            pageUrl
          );
      } else if (image?.url) {
        newsImage =
          absoluteUrl(
            image.url,
            pageUrl
          );
      }
    }
  }

  if (!newsImage && images.length) {
    newsImage =
      images[0].image_url;
  }

  return {
    title:
      cleanText(newsTitle) ||
      "Untitled",
    description:
      cleanText(newsDescription),
    url: pageUrl,
    source_name:
      extractSourceName(
        $,
        jsonLd,
        pageUrl
      ),
    source_domain:
      new URL(pageUrl).hostname,
    published_at:
      newsDate || null,
    image_url:
      newsImage || null,
    fetched_at:
      new Date().toISOString(),
  };
}

function extractContent($) {
  const clone = $.root().clone();

  clone
    .find(
      "script,style,noscript,template,svg,canvas,iframe,nav,footer,header,form"
    )
    .remove();

  let container =
    clone.find("article").first();

  if (!container.length) {
    container =
      clone.find("main").first();
  }

  if (!container.length) {
    container = clone.find("body").first();
  }

  const text = cleanText(
    container.text()
  );

  return text.slice(0, MAX_CONTENT);
}

function extractLinks($, pageUrl) {
  const links = [];
  const seen = new Set();

  $("a[href]").each((_, el) => {
    if (links.length >= MAX_LINKS) {
      return false;
    }

    const href = $(el).attr("href");

    const normalized =
      absoluteUrl(href, pageUrl);

    if (!normalized) return;

    if (isSkippableUrl(normalized)) {
      return;
    }

    if (seen.has(normalized)) {
      return;
    }

    seen.add(normalized);

    links.push(normalized);
  });

  return links;
}

async function parsePage(
  html,
  pageUrl
) {
  const $ = cheerio.load(html);

  const jsonLd =
    flattenJsonLd(
      collectJsonLd($)
    );

  const title =
    cleanText(
      $("title").first().text()
    ) ||
    firstMeta($, [
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
    ]);

  const description =
    firstMeta($, [
      'meta[name="description"]',
      'meta[property="og:description"]',
      'meta[name="twitter:description"]',
    ]);

  const content =
    extractContent($);

  const language =
    detectLanguage(
      `${title} ${description} ${content.slice(
        0,
        5000
      )}`
    );

  const publishedAt =
    parseDate($, jsonLd);

  const author =
    parseAuthor($, jsonLd);

  const images =
    extractImages(
      $,
      pageUrl,
      jsonLd,
      title
    );

  const videos =
    extractVideos(
      $,
      pageUrl,
      jsonLd,
      title
    );

  const places =
    extractPlaces(
      $,
      pageUrl,
      jsonLd
    );

  const news =
    extractNews(
      $,
      pageUrl,
      jsonLd,
      title,
      description,
      publishedAt,
      images
    );

  const links =
    extractLinks(
      $,
      pageUrl
    );

  return {
    title,
    description,
    author,
    published_at: publishedAt,
    language,
    content,
    images,
    videos,
    places,
    news,
    links,
  };
}

async function savePage(
  supabase,
  url,
  data
) {
  const row = {
    url,
    title: data.title || "",
    description:
      data.description || "",
    content: data.content || "",
    language:
      data.language || "en",
    author:
      data.author || null,
    published_at:
      data.published_at || null,
    image_url:
      data.images?.[0]?.image_url ||
      null,
    updated_at:
      new Date().toISOString(),
  };

  const { error } =
    await supabase
      .from("pages")
      .upsert(row, {
        onConflict: "url",
      });

  if (error) {
    throw error;
  }
}

async function saveImages(
  supabase,
  images
) {
  if (!images?.length) return;

  const { error } =
    await supabase
      .from("images")
      .upsert(images, {
        onConflict:
          "page_url,image_url",
      });

  if (error) {
    console.error(
      "[HEXORA] image save error:",
      error.message
    );
  }
}

async function saveVideos(
  supabase,
  videos
) {
  if (!videos?.length) return;

  const { error } =
    await supabase
      .from("videos")
      .upsert(videos, {
        onConflict:
          "page_url,video_url",
      });

  if (error) {
    console.error(
      "[HEXORA] video save error:",
      error.message
    );
  }
}

async function savePlaces(
  supabase,
  places
) {
  if (!places?.length) return;

  const { error } =
    await supabase
      .from("places")
      .upsert(places, {
        onConflict:
          "page_url,name,latitude,longitude",
      });

  if (error) {
    console.error(
      "[HEXORA] place save error:",
      error.message
    );
  }
}

async function saveNews(
  supabase,
  news
) {
  if (!news) return;

  const row = {
    title:
      news.title || "Untitled",
    description:
      news.description || "",
    url: news.url,
    source_name:
      news.source_name || "",
    source_domain:
      news.source_domain || "",
    published_at:
      news.published_at || null,
    image_url:
      news.image_url || null,
    fetched_at:
      new Date().toISOString(),
  };

  const { error } =
    await supabase
      .from("news")
      .upsert(row, {
        onConflict: "url",
      });

  if (error) {
    console.error(
      "[HEXORA] news save error:",
      error.message
    );
  }
}

async function queueLinks(
  supabase,
  links
) {
  if (!links?.length) return;

  const rows = links.map((url) => ({
    url,
    status: "pending",
    retries: 0,
    next_attempt_at:
      new Date().toISOString(),
  }));

  /*
   * Duplicate URLs are harmless here.
   * If crawl_queue has a unique URL constraint,
   * duplicates will be ignored.
   */
  const { error } =
    await supabase
      .from("crawl_queue")
      .upsert(rows, {
        onConflict: "url",
        ignoreDuplicates: true,
      });

  if (error) {
    console.error(
      "[HEXORA] queue error:",
      error.message
    );
  }
}

async function markQueueDone(
  supabase,
  url
) {
  const { error } =
    await supabase
      .from("crawl_queue")
      .update({
        status: "done",
        last_error: null,
        updated_at:
          new Date().toISOString(),
      })
      .eq("url", url);

  if (error) {
    console.error(
      "[HEXORA] queue done error:",
      error.message
    );
  }
}

async function markQueueFailed(
  supabase,
  row,
  error
) {
  const retries =
    Number(row.retries || 0) + 1;

  const status =
    PERMANENT_ERRORS.has(
      Number(error?.status)
    ) ||
    retries >= RETRY_LIMIT
      ? "failed"
      : "pending";

  const delayMinutes =
    Math.min(
      24 * 60,
      Math.pow(2, retries - 1)
    );

  const nextAttempt =
    new Date(
      Date.now() +
        delayMinutes * 60 * 1000
    ).toISOString();

  const { error: dbError } =
    await supabase
      .from("crawl_queue")
      .update({
        status,
        retries,
        last_error:
          String(
            error?.message ||
              error ||
              "Unknown error"
          ).slice(0, 1000),
        next_attempt_at:
          status === "pending"
            ? nextAttempt
            : null,
        updated_at:
          new Date().toISOString(),
      })
      .eq("url", row.url);

  if (dbError) {
    console.error(
      "[HEXORA] queue failed error:",
      dbError.message
    );
  }
}

function chooseDomainFairly(rows) {
  const counts = new Map();

  for (const row of rows) {
    try {
      const domain =
        new URL(row.url).hostname;

      counts.set(
        domain,
        (counts.get(domain) || 0) + 1
      );
    } catch {
      // ignore
    }
  }

  return rows.sort((a, b) => {
    try {
      const da =
        new URL(a.url).hostname;

      const db =
        new URL(b.url).hostname;

      return (
        (counts.get(da) || 0) -
        (counts.get(db) || 0)
      );
    } catch {
      return 0;
    }
  });
}

async function claimQueue(
  supabase,
  limit = 10
) {
  const now =
    new Date().toISOString();

  const { data, error } =
    await supabase
      .from("crawl_queue")
      .select("*")
      .eq("status", "pending")
      .or(
        `next_attempt_at.is.null,next_attempt_at.lte.${now}`
      )
      .order("created_at", {
        ascending: true,
      })
      .limit(limit * 5);

  if (error) {
    throw error;
  }

  if (!data?.length) {
    return [];
  }

  const selected =
    chooseDomainFairly(data)
      .slice(0, limit);

  const urls =
    selected.map((row) => row.url);

  if (!urls.length) {
    return [];
  }

  const { error: updateError } =
    await supabase
      .from("crawl_queue")
      .update({
        status: "processing",
        updated_at: now,
      })
      .in("url", urls)
      .eq("status", "pending");

  if (updateError) {
    throw updateError;
  }

  return selected;
}

export async function crawlOne(
  supabase,
  inputUrl,
  queueRow = null
) {
  const url =
    normalizeUrl(inputUrl);

  if (!url) {
    return {
      ok: false,
      reason: "invalid_url",
    };
  }

  if (isSkippableUrl(url)) {
    return {
      ok: false,
      reason: "skipped_url",
    };
  }

  try {
    const allowed =
      await canCrawl(url);

    if (!allowed) {
      const error =
        new Error(
          "Blocked by robots.txt"
        );

      error.status = 403;

      if (queueRow) {
        await markQueueFailed(
          supabase,
          queueRow,
          error
        );
      }

      return {
        ok: false,
        reason: "robots_blocked",
      };
    }

    const fetched =
      await fetchHtml(url);

    const finalUrl =
      normalizeUrl(
        fetched.finalUrl
      ) || url;

    if (isSkippableUrl(finalUrl)) {
      if (queueRow) {
        await markQueueDone(
          supabase,
          queueRow.url
        );
      }

      return {
        ok: false,
        reason: "redirect_skipped",
      };
    }

    const parsed =
      await parsePage(
        fetched.html,
        finalUrl
      );

    if (
      !parsed.content ||
      parsed.content.length <
        MIN_CONTENT_LENGTH
    ) {
      if (queueRow) {
        await markQueueDone(
          supabase,
          queueRow.url
        );
      }

      return {
        ok: false,
        reason: "content_too_small",
      };
    }

    /*
     * MAIN WEB INDEX
     */
    await savePage(
      supabase,
      finalUrl,
      parsed
    );

    /*
     * IMAGE INDEX
     */
    await saveImages(
      supabase,
      parsed.images
    );

    /*
     * VIDEO INDEX
     */
    await saveVideos(
      supabase,
      parsed.videos
    );

    /*
     * MAP / PLACE INDEX
     */
    await savePlaces(
      supabase,
      parsed.places
    );

    /*
     * NEWS INDEX
     */
    await saveNews(
      supabase,
      parsed.news
    );

    /*
     * DISCOVER NEW URLs
     */
    await queueLinks(
      supabase,
      parsed.links
    );

    if (queueRow) {
      await markQueueDone(
        supabase,
        queueRow.url
      );
    }

    console.log(
      `[HEXORA] Crawled: ${finalUrl} | images=${parsed.images.length} videos=${parsed.videos.length} places=${parsed.places.length} news=${parsed.news ? 1 : 0}`
    );

    return {
      ok: true,
      url: finalUrl,
      images:
        parsed.images.length,
      videos:
        parsed.videos.length,
      places:
        parsed.places.length,
      news:
        parsed.news ? 1 : 0,
      links:
        parsed.links.length,
    };
  } catch (error) {
    console.error(
      `[HEXORA] Crawl failed: ${url}`,
      error?.message || error
    );

    if (queueRow) {
      await markQueueFailed(
        supabase,
        queueRow,
        error
      );
    }

    return {
      ok: false,
      reason:
        error?.message ||
        "crawl_failed",
    };
  }
}

export async function crawlBatch(
  supabase,
  limit = 10
) {
  const rows =
    await claimQueue(
      supabase,
      limit
    );

  if (!rows.length) {
    return {
      claimed: 0,
      success: 0,
      failed: 0,
    };
  }

  let success = 0;
  let failed = 0;

  /*
   * Sequential crawling keeps load reasonable
   * and respects domain delay.
   */
  for (const row of rows) {
    const result =
      await crawlOne(
        supabase,
        row.url,
        row
      );

    if (result.ok) {
      success++;
    } else {
      failed++;
    }
  }

  return {
    claimed: rows.length,
    success,
    failed,
  };
}
