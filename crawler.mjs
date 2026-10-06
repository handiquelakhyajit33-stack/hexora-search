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

const MAX_SITEMAP_URLS = Math.max(
  100,
  Number(process.env.CRAWL_MAX_SITEMAP_URLS || 2000)
);

const MAX_DISCOVERY_LINKS = Math.max(
  10,
  Number(process.env.CRAWL_MAX_DISCOVERY_LINKS || 75)
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
const domainLocks = new Map();

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

  for (const url of urls.slice(0, MAX_SITEMAP_URLS)) {
    const result =
      await pool.query(
        `
        INSERT INTO crawl_queue
          (url,status,priority,discovered_from)
        VALUES
          ($1,'pending',35,$2)
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
    total: urls.length,
    inserted,
  };
}
