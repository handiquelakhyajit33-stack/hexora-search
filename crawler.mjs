import * as cheerio from "cheerio";

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

const FETCH_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "*",
};

const domainLastCrawled = new Map();
const robotsCache = new Map();

/* ---------------------------------------------------------
   BASIC HELPERS
--------------------------------------------------------- */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\u00a0/g, " ")
    .trim();
}

function truncate(value, max) {
  const text = cleanText(value);
  if (text.length <= max) return text;
  return text.slice(0, max);
}

function getDomain(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function getOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

function normalizeUrl(rawUrl, baseUrl = null) {
  try {
    if (!rawUrl) return null;

    let value = String(rawUrl).trim();

    if (
      value.startsWith("#") ||
      value.startsWith("javascript:") ||
      value.startsWith("mailto:") ||
      value.startsWith("tel:") ||
      value.startsWith("data:")
    ) {
      return null;
    }

    const absolute = baseUrl
      ? new URL(value, baseUrl)
      : new URL(value);

    if (!["http:", "https:"].includes(absolute.protocol)) {
      return null;
    }

    absolute.hash = "";

    const trackingParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid",
      "dclid",
      "mc_cid",
      "mc_eid",
      "_ga",
    ];

    for (const param of trackingParams) {
      absolute.searchParams.delete(param);
    }

    // Remove trailing slash except for domain root.
    let result = absolute.toString();

    if (
      absolute.pathname !== "/" &&
      result.endsWith("/")
    ) {
      result = result.slice(0, -1);
    }

    return result;
  } catch {
    return null;
  }
}

function isProbablyHtmlUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();

    const blockedExtensions = [
      ".jpg",
      ".jpeg",
      ".png",
      ".gif",
      ".webp",
      ".svg",
      ".ico",
      ".mp4",
      ".webm",
      ".mov",
      ".avi",
      ".mp3",
      ".wav",
      ".pdf",
      ".zip",
      ".rar",
      ".7z",
      ".tar",
      ".gz",
      ".css",
      ".js",
      ".xml",
      ".json",
      ".woff",
      ".woff2",
      ".ttf",
      ".eot",
      ".exe",
      ".dmg",
      ".iso",
    ];

    return !blockedExtensions.some((ext) =>
      path.endsWith(ext)
    );
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------
   ROBOTS.TXT
--------------------------------------------------------- */

function parseRobots(text) {
  const groups = [];
  let current = null;

  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.split("#")[0].trim())
    .filter(Boolean);

  for (const line of lines) {
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
      current = {
        agents: [value.toLowerCase()],
        rules: [],
      };

      groups.push(current);
      continue;
    }

    if (
      current &&
      (key === "allow" || key === "disallow")
    ) {
      current.rules.push({
        type: key,
        path: value,
      });
    }
  }

  return groups;
}

function robotsRuleMatches(rulePath, targetPath) {
  if (!rulePath) return false;

  if (rulePath === "/") return true;

  if (rulePath.endsWith("$")) {
    return targetPath === rulePath.slice(0, -1);
  }

  return targetPath.startsWith(rulePath);
}

async function canCrawl(url) {
  try {
    const origin = getOrigin(url);

    if (!origin) return false;

    const now = Date.now();

    const cached = robotsCache.get(origin);

    let robots;

    if (
      cached &&
      now - cached.time < ROBOTS_CACHE_MS
    ) {
      robots = cached.groups;
    } else {
      const controller = new AbortController();

      const timeout = setTimeout(
        () => controller.abort(),
        10000
      );

      try {
        const response = await fetch(
          `${origin}/robots.txt`,
          {
            headers: {
              "User-Agent": USER_AGENT,
            },
            signal: controller.signal,
          }
        );

        clearTimeout(timeout);

        if (response.status === 404) {
          robots = [];
        } else if (response.ok) {
          robots = parseRobots(
            await response.text()
          );
        } else {
          // If robots cannot be fetched, be conservative.
          return false;
        }

        robotsCache.set(origin, {
          time: now,
          groups: robots,
        });
      } catch {
        clearTimeout(timeout);

        // Temporary robots failure:
        // do not crawl this URL now.
        return false;
      }
    }

    if (!robots.length) return true;

    const urlObject = new URL(url);
    const targetPath =
      `${urlObject.pathname}${urlObject.search}`;

    const matchingGroups = robots.filter((group) =>
      group.agents.some(
        (agent) =>
          agent === "*" ||
          agent === "hexora-bot" ||
          agent === "hexora"
      )
    );

    if (!matchingGroups.length) return true;

    let matchedRule = null;

    for (const group of matchingGroups) {
      for (const rule of group.rules) {
        if (
          robotsRuleMatches(
            rule.path,
            targetPath
          )
        ) {
          if (
            !matchedRule ||
            rule.path.length >
              matchedRule.path.length
          ) {
            matchedRule = rule;
          }
        }
      }
    }

    if (!matchedRule) return true;

    return matchedRule.type === "allow";
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------
   DOMAIN FAIRNESS
--------------------------------------------------------- */

/*
  IMPORTANT:
  There is NO Assam/India priority here.

  Every domain starts from the same neutral priority.

  Fairness is achieved by:
  - one/few URLs per domain per batch
  - queue candidate sampling
  - retry penalties
  - freshness
  - avoiding giant-domain starvation
*/

function calculatePriority(url, row = {}) {
  let priority = 100;

  const attempts = Number(row.attempts || 0);

  // Freshly discovered pages get a small boost.
  if (!row.last_crawled_at) {
    priority += 15;
  }

  // Failed URLs slowly lose priority.
  priority -= attempts * 10;

  // Keep everything inside a sane range.
  return Math.max(1, Math.min(500, priority));
}

function selectFairBatch(rows, batchSize) {
  const selected = [];
  const domainCounts = new Map();

  // First pass:
  // Prefer different domains.
  for (const row of rows) {
    if (selected.length >= batchSize) break;

    const domain = getDomain(row.url);

    if (!domain) continue;

    const count =
      domainCounts.get(domain) || 0;

    if (count >= 1) continue;

    selected.push(row);
    domainCounts.set(domain, 1);
  }

  // Second pass:
  // If there are not enough different domains,
  // allow a second URL from domains.
  if (selected.length < batchSize) {
    for (const row of rows) {
      if (selected.length >= batchSize) break;

      if (
        selected.some(
          (item) => item.id === row.id
        )
      ) {
        continue;
      }

      const domain = getDomain(row.url);

      if (!domain) continue;

      const count =
        domainCounts.get(domain) || 0;

      if (count >= 2) continue;

      selected.push(row);
      domainCounts.set(
        domain,
        count + 1
      );
    }
  }

  // Final fallback.
  if (selected.length < batchSize) {
    for (const row of rows) {
      if (selected.length >= batchSize) break;

      if (
        selected.some(
          (item) => item.id === row.id
        )
      ) {
        continue;
      }

      selected.push(row);
    }
  }

  return selected;
}

/* ---------------------------------------------------------
   QUEUE
--------------------------------------------------------- */

async function queueUrls(
  supabase,
  urls,
  discoveredFrom = null
) {
  const rows = [];

  const unique = new Set();

  for (const raw of urls) {
    const normalized =
      normalizeUrl(
        raw,
        discoveredFrom
      );

    if (!normalized) continue;

    if (!isProbablyHtmlUrl(normalized)) {
      continue;
    }

    if (unique.has(normalized)) continue;

    unique.add(normalized);

    rows.push({
      url: normalized,
      status: "pending",
      priority: 100,
      attempts: 0,
      discovered_from:
        discoveredFrom || null,
      next_crawl_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  if (!rows.length) return 0;

  // Insert only new URLs.
  // Existing URLs are never deleted.
  const { error } = await supabase
    .from("crawl_queue")
    .upsert(rows, {
      onConflict: "url",
      ignoreDuplicates: true,
    });

  if (error) {
    throw error;
  }

  return rows.length;
}

async function claimQueue(
  supabase,
  batchSize
) {
  const now = new Date().toISOString();

  /*
    Get a reasonably large candidate pool.
    We then apply domain fairness locally.
  */
  const { data, error } = await supabase
    .from("crawl_queue")
    .select(
      "id,url,status,priority,attempts,created_at,next_crawl_at,discovered_from"
    )
    .eq("status", "pending")
    .or(
      `next_crawl_at.is.null,next_crawl_at.lte.${now}`
    )
    .order("priority", {
      ascending: false,
    })
    .order("created_at", {
      ascending: true,
    })
    .limit(
      Math.max(
        CANDIDATE_LIMIT,
        batchSize * 10
      )
    );

  if (error) throw error;

  if (!data || !data.length) {
    return [];
  }

  const selected = selectFairBatch(
    data,
    batchSize
  );

  const claimed = [];

  for (const row of selected) {
    const { data: updated, error: updateError } =
      await supabase
        .from("crawl_queue")
        .update({
          status: "processing",
          updated_at:
            new Date().toISOString(),
        })
        .eq("id", row.id)
        .eq("status", "pending")
        .select(
          "id,url,status,priority,attempts,created_at,next_crawl_at,discovered_from"
        )
        .maybeSingle();

    if (updateError) {
      console.error(
        "Queue claim failed:",
        row.url,
        updateError
      );
      continue;
    }

    if (updated) {
      claimed.push(updated);
    }
  }

  return claimed;
}

/* ---------------------------------------------------------
   FETCH
--------------------------------------------------------- */

async function fetchHtml(url) {
  const domain = getDomain(url);

  const previous =
    domainLastCrawled.get(domain) || 0;

  const elapsed =
    Date.now() - previous;

  if (elapsed < DOMAIN_DELAY) {
    await sleep(
      DOMAIN_DELAY - elapsed
    );
  }

  domainLastCrawled.set(
    domain,
    Date.now()
  );

  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT
  );

  try {
    const response = await fetch(url, {
      headers: FETCH_HEADERS,
      redirect: "follow",
      signal: controller.signal,
    });

    const finalUrl =
      response.url || url;

    const contentType =
      response.headers.get(
        "content-type"
      ) || "";

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    if (
      !contentType.includes("text/html") &&
      !contentType.includes(
        "application/xhtml+xml"
      )
    ) {
      throw new Error(
        `Not HTML: ${contentType}`
      );
    }

    const html = await response.text();

    return {
      html,
      finalUrl,
      contentType,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/* ---------------------------------------------------------
   LANGUAGE
--------------------------------------------------------- */

function detectLanguage($, html) {
  const htmlLang = cleanText(
    $("html").attr("lang")
  );

  if (htmlLang) {
    return htmlLang
      .toLowerCase()
      .split("-")[0];
  }

  const metaLang = cleanText(
    $('meta[http-equiv="content-language"]').attr(
      "content"
    )
  );

  if (metaLang) {
    return metaLang
      .toLowerCase()
      .split("-")[0];
  }

  const text = cleanText(
    $("body").text()
  ).slice(0, 5000);

  // Basic Assamese detection.
  if (/[\u0980-\u09FF]/.test(text)) {
    return "as";
  }

  // Devanagari.
  if (/[\u0900-\u097F]/.test(text)) {
    return "hi";
  }

  // Bengali.
  if (/[\u0980-\u09FF]/.test(text)) {
    return "bn";
  }

  return "unknown";
}

/* ---------------------------------------------------------
   DATE
--------------------------------------------------------- */

function extractPublishedDate($) {
  const selectors = [
    'meta[property="article:published_time"]',
    'meta[name="article:published_time"]',
    'meta[name="date"]',
    'meta[name="publish-date"]',
    'meta[itemprop="datePublished"]',
    "time[datetime]",
  ];

  for (const selector of selectors) {
    const element = $(selector).first();

    if (!element.length) continue;

    const value =
      element.attr("content") ||
      element.attr("datetime") ||
      element.text();

    if (!value) continue;

    const date = new Date(value);

    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  return null;
}

/* ---------------------------------------------------------
   AUTHOR
--------------------------------------------------------- */

function extractAuthor($) {
  const selectors = [
    'meta[name="author"]',
    'meta[property="article:author"]',
    '[rel="author"]',
    '[itemprop="author"]',
  ];

  for (const selector of selectors) {
    const element = $(selector).first();

    if (!element.length) continue;

    const value =
      element.attr("content") ||
      element.attr("name") ||
      element.text();

    if (cleanText(value)) {
      return truncate(value, 500);
    }
  }

  return null;
}

/* ---------------------------------------------------------
   DESCRIPTION
--------------------------------------------------------- */

function extractDescription($) {
  const selectors = [
    'meta[name="description"]',
    'meta[property="og:description"]',
    'meta[name="twitter:description"]',
  ];

  for (const selector of selectors) {
    const value = $(selector)
      .first()
      .attr("content");

    if (cleanText(value)) {
      return truncate(value, 2000);
    }
  }

  return null;
}

/* ---------------------------------------------------------
   MAIN CONTENT
--------------------------------------------------------- */

function extractContent($) {
  const clone = $("body").clone();

  clone.find(
    "script,style,noscript,template,svg,canvas,iframe,form,nav,footer,header"
  ).remove();

  const preferred = clone
    .find(
      "article,main,[role='main'],.article,.post,.entry-content"
    )
    .first();

  let text;

  if (preferred.length) {
    text = preferred.text();
  } else {
    text = clone.text();
  }

  return truncate(
    text,
    MAX_CONTENT
  );
}

/* ---------------------------------------------------------
   JSON-LD
--------------------------------------------------------- */

function extractJsonLd($) {
  const objects = [];

  $('script[type="application/ld+json"]').each(
    (_, element) => {
      const raw = $(element).html();

      if (!raw) return;

      try {
        const parsed = JSON.parse(raw);

        if (Array.isArray(parsed)) {
          objects.push(...parsed);
        } else {
          objects.push(parsed);
        }
      } catch {
        // Ignore malformed JSON-LD.
      }
    }
  );

  return objects;
}

function flattenJsonLd(value) {
  const output = [];

  function visit(item) {
    if (!item) return;

    if (Array.isArray(item)) {
      for (const child of item) {
        visit(child);
      }
      return;
    }

    if (
      typeof item === "object"
    ) {
      output.push(item);

      if (Array.isArray(item["@graph"])) {
        visit(item["@graph"]);
      }
    }
  }

  visit(value);

  return output;
}

/* ---------------------------------------------------------
   IMAGES
--------------------------------------------------------- */

function extractImages(
  $,
  pageUrl,
  jsonLd
) {
  const results = [];
  const seen = new Set();

  function addImage(
    rawUrl,
    alt = null,
    title = null
  ) {
    const imageUrl =
      normalizeUrl(
        rawUrl,
        pageUrl
      );

    if (!imageUrl) return;

    if (seen.has(imageUrl)) return;

    seen.add(imageUrl);

    results.push({
      page_url: pageUrl,
      image_url: imageUrl,
      alt_text:
        cleanText(alt) || null,
      title:
        cleanText(title) || null,
      source_domain:
        getDomain(pageUrl),
      updated_at:
        new Date().toISOString(),
    });
  }

  addImage(
    $('meta[property="og:image"]').attr(
      "content"
    ),
    $('meta[property="og:image:alt"]').attr(
      "content"
    ),
    $("title").first().text()
  );

  addImage(
    $('meta[name="twitter:image"]').attr(
      "content"
    ),
    $('meta[name="twitter:image:alt"]').attr(
      "content"
    ),
    $("title").first().text()
  );

  $("img").each((_, img) => {
    if (results.length >= MAX_IMAGES) {
      return false;
    }

    const $img = $(img);

    const raw =
      $img.attr("src") ||
      $img.attr("data-src") ||
      $img.attr("data-lazy-src") ||
      $img.attr("data-original");

    const srcset =
      $img.attr("srcset") ||
      $img.attr("data-srcset");

    let selected = raw;

    if (!selected && srcset) {
      const first =
        srcset
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)[0];

      if (first) {
        selected =
          first.split(/\s+/)[0];
      }
    }

    addImage(
      selected,
      $img.attr("alt"),
      $img.attr("title")
    );
  });

  for (const item of flattenJsonLd(jsonLd)) {
    if (results.length >= MAX_IMAGES) break;

    const image = item.image;

    if (typeof image === "string") {
      addImage(
        image,
        item.caption,
        item.name
      );
    } else if (
      Array.isArray(image)
    ) {
      for (const img of image) {
        if (results.length >= MAX_IMAGES) break;

        if (typeof img === "string") {
          addImage(
            img,
            item.caption,
            item.name
          );
        } else if (
          img &&
          typeof img === "object"
        ) {
          addImage(
            img.url ||
              img.contentUrl,
            img.caption,
            img.name || item.name
          );
        }
      }
    } else if (
      image &&
      typeof image === "object"
    ) {
      addImage(
        image.url ||
          image.contentUrl,
        image.caption,
        image.name || item.name
      );
    }
  }

  return results;
}

/* ---------------------------------------------------------
   VIDEOS
--------------------------------------------------------- */

function extractVideos(
  $,
  pageUrl,
  jsonLd
) {
  const results = [];
  const seen = new Set();

  function addVideo(
    rawUrl,
    title = null,
    description = null,
    thumbnail = null
  ) {
    const videoUrl =
      normalizeUrl(
        rawUrl,
        pageUrl
      );

    if (!videoUrl) return;

    if (seen.has(videoUrl)) return;

    seen.add(videoUrl);

    results.push({
      page_url: pageUrl,
      video_url: videoUrl,
      title:
        cleanText(title) || null,
      description:
        cleanText(description) || null,
      source_domain:
        getDomain(pageUrl),
      thumbnail_url:
        normalizeUrl(
          thumbnail,
          pageUrl
        ),
      updated_at:
        new Date().toISOString(),
    });
  }

  $("video").each((_, video) => {
    if (results.length >= MAX_VIDEOS) {
      return false;
    }

    const $video = $(video);

    addVideo(
      $video.attr("src"),
      $video.attr("title") ||
        $("title").first().text(),
      null,
      $video.attr("poster")
    );

    $video.find("source").each(
      (_, source) => {
        if (results.length >= MAX_VIDEOS) {
          return false;
        }

        addVideo(
          $(source).attr("src"),
          $video.attr("title"),
          null,
          $video.attr("poster")
        );
      }
    );
  });

  $("iframe").each((_, iframe) => {
    if (results.length >= MAX_VIDEOS) {
      return false;
    }

    const src = $(iframe).attr("src");

    if (!src) return;

    if (
      /youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com/i.test(
        src
      )
    ) {
      addVideo(
        src,
        $("title").first().text()
      );
    }
  });

  for (const item of flattenJsonLd(jsonLd)) {
    if (results.length >= MAX_VIDEOS) break;

    const type = String(
      item["@type"] || ""
    ).toLowerCase();

    if (
      type.includes("videoobject")
    ) {
      addVideo(
        item.contentUrl ||
          item.embedUrl ||
          item.url,
        item.name,
        item.description,
        item.thumbnailUrl
      );
    }
  }

  return results;
}

/* ---------------------------------------------------------
   PLACES
--------------------------------------------------------- */

function extractPlaces(
  pageUrl,
  jsonLd
) {
  const results = [];
  const seen = new Set();

  const placeTypes = new Set([
    "place",
    "localbusiness",
    "restaurant",
    "hotel",
    "store",
    "organization",
    "airport",
    "hospital",
    "school",
    "university",
    "touristattraction",
    "museum",
    "park",
    "landmarksorhistoricalbuildings",
  ]);

  for (const item of flattenJsonLd(jsonLd)) {
    const types = Array.isArray(
      item["@type"]
    )
      ? item["@type"]
      : [item["@type"]];

    const isPlace = types.some(
      (type) =>
        placeTypes.has(
          String(type || "").toLowerCase()
        )
    );

    if (!isPlace) continue;

    const name =
      cleanText(item.name) || null;

    const address =
      item.address;

    let street = null;
    let city = null;
    let district = null;
    let state = null;
    let country = null;

    if (
      typeof address === "string"
    ) {
      street = cleanText(address);
    } else if (
      address &&
      typeof address === "object"
    ) {
      street =
        cleanText(
          address.streetAddress
        ) || null;

      city =
        cleanText(
          address.addressLocality
        ) || null;

      state =
        cleanText(
          address.addressRegion
        ) || null;

      country =
        cleanText(
          typeof address.addressCountry ===
            "object"
            ? address.addressCountry.name
            : address.addressCountry
        ) || null;
    }

    const geo =
      item.geo || {};

    const latitude =
      Number(
        geo.latitude ??
          geo.lat
      );

    const longitude =
      Number(
        geo.longitude ??
          geo.lng
      );

    const validLatitude =
      Number.isFinite(latitude)
        ? latitude
        : null;

    const validLongitude =
      Number.isFinite(longitude)
        ? longitude
        : null;

    const key = [
      pageUrl,
      name,
      validLatitude,
      validLongitude,
    ].join("|");

    if (seen.has(key)) continue;

    seen.add(key);

    results.push({
      page_url: pageUrl,
      name,
      address: street,
      city,
      district,
      state,
      country,
      latitude: validLatitude,
      longitude: validLongitude,
      source_domain:
        getDomain(pageUrl),
      updated_at:
        new Date().toISOString(),
    });

    if (results.length >= MAX_PLACES) {
      break;
    }
  }

  return results;
}

/* ---------------------------------------------------------
   LINK EXTRACTION
--------------------------------------------------------- */

function extractLinks(
  $,
  pageUrl
) {
  const links = [];
  const seen = new Set();

  $("a[href]").each((_, element) => {
    if (links.length >= MAX_LINKS) {
      return false;
    }

    const href =
      $(element).attr("href");

    const normalized =
      normalizeUrl(
        href,
        pageUrl
      );

    if (!normalized) return;

    if (
      !isProbablyHtmlUrl(
        normalized
      )
    ) {
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

/* ---------------------------------------------------------
   PAGE SAVE
--------------------------------------------------------- */

async function savePage(
  supabase,
  page
) {
  const payload = {
    url: page.url,
    title: page.title,
    description: page.description,
    content: page.content,
    author: page.author,
    image_url: page.image_url,
    published_at: page.published_at,
    language: page.language,
    updated_at:
      new Date().toISOString(),
  };

  const { error } = await supabase
    .from("pages")
    .upsert(payload, {
      onConflict: "url",
    });

  if (error) {
    throw error;
  }
}

/* ---------------------------------------------------------
   MEDIA SAVE
--------------------------------------------------------- */

async function saveImages(
  supabase,
  images
) {
  if (!images.length) return;

  const { error } = await supabase
    .from("images")
    .upsert(images, {
      onConflict:
        "page_url,image_url",
      ignoreDuplicates: true,
    });

  if (error) {
    throw error;
  }
}

async function saveVideos(
  supabase,
  videos
) {
  if (!videos.length) return;

  const { error } = await supabase
    .from("videos")
    .upsert(videos, {
      onConflict:
        "page_url,video_url",
      ignoreDuplicates: true,
    });

  if (error) {
    throw error;
  }
}

async function savePlaces(
  supabase,
  places
) {
  if (!places.length) return;

  const { error } = await supabase
    .from("places")
    .upsert(places, {
      onConflict:
        "page_url,name,latitude,longitude",
      ignoreDuplicates: true,
    });

  if (error) {
    throw error;
  }
}

/* ---------------------------------------------------------
   QUEUE SUCCESS
--------------------------------------------------------- */

async function markQueueDone(
  supabase,
  row,
  finalUrl
) {
  const now =
    new Date().toISOString();

  const { error } = await supabase
    .from("crawl_queue")
    .update({
      status: "done",
      attempts: Number(
        row.attempts || 0
      ),
      last_error: null,
      last_crawled_at: now,
      next_crawl_at: now,
      updated_at: now,
    })
    .eq("id", row.id);

  if (error) {
    throw error;
  }

  // If the server redirected the URL,
  // make sure the final URL can also be crawled.
  if (
    finalUrl &&
    finalUrl !== row.url
  ) {
    const normalized =
      normalizeUrl(finalUrl);

    if (normalized) {
      await queueUrls(
        supabase,
        [normalized],
        row.url
      );
    }
  }
}

/* ---------------------------------------------------------
   QUEUE FAILURE
--------------------------------------------------------- */

async function markQueueFailed(
  supabase,
  row,
  error
) {
  const attempts =
    Number(row.attempts || 0) + 1;

  const message = truncate(
    error?.message ||
      String(error),
    1000
  );

  const permanent =
    attempts >= RETRY_LIMIT;

  const backoffMinutes =
    Math.min(
      24 * 60,
      Math.pow(2, attempts) * 2
    );

  const nextCrawl = new Date(
    Date.now() +
      backoffMinutes * 60 * 1000
  ).toISOString();

  const { error: updateError } =
    await supabase
      .from("crawl_queue")
      .update({
        status: permanent
          ? "failed"
          : "pending",
        attempts,
        last_error: message,
        next_crawl_at:
          permanent
            ? null
            : nextCrawl,
        updated_at:
          new Date().toISOString(),
      })
      .eq("id", row.id);

  if (updateError) {
    throw updateError;
  }
}

/* ---------------------------------------------------------
   CRAWL ONE URL
--------------------------------------------------------- */

export async function crawlOne(
  supabase,
  row
) {
  const url = row.url;

  try {
    if (!isProbablyHtmlUrl(url)) {
      throw new Error(
        "Unsupported URL"
      );
    }

    const allowed =
      await canCrawl(url);

    if (!allowed) {
      throw new Error(
        "Blocked by robots.txt or robots.txt unavailable"
      );
    }

    const result =
      await fetchHtml(url);

    const finalUrl =
      normalizeUrl(
        result.finalUrl
      ) || url;

    const $ =
      cheerio.load(
        result.html
      );

    const jsonLd =
      extractJsonLd($);

    const title =
      truncate(
        cleanText(
          $("title").first().text()
        ),
        1000
      ) || null;

    const description =
      extractDescription($);

    const author =
      extractAuthor($);

    const publishedAt =
      extractPublishedDate($);

    const language =
      detectLanguage(
        $,
        result.html
      );

    const content =
      extractContent($);

    const images =
      extractImages(
        $,
        finalUrl,
        jsonLd
      );

    const videos =
      extractVideos(
        $,
        finalUrl,
        jsonLd
      );

    const places =
      extractPlaces(
        finalUrl,
        jsonLd
      );

    const links =
      extractLinks(
        $,
        finalUrl
      );

    const firstImage =
      images.length
        ? images[0].image_url
        : null;

    await savePage(
      supabase,
      {
        url: finalUrl,
        title,
        description,
        content,
        author,
        image_url: firstImage,
        published_at:
          publishedAt,
        language,
      }
    );

    await saveImages(
      supabase,
      images
    );

    await saveVideos(
      supabase,
      videos
    );

    await savePlaces(
      supabase,
      places
    );

    // Queue discovered global links.
    if (links.length) {
      await queueUrls(
        supabase,
        links,
        finalUrl
      );
    }

    await markQueueDone(
      supabase,
      row,
      finalUrl
    );

    console.log(
      `Crawled: ${finalUrl} | ` +
        `images: ${images.length} | ` +
        `videos: ${videos.length} | ` +
        `places: ${places.length} | ` +
        `links: ${links.length}`
    );

    return {
      ok: true,
      url: finalUrl,
      images: images.length,
      videos: videos.length,
      places: places.length,
      links: links.length,
    };
  } catch (error) {
    console.error(
      `Crawl failed: ${url}`,
      error
    );

    try {
      await markQueueFailed(
        supabase,
        row,
        error
      );
    } catch (queueError) {
      console.error(
        "Failed to update queue:",
        queueError
      );
    }

    return {
      ok: false,
      url,
      error:
        error?.message ||
        String(error),
    };
  }
}

/* ---------------------------------------------------------
   BATCH
--------------------------------------------------------- */

export async function crawlBatch(
  supabase,
  batchSize = 12
) {
  const requested =
    Math.max(
      1,
      Number(batchSize || 12)
    );

  const rows =
    await claimQueue(
      supabase,
      requested
    );

  if (!rows.length) {
    return {
      requested,
      claimed: 0,
      success: 0,
      failed: 0,
    };
  }

  let success = 0;
  let failed = 0;

  /*
    Sequential crawling keeps domain delays and
    robots handling predictable.
  */
  for (const row of rows) {
    const result =
      await crawlOne(
        supabase,
        row
      );

    if (result.ok) {
      success++;
    } else {
      failed++;
    }
  }

  return {
    requested,
    claimed: rows.length,
    success,
    failed,
  };
}

/* ---------------------------------------------------------
   SEED HELPER
--------------------------------------------------------- */

export async function seedUrls(
  supabase,
  urls
) {
  return queueUrls(
    supabase,
    urls
  );
}
