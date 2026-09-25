import * as cheerio from "cheerio";

/*
 * HEXORA GLOBAL CRAWLER
 *
 * Features:
 * - Global / topic-neutral crawling
 * - Per-domain fairness
 * - Search-engine result URL filtering
 * - Permanent HTTP error handling
 * - 429 / 5xx retry with backoff
 * - robots.txt
 * - HTML-only crawling
 * - Images
 * - Videos
 * - Places
 * - Global link discovery
 * - Existing Supabase data preserved
 */

const USER_AGENT =
  process.env.HEXORA_USER_AGENT ||
  "HEXORA-Bot/1.0 (+https://hexora-search.com/crawler)";

const REQUEST_TIMEOUT =
  Number(process.env.CRAWL_TIMEOUT_MS || 15000);

const DOMAIN_DELAY =
  Number(process.env.CRAWL_DOMAIN_DELAY_MS || 1500);

const MAX_CONTENT =
  Number(process.env.CRAWL_MAX_CONTENT || 100000);

const MAX_LINKS =
  Number(process.env.CRAWL_MAX_LINKS || 300);

const MAX_IMAGES =
  Number(process.env.CRAWL_MAX_IMAGES || 100);

const MAX_VIDEOS =
  Number(process.env.CRAWL_MAX_VIDEOS || 50);

const MAX_PLACES =
  Number(process.env.CRAWL_MAX_PLACES || 20);

const CANDIDATE_LIMIT =
  Number(process.env.CRAWL_CANDIDATE_LIMIT || 250);

const RETRY_LIMIT =
  Number(process.env.CRAWL_RETRY_LIMIT || 5);

const ROBOTS_CACHE_MS =
  Number(process.env.CRAWL_ROBOTS_CACHE_MS || 3600000);

const MAX_DOMAIN_PER_BATCH =
  Math.max(
    1,
    Number(
      process.env.CRAWL_MAX_DOMAIN_PER_BATCH || 2
    )
  );

const MIN_CONTENT_LENGTH =
  Math.max(
    100,
    Number(
      process.env.CRAWL_MIN_CONTENT_LENGTH || 200
    )
  );

const PERMANENT_HTTP_ERRORS = new Set([
  400,
  401,
  403,
  404,
  410,
  451,
]);

const SKIP_EXTENSIONS = new Set([
  ".pdf",
  ".zip",
  ".rar",
  ".7z",
  ".tar",
  ".gz",
  ".bz2",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".odt",
  ".ods",
  ".odp",
  ".exe",
  ".dmg",
  ".iso",
  ".apk",
  ".ipa",
  ".bin",
  ".torrent",
  ".mp3",
  ".wav",
  ".flac",
  ".ogg",
  ".mp4",
  ".mkv",
  ".avi",
  ".mov",
  ".wmv",
  ".webm",
]);

/*
 * Search engines / search-result services that
 * HEXORA should NOT crawl as webpages.
 *
 * HEXORA builds its own index. Crawling Google/Bing
 * search-result pages only produces duplicate queries,
 * 429 errors and low-value URLs.
 */
const BLOCKED_HOSTS = new Set([
  "google.com",
  "www.google.com",
  "google.co.in",
  "www.google.co.in",
  "google.co.jp",
  "www.google.co.jp",
  "google.co.hu",
  "www.google.co.hu",
  "google.co.uk",
  "www.google.co.uk",
  "google.de",
  "www.google.de",
  "google.fr",
  "www.google.fr",
  "google.ca",
  "www.google.ca",
  "google.com.au",
  "www.google.com.au",

  "scholar.google.com",
  "books.google.com",
  "news.google.com",

  "bing.com",
  "www.bing.com",

  "search.yahoo.com",

  "duckduckgo.com",
  "www.duckduckgo.com",
]);

const BLOCKED_HOST_SUFFIXES = [
  ".google.com",
  ".google.co.in",
  ".google.co.jp",
  ".google.co.hu",
  ".google.co.uk",
  ".google.de",
  ".google.fr",
  ".google.ca",
  ".google.com.au",
];

const BLOCKED_PATH_PATTERNS = [
  /^\/search(?:\/|$|\?)/i,
  /^\/scholar(?:\/|$|\?)/i,
  /^\/books\/search/i,
  /^\/news\/search/i,
  /^\/cse(?:\/|$)/i,
  /^\/customsearch/i,
  /^\/search-results/i,
  /^\/searchresult/i,
  /^\/action\/doBasicSearch/i,
  /^\/search\?/i,
];

const robotsCache = new Map();
const domainLastRequest = new Map();

/* =====================================================
   BASIC HELPERS
===================================================== */

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function safeUrl(value, base = null) {
  try {
    const u = base
      ? new URL(value, base)
      : new URL(value);

    if (
      u.protocol !== "http:" &&
      u.protocol !== "https:"
    ) {
      return null;
    }

    u.hash = "";

    return u.href;
  } catch {
    return null;
  }
}

function domainOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value, max) {
  const text = cleanText(value);

  if (text.length <= max) {
    return text;
  }

  return text.slice(0, max);
}

function absoluteUrl(value, base) {
  return safeUrl(value, base);
}

/* =====================================================
   URL NORMALIZATION
===================================================== */

function normalizeUrl(url) {
  const value = safeUrl(url);

  if (!value) {
    return null;
  }

  try {
    const u = new URL(value);

    u.hash = "";

    const trackingParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "gclid",
      "fbclid",
      "mc_cid",
      "mc_eid",
    ];

    for (const key of trackingParams) {
      u.searchParams.delete(key);
    }

    return u.href;
  } catch {
    return null;
  }
}

/* =====================================================
   SEARCH URL FILTER
===================================================== */

function isBlockedSearchUrl(url) {
  try {
    const u = new URL(url);

    const host =
      u.hostname.toLowerCase();

    const path =
      u.pathname || "/";

    /*
     * Exact blocked hosts.
     */
    if (BLOCKED_HOSTS.has(host)) {
      return true;
    }

    /*
     * Google regional domains.
     */
    if (
      BLOCKED_HOST_SUFFIXES.some(
        (suffix) => host.endsWith(suffix)
      )
    ) {
      return true;
    }

    /*
     * Search-result URL paths.
     */
    const fullPath =
      `${path}${u.search}`;

    if (
      BLOCKED_PATH_PATTERNS.some(
        (pattern) =>
          pattern.test(fullPath)
      )
    ) {
      return true;
    }

    /*
     * Search-like parameters on obvious
     * search endpoints.
     */
    const searchParams = [
      "q",
      "query",
      "search",
      "keyword",
      "keywords",
      "wd",
      "as_q",
      "as_eq",
    ];

    const hasSearchParam =
      searchParams.some(
        (key) =>
          u.searchParams.has(key)
      );

    const searchWords =
      `${path} ${host}`.toLowerCase();

    if (
      hasSearchParam &&
      (
        searchWords.includes("search") ||
        searchWords.includes("scholar") ||
        searchWords.includes("basicsearch")
      )
    ) {
      return true;
    }

    return false;
  } catch {
    return true;
  }
}

/* =====================================================
   RESOURCE FILTER
===================================================== */

function isSkippableResource(url) {
  try {
    const pathname =
      new URL(url)
        .pathname
        .toLowerCase();

    for (
      const extension of SKIP_EXTENSIONS
    ) {
      if (
        pathname.endsWith(extension)
      ) {
        return true;
      }
    }

    return false;
  } catch {
    return true;
  }
}

function isHtmlUrl(url) {
  if (!url) {
    return false;
  }

  if (isBlockedSearchUrl(url)) {
    return false;
  }

  if (isSkippableResource(url)) {
    return false;
  }

  return true;
}

/* =====================================================
   DOMAIN RATE LIMIT
===================================================== */

async function respectDomainDelay(url) {
  const domain = domainOf(url);

  if (!domain) {
    return;
  }

  const previous =
    domainLastRequest.get(domain) || 0;

  const elapsed =
    Date.now() - previous;

  if (elapsed < DOMAIN_DELAY) {
    await sleep(
      DOMAIN_DELAY - elapsed
    );
  }

  domainLastRequest.set(
    domain,
    Date.now()
  );
}

/* =====================================================
   ROBOTS.TXT
===================================================== */

function parseRobots(text) {
  const groups = [];

  let current = null;

  for (
    const rawLine of String(
      text || ""
    ).split(/\r?\n/)
  ) {
    const line =
      rawLine
        .split("#")[0]
        .trim();

    if (!line) {
      continue;
    }

    const colon =
      line.indexOf(":");

    if (colon === -1) {
      continue;
    }

    const key =
      line
        .slice(0, colon)
        .trim()
        .toLowerCase();

    const value =
      line
        .slice(colon + 1)
        .trim();

    if (key === "user-agent") {
      current = {
        agents: [
          value.toLowerCase(),
        ],
        rules: [],
      };

      groups.push(current);

      continue;
    }

    if (
      current &&
      (
        key === "allow" ||
        key === "disallow"
      )
    ) {
      current.rules.push({
        type: key,
        value,
      });
    }
  }

  return groups;
}

function robotsMatch(
  pattern,
  pathname
) {
  if (!pattern) {
    return false;
  }

  if (pattern === "/") {
    return true;
  }

  let p = pattern;

  p = p
    .replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    )
    .replace(
      /\\\*/g,
      ".*"
    )
    .replace(
      /\\\$/g,
      "$"
    );

  try {
    return new RegExp(
      `^${p}`
    ).test(pathname);
  } catch {
    return false;
  }
}

function robotsAllowed(
  groups,
  url
) {
  const matchingGroups = [];

  for (const group of groups) {
    const agents =
      group.agents || [];

    if (
      agents.includes("*") ||
      agents.includes("hexora-bot") ||
      agents.includes("hexora")
    ) {
      matchingGroups.push(group);
    }
  }

  if (!matchingGroups.length) {
    return true;
  }

  let pathname = "/";

  try {
    pathname =
      new URL(url).pathname || "/";
  } catch {
    return false;
  }

  let matched = null;

  for (
    const group of matchingGroups
  ) {
    for (
      const rule of group.rules || []
    ) {
      if (
        robotsMatch(
          rule.value,
          pathname
        )
      ) {
        if (
          !matched ||
          rule.value.length >
            matched.value.length
        ) {
          matched = rule;
        }
      }
    }
  }

  if (!matched) {
    return true;
  }

  return (
    matched.type === "allow"
  );
}

async function canCrawl(url) {
  const origin =
    originOf(url);

  if (!origin) {
    return false;
  }

  const cached =
    robotsCache.get(origin);

  if (
    cached &&
    Date.now() - cached.time <
      ROBOTS_CACHE_MS
  ) {
    if (!cached.allowed) {
      return false;
    }

    return robotsAllowed(
      cached.groups,
      url
    );
  }

  const robotsUrl =
    `${origin}/robots.txt`;

  try {
    await respectDomainDelay(
      robotsUrl
    );

    const controller =
      new AbortController();

    const timer =
      setTimeout(
        () =>
          controller.abort(),
        Math.min(
          REQUEST_TIMEOUT,
          10000
        )
      );

    let response;

    try {
      response = await fetch(
        robotsUrl,
        {
          method: "GET",
          headers: {
            "user-agent":
              USER_AGENT,
            accept:
              "text/plain,*/*;q=0.5",
          },
          redirect: "follow",
          signal:
            controller.signal,
        }
      );
    } finally {
      clearTimeout(timer);
    }

    /*
     * No robots.txt = allowed.
     */
    if (
      response.status === 404
    ) {
      robotsCache.set(
        origin,
        {
          time: Date.now(),
          allowed: true,
          groups: [],
        }
      );

      return true;
    }

    /*
     * If robots cannot be verified,
     * stay conservative.
     */
    if (!response.ok) {
      robotsCache.set(
        origin,
        {
          time: Date.now(),
          allowed: false,
          groups: [],
        }
      );

      return false;
    }

    const text =
      await response.text();

    const groups =
      parseRobots(text);

    robotsCache.set(
      origin,
      {
        time: Date.now(),
        allowed: true,
        groups,
      }
    );

    return robotsAllowed(
      groups,
      url
    );
  } catch {
    robotsCache.set(
      origin,
      {
        time: Date.now(),
        allowed: false,
        groups: [],
      }
    );

    return false;
  }
}

/* =====================================================
   HTML FETCH
===================================================== */

async function fetchHtml(url) {
  await respectDomainDelay(url);

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      REQUEST_TIMEOUT
    );

  try {
    const response =
      await fetch(
        url,
        {
          method: "GET",
          headers: {
            "user-agent":
              USER_AGENT,
            accept:
              "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
            "accept-language":
              "en-US,en;q=0.8",
          },
          redirect: "follow",
          signal:
            controller.signal,
        }
      );

    const contentType =
      response.headers.get(
        "content-type"
      ) || "";

    const finalUrl =
      normalizeUrl(
        response.url || url
      ) || url;

    if (!response.ok) {
      const error =
        new Error(
          `HTTP ${response.status}`
        );

      error.status =
        response.status;

      error.permanent =
        PERMANENT_HTTP_ERRORS.has(
          response.status
        );

      throw error;
    }

    if (
      !contentType.includes(
        "text/html"
      ) &&
      !contentType.includes(
        "application/xhtml+xml"
      )
    ) {
      const error =
        new Error(
          `Unsupported content-type: ${contentType}`
        );

      error.status = 415;
      error.permanent = true;

      throw error;
    }

    const html =
      await response.text();

    return {
      html,
      finalUrl,
      status:
        response.status,
      contentType,
    };
  } finally {
    clearTimeout(timer);
  }
}

/* =====================================================
   LANGUAGE
===================================================== */

function detectLanguage(
  text,
  html
) {
  const value =
    `${text || ""} ${html || ""}`
      .slice(0, 50000);

  /*
   * Assamese / Bengali share Unicode block.
   * Check common Assamese letters first.
   */
  if (
    /[ৰৱয়খগঘচছজঝটঠডঢণতথদধনপফবভমযলশষসহ]/.test(
      value
    )
  ) {
    return "as";
  }

  if (
    /[\u0980-\u09FF]/.test(
      value
    )
  ) {
    return "bn";
  }

  if (
    /[\u0900-\u097F]/.test(
      value
    )
  ) {
    return "hi";
  }

  if (
    /[\u4E00-\u9FFF]/.test(
      value
    )
  ) {
    return "zh";
  }

  if (
    /[\u3040-\u30FF]/.test(
      value
    )
  ) {
    return "ja";
  }

  if (
    /[\uAC00-\uD7AF]/.test(
      value
    )
  ) {
    return "ko";
  }

  if (
    /[\u0400-\u04FF]/.test(
      value
    )
  ) {
    return "ru";
  }

  if (
    /[\u0600-\u06FF]/.test(
      value
    )
  ) {
    return "ar";
  }

  if (
    /[\u0370-\u03FF]/.test(
      value
    )
  ) {
    return "el";
  }

  return "en";
}

/* =====================================================
   AUTHOR / DATE
===================================================== */

function parseDate($) {
  const selectors = [
    'meta[property="article:published_time"]',
    'meta[name="article:published_time"]',
    'meta[name="publishdate"]',
    'meta[name="date"]',
    'meta[itemprop="datePublished"]',
    "time[datetime]",
  ];

  for (
    const selector of selectors
  ) {
    const node =
      $(selector).first();

    if (!node.length) {
      continue;
    }

    const value =
      node.attr("content") ||
      node.attr("datetime") ||
      node.text();

    if (!value) {
      continue;
    }

    const date =
      new Date(value);

    if (
      !Number.isNaN(
        date.getTime()
      )
    ) {
      return date.toISOString();
    }
  }

  return null;
}

function parseAuthor($) {
  const selectors = [
    'meta[name="author"]',
    'meta[property="article:author"]',
    'meta[itemprop="author"]',
    '[rel="author"]',
    ".author",
    ".byline",
  ];

  for (
    const selector of selectors
  ) {
    const node =
      $(selector).first();

    if (!node.length) {
      continue;
    }

    const value =
      node.attr("content") ||
      node.attr("href") ||
      node.text();

    const cleaned =
      cleanText(value);

    if (cleaned) {
      return cleaned.slice(
        0,
        500
      );
    }
  }

  return null;
}

/* =====================================================
   JSON-LD
===================================================== */

function collectJsonLd($) {
  const items = [];

  $(
    'script[type="application/ld+json"]'
  ).each((_, node) => {
    const raw =
      $(node)
        .text()
        .trim();

    if (!raw) {
      return;
    }

    try {
      const parsed =
        JSON.parse(raw);

      if (Array.isArray(parsed)) {
        items.push(
          ...parsed
        );
      } else if (parsed) {
        items.push(parsed);
      }
    } catch {
      // Ignore malformed JSON-LD.
    }
  });

  return items;
}

function flattenJsonLd(item) {
  if (
    !item ||
    typeof item !== "object"
  ) {
    return [];
  }

  const result = [item];

  if (
    Array.isArray(
      item["@graph"]
    )
  ) {
    result.push(
      ...item["@graph"]
    );
  }

  return result;
}

/* =====================================================
   IMAGES
===================================================== */

function addImage(
  images,
  image,
  pageUrl,
  title = ""
) {
  if (!image) {
    return;
  }

  const imageUrl =
    absoluteUrl(
      typeof image === "string"
        ? image
        : image.url ||
          image.contentUrl,
      pageUrl
    );

  if (!imageUrl) {
    return;
  }

  if (
    !/^https?:\/\//i.test(
      imageUrl
    )
  ) {
    return;
  }

  images.push({
    page_url: pageUrl,
    image_url: imageUrl,
    alt_text:
      title || null,
    title:
      title || null,
    source_domain:
      domainOf(pageUrl),
  });
}

function extractImages(
  $,
  pageUrl,
  jsonLd
) {
  const images = [];

  const ogImage =
    $(
      'meta[property="og:image"]'
    ).attr("content");

  addImage(
    images,
    ogImage,
    pageUrl
  );

  const twitterImage =
    $(
      'meta[name="twitter:image"]'
    ).attr("content");

  addImage(
    images,
    twitterImage,
    pageUrl
  );

  $("img").each(
    (_, img) => {
      if (
        images.length >=
        MAX_IMAGES
      ) {
        return false;
      }

      const node = $(img);

      const src =
        node.attr("src") ||
        node.attr("data-src") ||
        node.attr(
          "data-lazy-src"
        ) ||
        node.attr(
          "data-original"
        );

      const alt =
        cleanText(
          node.attr("alt") ||
            node.attr("title") ||
            ""
        );

      addImage(
        images,
        src,
        pageUrl,
        alt
      );
    }
  );

  for (
    const item of jsonLd
  ) {
    for (
      const object of
        flattenJsonLd(item)
    ) {
      if (
        images.length >=
        MAX_IMAGES
      ) {
        break;
      }

      const image =
        object.image;

      if (
        Array.isArray(image)
      ) {
        for (
          const value of image
        ) {
          addImage(
            images,
            value,
            pageUrl,
            object.name || ""
          );

          if (
            images.length >=
            MAX_IMAGES
          ) {
            break;
          }
        }
      } else {
        addImage(
          images,
          image,
          pageUrl,
          object.name || ""
        );
      }
    }
  }

  const unique =
    new Map();

  for (
    const row of images
  ) {
    unique.set(
      row.image_url,
      row
    );
  }

  return [
    ...unique.values(),
  ].slice(
    0,
    MAX_IMAGES
  );
}

/* =====================================================
   VIDEOS
===================================================== */

function addVideo(
  videos,
  video,
  pageUrl,
  title = "",
  description = "",
  thumbnail = null
) {
  if (!video) {
    return;
  }

  const videoUrl =
    absoluteUrl(
      typeof video === "string"
        ? video
        : video.url ||
          video.contentUrl ||
          video.embedUrl,
      pageUrl
    );

  if (!videoUrl) {
    return;
  }

  if (
    !/^https?:\/\//i.test(
      videoUrl
    )
  ) {
    return;
  }

  videos.push({
    page_url: pageUrl,
    video_url: videoUrl,
    title:
      title || null,
    description:
      description || null,
    source_domain:
      domainOf(pageUrl),
    thumbnail_url:
      thumbnail
        ? absoluteUrl(
            thumbnail,
            pageUrl
          )
        : null,
  });
}

function extractVideos(
  $,
  pageUrl,
  jsonLd
) {
  const videos = [];

  $("video").each(
    (_, node) => {
      if (
        videos.length >=
        MAX_VIDEOS
      ) {
        return false;
      }

      const el = $(node);

      addVideo(
        videos,
        el.attr("src"),
        pageUrl,
        cleanText(
          el.attr("title") ||
            ""
        )
      );

      el.find(
        "source"
      ).each(
        (__, source) => {
          if (
            videos.length >=
            MAX_VIDEOS
          ) {
            return false;
          }

          addVideo(
            videos,
            $(source).attr(
              "src"
            ),
            pageUrl
          );
        }
      );
    }
  );

  $("iframe").each(
    (_, node) => {
      if (
        videos.length >=
        MAX_VIDEOS
      ) {
        return false;
      }

      const src =
        absoluteUrl(
          $(node).attr("src"),
          pageUrl
        );

      if (!src) {
        return;
      }

      const host =
        domainOf(src);

      if (
        host.includes(
          "youtube.com"
        ) ||
        host.includes(
          "youtu.be"
        ) ||
        host.includes(
          "vimeo.com"
        ) ||
        host.includes(
          "dailymotion.com"
        )
      ) {
        addVideo(
          videos,
          src,
          pageUrl,
          cleanText(
            $(node).attr(
              "title"
            ) || ""
          )
        );
      }
    }
  );

  for (
    const item of jsonLd
  ) {
    for (
      const object of
        flattenJsonLd(item)
    ) {
      if (
        videos.length >=
        MAX_VIDEOS
      ) {
        break;
      }

      const type =
        object["@type"];

      const types =
        Array.isArray(type)
          ? type
          : [type];

      if (
        types.some(
          (x) =>
            String(x)
              .toLowerCase() ===
            "videoobject"
        )
      ) {
        addVideo(
          videos,
          object.contentUrl ||
            object.embedUrl ||
            object.url,
          pageUrl,
          object.name || "",
          object.description ||
            "",
          object.thumbnailUrl ||
            object.thumbnail
        );
      }
    }
  }

  const unique =
    new Map();

  for (
    const row of videos
  ) {
    unique.set(
      row.video_url,
      row
    );
  }

  return [
    ...unique.values(),
  ].slice(
    0,
    MAX_VIDEOS
  );
}

/* =====================================================
   PLACES
===================================================== */

function extractPlaces(
  $,
  pageUrl,
  jsonLd
) {
  const places = [];

  const supported =
    new Set([
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

  for (
    const item of jsonLd
  ) {
    for (
      const object of
        flattenJsonLd(item)
    ) {
      if (
        places.length >=
        MAX_PLACES
      ) {
        break;
      }

      const type =
        object["@type"];

      const types =
        Array.isArray(type)
          ? type
          : [type];

      if (
        !types.some((x) =>
          supported.has(
            String(x)
          )
        )
      ) {
        continue;
      }

      const address =
        object.address || {};

      const geo =
        object.geo || {};

      places.push({
        page_url: pageUrl,

        name:
          cleanText(
            object.name || ""
          ) || null,

        address:
          typeof address ===
          "string"
            ? cleanText(
                address
              )
            : cleanText(
                [
                  address.streetAddress,
                  address.postalCode,
                ]
                  .filter(Boolean)
                  .join(", ")
              ) || null,

        city:
          cleanText(
            address.addressLocality ||
              ""
          ) || null,

        district:
          cleanText(
            address.addressRegion ||
              ""
          ) || null,

        state:
          cleanText(
            address.addressRegion ||
              ""
          ) || null,

        country:
          typeof address.addressCountry ===
          "string"
            ? cleanText(
                address.addressCountry
              )
            : null,

        latitude:
          geo.latitude != null
            ? Number(
                geo.latitude
              )
            : null,

        longitude:
          geo.longitude != null
            ? Number(
                geo.longitude
              )
            : null,

        source_domain:
          domainOf(pageUrl),
      });
    }
  }

  const unique =
    new Map();

  for (
    const row of places
  ) {
    const key =
      [
        row.name || "",
        row.latitude || "",
        row.longitude || "",
      ].join("|");

    unique.set(
      key,
      row
    );
  }

  return [
    ...unique.values(),
  ].slice(
    0,
    MAX_PLACES
  );
}

/* =====================================================
   CONTENT EXTRACTION
===================================================== */

function extractContent($) {
  const clone =
    $.root().clone();

  clone
    .find(
      "script,style,noscript,template,svg,canvas,iframe,nav,footer,header,form"
    )
    .remove();

  const preferred = [];

  clone
    .find(
      "article,main,[role='main']"
    )
    .each(
      (_, node) => {
        const text =
          cleanText(
            $(node).text()
          );

        if (
          text.length > 200
        ) {
          preferred.push(
            text
          );
        }
      }
    );

  if (
    preferred.length
  ) {
    return truncate(
      preferred.sort(
        (a, b) =>
          b.length -
          a.length
      )[0],
      MAX_CONTENT
    );
  }

  return truncate(
    cleanText(
      clone.text()
    ),
    MAX_CONTENT
  );
}

/* =====================================================
   LINK EXTRACTION
===================================================== */

function extractLinks(
  $,
  pageUrl
) {
  const links = [];
  const seen =
    new Set();

  $("a[href]").each(
    (_, node) => {
      if (
        links.length >=
        MAX_LINKS
      ) {
        return false;
      }

      const raw =
        $(node).attr(
          "href"
        );

      const absolute =
        absoluteUrl(
          raw,
          pageUrl
        );

      const url =
        normalizeUrl(
          absolute
        );

      if (!url) {
        return;
      }

      /*
       * Important:
       * search-engine URLs are filtered
       * before entering the queue.
       */
      if (
        !isHtmlUrl(url)
      ) {
        return;
      }

      if (
        seen.has(url)
      ) {
        return;
      }

      seen.add(url);

      links.push(url);
    }
  );

  return links;
}

/* =====================================================
   PAGE PARSER
===================================================== */

function parsePage(
  html,
  pageUrl
) {
  const $ =
    cheerio.load(html);

  const jsonLd =
    collectJsonLd($);

  const title =
    cleanText(
      $(
        'meta[property="og:title"]'
      ).attr("content") ||
        $("title")
          .first()
          .text()
    ) || null;

  const description =
    cleanText(
      $(
        'meta[name="description"]'
      ).attr("content") ||
        $(
          'meta[property="og:description"]'
        ).attr("content")
    ) || null;

  const author =
    parseAuthor($);

  const publishedAt =
    parseDate($);

  const content =
    extractContent($);

  const language =
    detectLanguage(
      content,
      html
    );

  const images =
    extractImages(
      $,
      pageUrl,
      jsonLd
    );

  const videos =
    extractVideos(
      $,
      pageUrl,
      jsonLd
    );

  const places =
    extractPlaces(
      $,
      pageUrl,
      jsonLd
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
    published_at:
      publishedAt,
    language,
    content,
    images,
    videos,
    places,
    links,
  };
}

/* =====================================================
   QUEUE URLS
===================================================== */

async function queueUrls(
  supabase,
  urls,
  discoveredFrom
) {
  if (
    !urls?.length
  ) {
    return 0;
  }

  const rows = [];

  for (
    const raw of urls
  ) {
    const url =
      normalizeUrl(raw);

    if (!url) {
      continue;
    }

    if (
      !isHtmlUrl(url)
    ) {
      continue;
    }

    rows.push({
      url,
      status: "pending",
      priority: 100,
      discovered_from:
        discoveredFrom ||
        null,
      updated_at:
        new Date().toISOString(),
    });
  }

  if (!rows.length) {
    return 0;
  }

  const { error } =
    await supabase
      .from("crawl_queue")
      .upsert(
        rows,
        {
          onConflict:
            "url",
          ignoreDuplicates:
            true,
        }
      );

  if (error) {
    throw error;
  }

  return rows.length;
}

/* =====================================================
   SAVE PAGE
===================================================== */

async function savePage(
  supabase,
  pageUrl,
  data
) {
  const row = {
    url: pageUrl,
    title: data.title,
    description:
      data.description,
    content:
      data.content,
    language:
      data.language,
    author:
      data.author,
    published_at:
      data.published_at,
    image_url:
      data.images?.[0]
        ?.image_url ||
      null,
    updated_at:
      new Date().toISOString(),
  };

  const { error } =
    await supabase
      .from("pages")
      .upsert(
        row,
        {
          onConflict:
            "url",
        }
      );

  if (error) {
    throw error;
  }
}

/* =====================================================
   SAVE IMAGES
===================================================== */

async function saveImages(
  supabase,
  images
) {
  if (
    !images?.length
  ) {
    return;
  }

  const { error } =
    await supabase
      .from("images")
      .upsert(
        images,
        {
          onConflict:
            "page_url,image_url",
          ignoreDuplicates:
            false,
        }
      );

  if (error) {
    throw error;
  }
}

/* =====================================================
   SAVE VIDEOS
===================================================== */

async function saveVideos(
  supabase,
  videos
) {
  if (
    !videos?.length
  ) {
    return;
  }

  const { error } =
    await supabase
      .from("videos")
      .upsert(
        videos,
        {
          onConflict:
            "page_url,video_url",
          ignoreDuplicates:
            false,
        }
      );

  if (error) {
    throw error;
  }
}

/* =====================================================
   SAVE PLACES
===================================================== */

async function savePlaces(
  supabase,
  places
) {
  if (
    !places?.length
  ) {
    return;
  }

  const { error } =
    await supabase
      .from("places")
      .upsert(
        places,
        {
          onConflict:
            "page_url,name,latitude,longitude",
          ignoreDuplicates:
            false,
        }
      );

  if (error) {
    throw error;
  }
}

/* =====================================================
   QUEUE STATE
===================================================== */

async function markQueueDone(
  supabase,
  row
) {
  const { error } =
    await supabase
      .from("crawl_queue")
      .update({
        status: "done",
        last_crawled_at:
          new Date().toISOString(),
        next_crawl_at:
          new Date().toISOString(),
        last_error: null,
        updated_at:
          new Date().toISOString(),
      })
      .eq(
        "url",
        row.url
      );

  if (error) {
    throw error;
  }
}

async function markQueueFailed(
  supabase,
  row,
  error
) {
  const attempts =
    Number(
      row.attempts || 0
    ) + 1;

  const statusCode =
    Number(
      error?.status || 0
    );

  const permanent =
    Boolean(
      error?.permanent
    ) ||
    PERMANENT_HTTP_ERRORS.has(
      statusCode
    ) ||
    statusCode === 415;

  /*
   * Permanent:
   * 400 / 401 / 403 / 404 / 410 / 451
   * are not retried.
   */
  if (
    permanent ||
    attempts >=
      RETRY_LIMIT
  ) {
    const {
      error: updateError,
    } =
      await supabase
        .from("crawl_queue")
        .update({
          status: "failed",
          attempts,
          last_error:
            truncate(
              error?.message ||
                String(error),
              1000
            ),
          updated_at:
            new Date().toISOString(),
        })
        .eq(
          "url",
          row.url
        );

    if (updateError) {
      throw updateError;
    }

    return;
  }

  /*
   * Temporary:
   * 429 / 5xx / timeout etc.
   *
   * Retry:
   * 1m -> 2m -> 4m -> 8m -> 16m
   * max 24h.
   */
  const delay =
    Math.min(
      24 * 60 * 60 * 1000,
      Math.max(
        60 * 1000,
        60 *
          1000 *
          Math.pow(
            2,
            attempts - 1
          )
      )
    );

  const next =
    new Date(
      Date.now() + delay
    ).toISOString();

  const {
    error: updateError,
  } =
    await supabase
      .from("crawl_queue")
      .update({
        status: "pending",
        attempts,
        next_crawl_at:
          next,
        last_error:
          truncate(
            error?.message ||
              String(error),
            1000
          ),
        updated_at:
          new Date().toISOString(),
      })
      .eq(
        "url",
        row.url
      );

  if (updateError) {
    throw updateError;
  }
}

/* =====================================================
   FAIR DOMAIN SELECTION
===================================================== */

function selectFairBatch(
  rows,
  batchSize
) {
  const selected = [];

  const domainCounts =
    new Map();

  /*
   * Pass 1:
   * one URL per domain.
   */
  for (
    const row of rows
  ) {
    if (
      selected.length >=
      batchSize
    ) {
      break;
    }

    const domain =
      domainOf(row.url);

    if (!domain) {
      continue;
    }

    if (
      domainCounts.has(
        domain
      )
    ) {
      continue;
    }

    selected.push(row);

    domainCounts.set(
      domain,
      1
    );
  }

  /*
   * Pass 2:
   * maximum two URLs per domain.
   */
  if (
    selected.length <
    batchSize
  ) {
    for (
      const row of rows
    ) {
      if (
        selected.length >=
        batchSize
      ) {
        break;
      }

      if (
        selected.some(
          (item) =>
            item.url ===
            row.url
        )
      ) {
        continue;
      }

      const domain =
        domainOf(row.url);

      if (!domain) {
        continue;
      }

      const count =
        domainCounts.get(
          domain
        ) || 0;

      if (
        count >=
        MAX_DOMAIN_PER_BATCH
      ) {
        continue;
      }

      selected.push(row);

      domainCounts.set(
        domain,
        count + 1
      );
    }
  }

  /*
   * Final fallback if the queue has
   * only a small number of domains.
   */
  if (
    selected.length <
    batchSize
  ) {
    for (
      const row of rows
    ) {
      if (
        selected.length >=
        batchSize
      ) {
        break;
      }

      if (
        selected.some(
          (item) =>
            item.url ===
            row.url
        )
      ) {
        continue;
      }

      selected.push(row);
    }
  }

  return selected;
}

/* =====================================================
   CLAIM QUEUE
===================================================== */

async function claimQueue(
  supabase,
  batchSize
) {
  const now =
    new Date().toISOString();

  const limit =
    Math.max(
      batchSize * 10,
      CANDIDATE_LIMIT
    );

  const { data, error } =
    await supabase
      .from("crawl_queue")
      .select("*")
      .eq(
        "status",
        "pending"
      )
      .or(
        `next_crawl_at.is.null,next_crawl_at.lte.${now}`
      )
      .order(
        "priority",
        {
          ascending: false,
        }
      )
      .order(
        "created_at",
        {
          ascending: true,
        }
      )
      .limit(limit);

  if (error) {
    throw error;
  }

  if (
    !data?.length
  ) {
    return [];
  }

  const selected =
    selectFairBatch(
      data,
      batchSize
    );

  if (
    !selected.length
  ) {
    return [];
  }

  const urls =
    selected.map(
      (row) =>
        row.url
    );

  const {
    error: updateError,
  } =
    await supabase
      .from("crawl_queue")
      .update({
        status:
          "processing",
        updated_at:
          new Date().toISOString(),
      })
      .in(
        "url",
        urls
      );

  if (updateError) {
    throw updateError;
  }

  return selected;
}

/* =====================================================
   CRAWL ONE
===================================================== */

export async function crawlOne(
  supabase,
  row
) {
  const originalUrl =
    normalizeUrl(
      row.url
    );

  if (!originalUrl) {
    const error =
      new Error(
        "Invalid URL"
      );

    error.permanent =
      true;

    await markQueueFailed(
      supabase,
      row,
      error
    );

    return false;
  }

  /*
   * Do not crawl search-engine result URLs
   * even if an old queue row already exists.
   */
  if (
    !isHtmlUrl(
      originalUrl
    )
  ) {
    const error =
      new Error(
        "Skipped blocked/search/non-HTML URL"
      );

    error.permanent =
      true;

    await markQueueFailed(
      supabase,
      row,
      error
    );

    console.log(
      `Skipped URL: ${originalUrl}`
    );

    return false;
  }

  try {
    const allowed =
      await canCrawl(
        originalUrl
      );

    if (!allowed) {
      const error =
        new Error(
          "Blocked by robots.txt or robots.txt unavailable"
        );

      error.permanent =
        true;

      await markQueueFailed(
        supabase,
        row,
        error
      );

      console.log(
        `Skipped robots: ${originalUrl}`
      );

      return false;
    }

    const fetched =
      await fetchHtml(
        originalUrl
      );

    const finalUrl =
      normalizeUrl(
        fetched.finalUrl ||
          originalUrl
      ) ||
      originalUrl;

    /*
     * Redirect may lead to a blocked
     * search-engine URL.
     */
    if (
      !isHtmlUrl(
        finalUrl
      )
    ) {
      const error =
        new Error(
          "Redirected to blocked/search/non-HTML URL"
        );

      error.permanent =
        true;

      await markQueueFailed(
        supabase,
        row,
        error
      );

      return false;
    }

    const parsed =
      parsePage(
        fetched.html,
        finalUrl
      );

    /*
     * Tiny empty pages are generally
     * login/error/placeholder pages.
     */
    if (
      !parsed.title &&
      parsed.content.length <
        MIN_CONTENT_LENGTH
    ) {
      const error =
        new Error(
          "Page contains insufficient searchable content"
        );

      error.permanent =
        true;

      await markQueueFailed(
        supabase,
        row,
        error
      );

      return false;
    }

    await savePage(
      supabase,
      finalUrl,
      parsed
    );

    await saveImages(
      supabase,
      parsed.images
    );

    await saveVideos(
      supabase,
      parsed.videos
    );

    await savePlaces(
      supabase,
      parsed.places
    );

    /*
     * Only valid, crawlable HTML links
     * enter the next frontier.
     */
    await queueUrls(
      supabase,
      parsed.links,
      finalUrl
    );

    await markQueueDone(
      supabase,
      row
    );

    console.log(
      `Crawled: ${finalUrl} | ` +
      `images: ${parsed.images.length} | ` +
      `videos: ${parsed.videos.length} | ` +
      `places: ${parsed.places.length} | ` +
      `links: ${parsed.links.length}`
    );

    return true;
  } catch (error) {
    await markQueueFailed(
      supabase,
      row,
      error
    );

    console.error(
      `Crawl failed: ${originalUrl} |`,
      error?.message ||
        String(error)
    );

    return false;
  }
}

/* =====================================================
   CRAWL BATCH
===================================================== */

export async function crawlBatch(
  supabase,
  batchSize = 12
) {
  const requested =
    Math.max(
      1,
      Number(
        batchSize || 12
      )
    );

  const rows =
    await claimQueue(
      supabase,
      requested
    );

  let success = 0;
  let failed = 0;

  /*
   * Sequential crawling:
   * safer for websites and respects
   * per-domain delay.
   */
  for (
    const row of rows
  ) {
    const ok =
      await crawlOne(
        supabase,
        row
      );

    if (ok) {
      success++;
    } else {
      failed++;
    }
  }

  return {
    requested,
    claimed:
      rows.length,
    success,
    failed,
  };
}

/* =====================================================
   EXPORT
===================================================== */

export default {
  crawlOne,
  crawlBatch,
};
