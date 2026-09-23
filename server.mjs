import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";
import crypto from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

const USER_AGENT = "HEXORA-Bot/1.0";

const TIMEOUT_MS = Number(process.env.CRAWL_TIMEOUT_MS || 15000);
const BATCH_SIZE = Number(process.env.CRAWL_BATCH_SIZE || 10);
const CONCURRENCY = Number(process.env.CRAWL_CONCURRENCY || 2);

function cleanText(text = "") {
  return text
    .replace(/\s+/g, " ")
    .replace(/\u00a0/g, " ")
    .trim();
}

function hashContent(text = "") {
  return crypto
    .createHash("sha256")
    .update(text)
    .digest("hex");
}

function normalizeUrl(url, baseUrl) {
  try {
    const parsed = new URL(url, baseUrl);

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }

    parsed.hash = "";

    return parsed.toString();
  } catch {
    return null;
  }
}

function extractPage(html, pageUrl) {
  const $ = cheerio.load(html);

  $("script, style, noscript, iframe, svg").remove();

  const title = cleanText(
    $("title").first().text()
  );

  const description = cleanText(
    $('meta[name="description"]').attr("content") || ""
  );

  const canonical = normalizeUrl(
    $('link[rel="canonical"]').attr("href") || pageUrl,
    pageUrl
  );

  const content = cleanText(
    $("body").text()
  );

  const links = new Set();

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");

    if (!href) return;

    const normalized = normalizeUrl(
      href,
      pageUrl
    );

    if (normalized) {
      links.add(normalized);
    }
  });

  const wordCount = content
    ? content.split(/\s+/).length
    : 0;

  const contentHash = hashContent(content);

  return {
    title,
    description,
    canonical,
    content,
    links: [...links],
    wordCount,
    contentHash
  };
}

async function canFetch(url) {
  try {
    const parsed = new URL(url);

    const robotsUrl =
      `${parsed.origin}/robots.txt`;

    const response = await fetch(robotsUrl, {
      headers: {
        "User-Agent": USER_AGENT
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      return true;
    }

    const robots = await response.text();

    const lines = robots
      .split(/\r?\n/)
      .map(line =>
        line.trim()
          .toLowerCase()
      );

    let activeUserAgent = false;

    for (const line of lines) {
      if (line.startsWith("user-agent:")) {
        const value =
          line.split(":")[1]?.trim();

        activeUserAgent =
          value === "*" ||
          value === "hexora-bot";
      }

      if (
        activeUserAgent &&
        line.startsWith("disallow:")
      ) {
        const path =
          line.split(":").slice(1).join(":").trim();

        if (!path) continue;

        const currentPath =
          new URL(url).pathname;

        if (currentPath.startsWith(path)) {
          return false;
        }
      }
    }

    return true;

  } catch {
    return true;
  }
}

async function fetchPage(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept":
        "text/html,application/xhtml+xml"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });

  return response;
}

async function markFailure(id, error) {
  try {
    await supabase
      .from("crawl_queue")
      .update({
        last_error: String(error).slice(0, 1000),
        last_crawled_at: new Date().toISOString()
      })
      .eq("id", id);
  } catch (dbError) {
    console.error(
      "[HEXORA] Failed to update queue error:",
      dbError.message
    );
  }
}

async function crawlUrl(item) {
  const url = item.url;

  console.log(`[HEXORA] Crawling: ${url}`);

  try {
    const allowed = await canFetch(url);

    if (!allowed) {
      console.log(
        `[HEXORA] robots.txt blocked: ${url}`
      );

      await markFailure(
        item.id,
        "Blocked by robots.txt"
      );

      return;
    }

    const response = await fetchPage(url);

    if (!response.ok) {
      const error =
        `HTTP ${response.status}`;

      console.log(
        `[HEXORA] ${error}: ${url}`
      );

      await markFailure(
        item.id,
        error
      );

      return;
    }

    const contentType =
      response.headers.get("content-type") || "";

    if (!contentType.includes("text/html")) {
      console.log(
        `[HEXORA] Skipped non-HTML: ${url}`
      );

      await markFailure(
        item.id,
        "Non-HTML content"
      );

      return;
    }

    const html = await response.text();

    if (!html || html.length < 50) {
      await markFailure(
        item.id,
        "Empty or invalid HTML"
      );

      return;
    }

    const page = extractPage(
      html,
      url
    );

    const now =
      new Date().toISOString();

    const pageData = {
      url,
      title: page.title || url,
      description:
        page.description || "",
      content:
        page.content || "",
      canonical:
        page.canonical || url,
      content_hash:
        page.contentHash,
      word_count:
        page.wordCount,
      language: "unknown",
      last_crawled_at: now
    };

    const { error: pageError } =
      await supabase
        .from("pages")
        .upsert(
          pageData,
          {
            onConflict: "url"
          }
        );

    if (pageError) {
      throw pageError;
    }

    for (const link of page.links) {
      try {
        await supabase
          .from("crawl_queue")
          .upsert(
            {
              url: link,
              status: "pending"
            },
            {
              onConflict: "url",
              ignoreDuplicates: true
            }
          );
      } catch (error) {
        console.log(
          `[HEXORA] Queue error: ${link}`,
          error.message
        );
      }
    }

    await supabase
      .from("crawl_queue")
      .update({
        status: "done",
        last_error: null,
        last_crawled_at: now
      })
      .eq("id", item.id);

    console.log(
      `[HEXORA] Crawled successfully: ${url} | links: ${page.links.length}`
    );

  } catch (error) {
    console.error(
      `[HEXORA] Crawl failed: ${url}`,
      error.message
    );

    await markFailure(
      item.id,
      error.message
    );
  }
}

async function crawlBatch() {
  const { data, error } =
    await supabase
      .from("crawl_queue")
      .select("*")
      .eq("status", "pending")
      .order("created_at", {
        ascending: true
      })
      .limit(BATCH_SIZE);

  if (error) {
    throw error;
  }

  if (!data || data.length === 0) {
    console.log(
      "[HEXORA] No pending URLs."
    );

    return 0;
  }

  let index = 0;

  async function worker() {
    while (true) {
      const current = index++;

      if (current >= data.length) {
        return;
      }

      const item = data[current];

      await supabase
        .from("crawl_queue")
        .update({
          status: "processing"
        })
        .eq("id", item.id);

      await crawlUrl(item);
    }
  }

  const workers = [];

  for (
    let i = 0;
    i < Math.min(CONCURRENCY, data.length);
    i++
  ) {
    workers.push(worker());
  }

  await Promise.all(workers);

  return data.length;
}

export async function startCrawler() {
  console.log(
    "================================"
  );

  console.log(
    "HEXORA crawler worker started"
  );

  console.log(
    `Batch: ${BATCH_SIZE}`
  );

  console.log(
    `Concurrency: ${CONCURRENCY}`
  );

  console.log(
    "================================"
  );

  while (true) {
    try {
      const processed =
        await crawlBatch();

      console.log(
        `[HEXORA] Crawl cycle completed | processed: ${processed}`
      );

    } catch (error) {
      console.error(
        "[HEXORA] Crawl cycle error:",
        error.message
      );
    }

    const interval =
      Number(
        process.env.CRAWL_INTERVAL_MS ||
        30000
      );

    await new Promise(
      resolve =>
        setTimeout(resolve, interval)
    );
  }
}

export default {
  startCrawler,
  crawlBatch
};
