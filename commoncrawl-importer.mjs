// commoncrawl-importer.mjs
// HEXORA - Common Crawl Safe Importer
// Test: 100 pages

import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import { gunzipSync } from "node:zlib";

const SUPABASE_URL = process.env.SUPABASE_URL;

const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY;

const MAX_PAGES = Number(
  process.env.CC_MAX_PAGES || 100
);

const USER_AGENT =
  "HEXORA-SearchEngine/1.0 (web crawler; HEXORA)";

const TARGET_DOMAINS = [
  "commoncrawl.org/*",
  "wikipedia.org/*",
  "mozilla.org/*",
  "python.org/*",
  "nodejs.org/*",
  "ietf.org/*",
  "w3.org/*",
  "apache.org/*",
  "ubuntu.com/*",
  "debian.org/*",
  "gnu.org/*",
  "linux.org/*",
  "stackoverflow.com/*",
  "npmjs.com/*",
  "cloudflare.com/*"
];

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error(
    "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing."
  );
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  }
);

function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  );
}

function cleanText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function getTitle(html) {
  const match = String(html || "").match(
    /<title[^>]*>([\s\S]*?)<\/title>/i
  );

  return cleanText(
    match?.[1] || ""
  ).slice(0, 500);
}

function getDescription(html) {
  const value = String(html || "");

  let match = value.match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i
  );

  if (!match) {
    match = value.match(
      /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i
    );
  }

  return cleanText(
    match?.[1] || ""
  ).slice(0, 1000);
}

function getCanonical(html, fallback) {
  const match = String(html || "").match(
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i
  );

  return match?.[1] || fallback;
}

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

function getWordCount(text) {
  return String(text || "")
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

function getHash(text) {
  return crypto
    .createHash("sha256")
    .update(text)
    .digest("hex");
}

function extractHttpBody(text) {
  const value = String(text || "");

  const httpIndex =
    value.indexOf("HTTP/");

  if (httpIndex >= 0) {
    const httpPart =
      value.slice(httpIndex);

    const separator =
      httpPart.search(/\r?\n\r?\n/);

    if (separator >= 0) {
      return httpPart
        .slice(separator)
        .replace(/^\r?\n\r?\n/, "");
    }
  }

  const separator =
    value.search(/\r?\n\r?\n/);

  if (separator >= 0) {
    return value
      .slice(separator)
      .replace(/^\r?\n\r?\n/, "");
  }

  return value;
}

async function getLatestCrawl() {
  console.log(
    "Checking Common Crawl collections..."
  );

  const response = await fetch(
    "https://index.commoncrawl.org/collinfo.json",
    {
      headers: {
        "User-Agent": USER_AGENT
      }
    }
  );

  if (!response.ok) {
    throw new Error(
      `Collection request failed: ${response.status}`
    );
  }

  const collections =
    await response.json();

  const crawls =
    collections
      .filter(
        item =>
          item &&
          typeof item.id === "string" &&
          item.id.startsWith("CC-MAIN-")
      )
      .sort((a, b) =>
        String(b.id).localeCompare(
          String(a.id),
          undefined,
          { numeric: true }
        )
      );

  if (!crawls.length) {
    throw new Error(
      "No CC-MAIN crawl found."
    );
  }

  const crawl =
    crawls[0].id;

  console.log(
    `Latest Common Crawl collection: ${crawl}`
  );

  return crawl;
}

async function getDomainRecords(
  crawl,
  domainPattern,
  limit
) {
  const params =
    new URLSearchParams();

  params.set(
    "url",
    domainPattern
  );

  params.set(
    "output",
    "json"
  );

  params.set(
    "filter",
    "status:200"
  );

  params.append(
    "filter",
    "mime:text/html"
  );

  params.set(
    "collapse",
    "urlkey"
  );

  params.set(
    "pageSize",
    String(limit)
  );

  const indexUrl =
    `https://index.commoncrawl.org/${crawl}-index?${params.toString()}`;

  console.log("");
  console.log(
    `Querying: ${domainPattern}`
  );

  const response =
    await fetch(
      indexUrl,
      {
        headers: {
          "User-Agent": USER_AGENT,
          "Accept": "application/json"
        }
      }
    );

  if (response.status === 404) {
    console.log(
      `No captures found: ${domainPattern}`
    );

    return [];
  }

  if (response.status === 429) {
    throw new Error(
      "Common Crawl rate limit reached."
    );
  }

  if (!response.ok) {
    const body =
      await response.text();

    throw new Error(
      `Index error ${response.status}: ${body.slice(0, 300)}`
    );
  }

  const text =
    await response.text();

  const records = [];

  for (
    const line of text.split("\n")
  ) {
    if (!line.trim()) {
      continue;
    }

    try {
      const record =
        JSON.parse(line);

      if (
        record.url &&
        record.filename &&
        record.offset &&
        record.length
      ) {
        records.push(record);
      }
    } catch {
      // ignore invalid JSON line
    }

    if (
      records.length >= limit
    ) {
      break;
    }
  }

  console.log(
    `Records received: ${records.length}`
  );

  return records;
}

async function collectRecords(crawl) {
  const records = [];
  const seen = new Set();

  const perDomain =
    Math.max(
      2,
      Math.ceil(
        MAX_PAGES /
        TARGET_DOMAINS.length
      )
    );

  for (
    const domain of TARGET_DOMAINS
  ) {
    if (
      records.length >= MAX_PAGES
    ) {
      break;
    }

    const remaining =
      MAX_PAGES -
      records.length;

    const limit =
      Math.min(
        perDomain,
        remaining
      );

    try {
      const domainRecords =
        await getDomainRecords(
          crawl,
          domain,
          limit
        );

      for (
        const record of domainRecords
      ) {
        if (
          !record.url ||
          seen.has(record.url)
        ) {
          continue;
        }

        seen.add(record.url);
        records.push(record);

        if (
          records.length >= MAX_PAGES
        ) {
          break;
        }
      }
    } catch (error) {
      console.log(
        `Failed: ${domain}`
      );

      console.log(
        error.message
      );
    }

    // Slow down API requests.
    await sleep(3000);
  }

  return records.slice(
    0,
    MAX_PAGES
  );
}

async function downloadWarc(record) {
  const offset =
    Number(record.offset);

  const length =
    Number(record.length);

  if (
    !record.filename ||
    !Number.isFinite(offset) ||
    !Number.isFinite(length) ||
    length <= 0
  ) {
    throw new Error(
      "Invalid WARC record."
    );
  }

  const start =
    offset;

  const end =
    offset +
    length -
    1;

  const warcUrl =
    `https://data.commoncrawl.org/${record.filename}`;

  const response =
    await fetch(
      warcUrl,
      {
        headers: {
          "User-Agent": USER_AGENT,
          "Range":
            `bytes=${start}-${end}`
        }
      }
    );

  if (
    response.status !== 206 &&
    response.status !== 200
  ) {
    throw new Error(
      `WARC download failed: ${response.status}`
    );
  }

  const buffer =
    Buffer.from(
      await response.arrayBuffer()
    );

  let decoded;

  try {
    decoded =
      gunzipSync(buffer)
        .toString("utf8");
  } catch {
    decoded =
      buffer.toString("utf8");
  }

  return extractHttpBody(
    decoded
  );
}

async function urlExists(url) {
  const {
    data,
    error
  } = await supabase
    .from("pages")
    .select("id")
    .eq("url", url)
    .limit(1);

  if (error) {
    throw error;
  }

  return (
    Array.isArray(data) &&
    data.length > 0
  );
}

async function insertPage(
  record,
  html
) {
  const url =
    record.url;

  if (!url) {
    return false;
  }

  if (
    await urlExists(url)
  ) {
    console.log(
      "  -> duplicate, skipped"
    );

    return false;
  }

  const content =
    cleanText(html)
      .slice(0, 100000);

  if (
    content.length < 100
  ) {
    console.log(
      "  -> too little content, skipped"
    );

    return false;
  }

  const title =
    getTitle(html) ||
    url;

  const description =
    getDescription(html);

  const canonical =
    getCanonical(
      html,
      url
    );

  const domain =
    getDomain(url);

  const contentHash =
    getHash(content);

  const wordCount =
    getWordCount(content);

  const now =
    new Date().toISOString();

  const page = {
    url,
    title,
    description,
    content,
    content_hash:
      contentHash,
    word_count:
      wordCount,
    language:
      record.languages ||
      "unknown",
    canonical,
    last_crawled_at:
      now,
    updated_at:
      now,
    domain,
    authority_score: 0,
    popularity_score: 0
  };

  const {
    error
  } = await supabase
    .from("pages")
    .insert(page);

  if (error) {
    throw error;
  }

  return true;
}

async function main() {
  console.log("");
  console.log(
    "===================================="
  );
  console.log(
    " HEXORA COMMON CRAWL IMPORTER"
  );
  console.log(
    "===================================="
  );
  console.log(
    `Limit: ${MAX_PAGES}`
  );
  console.log(
    "Mode: SAFE DOMAIN IMPORT"
  );
  console.log("");

  const crawl =
    await getLatestCrawl();

  console.log("");

  const records =
    await collectRecords(
      crawl
    );

  console.log("");
  console.log(
    `Total records collected: ${records.length}`
  );
  console.log("");

  if (!records.length) {
    throw new Error(
      "No Common Crawl records collected."
    );
  }

  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (
    let i = 0;
    i < records.length;
    i++
  ) {
    const record =
      records[i];

    console.log(
      `[${i + 1}/${records.length}] ${record.url}`
    );

    try {
      const html =
        await downloadWarc(
          record
        );

      const inserted =
        await insertPage(
          record,
          html
        );

      if (inserted) {
        imported++;

        console.log(
          "  -> IMPORTED"
        );
      } else {
        skipped++;
      }
    } catch (error) {
      failed++;

      console.log(
        `  -> FAILED: ${error.message}`
      );
    }

    await sleep(1000);
  }

  console.log("");
  console.log(
    "===================================="
  );
  console.log(
    " IMPORT FINISHED"
  );
  console.log(
    "===================================="
  );
  console.log(
    `Imported: ${imported}`
  );
  console.log(
    `Skipped : ${skipped}`
  );
  console.log(
    `Failed  : ${failed}`
  );
  console.log(
    "===================================="
  );
}

main().catch(error => {
  console.error("");
  console.error(
    "FATAL ERROR:"
  );
  console.error(error);
  process.exit(1);
});
