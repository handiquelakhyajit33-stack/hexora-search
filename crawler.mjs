```javascript
import crypto from "node:crypto";
import dns from "node:dns/promises";
import * as cheerio from "cheerio";
import pg from "pg";
import { putHtml } from "./storage.mjs";

const { Pool } = pg;

const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();

if (!DATABASE_URL) {
  throw new Error("[HEXORA] DATABASE_URL is missing");
}

const USER_AGENT =
  process.env.HEXORA_USER_AGENT ||
  "HEXORA-Bot/1.0 (+https://www.hexsorasearch.com/)";

const REQUEST_TIMEOUT = Math.max(
  3000,
  Number(process.env.CRAWL_TIMEOUT_MS || 15000)
);

const MAX_CONTENT = Math.max(
  10000,
  Number(process.env.CRAWL_MAX_CONTENT || 120000)
);

const MAX_HTML_BYTES = Math.max(
  100000,
  Number(process.env.CRAWL_MAX_HTML_BYTES || 3000000)
);

const MAX_LINKS = Math.max(
  10,
  Number(process.env.CRAWL_MAX_LINKS || 150)
);

const DOMAIN_DELAY = Math.max(
  100,
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

const pool = new Pool({
  connectionString: DATABASE_URL,

  max: Math.max(
    2,
    Number(process.env.CRAWL_DB_POOL_MAX || 6)
  ),

  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000,

  ssl: /neon\.tech|neon\.com|neon\.io|neon\./i.test(
    DATABASE_URL
  )
    ? { rejectUnauthorized: false }
    : undefined,
});

const robotsCache = new Map();
const domainLastRequest = new Map();

const BLOCKED_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".mp3",
  ".wav",
  ".ogg",
  ".mp4",
  ".webm",
  ".avi",
  ".mov",
  ".zip",
  ".rar",
  ".7z",
  ".gz",
  ".tar",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".apk",
  ".exe",
  ".dmg",
  ".iso",
]);

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

function isPrivateIPv4(ip) {
  const p = ip.split(".").map(Number);

  if (
    p.length !== 4 ||
    p.some(
      (x) =>
        !Number.isInteger(x) ||
        x < 0 ||
        x > 255
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
  const value = ip.toLowerCase();

  return (
    value === "::1" ||
    value.startsWith("fc") ||
    value.startsWith("fd") ||
    value.startsWith("fe80:") ||
    value === "::"
  );
}

async function assertPublicHost(hostname) {
  const host = hostname
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

function normalizeUrl(input, baseUrl = null) {
  try {
    const url = new URL(
      input,
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

    if (
      [...BLOCKED_EXTENSIONS].some((ext) =>
        pathname.endsWith(ext)
      )
    ) {
      return false;
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

    if (
      blockedPaths.some((part) =>
        pathname.includes(part)
      )
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

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

function qualityScore({
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

function parseRobots(text) {
  const rules = [];
  const sitemaps = [];

  let active = false;

  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.split("#")[0].trim();

    if (!line) continue;

    const i = line.indexOf(":");

    if (i < 0) continue;

    const key = line
      .slice(0, i)
      .trim()
      .toLowerCase();

    const value = line
      .slice(i + 1)
      .trim();

    if (key === "user-agent") {
      active =
        value === "*" ||
        value.toLowerCase() === "hexora-bot" ||
        value.toLowerCase().includes("hexora");
    } else if (
      active &&
      key === "disallow" &&
      value
    ) {
      rules.push({
        type: "disallow",
        path: value,
      });
    } else if (
      active &&
      key === "allow" &&
      value
    ) {
      rules.push({
        type: "allow",
        path: value,
      });
    } else if (
      key === "sitemap" &&
      value
    ) {
      sitemaps.push(value);
    }
  }

  return {
    rules,
    sitemaps,
  };
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
    allowAll: true,
    rules: [],
    sitemaps: [],
    timestamp: Date.now(),
  };

  try {
    const url = `https://${domain}/robots.txt`;

    await assertPublicHost(domain);

    const response = await fetchWithRedirects(
      url,
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
      const parsed = parseRobots(
        await response.text()
      );

      result.rules = parsed.rules;

      result.sitemaps =
        parsed.sitemaps.filter((s) =>
          normalizeUrl(s)
        );

      result.allowAll =
        result.rules.length === 0;
    }
  } catch {
    // If robots.txt cannot be fetched,
    // continue with normal crawling.
  }

  robotsCache.set(domain, result);

  return result;
}

function robotsAllowed(url, robots) {
  if (!robots || robots.allowAll) {
    return true;
  }

  const pathname =
    new URL(url).pathname || "/";

  let best = null;

  for (const rule of robots.rules) {
    if (!pathname.startsWith(rule.path)) {
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

  return !best || best.type === "allow";
}

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

    await assertPublicHost(
      parsed.hostname
    );

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
          response.headers.get(
            "location"
          );

        if (!location) {
          return response;
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

      Object.defineProperty(
        response,
        "hexoraFinalUrl",
        {
          value: current,
        }
      );

      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error("Too many redirects");
}

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

      if (done) break;

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

async function fetchHtml(url) {
  let lastError;

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
              "User-Agent":
                USER_AGENT,

              Accept:
                "text/html,application/xhtml+xml;q=0.95,*/*;q=0.2",

              "Accept-Language":
                "en-US,en;q=0.8,as;q=0.7,hi;q=0.6,bn;q=0.5",
            },
          }
        );

      const finalUrl =
        normalizeUrl(
          response.hexoraFinalUrl || url
        ) || url;

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}`
        );
      }

      const contentType =
        response.headers.get(
          "content-type"
        ) || "";

      if (
        !/text\/html|application\/xhtml\+xml/i.test(
          contentType
        )
      ) {
        throw new Error(
          `Not HTML: ${
            contentType || "unknown"
          }`
        );
      }

      const html =
        await readLimitedText(
          response,
          MAX_HTML_BYTES
        );

      if (html.length < 100) {
        throw new Error(
          "Empty or very small HTML"
        );
      }

      return {
        ok: true,
        status: response.status,
        finalUrl,
        html,
        contentType,
      };
    } catch (error) {
      lastError = error;

      if (
        attempt < MAX_RETRIES
      ) {
        await sleep(
          Math.min(
            15000,
            1000 *
              2 ** (attempt - 1)
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

function parseHtml(html, url) {
  const $ = cheerio.load(html);

  $("script,style,noscript,template,svg,canvas").remove();

  const title = cleanText(
    $("title")
      .first()
      .text() ||
      $("meta[property='og:title']")
        .attr("content") ||
      ""
  ).slice(0, 1000);

  const description = cleanText(
    $("meta[name='description']")
      .attr("content") ||
      $("meta[property='og:description']")
        .attr("content") ||
      ""
  ).slice(0, 2000);

  const canonicalRaw =
    $("link[rel='canonical']")
      .attr("href");

  const canonical =
    normalizeUrl(
      canonicalRaw,
      url
    ) || url;

  const content = cleanText(
    $("body").text()
  ).slice(0, MAX_CONTENT);

  const wordCount =
    content
      .split(/\s+/)
      .
```
