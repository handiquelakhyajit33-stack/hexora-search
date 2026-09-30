```javascript
// ============================================================
// HEXORA SEARCH ENGINE - CRAWLER
// Neon PostgreSQL + Cloudflare R2
// Supabase is NOT used by the crawler
// ============================================================

import crypto from "crypto";
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

const DATABASE_URL = process.env.DATABASE_URL || "";

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "";
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";
const R2_SECRET_ACCESS_KEY =
  process.env.R2_SECRET_ACCESS_KEY || "";
const R2_BUCKET_NAME =
  process.env.R2_BUCKET_NAME || "hexoraase";

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

const DEFAULT_BATCH =
  Number(process.env.CRAWLER_BATCH_SIZE || 12);

// ============================================================
// SEED URLS
// ============================================================

const SEED_URLS = [
  "https://en.wikipedia.org/wiki/Search_engine",
  "https://www.india.gov.in/",
  "https://assam.gov.in/",
  "https://www.python.org/",
  "https://www.w3.org/",
];

// ============================================================
// NEON
// ============================================================

if (!DATABASE_URL) {
  console.error(
    "[HEXORA] DATABASE_URL is missing"
  );
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// ============================================================
// R2
// ============================================================

let r2 = null;

if (
  R2_ACCOUNT_ID &&
  R2_ACCESS_KEY_ID &&
  R2_SECRET_ACCESS_KEY &&
  R2_BUCKET_NAME
) {
  r2 = new S3Client({
    region: "auto",
    endpoint:
      "https://" +
      R2_ACCOUNT_ID +
      ".r2.cloudflarestorage.com",
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });

  console.log(
    "[HEXORA] R2 configured | bucket=" +
      R2_BUCKET_NAME
  );
} else {
  console.warn(
    "[HEXORA] R2 variables are incomplete"
  );
}

// ============================================================
// MEMORY
// ============================================================

const domainLastRequest = new Map();
const robotsCache = new Map();

// ============================================================
// BASIC HELPERS
// ============================================================

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(String(value))
    .digest("hex");
}

function normalizeUrl(input) {
  try {
    const url = new URL(input);

    url.hash = "";

    url.hostname = url.hostname.toLowerCase();

    if (
      (url.protocol === "https:" && url.port === "443") ||
      (url.protocol === "http:" && url.port === "80")
    ) {
      url.port = "";
    }

    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }

    return url.toString();
  } catch {
    return null;
  }
}

function getDomain(input) {
  try {
    return new URL(input).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isValidHttpUrl(input) {
  try {
    const url = new URL(input);

    if (
      url.protocol !== "http:" &&
      url.protocol !== "https:"
    ) {
      return false;
    }

    if (!url.hostname) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function detectLanguage(text) {
  const value = String(text || "");

  if (/[\u0980-\u09FF]/.test(value)) {
    return "bn";
  }

  if (/[\u0A00-\u0A7F]/.test(value)) {
    return "pa";
  }

  if (/[\u0900-\u097F]/.test(value)) {
    return "hi";
  }

  if (/[\u0B80-\u0BFF]/.test(value)) {
    return "ta";
  }

  if (/[\u0C00-\u0C7F]/.test(value)) {
    return "te";
  }

  if (/[\u0C80-\u0CFF]/.test(value)) {
    return "kn";
  }

  if (/[\u0D00-\u0D7F]/.test(value)) {
    return "ml";
  }

  if (/[\u0A80-\u0AFF]/.test(value)) {
    return "gu";
  }

  if (/[\u0B00-\u0B7F]/.test(value)) {
    return "or";
  }

  if (/[\u0D80-\u0DFF]/.test(value)) {
    return "si";
  }

  return "en";
}

// ============================================================
// ROBOTS.TXT
// ============================================================

async function getRobots(domain) {
  if (robotsCache.has(domain)) {
    return robotsCache.get(domain);
  }

  const robotsUrl = "https://" + domain + "/robots.txt";

  try {
    const controller = new AbortController();

    const timer = setTimeout(function () {
      controller.abort();
    }, 10000);

    const response = await fetch(robotsUrl, {
      method: "GET",
      headers: {
        "user-agent": USER_AGENT,
      },
      signal: controller.signal,
      redirect: "follow",
    });

    clearTimeout(timer);

    if (!response.ok) {
      const result = {
        available: false,
        text: "",
      };

      robotsCache.set(domain, result);
      return result;
    }

    const text = await response.text();

    const result = {
      available: true,
      text: text,
    };

    robotsCache.set(domain, result);

    return result;
  } c
```
