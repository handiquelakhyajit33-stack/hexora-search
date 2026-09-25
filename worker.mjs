import * as cheerio from "cheerio";

const USER_AGENT =
  process.env.HEXORA_USER_AGENT ||
  "HEXORA-Bot/1.0 (+search engine crawler)";

const REQUEST_TIMEOUT =
  Number(process.env.CRAWL_TIMEOUT_MS || 15000);

const DOMAIN_DELAY =
  Number(process.env.CRAWL_DOMAIN_DELAY_MS || 1500);

const MAX_CONTENT =
  Number(process.env.CRAWL_MAX_CONTENT || 100000);

const MAX_LINKS =
  Number(process.env.CRAWL_MAX_LINKS || 100);

const ALLOWED_SCHEMES =
  new Set(["http:", "https:"]);


/* =========================================
   URL NORMALIZATION
========================================= */

export function normalizeUrl(input, base = null) {
  try {
    const url =
      base
        ? new URL(input, base)
        : new URL(input);

    if (!ALLOWED_SCHEMES.has(url.protocol)) {
      return null;
    }

    url.hash = "";

    /*
     * Remove common tracking parameters.
     */

    const removeParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid",
      "mc_cid",
      "mc_eid"
    ];

    for (const param of removeParams) {
      url.searchParams.delete(param);
    }

    /*
     * Remove trailing slash except root.
     */

    if (
      url.pathname.length > 1 &&
      url.pathname.endsWith("/")
    ) {
      url.pathname =
        url.pathname.slice(0, -1);
    }

    /*
     * Lowercase hostname.
     */

    url.hostname =
      url.hostname.toLowerCase();

    return url.toString();

  } catch {
    return null;
  }
}


/* =========================================
   ROBOTS.TXT
========================================= */

const robotsCache =
  new Map();


async function canCrawl(url) {

  try {

    const target =
      new URL(url);

    const origin =
      target.origin;

    const cached =
      robotsCache.get(origin);

    if (cached && cached.expires > Date.now()) {
      return cached.allowed;
    }

    const robotsUrl =
      `${origin}/robots.txt`;

    const controller =
      new AbortController();

    const timer =
      setTimeout(
        () => controller.abort(),
        8000
      );

    let response;

    try {

      response =
        await fetch(
          robotsUrl,
          {
            headers: {
              "User-Agent":
                USER_AGENT
            },
            signal:
              controller.signal
          }
        );

    } finally {
      clearTimeout(timer);
    }

    /*
     * If robots.txt does not exist,
     * allow crawling.
     */

    if (!response.ok) {

      robotsCache.set(
        origin,
        {
          allowed: true,
          expires:
            Date.now() + 3600000
        }
      );

      return true;
    }

    const text =
      await response.text();

    const rules =
      parseRobots(text);

    const allowed =
      isPathAllowed(
        target.pathname,
        rules
      );

    robotsCache.set(
      origin,
      {
        allowed,
        expires:
          Date.now() + 3600000
      }
    );

    return allowed;

  } catch {

    /*
     * Network error:
     * do not aggressively crawl.
     */

    return false;
  }
}


function parseRobots(text) {

  const lines =
    text.split(/\r?\n/);

  let active = false;

  const disallow = [];
  const allow = [];

  for (const raw of lines) {

    const line =
      raw
        .split("#")[0]
        .trim();

    if (!line) continue;

    const separator =
      line.indexOf(":");

    if (separator === -1) continue;

    const key =
      line
        .slice(0, separator)
        .trim()
        .toLowerCase();

    const value =
      line
        .slice(separator + 1)
        .trim();

    if (key === "user-agent") {

      active =
        value === "*" ||
        value.toLowerCase() ===
          "hexora-bot";

      continue;
    }

    if (!active) continue;

    if (key === "disallow" && value) {
      disallow.push(value);
    }

    if (key === "allow" && value) {
      allow.push(value);
    }
  }

  return {
    disallow,
    allow
  };
}


function isPathAllowed(pathname, rules) {

  /*
   * Longest matching rule wins.
   */

  let bestMatch = null;
  let bestLength = -1;
  let bestAllow = true;

  for (const rule of rules.disallow) {

    if (pathname.startsWith(rule)) {

      if (rule.length > bestLength) {

        bestLength =
          rule.length;

        bestAllow = false;
      }
    }
  }

  for (const rule of rules.allow) {

    if (pathname.startsWith(rule)) {

      if (rule.length >= bestLength) {

        bestLength =
          rule.length;

        bestAllow = true;
      }
    }
  }

  return bestAllow;
}


/* =========================================
   FETCH PAGE
========================================= */

export async function fetchPage(url) {

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT
    );

  try {

    const response =
      await fetch(
        url,
        {
          redirect: "follow",
          headers: {
            "User-Agent":
              USER_AGENT,
            "Accept":
              "text/html,application/xhtml+xml",
            "Accept-Language":
              "en-US,en;q=0.8"
          },
          signal:
            controller.signal
        }
      );

    if (!response.ok) {

      return {
        ok: false,
        status:
          response.status,
        finalUrl:
          response.url
      };
    }

    const contentType =
      response.headers.get(
        "content-type"
      ) || "";

    /*
     * Only index HTML/XHTML.
     */

    if (
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml")
    ) {

      return {
        ok: false,
        status:
          response.status,
        finalUrl:
          response.url,
        reason:
          "not-html"
      };
    }

    const html =
      await response.text();

    return {
      ok: true,
      status:
        response.status,
      finalUrl:
        response.url,
      html
    };

  } catch (error) {

    return {
      ok: false,
      status: 0,
      finalUrl: url,
      reason:
        error?.name === "AbortError"
          ? "timeout"
          : String(
              error?.message || error
            )
    };

  } finally {

    clearTimeout(timer);
  }
}


/* =========================================
   PARSE HTML
========================================= */

export function parsePage(
  html,
  pageUrl
) {

  const $ =
    cheerio.load(
      html,
      {
        decodeEntities: true
      }
    );

  /*
   * Remove non-content elements.
   */

  $(
    "script,style,noscript,template,svg,canvas,iframe"
  ).remove();

  const title =
    $("title")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);

  const description =
    $('meta[name="description"]')
      .attr("content") ||
    $('meta[property="og:description"]')
      .attr("content") ||
    "";

  const canonical =
    $('link[rel="canonical"]')
      .attr("href");

  const finalCanonical =
    canonical
      ? normalizeUrl(
          canonical,
          pageUrl
        )
      : pageUrl;

  const lang =
    $("html")
      .attr("lang") ||
    detectLanguage(
      $("body").text()
    );

  const bodyText =
    $("body")
      .text()
      .replace(/\s+/g, " ")
      .trim();

  const content =
    bodyText.slice(
      0,
      MAX_CONTENT
    );

  /*
   * Extract links.
   */

  const links =
    new Set();

  $("a[href]").each(
    (_, element) => {

      if (
        links.size >= MAX_LINKS
      ) {
        return;
      }

      const href =
        $(element)
          .attr("href");

      const normalized =
        normalizeUrl(
          href,
          pageUrl
        );

      if (normalized) {
        links.add(normalized);
      }
    }
  );

  /*
   * Extract useful metadata.
   */

  const author =
    $('meta[name="author"]')
      .attr("content") ||
    "";

  const image =
    $('meta[property="og:image"]')
      .attr("content") ||
    "";

  const published =
    $('meta[property="article:published_time"]')
      .attr("content") ||
    $('meta[name="date"]')
      .attr("content") ||
    null;

  return {

    url:
      finalCanonical,

    title:
      title || finalCanonical,

    description:
      String(description)
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 1000),

    content,

    language:
      String(lang)
        .toLowerCase()
        .slice(0, 20),

    author:
      String(author)
        .slice(0, 300),

    image_url:
      image
        ? normalizeUrl(
            image,
            pageUrl
          )
        : null,

    published_at:
      published,

    links:
      [...links]
  };
}


/* =========================================
   LANGUAGE DETECTION
========================================= */

function detectLanguage(text) {

  const sample =
    String(text || "")
      .slice(0, 5000);

  if (/[\u0C00-\u0C7F]/.test(sample)) {
    return "as";
  }

  if (/[\u0900-\u097F]/.test(sample)) {
    return "hi";
  }

  if (/[\u0980-\u09FF]/.test(sample)) {
    return "bn";
  }

  if (/[\u4E00-\u9FFF]/.test(sample)) {
    return "zh";
  }

  if (/[\u3040-\u30FF]/.test(sample)) {
    return "ja";
  }

  if (/[\uAC00-\uD7AF]/.test(sample)) {
    return "ko";
  }

  if (/[\u0B80-\u0BFF]/.test(sample)) {
    return "ta";
  }

  if (/[\u0A80-\u0AFF]/.test(sample)) {
    return "gu";
  }

  if (/[\u0A00-\u0A7F]/.test(sample)) {
    return "pa";
  }

  return "en";
}


/* =========================================
   DOMAIN RATE LIMIT
========================================= */

const lastVisit =
  new Map();


async function respectDomainDelay(url) {

  try {

    const hostname =
      new URL(url).hostname;

    const previous =
      lastVisit.get(hostname) || 0;

    const wait =
      DOMAIN_DELAY -
      (Date.now() - previous);

    if (wait > 0) {

      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            wait
          )
      );
    }

    lastVisit.set(
      hostname,
      Date.now()
    );

  } catch {
    // ignore malformed URL
  }
}


/* =========================================
   CRAWL ONE URL
========================================= */

export async function crawlUrl(
  supabase,
  url
) {

  const normalized =
    normalizeUrl(url);

  if (!normalized) {

    return {
      ok: false,
      reason: "invalid-url"
    };
  }

  const allowed =
    await canCrawl(
      normalized
    );

  if (!allowed) {

    return {
      ok: false,
      reason:
        "robots-disallowed"
    };
  }

  await respectDomainDelay(
    normalized
  );

  const fetched =
    await fetchPage(
      normalized
    );

  if (!fetched.ok) {

    return {
      ok: false,
      reason:
        fetched.reason ||
        `HTTP ${fetched.status}`
    };
  }

  const parsed =
    parsePage(
      fetched.html,
      fetched.finalUrl
    );

  /*
   * Store page.
   */

  const record = {

    url:
      parsed.url,

    title:
      parsed.title,

    description:
      parsed.description,

    content:
      parsed.content,

    language:
      parsed.language,

    author:
      parsed.author,

    image_url:
      parsed.image_url,

    published_at:
      parsed.published_at,

    last_crawled_at:
      new Date().toISOString(),

    updated_at:
      new Date().toISOString()
  };

  const { error } =
    await supabase
      .from("pages")
      .upsert(
        record,
        {
          onConflict: "url"
        }
      );

  if (error) {

    throw error;
  }

  /*
   * Add discovered links to crawl queue.
   */

  if (
    parsed.links.length
  ) {

    const queueRows =
      parsed.links.map(
        link => ({
          url: link,
          status: "pending",
          discovered_from:
            parsed.url,
          priority:
            calculatePriority(
              link,
              parsed.url
            )
        })
      );

    /*
     * Insert in chunks.
     */

    for (
      let i = 0;
      i < queueRows.length;
      i += 100
    ) {

      const chunk =
        queueRows.slice(
          i,
          i + 100
        );

      const result =
        await supabase
          .from("crawl_queue")
          .upsert(
            chunk,
            {
              onConflict: "url",
              ignoreDuplicates: true
            }
          );

      if (result.error) {
        console.error(
          "Queue insert:",
          result.error.message
        );
      }
    }
  }

  return {

    ok: true,

    url:
      parsed.url,

    title:
      parsed.title,

    links:
      parsed.links.length,

    language:
      parsed.language
  };
}


/* =========================================
   PRIORITY
========================================= */

function calculatePriority(
  url,
  sourceUrl
) {

  let priority = 1;

  try {

    const target =
      new URL(url);

    const source =
      new URL(sourceUrl);

    /*
     * Same-domain pages get normal priority.
     */

    if (
      target.hostname ===
      source.hostname
    ) {
      priority += 2;
    }

    /*
     * Important public domains.
     */

    if (
      target.hostname.endsWith(".gov") ||
      target.hostname.includes(".gov.") ||
      target.hostname.endsWith(".edu") ||
      target.hostname.includes(".edu.")
    ) {
      priority += 3;
    }

    /*
     * HTTPS.
     */

    if (
      target.protocol === "https:"
    ) {
      priority += 1;
    }

  } catch {
    // keep default
  }

  return priority;
}


/* =========================================
   CRAWL BATCH
========================================= */

export async function crawlBatch(
  supabase,
  batchSize = 10
) {

  const { data, error } =
    await supabase
      .from("crawl_queue")
      .select(
        "id,url,priority,status"
      )
      .eq(
        "status",
        "pending"
      )
      .order(
        "priority",
        {
          ascending: false
        }
      )
      .order(
        "id",
        {
          ascending: true
        }
      )
      .limit(batchSize);

  if (error) {
    throw error;
  }

  const jobs =
    data || [];

  let success = 0;
  let failed = 0;

  for (const job of jobs) {

    /*
     * Mark as processing.
     */

    await supabase
      .from("crawl_queue")
      .update({
        status:
          "processing",
        started_at:
          new Date().toISOString()
      })
      .eq(
        "id",
        job.id
      );

    try {

      const result =
        await crawlUrl(
          supabase,
          job.url
        );

      if (result.ok) {

        success++;

        await supabase
          .from("crawl_queue")
          .update({
            status:
              "done",
            finished_at:
              new Date().toISOString(),
            error:
              null
          })
          .eq(
            "id",
            job.id
          );

      } else {

        failed++;

        await supabase
          .from("crawl_queue")
          .update({
            status:
              "failed",
            finished_at:
              new Date().toISOString(),
            error:
              result.reason
          })
          .eq(
            "id",
            job.id
          );
      }

    } catch (error) {

      failed++;

      console.error(
        "Crawler error:",
        job.url,
        error
      );

      await supabase
        .from("crawl_queue")
        .update({
          status:
            "failed",
          finished_at:
            new Date().toISOString(),
          error:
            String(
              error?.message ||
              error
            ).slice(0, 1000)
        })
        .eq(
          "id",
          job.id
        );
    }
  }

  return {

    requested:
      jobs.length,

    success,

    failed
  };
}
