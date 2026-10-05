import crypto from "node:crypto";
import dns from "node:dns/promises";
import * as cheerio from "cheerio";
import pg from "pg";
import { putHtml } from "./storage.mjs";

const { Pool } = pg;

/* =========================================================
   HEXORA INDEPENDENT WEB CRAWLER
   No Google Search API
   No Google Search results
   No external search index
   HEXORA crawls -> stores -> indexes its own web data
   ========================================================= */

const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();

if (!DATABASE_URL) {
  throw new Error("[HEXORA] DATABASE_URL is missing");
}

/* ---------------- CONFIG ---------------- */

const USER_AGENT =
  process.env.HEXORA_USER_AGENT ||
  "HEXORA-Bot/1.0 (+https://www.hexsorasearch.com/)";

const REQUEST_TIMEOUT = Math.max(
  5000,
  Number(process.env.CRAWL_TIMEOUT_MS || 20000)
);

const MAX_CONTENT = Math.max(
  10000,
  Number(process.env.CRAWL_MAX_CONTENT || 150000)
);

const MAX_HTML_BYTES = Math.max(
  100000,
  Number(process.env.CRAWL_MAX_HTML_BYTES || 5000000)
);

const MAX_LINKS = Math.max(
  20,
  Number(process.env.CRAWL_MAX_LINKS || 200)
);

const MAX_IMAGES = Math.max(
  5,
  Number(process.env.CRAWL_MAX_IMAGES || 20)
);

const MAX_VIDEOS = Math.max(
  5,
  Number(process.env.CRAWL_MAX_VIDEOS || 10)
);

const DOMAIN_DELAY = Math.max(
  250,
  Number(process.env.CRAWL_DOMAIN_DELAY_MS || 1000)
);

const MAX_REDIRECTS = Math.max(
  0,
  Number(process.env.CRAWL_MAX_REDIRECTS || 5)
);

const MAX_RETRIES = Math.max(
  1,
  Number(process.env.CRAWL_MAX_RETRIES || 3)
);

const MAX_ATTEMPTS = Math.max(
  1,
  Number(process.env.CRAWL_MAX_ATTEMPTS || 4)
);

const IDLE_WAIT = Math.max(
  2000,
  Number(process.env.CRAWL_IDLE_WAIT_MS || 10000)
);

const WORKER_BATCH = Math.max(
  1,
  Number(process.env.CRAWL_BATCH_SIZE || 5)
);

/* ---------------- DATABASE ---------------- */

const pool = new Pool({
  connectionString: DATABASE_URL,

  max: Math.max(
    2,
    Number(process.env.CRAWL_DB_POOL_MAX || 8)
  ),

  connectionTimeoutMillis: 15000,

  idleTimeoutMillis: 30000,

  ssl: /neon\.tech|neon\.com|neon\.io|neon\./i.test(
    DATABASE_URL
  )
    ? { rejectUnauthorized: false }
    : undefined,
});

/* ---------------- MEMORY ---------------- */

const robotsCache = new Map();
const domainLastRequest = new Map();

/* ---------------- BLOCKED FILE TYPES ---------------- */

const BLOCKED_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".bmp",
  ".tiff",
  ".mp3",
  ".wav",
  ".ogg",
  ".m4a",
  ".mp4",
  ".webm",
  ".avi",
  ".mov",
  ".mkv",
  ".zip",
  ".rar",
  ".7z",
  ".gz",
  ".tar",
  ".apk",
  ".exe",
  ".dmg",
  ".iso",
  ".bin",
]);

/* =========================================================
   BASIC HELPERS
   ========================================================= */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""), "utf8")
    .digest("hex");
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\u00a0/g, " ")
    .trim();
}

function domainOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isSitemapUrl(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();

    return (
      path.endsWith(".xml") ||
      path.endsWith(".xml.gz") ||
      path.includes("sitemap")
    );
  } catch {
    return false;
  }
}

/* =========================================================
   SSRF / PRIVATE NETWORK PROTECTION
   ========================================================= */

function isPrivateIPv4(ip) {
  const p = ip.split(".").map(Number);

  if (
    p.length !== 4 ||
    p.some(
      (x) => !Number.isInteger(x) || x < 0 || x > 255
    )
  ) {
    return false;
  }

  return (
    p[0] === 10 ||
    p[0] === 127 ||
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31)
  );
}

function isPrivateIPv6(ip) {
  const value = String(ip || "").toLowerCase();

  return (
    value === "::1" ||
    value === "::" ||
    value.startsWith("fc") ||
    value.startsWith("fd") ||
    value.startsWith("fe80:")
  );
}

async function assertPublicHost(hostname) {
  const host = String(hostname || "")
    .toLowerCase()
    .replace(/\.$/, "");

  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new Error("Blocked private/local hostname");
  }

  const records = await dns.lookup(host, {
    all: true,
    verbatim: true,
  });

  if (!records.length) {
    throw new Error("DNS lookup returned no address");
  }

  for (const record of records) {
    if (
      record.family === 4 &&
      isPrivateIPv4(record.address)
    ) {
      throw new Error("Blocked private IPv4 address");
    }

    if (
      record.family === 6 &&
      isPrivateIPv6(record.address)
    ) {
      throw new Error("Blocked private IPv6 address");
    }
  }
}

/* =========================================================
   URL NORMALIZATION
   ========================================================= */

function normalizeUrl(input, baseUrl = null) {
  try {
    const url = new URL(
      String(input || ""),
      baseUrl || undefined
    );

    if (!/^https?:$/.test(url.protocol)) {
      return null;
    }

    url.hash = "";
    url.username = "";
    url.password = "";

    const removeParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "gclid",
      "fbclid",
      "msclkid",
      "mc_cid",
      "mc_eid",
    ];

    for (const key of removeParams) {
      url.searchParams.delete(key);
    }

    if (
      url.pathname.length > 2048 ||
      url.toString().length > 8192
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function isValidCrawlUrl(url) {
  try {
    const u = new URL(url);

    if (!/^https?:$/.test(u.protocol)) {
      return false;
    }

    if (
      !u.hostname ||
      u.hostname.length < 3 ||
      u.hostname.length > 253
    ) {
      return false;
    }

    const pathname = u.pathname.toLowerCase();

    for (const ext of BLOCKED_EXTENSIONS) {
      if (pathname.endsWith(ext)) {
        return false;
      }
    }

    const blockedPaths = [
      "/login",
      "/signin",
      "/sign-in",
      "/signup",
      "/sign-up",
      "/register",
      "/logout",
      "/wp-login.php",
    ];

    for (const part of blockedPaths) {
      if (pathname.includes(part)) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

/* =========================================================
   LANGUAGE DETECTION
   ========================================================= */

function detectLanguage(text) {
  const value = String(text || "");

  const counts = {
    as: (value.match(/[\u0980-\u09FF]/g) || []).length,
    hi: (value.match(/[\u0900-\u097F]/g) || []).length,
    ar: (value.match(/[\u0600-\u06FF]/g) || []).length,
    zh: (value.match(/[\u4E00-\u9FFF]/g) || []).length,
    en: (value.match(/[A-Za-z]/g) || []).length,
  };

  const total = Object.values(counts).reduce(
    (a, b) => a + b,
    0
  );

  if (!total) {
    return "unknown";
  }

  const best = Object.entries(counts).sort(
    (a, b) => b[1] - a[1]
  )[0];

  if (best[1] / total >= 0.2) {
    return best[0];
  }

  return "unknown";
}

/* =========================================================
   QUALITY SCORE
   ========================================================= */

function calculateQuality({
  title,
  description,
  content,
  wordCount,
  links,
}) {
  let score = 0;

  if (title) score += 20;
  if (description) score += 15;

  if (wordCount >= 50) score += 10;
  if (wordCount >= 200) score += 10;
  if (wordCount >= 500) score += 10;
  if (wordCount >= 1000) score += 10;

  if (content.length >= 1000) score += 10;
  if (content.length >= 5000) score += 5;

  if (links > 0) score += 5;

  return Math.min(100, score);
}

/* =========================================================
   ROBOTS.TXT
   ========================================================= */

function parseRobots(text) {
  const groups = [];
  const sitemaps = [];

  let current = null;

  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.split("#")[0].trim();

    if (!line) {
      continue;
    }

    const index = line.indexOf(":");

    if (index < 0) {
      continue;
    }

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

    if (!current) {
      continue;
    }

    if (key === "allow") {
      current.rules.push({
        type: "allow",
        path: value,
      });
    }

    if (key === "disallow") {
      if (value) {
        current.rules.push({
          type: "disallow",
          path: value,
        });
      }
    }

    if (key === "sitemap") {
      const sitemap = normalizeUrl(value);

      if (sitemap) {
        sitemaps.push(sitemap);
      }
    }
  }

  return {
    groups,
    sitemaps: [...new Set(sitemaps)],
  };
}

function robotsRuleMatches(pathname, rulePath) {
  if (!rulePath) {
    return false;
  }

  let pattern = String(rulePath);

  const endMatch = pattern.endsWith("$");

  if (endMatch) {
    pattern = pattern.slice(0, -1);
  }

  const escaped = pattern.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );

  const regex = new RegExp(
    "^" +
      escaped.replace(/\\\*/g, ".*") +
      (endMatch ? "$" : "")
  );

  return regex.test(pathname);
}

function getRobotsRules(robots) {
  if (!robots || !Array.isArray(robots.groups)) {
    return [];
  }

  const exact = [];
  const generic = [];

  for (const group of robots.groups) {
    for (const agent of group.agents || []) {
      if (
        agent === "hexora-bot" ||
        agent.includes("hexora")
      ) {
        exact.push(...group.rules);
      } else if (agent === "*") {
        generic.push(...group.rules);
      }
    }
  }

  return exact.length ? exact : generic;
}

function robotsAllowed(url, robots) {
  if (!robots) {
    return true;
  }

  const rules = getRobotsRules(robots);

  if (!rules.length) {
    return true;
  }

  const pathname = new URL(url).pathname || "/";

  let best = null;

  for (const rule of rules) {
    if (!robotsRuleMatches(pathname, rule.path)) {
      continue;
    }

    if (
      !best ||
      rule.path.length > best.path.length ||
      (
        rule.path.length === best.path.length &&
        rule.type === "allow"
      )
    ) {
      best = rule;
    }
  }

  if (!best) {
    return true;
  }

  return best.type === "allow";
}

async function fetchRobots(domain) {
  const cached = robotsCache.get(domain);

  if (
    cached &&
    Date.now() - cached.timestamp <
      15 * 60 * 1000
  ) {
    return cached;
  }

  const result = {
    groups: [],
    sitemaps: [],
    timestamp: Date.now(),
  };

  try {
    const robotsUrl = `https://${domain}/robots.txt`;

    await assertPublicHost(domain);

    const response = await fetchWithRedirects(
      robotsUrl,
      {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/plain,*/*",
        },
      },
      10000,
      2
    );

    if (response.ok) {
      const text = await response.text();

      const parsed = parseRobots(text);

      result.groups = parsed.groups;
      result.sitemaps = parsed.sitemaps;
    }
  } catch (error) {
    console.log(
      `[HEXORA] robots.txt unavailable for ${domain}:`,
      error?.message || error
    );
  }

  robotsCache.set(domain, result);

  return result;
}

/* =========================================================
   DOMAIN RATE LIMIT
   ========================================================= */

async function respectDomainDelay(url) {
  const domain = domainOf(url);

  const last =
    domainLastRequest.get(domain) || 0;

  const wait =
    DOMAIN_DELAY -
    (Date.now() - last);

  if (wait > 0) {
    await sleep(wait);
  }

  domainLastRequest.set(
    domain,
    Date.now()
  );
}

/* =========================================================
   FETCH WITH REDIRECTS
   ========================================================= */

async function fetchWithRedirects(
  startUrl,
  options = {},
  timeoutMs = REQUEST_TIMEOUT,
  maxRedirects = MAX_REDIRECTS
) {
  let current = normalizeUrl(startUrl);

  if (!current) {
    throw new Error("Invalid URL");
  }

  for (
    let redirect = 0;
    redirect <= maxRedirects;
    redirect++
  ) {
    const parsed = new URL(current);

    await assertPublicHost(parsed.hostname);

    await respectDomainDelay(current);

    const controller =
      new AbortController();

    const timer = setTimeout(
      () => controller.abort(),
      timeoutMs
    );

    try {
      const response = await fetch(
        current,
        {
          ...options,
          redirect: "manual",
          signal: controller.signal,
        }
      );

      if (
        response.status >= 300 &&
        response.status < 400
      ) {
        const location =
          response.headers.get("location");

        if (!location) {
          return Object.defineProperty(
            response,
            "hexoraFinalUrl",
            {
              value: current,
            }
          );
        }

        const next = normalizeUrl(
          location,
          current
        );

        if (!next) {
          throw new Error(
            "Invalid redirect URL"
          );
        }

        current = next;

        continue;
      }

      return Object.defineProperty(
        response,
        "hexoraFinalUrl",
        {
          value: current,
        }
      );
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error("Too many redirects");
}

/* =========================================================
   LIMITED RESPONSE READER
   ========================================================= */

async function readLimitedText(
  response,
  maxBytes
) {
  const length = Number(
    response.headers.get(
      "content-length"
    ) || 0
  );

  if (length > maxBytes) {
    throw new Error(
      "Response exceeds crawler size limit"
    );
  }

  if (!response.body) {
    return "";
  }

  const reader =
    response.body.getReader();

  const chunks = [];

  let total = 0;

  try {
    while (true) {
      const { done, value } =
        await reader.read();

      if (done) {
        break;
      }

      total += value.byteLength;

      if (total > maxBytes) {
        await reader.cancel();

        throw new Error(
          "Response exceeds crawler size limit"
        );
      }

      chunks.push(
        Buffer.from(value)
      );
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks)
    .toString("utf8");
}

/* =========================================================
   HTML FETCH
   ========================================================= */

async function fetchHtml(url) {
  let lastError = null;

  for (
    let attempt = 1;
    attempt <= MAX_RETRIES;
    attempt++
  ) {
    try {
      const response =
        await fetchWithRedirects(
          url,
          {
            method: "GET",
            headers: {
              "User-Agent": USER_AGENT,
              Accept:
                "text/html,application/xhtml+xml;q=0.95,*/*;q=0.2",
              "Accept-Language":
                "en-US,en;q=0.8,as;q=0.7,hi;q=0.6",
            },
          }
        );

      const finalUrl =
        normalizeUrl(
          response.hexoraFinalUrl || url
        ) || url;

      const contentType =
        response.headers.get(
          "content-type"
        ) || "";

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}`
        );
      }

      const html =
        await readLimitedText(
          response,
          MAX_HTML_BYTES
        );

      return {
        ok: true,
        status: response.status,
        finalUrl,
        html,
        contentType,
      };
    } catch (error) {
      lastError = error;

      if (attempt < MAX_RETRIES) {
        await sleep(
          Math.min(
            15000,
            1000 * 2 ** (attempt - 1)
          )
        );
      }
    }
  }

  return {
    ok: false,
    status: 0,
    finalUrl: url,
    error:
      lastError?.message ||
      "Fetch failed",
  };
}

/* =========================================================
   SITEMAP PARSER
   ========================================================= */

function extractSitemapUrls(xml) {
  const $ = cheerio.load(
    String(xml || ""),
    {
      xmlMode: true,
    }
  );

  const urls = [];

  $("loc").each((_, element) => {
    const value = cleanText(
      $(element).text()
    );

    const normalized =
      normalizeUrl(value);

    if (
      normalized &&
      isValidCrawlUrl(normalized)
    ) {
      urls.push(normalized);
    }
  });

  return [
    ...new Set(urls),
  ];
}

async function processSitemap(
  sitemapUrl
) {
  const fetched =
    await fetchHtml(sitemapUrl);

  /*
   * fetchHtml accepts the response as text.
   * We intentionally allow XML here.
   */

  if (!fetched.ok) {
    return {
      ok: false,
      error: fetched.error,
    };
  }

  const urls =
    extractSitemapUrls(
      fetched.html
    );

  let inserted = 0;

  for (const url of urls.slice(0, 5000)) {
    const result =
      await pool.query(
        `
        INSERT INTO crawl_queue
          (url,status,priority,discovered_from)
        VALUES
          ($1,'pending',95,$2)
        ON CONFLICT (url) DO NOTHING
        `,
        [
          url,
          sitemapUrl,
        ]
      );

    inserted +=
      result.rowCount || 0;
  }

  return {
    ok: true,
    urls: urls.length,
    inserted,
  };
}

/* =========================================================
   HTML PARSER
   ========================================================= */

function parseHtml(html, url) {
  const $ = cheerio.load(html);

  $(
    "script,style,noscript,template,svg,canvas"
  ).remove();

  const title = cleanText(
    $("title").first().text() ||
      $(
        "meta[property='og:title']"
      ).attr("content") ||
      ""
  ).slice(0, 1000);

  const description =
    cleanText(
      $(
        "meta[name='description']"
      ).attr("content") ||
        $(
          "meta[property='og:description']"
        ).attr("content") ||
        ""
    ).slice(0, 2000);

  const canonicalRaw =
    $("link[rel='canonical']")
      .first()
      .attr("href");

  const canonical =
    normalizeUrl(
      canonicalRaw,
      url
    ) || url;

  const headings = cleanText(
    $("h1,h2,h3,h4,h5,h6")
      .map((_, el) =>
        $(el).text()
      )
      .get()
      .join(" ")
  ).slice(0, 15000);

  const keywords = cleanText(
    $(
      "meta[name='keywords']"
    ).attr("content") || ""
  ).slice(0, 5000);

  const content = cleanText(
    $("body").text()
  ).slice(0, MAX_CONTENT);

  const wordCount =
    content
      .split(/\s+/)
      .filter(Boolean)
      .length;

  const language =
    detectLanguage(
      `${title} ${description} ${headings} ${content}`
    );

  const links = [];
  const imageItems = [];
  const videoItems = [];

  /* ---------- LINKS ---------- */

  $("a[href]").each(
    (_, element) => {
      if (
        links.length >= MAX_LINKS
      ) {
        return;
      }

      const href =
        normalizeUrl(
          $(element).attr("href"),
          canonical
        );

      if (
        href &&
        isValidCrawlUrl(href)
      ) {
        links.push({
          url: href,
          anchor: cleanText(
            $(element).text()
          ).slice(0, 300),
        });
      }
    }
  );

  /* ---------- IMAGES ---------- */

  $(
    "img[src],img[data-src]"
  ).each((_, element) => {
    if (
      imageItems.length >=
      MAX_IMAGES
    ) {
      return;
    }

    const raw =
      $(element).attr("src") ||
      $(element).attr("data-src");

    const src =
      normalizeUrl(
        raw,
        canonical
      );

    if (!src) {
      return;
    }

    const alt =
      cleanText(
        $(element).attr("alt") ||
          ""
      ).slice(0, 300);

    imageItems.push({
      url: src,
      alt,
    });
  });

  /* ---------- OPEN GRAPH IMAGE ---------- */

  $(
    "meta[property='og:image'],meta[property='og:image:url']"
  ).each((_, element) => {
    if (
      imageItems.length >=
      MAX_IMAGES
    ) {
      return;
    }

    const src =
      normalizeUrl(
        $(element).attr("content"),
        canonical
      );

    if (src) {
      imageItems.push({
        url: src,
        alt: title,
      });
    }
  });

  /* ---------- VIDEOS ---------- */

  $(
    "video[src],video source[src]"
  ).each((_, element) => {
    if (
      videoItems.length >=
      MAX_VIDEOS
    ) {
      return;
    }

    const src =
      normalizeUrl(
        $(element).attr("src"),
        canonical
      );

    if (src) {
      videoItems.push({
        url: src,
      });
    }
  });

  $(
    "meta[property='og:video'],meta[property='og:video:url'],meta[property='og:video:secure_url']"
  ).each((_, element) => {
    if (
      videoItems.length >=
      MAX_VIDEOS
    ) {
      return;
    }

    const src =
      normalizeUrl(
        $(element).attr("content"),
        canonical
      );

    if (src) {
      videoItems.push({
        url: src,
      });
    }
  });

  /* ---------- PUBLISHED DATE ---------- */

  const publishedRaw =
    $(
      "meta[property='article:published_time'],meta[name='date'],time[datetime]"
    )
      .first()
      .attr("content") ||
    $("time[datetime]")
      .first()
      .attr("datetime") ||
    "";

  const publishedAt =
    publishedRaw &&
    !Number.isNaN(
      Date.parse(publishedRaw)
    )
      ? new Date(
          publishedRaw
        ).toISOString()
      : null;

  const ogType =
    String(
      $(
        "meta[property='og:type']"
      ).attr("content") ||
        ""
    ).toLowerCase();

  const crawlStatus =
    /article|news/.test(
      ogType
    ) || publishedAt
      ? "news"
      : "indexed";

  const uniqueLinks = [
    ...new Map(
      links.map((x) => [
        x.url,
        x,
      ])
    ).values(),
  ];

  const uniqueImages = [
    ...new Map(
      imageItems.map((x) => [
        x.url,
        x,
      ])
    ).values(),
  ];

  const uniqueVideos = [
    ...new Map(
      videoItems.map((x) => [
        x.url,
        x,
      ])
    ).values(),
  ];

  const qualityScore =
    calculateQuality({
      title,
      description,
      content,
      wordCount,
      links:
        uniqueLinks.length,
    });

  return {
    title,
    description,
    headings,
    keywords,
    canonical,
    content,
    wordCount,
    language,
    links: uniqueLinks,
    imageItems: uniqueImages,
    videoItems: uniqueVideos,
    publishedAt,
    crawlStatus,
    qualityScore,
  };
}

/* =========================================================
   SAVE PAGE
   ========================================================= */

async function savePage({
  originalUrl,
  finalUrl,
  parsed,
  contentHash,
  r2Key,
  statusCode,
}) {
  const client =
    await pool.connect();

  try {
    await client.query(
      "BEGIN"
    );

    const pageResult =
      await client.query(
        `
        INSERT INTO pages
        (
          url,
          canonical_url,
          title,
          description,
          excerpt,
          content,
          domain,
          language,
          content_hash,
          word_count,
          status_code,
          crawl_status,
          last_crawled_at,
          updated_at,
          published_at,
          r2_key,
          quality_score,
          image_items,
          video_items,
          search_vector
        )
        VALUES
        (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          NOW(),
          NOW(),
          $13,
          $14,
          $15,
          $16,
          $17,
          setweight(
            to_tsvector(
              'simple',
              coalesce($3,'') || ' ' ||
              coalesce($4,'') || ' ' ||
              coalesce($18,'') || ' ' ||
              coalesce($19,'') || ' ' ||
              coalesce($6,'')
            ),
            'A'
          )
        )
        ON CONFLICT (url)
        DO UPDATE SET
          canonical_url =
            EXCLUDED.canonical_url,

          title =
            EXCLUDED.title,

          description =
            EXCLUDED.description,

          excerpt =
            EXCLUDED.excerpt,

          content =
            EXCLUDED.content,

          domain =
            EXCLUDED.domain,

          language =
            EXCLUDED.language,

          content_hash =
            EXCLUDED.content_hash,

          word_count =
            EXCLUDED.word_count,

          status_code =
            EXCLUDED.status_code,

          crawl_status =
            EXCLUDED.crawl_status,

          last_crawled_at =
            NOW(),

          updated_at =
            NOW(),

          published_at =
            EXCLUDED.published_at,

          r2_key =
            EXCLUDED.r2_key,

          quality_score =
            EXCLUDED.quality_score,

          image_items =
            EXCLUDED.image_items,

          video_items =
            EXCLUDED.video_items,

          search_vector =
            setweight(
              to_tsvector(
                'simple',
                coalesce(EXCLUDED.title,'') || ' ' ||
                coalesce(EXCLUDED.description,'') || ' ' ||
                coalesce($18,'') || ' ' ||
                coalesce($19,'') || ' ' ||
                coalesce(EXCLUDED.content,'')
              ),
              'A'
            )

        RETURNING id
        `,
        [
          originalUrl,
          parsed.canonical ||
            finalUrl,
          parsed.title,
          parsed.description,
          parsed.content.slice(
            0,
            800
          ),
          parsed.content,
          domainOf(
            parsed.canonical ||
              finalUrl
          ),
          parsed.language,
          contentHash,
          parsed.wordCount,
          statusCode,
          parsed.crawlStatus,
          parsed.publishedAt,
          r2Key,
          parsed.qualityScore,
          JSON.stringify(
            parsed.imageItems
          ),
          JSON.stringify(
            parsed.videoItems
          ),
          parsed.headings,
          parsed.keywords,
        ]
      );

    const pageId =
      pageResult.rows[0].id;

    /* ---------- LINKS ---------- */

    await client.query(
      `
      DELETE FROM page_links
      WHERE source_page_id = $1
      `,
      [pageId]
    );

    for (
      const link of parsed.links
    ) {
      await client.query(
        `
        INSERT INTO page_links
        (
          source_page_id,
          target_url,
          anchor_text
        )
        VALUES
        ($1,$2,$3)
        ON CONFLICT
        (
          source_page_id,
          target_url
        )
        DO UPDATE SET
          anchor_text =
            EXCLUDED.anchor_text
        `,
        [
          pageId,
          link.url,
          link.anchor,
        ]
      );

      await client.query(
        `
        INSERT INTO crawl_queue
        (
          url,
          status,
          priority,
          discovered_from
        )
        VALUES
        (
          $1,
          'pending',
          $2,
          $3
        )
        ON CONFLICT (url)
        DO NOTHING
        `,
        [
          link.url,
          link.anchor
            ? 55
            : 40,
          finalUrl,
        ]
      );
    }

    /* ---------- DOMAIN ---------- */

    const pageDomain =
      domainOf(
        parsed.canonical ||
          finalUrl
      );

    await client.query(
      `
      UPDATE domains
      SET
        pages_count =
          COALESCE(pages_count,0) + 1,
        updated_at =
          NOW()
      WHERE domain = $1
      `,
      [pageDomain]
    ).catch(() => {});

    await client.query(
      "COMMIT"
    );

    return pageId;
  } catch (error) {
    await client.query(
      "ROLLBACK"
    );

    throw error;
  } finally {
    client.release();
  }
}

/* =========================================================
   QUEUE STATUS
   ========================================================= */

async function markQueue(
  id,
  status,
  error = null
) {
  if (!id) {
    return;
  }

  if (status === "failed") {
    await pool.query(
      `
      UPDATE crawl_queue
      SET
        status =
          CASE
            WHEN attempts >= $2
            THEN 'failed'
            ELSE 'pending'
          END,
        error = $3,
        finished_at = NOW()
      WHERE id = $1
      `,
      [
        id,
        MAX_ATTEMPTS,
        String(
          error ||
            "Crawl failed"
        ).slice(0, 2000),
      ]
    );

    return;
  }

  await pool.query(
    `
    UPDATE crawl_queue
    SET
      status = $2,
      finished_at = NOW(),
      error = NULL
    WHERE id = $1
    `,
    [id, status]
  );
}

/* =========================================================
   CLAIM JOB
   ========================================================= */

async function claimNextJob() {
  const client =
    await pool.connect();

  try {
    await client.query(
      "BEGIN"
    );

    const result =
      await client.query(
        `
        SELECT
          id,
          url,
          attempts
        FROM crawl_queue
        WHERE status = 'pending'
          AND attempts < $1
        ORDER BY
          priority DESC,
          id ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
        `,
        [
          MAX_ATTEMPTS,
          WORKER_BATCH,
        ]
      );

    if (!result.rows.length) {
      await client.query(
        "COMMIT"
      );

      return [];
    }

    const jobs = [];

    for (
      const row of result.rows
    ) {
      const updated =
        await client.query(
          `
          UPDATE crawl_queue
          SET
            status = 'processing',
            attempts =
              COALESCE(attempts,0) + 1,
            started_at = NOW(),
            finished_at = NULL,
            error = NULL
          WHERE id = $1
          RETURNING
            id,
            url,
            attempts
          `,
          [row.id]
        );

      if (updated.rows[0]) {
        jobs.push(
          updated.rows[0]
        );
      }
    }

    await client.query(
      "COMMIT"
    );

    return jobs;
  } catch (error) {
    await client.query(
      "ROLLBACK"
    );

    throw error;
  } finally {
    client.release();
  }
}

/* =========================================================
   CRAWL ONE URL
   ========================================================= */

export async function crawlUrl(
  job
) {
  const jobId =
    job?.id ?? null;

  const original =
    normalizeUrl(
      job?.url || job
    );

  if (
    !original ||
    !isValidCrawlUrl(original)
  ) {
    await markQueue(
      jobId,
      "failed",
      "Invalid or blocked URL"
    );

    return {
      ok: false,
      url:
        job?.url || job,
      error:
        "Invalid or blocked URL",
    };
  }

  try {
    console.log(
      `[HEXORA] Crawling: ${original}`
    );

    const domain =
      domainOf(original);

    /* ---------- ROBOTS ---------- */

    const robots =
      await fetchRobots(
        domain
      );

    if (
      !robotsAllowed(
        original,
        robots
      )
    ) {
      console.log(
        `[HEXORA] Robots blocked: ${original}`
      );

      await markQueue(
        jobId,
        "blocked",
        "Blocked by robots.txt"
      );

      return {
        ok: false,
        blocked: true,
        url: original,
      };
    }

    /* ---------- SITEMAP ---------- */

    if (
      isSitemapUrl(original)
    ) {
      console.log(
        `[HEXORA] Sitemap: ${original}`
      );

      const sitemap =
        await processSitemap(
          original
        );

      await markQueue(
        jobId,
        sitemap.ok
          ? "done"
          : "failed",
        sitemap.error
      );

      return sitemap;
    }

    /* ---------- EXISTING URL ---------- */

    const existing =
      await pool.query(
        `
        SELECT
          id,
          content_hash
        FROM pages
        WHERE url = $1
        LIMIT 1
        `,
        [original]
      );

    /* ---------- FETCH ---------- */

    const fetched =
      await fetchHtml(
        original
      );

    if (!fetched.ok) {
      await markQueue(
        jobId,
        "failed",
        fetched.error
      );

      return {
        ok: false,
        url: original,
        error:
          fetched.error,
      };
    }

    const finalUrl =
      fetched.finalUrl;

    /* ---------- REDIRECT ROBOTS ---------- */

    const finalDomain =
      domainOf(finalUrl);

    const finalRobots =
      finalDomain === domain
        ? robots
        : await fetchRobots(
            finalDomain
          );

    if (
      !robotsAllowed(
        finalUrl,
        finalRobots
      )
    ) {
      await markQueue(
        jobId,
        "blocked",
        "Redirect target blocked by robots.txt"
      );

      return {
        ok: false,
        blocked: true,
        url: finalUrl,
      };
    }

    /* ---------- PARSE ---------- */

    const parsed =
      parseHtml(
        fetched.html,
        finalUrl
      );

    if (
      !parsed.content &&
      !parsed.title
    ) {
      await markQueue(
        jobId,
        "failed",
        "No readable page content"
      );

      return {
        ok: false,
        url: finalUrl,
        error:
          "No readable page content",
      };
    }

    /* ---------- HASH ---------- */

    const contentHash =
      sha256(
        fetched.html
      );

    /*
     * IMPORTANT:
     * We do NOT discard a URL just because
     * another page has the same content.
     *
     * The URL itself is still valuable to
     * HEXORA's index.
     */

    if (
      existing.rowCount &&
      existing.rows[0]
        .content_hash ===
        contentHash
    ) {
      console.log(
        `[HEXORA] Already indexed: ${original}`
      );

      await pool.query(
        `
        UPDATE pages
        SET
          last_crawled_at = NOW(),
          updated_at = NOW(),
          status_code = $2
        WHERE id = $1
        `,
        [
          existing.rows[0].id,
          fetched.status,
        ]
      );

      await markQueue(
        jobId,
        "done"
      );

      return {
        ok: true,
        duplicate: true,
        pageId:
          existing.rows[0].id,
        url: original,
      };
    }

    /* ---------- R2 ---------- */

    const r2 =
      await putHtml({
        url: finalUrl,
        html: fetched.html,
        contentHash,
        metadata: {
          language:
            parsed.language,
        },
      });

    console.log(
      `[HEXORA] R2 saved: ${r2.key}`
    );

    /* ---------- DATABASE ---------- */

    const pageId =
      await savePage({
        originalUrl: original,
        finalUrl,
        parsed,
        contentHash,
        r2Key: r2.key,
        statusCode:
          fetched.status,
      });

    console.log(
      `[HEXORA] DB saved page=${pageId} url=${original}`
    );

    await markQueue(
      jobId,
      "done"
    );

    return {
      ok: true,
      pageId,
      url: original,
      finalUrl,
      title:
        parsed.title,
      language:
        parsed.language,
      links:
        parsed.links.length,
      images:
        parsed.imageItems.length,
      videos:
        parsed.videoItems.length,
      r2Key: r2.key,
    };
  } catch (error) {
    console.error(
      "[HEXORA] Crawl failed:",
      original,
      error?.message || error
    );

    await markQueue(
      jobId,
      "failed",
      error?.message ||
        String(error)
    ).catch(() => {});

    return {
      ok: false,
      url: original,
      error:
        error?.message ||
        String(error),
    };
  }
}

/* =========================================================
   CRAWL BATCH
   ========================================================= */

export async function crawlBatch(
  jobs = []
) {
  const list =
    Array.isArray(jobs)
      ? jobs
      : [];

  const results = [];

  for (
    const job of list
  ) {
    results.push(
      await crawlUrl(job)
    );

    await sleep(
      DOMAIN_DELAY
    );
  }

  const successful =
    results.filter(
      (r) => r.ok
    ).length;

  return {
    total:
      results.length,
    successful,
    failed:
      results.length -
      successful,
    results,
  };
}

/* =========================================================
   DATABASE HEALTH
   ========================================================= */

export async function checkCrawlerDatabase() {
  try {
    const result =
      await pool.query(
        "SELECT NOW() AS now"
      );

    return {
      connected: true,
      now:
        result.rows[0]?.now ||
        null,
    };
  } catch (error) {
    return {
      connected: false,
      error:
        error?.message ||
        String(error),
    };
  }
}

export async function closeCrawlerDatabase() {
  await pool.end();
}

/* =========================================================
   MAIN WORKER
   ========================================================= */

async function main() {
  console.log(
    "=========================================="
  );

  console.log(
    "[HEXORA] Independent crawler starting..."
  );

  console.log(
    `[HEXORA] User-Agent: ${USER_AGENT}`
  );

  console.log(
    `[HEXORA] Domain delay: ${DOMAIN_DELAY}ms`
  );

  console.log(
    `[HEXORA] Worker batch: ${WORKER_BATCH}`
  );

  console.log(
    "=========================================="
  );

  const db =
    await checkCrawlerDatabase();

  if (!db.connected) {
    throw new Error(
      `[HEXORA] Database connection failed: ${db.error}`
    );
  }

  console.log(
    "[HEXORA] PostgreSQL connected:",
    db.now
  );

  console.log(
    "[HEXORA] Crawler is ready."
  );

  while (true) {
    try {
      const jobs =
        await claimNextJob();

      if (!jobs.length) {
        console.log(
          "[HEXORA] No pending jobs. Waiting..."
        );

        await sleep(
          IDLE_WAIT
        );

        continue;
      }

      for (
        const job of jobs
      ) {
        await crawlUrl(job);
      }
    } catch (error) {
      console.error(
        "[HEXORA] Worker error:",
        error?.message ||
          error
      );

      await sleep(
        5000
      );
    }
  }
}

/* =========================================================
   START
   ========================================================= */

main().catch(
  (error) => {
    console.error(
      "[HEXORA] FATAL:",
      error?.message ||
        error
    );

    process.exit(1);
  }
);
