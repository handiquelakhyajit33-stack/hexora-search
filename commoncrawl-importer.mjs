// commoncrawl-importer.mjs
// HEXORA - Common Crawl importer
// First test: 100 pages

import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY;

const MAX_PAGES = Number(process.env.CC_MAX_PAGES || 100);
const CC_INDEX =
  process.env.CC_INDEX || "CC-MAIN-2026-30";

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
      autoRefreshToken: false,
    },
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
  const match = String(html || "").match(
    /<title[^>]*>([\s\S]*?)<\/title>/i
  );

  return cleanText(match?.[1] || "").slice(0, 500);
}

function getDescription(html) {
  const match = String(html || "").match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i
  );

  return cleanText(match?.[1] || "").slice(0, 1000);
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

function extractBody(warcText) {
  const parts = String(warcText).split(/\r?\n\r?\n/);

  if (parts.length < 2) {
    return warcText;
  }

  return parts[parts.length - 1];
}

async function getRecords() {
  const params = new URLSearchParams({
    url: "*",
    output: "json",
    filter: "status:200",
    collapse: "urlkey",
    pageSize: String(Math.min(MAX_PAGES, 1000)),
  });

  const url =
    `https://index.commoncrawl.org/${CC_INDEX}-index?${params}`;

  console.log("Fetching Common Crawl index...");
  console.log(url);

  const response = await fetch(url, {
    headers: {
      "User-Agent": "HEXORA-SearchEngine/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Common Crawl index error: ${response.status}`
    );
  }

  const text = await response.text();

  const records = [];

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;

    try {
      records.push(JSON.parse(line));
    } catch {
      // Ignore invalid lines.
    }

    if (records.length >= MAX_PAGES) {
      break;
    }
  }

  return records;
}

async function downloadWarc(record) {
  const filename = record.filename;
  const offset = Number(record.offset);
  const length = Number(record.length);

  if (
    !filename ||
    !Number.isFinite(offset) ||
    !Number.isFinite(length)
  ) {
    throw new Error("Invalid WARC record");
  }

  const start = offset;
  const end = offset + length - 1;

  const response = await fetch(
    `https://data.commoncrawl.org/${filename}`,
    {
      headers: {
        Range: `bytes=${start}-${end}`,
        "User-Agent": "HEXORA-SearchEngine/1.0",
      },
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

  // Common Crawl WARC records are normally gzip compressed.
  let decoded;

  try {
    decoded = await import("node:zlib").then(({ gunzipSync }) =>
      gunzipSync(buffer).toString("utf8")
    );
  } catch {
    decoded = buffer.toString("utf8");
  }

  return extractBody(decoded);
}

async function insertPage(record, html) {
  const url = record.url;

  const content = cleanText(html).slice(0, 100000);

  if (!content || content.length < 100) {
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

  const page = {
    url,
    title,
    description,
    content,
    content_hash: contentHash,
    word_count: wordCount,
    language: "unknown",
    canonical: url,
    domain,
    last_crawled_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    authority_score: 0,
    popularity_score: 0,
  };

  // First check whether this URL already exists.
  const { data: existing, error: checkError } =
    await supabase
      .from("pages")
      .select("id")
      .eq("url", url)
      .limit(1);

  if (checkError) {
    throw checkError;
  }

  if (existing && existing.length > 0) {
    console.log("  -> already exists");
    return false;
  }

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
  console.log(`Index: ${CC_INDEX}`);
  console.log(`Limit: ${MAX_PAGES}`);
  console.log("");

  const records = await getRecords();

  console.log(
    `Found ${records.length} Common Crawl records.`
  );
  console.log("");

  let imported = 0;
  let skipped = 0;
  let failed = 0;

  const seen = new Set();

  for (let i = 0; i < records.length; i++) {
    const record = records[i];

    console.log(
      `[${i + 1}/${records.length}] ${record.url}`
    );

    try {
      if (!record.url || seen.has(record.url)) {
        skipped++;
        continue;
      }

      seen.add(record.url);

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

      await new Promise((resolve) =>
        setTimeout(resolve, 250)
      );
    } catch (error) {
      failed++;

      console.log(
        `  -> FAILED: ${error.message}`
      );
    }
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

main().catch((error) => {
  console.error("");
  console.error("FATAL ERROR:");
  console.error(error);
  process.exit(1);
});
