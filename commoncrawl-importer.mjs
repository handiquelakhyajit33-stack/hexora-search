// commoncrawl-importer.mjs
// HEXORA - Common Crawl importer

import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import { gunzipSync } from "node:zlib";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY;

const MAX_PAGES = Number(process.env.CC_MAX_PAGES || 100);

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

function cleanText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function getTitle(html) {
  const m = String(html || "").match(
    /<title[^>]*>([\s\S]*?)<\/title>/i
  );

  return cleanText(m?.[1] || "").slice(0, 500);
}

function getDescription(html) {
  const m = String(html || "").match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i
  );

  return cleanText(m?.[1] || "").slice(0, 1000);
}

function getDomain(url) {
  try {
    return new URL(url).hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return "";
  }
}

function getWordCount(text) {
  return text
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
  const match = String(text).match(
    /\r?\n\r?\n([\s\S]*)/
  );

  return match ? match[1] : text;
}

async function getLatestCrawl() {
  const response = await fetch(
    "https://index.commoncrawl.org/collinfo.json",
    {
      headers: {
        "User-Agent": "HEXORA-SearchEngine/1.0"
      }
    }
  );

  if (!response.ok) {
    throw new Error(
      `Common Crawl collection error: ${response.status}`
    );
  }

  const collections = await response.json();

  if (!Array.isArray(collections) || collections.length === 0) {
    throw new Error(
      "No Common Crawl collections found."
    );
  }

  const available = collections
    .filter(x => x && x.id)
    .sort((a, b) =>
      String(b.id).localeCompare(String(a.id))
    );

  const crawl = available[0];

  console.log(
    `Latest Common Crawl collection: ${crawl.id}`
  );

  return crawl.id;
}

async function getRecords(crawl) {
  const params = new URLSearchParams({
    url: "*",
    output: "json",
    filter: "status:200",
    collapse: "urlkey",
    pageSize: String(Math.min(MAX_PAGES, 100))
  });

  const indexUrl =
    `https://index.commoncrawl.org/${crawl}-index?${params}`;

  console.log("");
  console.log("Fetching Common Crawl index...");
  console.log(indexUrl);

  const response = await fetch(indexUrl, {
    headers: {
      "User-Agent": "HEXORA-SearchEngine/1.0"
    }
  });

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `Common Crawl index error: ${response.status} ${body.slice(0, 300)}`
    );
  }

  const text = await response.text();

  const records = [];

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;

    try {
      records.push(JSON.parse(line));
    } catch {
      // Ignore malformed lines.
    }

    if (records.length >= MAX_PAGES) {
      break;
    }
  }

  return records;
}

async function downloadWarc(record) {
  const offset = Number(record.offset);
  const length = Number(record.length);

  if (
    !record.filename ||
    !Number.isFinite(offset) ||
    !Number.isFinite(length)
  ) {
    throw new Error("Invalid Common Crawl WARC record.");
  }

  const start = offset;
  const end = offset + length - 1;

  const response = await fetch(
    `https://data.commoncrawl.org/${record.filename}`,
    {
      headers: {
        Range: `bytes=${start}-${end}`,
        "User-Agent": "HEXORA-SearchEngine/1.0"
      }
    }
  );

  if (!response.ok && response.status !== 206) {
    throw new Error(
      `WARC download failed: ${response.status}`
    );
  }

  const buffer = Buffer.from(
    await response.arrayBuffer()
  );

  let decoded;

  try {
    decoded = gunzipSync(buffer).toString("utf8");
  } catch {
    decoded = buffer.toString("utf8");
  }

  return extractHttpBody(decoded);
}

async function urlExists(url) {
  const { data, error } = await supabase
    .from("pages")
    .select("id")
    .eq("url", url)
    .limit(1);

  if (error) {
    throw error;
  }

  return Array.isArray(data) && data.length > 0;
}

async function insertPage(record, html) {
  const url = record.url;

  if (!url) {
    return false;
  }

  if (await urlExists(url)) {
    console.log("  -> duplicate URL, skipped");
    return false;
  }

  const content = cleanText(html).slice(0, 100000);

  if (content.length < 100) {
    console.log("  -> too little text, skipped");
    return false;
  }

  const title =
    getTitle(html) || url;

  const description =
    getDescription(html);

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
    content_hash: contentHash,
    word_count: wordCount,
    language: "unknown",
    canonical: url,
    last_crawled_at: now,
    updated_at: now,
    domain,
    authority_score: 0,
    popularity_score: 0
  };

  const { error } =
    await supabase
      .from("pages")
      .insert(page);

  if (error) {
    throw error;
  }

  return true;
}

async function main() {
  console.log("");
  console.log("====================================");
  console.log(" HEXORA COMMON CRAWL IMPORTER");
  console.log("====================================");
  console.log(`Limit: ${MAX_PAGES}`);
  console.log("");

  const crawl =
    await getLatestCrawl();

  const records =
    await getRecords(crawl);

  console.log("");
  console.log(
    `Found ${records.length} records.`
  );
  console.log("");

  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < records.length; i++) {
    const record = records[i];

    console.log(
      `[${i + 1}/${records.length}] ${record.url}`
    );

    try {
      const html =
        await downloadWarc(record);

      const inserted =
        await insertPage(record, html);

      if (inserted) {
        imported++;
        console.log("  -> IMPORTED");
      } else {
        skipped++;
      }
    } catch (error) {
      failed++;

      console.log(
        `  -> FAILED: ${error.message}`
      );
    }

    await new Promise(resolve =>
      setTimeout(resolve, 250)
    );
  }

  console.log("");
  console.log("====================================");
  console.log(" IMPORT FINISHED");
  console.log("====================================");
  console.log(`Imported: ${imported}`);
  console.log(`Skipped : ${skipped}`);
  console.log(`Failed  : ${failed}`);
  console.log("====================================");
}

main().catch(error => {
  console.error("");
  console.error("FATAL ERROR:");
  console.error(error);
  process.exit(1);
});
