// ============================================================
// HEXORA SEARCH ENGINE - CRAWLER
// Neon PostgreSQL + Cloudflare R2
// ============================================================

import crypto from "crypto";
import * as cheerio from "cheerio";
import pg from "pg";
import { putHtml } from "./storage.mjs";

const { Pool } = pg;

// ============================================================
// CONFIG
// ============================================================

const DATABASE_URL = process.env.DATABASE_URL || "";

const USER_AGENT =
  process.env.HEXORA_USER_AGENT ||
  "HEXORA-Bot/1.0 (+https://hexorasearch.com/crawler)";

const REQUEST_TIMEOUT =
  Number(process.env.CRAWL_TIMEOUT_MS || 15000);

const MAX_CONTENT =
  Number(process.env.CRAWL_MAX_CONTENT || 120000);

const MAX_LINKS =
  Number(process.env.CRAWL_MAX_LINKS || 120);

const DOMAIN_DELAY =
  Number(process.env.CRAWL_DOMAIN_DELAY_MS || 1000);

const MAX_REDIRECTS = 5;

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: DATABASE_URL
    ? { rejectUnauthorized: false }
    : undefined,
});

// ============================================================
// HELPERS
// ============================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""), "utf8")
    .digest("hex");
}

function normalizeUrl(input, baseUrl = null) {
  try {
    const url = baseUrl
      ? new URL(input, baseUrl)
      : new URL(input);

    if (!["http:", "https:"].includes(url.protocol)) {
      return null;
    }

    url.hash = "";

    // Remove common tracking parameters.
    const removeParams = [
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

    for (const param of removeParams) {
      url.searchParams.delete(param);
    }

    return url.toString();
  } catch {
    return null;
  }
}

function isValidCrawlUrl(url) {
  try {
    const u = new URL(url);

    if (!["http:", "https:"].includes(u.protocol)) {
      return false;
    }

    const host = u.hostname.toLowerCase();

    if (!host || host.length < 3) {
      return false;
    }

    // Skip obvious non-web resources.
    const blockedExtensions = [
      ".jpg",
      ".jpeg",
      ".png",
      ".gif",
      ".webp",
      ".svg",
      ".ico",
      ".mp3",
      ".wav",
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
    ];

    const pathname = u.pathname.toLowerCase();

    if (
      blockedExtensions.some((ext) =>
        pathname.endsWith(ext)
      )
    ) {
      return false;
    }

    // Skip login/auth/action URLs.
    const blockedParts = [
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
      blockedParts.some((part) =>
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

function getDomain(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function detectLanguage(text) {
  const value = String(text || "");

  if (!value.trim()) {
    return "unknown";
  }

  // Assamese / Bengali Unicode range.
  const assameseBengali =
    (value.match(/[\u0980-\u09FF]/g) || []).length;

  // Devanagari.
  const devanagari =
    (value.match(/[\u0900-\u097F]/g) || []).length;

  // Arabic.
  const arabic =
    (value.match(/[\u0600-\u06FF]/g) || []).length;

  // CJK.
  const cjk =
    (value.match(/[\u4E00-\u9FFF]/g) || []).length;

  const latin =
    (value.match(/[A-Za-z]/g) || []).length;

  const total =
    assameseBengali +
    devanagari +
    arabic +
    cjk +
    latin;

  if (!total) {
    return "unknown";
  }

  if (assameseBengali / total > 0.20) {
    return "as";
  }

  if (devanagari / total > 0.20) {
    return "hi";
  }

  if (arabic / total > 0.20) {
    return "ar";
  }

  if (cjk / total > 0.20) {
    return "zh";
  }

  if (latin / total > 0.50) {
    return "en";
  }

  return "unknown";
}

function cleanText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/\u00a0/g, " ")
    .trim();
}

function getText($) {
  $("script, style, noscript, template, svg").remove();

  return cleanText(
    $("body").text()
  );
}

function getDescription($) {
  const description =
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") ||
    "";

  return cleanText(description).slice(0, 2000);
}

function getTitle($) {
  const title =
    $("title").first().text() ||
    $('meta[property="og:title"]').attr("content") ||
    "";

  return cleanText(title).slice(0, 1000);
}

function getCanonical($, currentUrl) {
  const canonical =
    $('link[rel="canonical"]').attr("href");

  if (!canonical) {
    return currentUrl;
  }

  return (
    normalizeUrl(canonical, currentUrl) ||
    currentUrl
  );
}

function calculateQuality({
  title,
  description,
  content,
  wordCount,
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
  if (content.length >= 10000) score += 5;

  return Math.min(100, score);
}

// ============================================================
// ROBOTS.TXT
// ============================================================

const robotsCache = new Map();

async function fetchRobots(domain) {
  const cached = robotsCache.get(domain);

  if (
    cached &&
    Date.now() - cached.timestamp < 15 * 60 * 1000
  ) {
    return cached;
  }

  const robotsUrl = `https://${domain}/robots.txt`;

  try {
    const controller = new AbortController();

    const timer = setTimeout(
      () => controller.abort(),
      10000
    );

    const response = await fetch(
      robotsUrl,
      {
        method: "GET",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/plain,*/*",
        },
        redirect: "follow",
        signal: controller.signal,
      }
    );

    clearTimeout(timer);

    if (!response.ok) {
      const result = {
        allowAll: true,
        rules: [],
        timestamp: Date.now(),
      };

      robotsCache.set(domain, result);

      return result;
    }

    const text = await response.text();

    const rules = [];

    let active = false;

    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine
        .split("#")[0]
        .trim();

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
        active =
          value === "*" ||
          value.toLowerCase() === "hexora-bot";
      }

      if (
        active &&
        key === "disallow" &&
        value
      ) {
        rules.push({
          type: "disallow",
          path: value,
        });
      }

      if (
        active &&
        key === "allow" &&
        value
      ) {
        rules.push({
          type: "allow",
          path: value,
        });
      }
    }

    const result = {
      allowAll: rules.length === 0,
      rules,
      timestamp: Date.now(),
    };

    robotsCache.set(domain, result);

    return result;
  } catch {
    // If robots.txt cannot be reached, do not
    // unnecessarily kill the entire crawler.
    const result = {
      allowAll: true,
      rules: [],
      timestamp: Date.now(),
    };

    robotsCache.set(domain, result);

    return result;
  }
}

function isAllowedByRobots(url, robots) {
  if (!robots || robots.allowAll) {
    return true;
  }

  try {
    const pathname =
      new URL(url).pathname || "/";

    let allowed = true;
    let bestLength = -1;

    for (const rule of robots.rules) {
      const rulePath = rule.path || "";

      if (!pathname.startsWith(rulePath)) {
        continue;
      }

      if (rulePath.length < bestLength) {
        continue;
      }

      bestLength = rulePath.length;

      if (rule.type === "disallow") {
        allowed = false;
      }

      if (rule.type === "allow") {
        allowed = true;
      }
    }

    return allowed;
  } catch {
    return true;
  }
}

// ============================================================
// FETCH HTML
// ============================================================

async function fetchHtml(url) {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT
  );

  try {
    const response = await fetch(
      url,
      {
        method: "GET",

        headers: {
          "User-Agent": USER_AGENT,
          Accept:
            "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          "Accept-Language":
            "en-US,en;q=0.8,as;q=0.7,hi;q=0.6",
        },

        redirect: "follow",

        signal: controller.signal,
      }
    );

    const finalUrl =
      normalizeUrl(
        response.url || url
      ) || url;

    const status = response.status;

    if (!response.ok) {
      return {
        ok: false,
        status,
        finalUrl,
        error: `HTTP ${status}`,
      };
    }

    const contentType =
      response.headers.get("content-type") || "";

    if (
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml")
    ) {
      return {
        ok: false,
        status,
        finalUrl,
        error: `Not HTML: ${contentType}`,
      };
    }

    const html =
      await response.text();

    if (!html || html.length < 100) {
      return {
        ok: false,
        status,
        finalUrl,
        error: "Empty or very small HTML",
      };
    }

    return {
      ok: true,
      status,
      finalUrl,
      html,
      contentType,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      finalUrl: url,
      error:
        error?.name === "AbortError"
          ? "Request timeout"
          : error?.message || String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// PARSE HTML
// ============================================================

function parseHtml(html, url) {
  const $ = cheerio.load(html);

  const title = getTitle($);

  const description =
    getDescription($);

  const canonical =
    getCanonical($, url);

  const content =
    getText($).slice(0, MAX_CONTENT);

  const wordCount =
    content
      .split(/\s+/)
      .filter(Boolean)
      .length;

  const language =
    detectLanguage(
      `${title} ${description} ${content}`
    );

  const qualityScore =
    calculateQuality({
      title,
      description,
      content,
      wordCount,
    });

  const links = [];

  $("a[href]").each(
    (_, element) => {
      if (links.length >= MAX_LINKS) {
        return;
      }

      const href =
        $(element).attr("href");

      if (!href) return;

      const normalized =
        normalizeUrl(
          href,
          canonical
        );

      if (!normalized) return;

      if (
        !isValidCrawlUrl(normalized)
      ) {
        return;
      }

      links.push(normalized);
    }
  );

  return {
    title,
    description,
    canonical,
    content,
    wordCount,
    language,
    qualityScore,
    links: [...new Set(links)],
  };
}

// ============================================================
// DATABASE HELPERS
// ============================================================

async function pageExists(url) {
  const result = await pool.query(
    `
    SELECT id
    FROM pages
    WHERE url = $1
    LIMIT 1
    `,
    [url]
  );

  return result.rowCount > 0;
}

async function savePage({
  url,
  finalUrl,
  title,
  description,
  content,
  contentHash,
  wordCount,
  language,
  qualityScore,
  r2Key,
}) {
  const result = await pool.query(
    `
    INSERT INTO pages (
      url,
      title,
      description,
      content,
      content_hash,
      word_count,
      language,
      r2_key,
      quality_score,
      updated_at
    )
    VALUES (
      $1,
      $2,
      $3,
      $4,
      $5,
      $6,
      $7,
      $8,
      $9,
      NOW()
    )

    ON CONFLICT (url)
    DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      content = EXCLUDED.content,
      content_hash = EXCLUDED.content_hash,
      word_count = EXCLUDED.word_count,
      language = EXCLUDED.language,
      r2_key = EXCLUDED.r2_key,
      quality_score = EXCLUDED.quality_score,
      updated_at = NOW()

    RETURNING id
    `,
    [
      finalUrl || url,
      title,
      description,
      content,
      contentHash,
      wordCount,
      language,
      r2Key,
      qualityScore,
    ]
  );

  return result.rows[0]?.id || null;
}

async function queueDiscoveredLinks(
  links,
  sourceUrl
) {
  if (!links.length) {
    return;
  }

  for (const link of links) {
    try {
      await pool.query(
        `
        INSERT INTO crawl_queue (
          url,
          status,
          created_at
        )
        VALUES (
          $1,
          'queued',
          NOW()
        )
        ON CONFLICT (url)
        DO NOTHING
        `,
        [link]
      );
    } catch (error) {
      console.warn(
        "[HEXORA] queue link failed:",
        link,
        error?.message || error
      );
    }
  }

  // Store link relationships if table exists.
  for (const link of links.slice(0, 50)) {
    try {
      await pool.query(
        `
        INSERT INTO page_links (
          source_url,
          target_url
        )
        VALUES (
          $1,
          $2
        )
        ON CONFLICT DO NOTHING
        `,
        [sourceUrl, link]
      );
    } catch {
      // page_links is optional for crawler survival.
    }
  }
}

async function markQueueDone(
  jobId
) {
  if (!jobId) return;

  await pool.query(
    `
    UPDATE crawl_queue
    SET
      status = 'done',
      last_crawled_at = NOW(),
      last_error = NULL
    WHERE id = $1
    `,
    [jobId]
  );
}

async function markQueueFailed(
  jobId,
  error
) {
  if (!jobId) return;

  await pool.query(
    `
    UPDATE crawl_queue
    SET
      status = 'failed',
      last_crawled_at = NOW(),
      last_error = $2
    WHERE id = $1
    `,
    [
      jobId,
      String(error || "Unknown error").slice(
        0,
        2000
      ),
    ]
  );
}

// ============================================================
// SINGLE URL CRAWL
// ============================================================

export async function crawlUrl(
  job
) {
  const jobId =
    job?.id ?? null;

  const originalUrl =
    job?.url || job;

  const url =
    normalizeUrl(originalUrl);

  if (!url) {
    if (jobId) {
      await markQueueFailed(
        jobId,
        "Invalid URL"
      );
    }

    return {
      ok: false,
      url: originalUrl,
      error: "Invalid URL",
    };
  }

  if (!isValidCrawlUrl(url)) {
    if (jobId) {
      await markQueueFailed(
        jobId,
        "URL blocked by crawler rules"
      );
    }

    return {
      ok: false,
      url,
      error: "URL blocked",
    };
  }

  const domain =
    getDomain(url);

  // ----------------------------------------------------------
  // ROBOTS
  // ----------------------------------------------------------

  const robots =
    await fetchRobots(domain);

  if (
    !isAllowedByRobots(
      url,
      robots
    )
  ) {
    if (jobId) {
      await pool.query(
        `
        UPDATE crawl_queue
        SET
          status = 'blocked',
          last_crawled_at = NOW(),
          last_error = $2
        WHERE id = $1
        `,
        [
          jobId,
          "Blocked by robots.txt",
        ]
      );
    }

    return {
      ok: false,
      blocked: true,
      url,
      error: "Blocked by robots.txt",
    };
  }

  // ----------------------------------------------------------
  // DUPLICATE CHECK
  // ----------------------------------------------------------

  try {
    const exists =
      await pageExists(url);

    if (exists) {
      if (jobId) {
        await markQueueDone(
          jobId
        );
      }

      return {
        ok: true,
        duplicate: true,
        url,
      };
    }
  } catch (error) {
    console.error(
      "[HEXORA] Neon duplicate check failed:",
      error?.message || error
    );

    if (jobId) {
      await markQueueFailed(
        jobId,
        `Database duplicate check failed: ${
          error?.message || error
        }`
      );
    }

    // IMPORTANT:
    // If Neon duplicate check fails, do NOT crawl/save.
    return {
      ok: false,
      url,
      error:
        "Database duplicate check failed",
    };
  }

  // ----------------------------------------------------------
  // FETCH
  // ----------------------------------------------------------

  const fetched =
    await fetchHtml(url);

  if (!fetched.ok) {
    if (jobId) {
      await markQueueFailed(
        jobId,
        fetched.error
      );
    }

    return {
      ok: false,
      url,
      status: fetched.status,
      error: fetched.error,
    };
  }

  const finalUrl =
    fetched.finalUrl || url;

  // ----------------------------------------------------------
  // PARSE
  // ----------------------------------------------------------

  const parsed =
    parseHtml(
      fetched.html,
      finalUrl
    );

  if (!parsed.content) {
    if (jobId) {
      await markQueueFailed(
        jobId,
        "No readable page content"
      );
    }

    return {
      ok: false,
      url,
      error:
        "No readable page content",
    };
  }

  const contentHash =
    sha256(
      fetched.html
    );

  // ----------------------------------------------------------
  // SAVE FULL HTML TO R2
  // ----------------------------------------------------------

  let r2;

  try {
    r2 =
      await putHtml({
        url: finalUrl,
        html: fetched.html,
        contentHash,
      });
  } catch (error) {
    console.error(
      "[HEXORA] R2 upload failed:",
      finalUrl,
      error?.message || error
    );

    if (jobId) {
      await markQueueFailed(
        jobId,
        `R2 upload failed: ${
          error?.message || error
        }`
      );
    }

    return {
      ok: false,
      url: finalUrl,
      error:
        "R2 upload failed",
    };
  }

  // ----------------------------------------------------------
  // SAVE METADATA + SEARCH CONTENT TO NEON
  // ----------------------------------------------------------

  try {
    const pageId =
      await savePage({
        url,
        finalUrl,
        title: parsed.title,
        description:
          parsed.description,
        content: parsed.content,
        contentHash,
        wordCount:
          parsed.wordCount,
        language:
          parsed.language,
        qualityScore:
          parsed.qualityScore,
        r2Key: r2.key,
      });

    // --------------------------------------------------------
    // DISCOVER LINKS
    // --------------------------------------------------------

    await queueDiscoveredLinks(
      parsed.links,
      finalUrl
    );

    // --------------------------------------------------------
    // MARK QUEUE JOB DONE
    // --------------------------------------------------------

    if (jobId) {
      await markQueueDone(
        jobId
      );
    }

    return {
      ok: true,
      pageId,
      url,
      finalUrl,
      title: parsed.title,
      language: parsed.language,
      wordCount: parsed.wordCount,
      links: parsed.links.length,
      r2Key: r2.key,
    };
  } catch (error) {
    console.error(
      "[HEXORA] Neon page save failed:",
      finalUrl,
      error?.message || error
    );

    if (jobId) {
      await markQueueFailed(
        jobId,
        `Neon save failed: ${
          error?.message || error
        }`
      );
    }

    return {
      ok: false,
      url: finalUrl,
      error:
        "Neon page save failed",
    };
  }
}

// ============================================================
// CRAWL BATCH
// IMPORTANT: worker/worker.mjs imports this function.
// ============================================================

export async function crawlBatch(
  jobs = []
) {
  if (!Array.isArray(jobs)) {
    jobs = [];
  }

  const results = [];

  for (const job of jobs) {
    try {
      const result =
        await crawlUrl(job);

      results.push(result);

      // Respect a small delay between domains/requests.
      await sleep(DOMAIN_DELAY);
    } catch (error) {
      console.error(
        "[HEXORA] Crawl failed:",
        job?.url || job,
        error?.message || error
      );

      if (job?.id) {
        try {
          await markQueueFailed(
            job.id,
            error?.message ||
              String(error)
          );
        } catch {}
      }

      results.push({
        ok: false,
        url: job?.url || String(job),
        error:
          error?.message ||
          String(error),
      });
    }
  }

  const successful =
    results.filter(
      (r) => r.ok
    ).length;

  const failed =
    results.length - successful;

  console.log(
    `[HEXORA] Batch complete: total=${results.length} successful=${successful} failed=${failed}`
  );

  return {
    total: results.length,
    successful,
    failed,
    results,
  };
}

// ============================================================
// HEALTH CHECK
// ============================================================

export async function checkCrawlerDatabase() {
  try {
    const result =
      await pool.query(
        "SELECT NOW() AS now"
      );

    return {
      connected: true,
      now: result.rows[0]?.now || null,
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

// ============================================================
// SHUTDOWN
// ============================================================

export async function closeCrawlerDatabase() {
  await pool.end();
}
