```javascript
// ============================================================
// HEXORA SEARCH ENGINE - CRAWLER
// Neon = Search Index + Queue
// R2   = Raw Crawl Storage
// Supabase = NO NEW CRAWL WRITES
// ============================================================

import crypto from "node:crypto";
import * as cheerio from "cheerio";
import pg from "pg";
import {
  S3Client,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

const { Pool } = pg;

// ============================================================
// CONFIG
// ============================================================

const USER_AGENT =
  process.env.HEXORA_USER_AGENT ||
  "HEXORA-Bot/1.0 (+https://hexorasearch.com/)";

const REQUEST_TIMEOUT =
  Number(process.env.CRAWL_TIMEOUT_MS || 15000);

const DOMAIN_DELAY =
  Number(process.env.CRAWL_DOMAIN_DELAY_MS || 1500);

const MAX_CONTENT =
  Number(process.env.CRAWL_MAX_CONTENT || 100000);

const MAX_LINKS =
  Number(process.env.CRAWL_MAX_LINKS || 100);

const BATCH_SIZE =
  Number(process.env.CRAWL_BATCH_SIZE || 12);

const CONCURRENCY =
  Number(process.env.CRAWL_CONCURRENCY || 2);

// ============================================================
// ENVIRONMENT
// ============================================================

const DATABASE_URL =
  process.env.DATABASE_URL;

const R2_ACCOUNT_ID =
  process.env.R2_ACCOUNT_ID;

const R2_ACCESS_KEY_ID =
  process.env.R2_ACCESS_KEY_ID;

const R2_SECRET_ACCESS_KEY =
  process.env.R2_SECRET_ACCESS_KEY;

const R2_BUCKET_NAME =
  process.env.R2_BUCKET_NAME;

// ============================================================
// VALIDATE ENV
// ============================================================

if (!DATABASE_URL) {
  throw new Error(
    "[HEXORA] DATABASE_URL is missing."
  );
}

if (
  !R2_ACCOUNT_ID ||
  !R2_ACCESS_KEY_ID ||
  !R2_SECRET_ACCESS_KEY ||
  !R2_BUCKET_NAME
) {
  throw new Error(
    "[HEXORA] R2 configuration is incomplete."
  );
}

// ============================================================
// NEON
// ============================================================

const neon = new Pool({
  connectionString: DATABASE_URL,

  ssl: {
    rejectUnauthorized: false,
  },

  max: 5,

  idleTimeoutMillis: 30000,

  connectionTimeoutMillis: 10000,
});

// ============================================================
// R2
// ============================================================

const r2 = new S3Client({
  region: "auto",

  endpoint:
    `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,

  credentials: {
    accessKeyId:
      R2_ACCESS_KEY_ID,

    secretAccessKey:
      R2_SECRET_ACCESS_KEY,
  },
});

// ============================================================
// SEEDS
// ============================================================

const SEED_URLS = [
  "https://en.wikipedia.org/wiki/Search_engine",
  "https://www.india.gov.in/",
  "https://assam.gov.in/",
  "https://python.org/",
  "https://www.w3.org/",
];

// ============================================================
// MEMORY
// ============================================================

const domainLastRequest = new Map();
const robotsCache = new Map();

// ============================================================
// HELPERS
// ============================================================

function sleep(ms) {
  return new Promise(
    resolve => setTimeout(resolve, ms)
  );
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

// ============================================================
// URL NORMALIZATION
// ============================================================

function normalizeUrl(input) {
  try {
    if (!input) return null;

    const url = new URL(String(input));

    if (
      url.protocol !== "http:" &&
      url.protocol !== "https:"
    ) {
      return null;
    }

    url.hash = "";
    url.username = "";
    url.password = "";

    let pathname =
      url.pathname || "/";

    pathname =
      pathname.replace(
        /\/{2,}/g,
        "/"
      );

    if (
      pathname.length > 1 &&
      pathname.endsWith("/")
    ) {
      pathname =
        pathname.slice(0, -1);
    }

    url.pathname = pathname;

    const trackingParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "gclid",
      "fbclid",
      "msclkid",
      "ref",
      "ref_src",
    ];

    for (
      const param of trackingParams
    ) {
      url.searchParams.delete(param);
    }

    return url.toString();

  } catch {
    return null;
  }
}

// ============================================================
// DOMAIN
// ============================================================

function getDomain(url) {
  try {
    return new URL(url)
      .hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return "";
  }
}

// ============================================================
// VALID CRAWL URL
// ============================================================

function isValidCrawlUrl(url) {
  try {
    const parsed = new URL(url);

    if (
      parsed.protocol !== "http:" &&
      parsed.protocol !== "https:"
    ) {
      return false;
    }

    const hostname =
      parsed.hostname.toLowerCase();

    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1"
    ) {
      return false;
    }

    const blockedExtensions = [
      ".jpg",
      ".jpeg",
      ".png",
      ".gif",
      ".webp",
      ".svg",
      ".ico",
      ".bmp",

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
      ".tar",
      ".gz",

      ".pdf",
      ".doc",
      ".docx",
      ".xls",
      ".xlsx",
      ".ppt",
      ".pptx",

      ".exe",
      ".apk",
      ".dmg",
      ".iso",
    ];

    const pathname =
      parsed.pathname.toLowerCase();

    if (
      blockedExtensions.some(
        extension =>
          pathname.endsWith(extension)
      )
    ) {
      return false;
    }

    return true;

  } catch {
    return false;
  }
}

// ============================================================
// LANGUAGE
// ============================================================

function detectLanguage(text) {
  const value =
    String(text || "");

  if (!value) {
    return "unknown";
  }

  if (/[\u0980-\u09FF]/.test(value)) {
    return "assamese/bengali";
  }

  if (/[\u0900-\u097F]/.test(value)) {
    return "hindi";
  }

  if (/[\u4E00-\u9FFF]/.test(value)) {
    return "chinese";
  }

  if (/[\u3040-\u30FF]/.test(value)) {
    return "japanese";
  }

  if (/[\uAC00-\uD7AF]/.test(value)) {
    return "korean";
  }

  if (/[A-Za-z]/.test(value)) {
    return "english";
  }

  return "unknown";
}

// ============================================================
// LINK EXTRACTION
// ============================================================

function extractLinks($, baseUrl) {
  const results = new Set();

  $("a[href]").each(
    (_, element) => {

      if (
        results.size >= MAX_LINKS
      ) {
        return;
      }

      const href =
        $(element).attr("href");

      if (!href) return;

      try {
        const absolute =
          normalizeUrl(
            new URL(
              href,
              baseUrl
            ).toString()
          );

        if (
          absolute &&
          isValidCrawlUrl(
            absolute
          )
        ) {
          results.add(absolute);
        }

      } catch {
        // Ignore invalid links.
      }
    }
  );

  return [...results];
}

// ============================================================
// HTML EXTRACTION
// ============================================================

function extractPage(
  html,
  pageUrl
) {
  const $ =
    cheerio.load(html);

  $(
    "script, style, noscript, iframe, svg, canvas, nav, footer, header, form"
  ).remove();

  const title =
    cleanText(
      $("title")
        .first()
        .text()
    );

  const description =
    cleanText(
      $('meta[name="description"]')
        .attr("content") ||

      $('meta[property="og:description"]')
        .attr("content") ||

      ""
    );

  let content =
    cleanText(
      $("main").text() ||

      $("article").text() ||

      $("body").text()
    );

  if (
    content.length >
    MAX_CONTENT
  ) {
    content =
      content.slice(
        0,
        MAX_CONTENT
      );
  }

  const language =
    detectLanguage(
      `${title} ${description} ${content}`
    );

  const canonicalRaw =
    $('link[rel="canonical"]')
      .attr("href");

  let canonical =
    pageUrl;

  if (canonicalRaw) {
    try {
      canonical =
        normalizeUrl(
          new URL(
            canonicalRaw,
            pageUrl
          ).toString()
        ) ||
```
