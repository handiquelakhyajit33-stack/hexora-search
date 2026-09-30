```javascript
// ============================================================
// HEXORA SEARCH ENGINE - CRAWLER
// Neon PostgreSQL + Cloudflare R2
// Supabase is NOT used by crawler
// ============================================================

import crypto from "crypto";
import * as cheerio from "cheerio";
import pg from "pg";
import {
  S3Client,
  PutObjectCommand
} from "@aws-sdk/client-s3";

const { Pool } = pg;

// ============================================================
// CONFIG
// ============================================================

const DATABASE_URL = process.env.DATABASE_URL || "";

const R2_ACCOUNT_ID =
  process.env.R2_ACCOUNT_ID || "";

const R2_ACCESS_KEY_ID =
  process.env.R2_ACCESS_KEY_ID || "";

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
// SEEDS
// ============================================================

const SEED_URLS = [
  "https://en.wikipedia.org/wiki/Search_engine",
  "https://www.india.gov.in/",
  "https://assam.gov.in/",
  "https://www.python.org/",
  "https://www.w3.org/"
];

// ============================================================
// NEON
// ============================================================

if (!DATABASE_URL) {
  console.error(
    "[HEXORA] ERROR: DATABASE_URL is missing"
  );
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
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
      secretAccessKey: R2_SECRET_ACCESS_KEY
    }
  });

  console.log(
    "[HEXORA] R2 configured | bucket=" +
      R2_BUCKET_NAME
  );
} else {
  console.warn(
    "[HEXORA] R2 variables incomplete"
  );
}

// ============================================================
// MEMORY
// ============================================================

const domainLastRequest = new Map();
const robotsCache = new Map();

// ============================================================
// HELPERS
// ============================================================

function sleep(ms) {
  return new Promise(function(resolve) {
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
    url.hostname =
      url.hostname.toLowerCase();

    if (
      (url.protocol === "https:" &&
        url.port === "443") ||
      (url.protocol === "http:" &&
        url.port === "80")
    ) {
      url.port = "";
    }

    if (url.pathname.length > 1) {
      url.pathname =
        url.pathname.replace(/\/+$/, "");
    }

    return url.toString();
  } catch {
    return null;
  }
}

function getDomain(input) {
  try {
    return new URL(input)
      .hostname
      .toLowerCase();
  } catch {
    return "";
  }
}

function isValidHttpUrl(input) {
  try {
    const url = new URL(input);

    return (
      url.protocol === "http:" ||
      url.protocol === "https:"
    );
  } catch {
    return false;
  }
}

function detectLanguage(text) {
  const value = String(text || "");

  if (/[\u0B00-\u0B7F]/.test(value)) {
    return "as";
  }

  if (/[\u0900-\u097F]/.test(value)) {
    return "hi";
  }

  if (/[\u0980-\u09FF]/.test(value)) {
    return "bn";
  }

  if (/[\u0A00-\u0A7F]/.test(value)) {
    return "pa";
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

  return "en";
}

// ============================================================
// ROBOTS
// ============================================================

async function getRobots(domain) {
  if (robotsCache.has(domain)) {
    return robotsCache.get(domain);
  }

  const robotsUrl =
    "https://" + domain + "/robots.txt";

  try {
    const controller =
      new AbortController();

    const timer = setTimeout(
      function() {
        controller.abort();
      },
      10000
    );

    const response = await fetch(
      robotsUrl,
      {
        method: "GET",
        headers: {
          "user-agent": USER_AGENT
        },
        signal: controller.signal,
        redirect: "follow"
      }
    );

    clearTimeout(timer);

    if (!response.ok) {
      const result = {
        available: false,
        text: ""
      };

      robotsCache.set(
        domain,
        result
      );

      return result;
    }

    const text =
      await response.text();

    const result = {
      available: true,
      text: text
    };

    robotsCache.set(
      domain,
      result
    );

    return result;
  } catch {
    const result = {
      available: false,
      text: ""
    };

    robotsCache.set(
      domain,
      result
    );

    return result;
  }
}

function robotsAllows(
  robotsText,
  targetUrl
) {
  if (!robotsText) {
    return true;
  }

  let pathname = "/";

  try {
    pathname =
      new URL(targetUrl).pathname || "/";
  } catch {
    return true;
  }

  const lines =
    robotsText.split(/\r?\n/);

  let applies = false;

  for (let i = 0; i < lines.length; i++) {
    const line =
      lines[i].trim();

    if (!line || line.startsWith("#")) {
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
      applies =
        value === "*" ||
        value
          .toLowerCase()
          .includes("hexora");

      continue;
    }

    if (
      applies &&
      key === "disallow" &&
      value &&
      pathname.startsWith(value)
    ) {
      return false;
    }
  }

  return true;
}

async function allowedByRobots(url) {
  const domain =
    getDomain(url);

  if (!domain) {
    return false;
  }

  const robots =
    await getRobots(domain);

  if (!robots.available) {
    return true;
  }

  return robotsAllows(
    robots.text,
    url
  );
}

// ============================================================
// DOMAIN DELAY
// ============================================================

async function respectDomainDelay(url) {
  const domain =
    getDomain(url);

  if (!domain) {
    return;
  }

  const now = Date.now();

  const previous =
    domainLastRequest.get(domain) || 0;

  const wait =
    DOMAIN_DELAY -
    (now - previous);

  if (wait > 0) {
    await sleep(wait);
  }

  domainLastRequest.set(
    domain,
    Date.now()
  );
}

// ============================================================
// FETCH
// ============================================================

async function fetchPage(url) {
  await respectDomainDelay(url);

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      function() {
        controller.abort();
      },
      REQUEST_TIMEOUT
    );

  try {
    const response =
      await fetch(
        url,
        {
          method: "GET",
          headers: {
            "user-agent": USER_AGENT,
            accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
          },
          signal:
            controller.signal,
          redirect: "follow"
        }
      );

    clearTimeout(timer);

    const contentType =
      response.headers.get(
        "content-type"
      ) || "";

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        finalUrl: url,
        html: "",
        contentType: contentType
      };
    }

    if (
      !contentType.includes(
        "text/html"
      ) &&
      !contentType.includes(
        "application/xhtml+xml"
      )
    ) {
      return {
        ok: false,
        status: response.status,
        finalUrl: url,
        html: "",
        contentType: contentType
      };
    }

    const html =
      await response.text();

    return {
      ok: true,
      status: response.status,
      finalUrl:
        response.url || url,
      html: html,
      contentType: contentType
    };
  } catch (error) {
    clearTimeout(timer);

    return {
      ok: false,
      status: 0,
      finalUrl: url,
      html: "",
      contentType: "",
      error:
        error?.message ||
        String(error)
    };
  }
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
    "script,style,noscript,iframe,svg,canvas,form"
  ).remove();

  const title =
    $("title")
      .first()
      .text()
      .trim() ||
    $("h1")
      .first()
      .text()
      .trim() ||
    "";

  let description =
    $('meta[name="description"]')
      .attr("content") ||
    "";

  if (!description) {
    description =
      $(
        'meta[property="og:description"]'
      ).attr("content") || "";
  }

  const bodyText =
    $("body")
      .text(" ")
      .replace(/\s+/g, " ")
      .trim();

  const content =
    bodyText.slice(
      0,
      MAX_CONTENT
    );

  const links = [];

  $("a[href]").each(
    function() {
      if (
        links.length >=
        MAX_LINKS
      ) {
        return;
      }
```
