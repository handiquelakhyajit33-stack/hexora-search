// commoncrawl-importer.mjs
// HEXORA - Common Crawl importer
// Safe standalone importer: does NOT modify server.mjs, crawler.mjs or worker.mjs.

import { createClient } from "@supabase/supabase-js";
import { gunzipSync } from "node:zlib";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

const MAX_PAGES = Number(process.env.CC_MAX_PAGES || 100);
const CC_INDEX =
  process.env.CC_INDEX || "CC-MAIN-2026-30";

const TABLE = "pages";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable."
  );
  process.exit(1);
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

const INDEX_URL =
  `https://index.commoncrawl.org/${CC_INDEX}-index?` +
  new URLSearchParams({
    url: "*",
    output: "json",
    filter: "status:200",
    collapse: "urlkey",
    pageSize: String(Math.min(MAX_PAGES, 1000)),
  });

function cleanText(value) {
  return String(value || "")
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
  const match = html.match(
    /<title[^>]*>([\s\S]*?)<\/title>/i
  );

  return cleanText(match?.[1] || "").slice(0, 500);
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

function decodeWarcPayload(buffer) {
  try {
    return gunzipSync(buffer).toString("utf8");
  } catch {
    return buffer.toString("utf8");
  }
}

function extractHttpBody(text) {
  const separators = [
    "\r\n\r\n",
    "\n\n",
  ];

  for (const separator of separators) {
    const index = text.indexOf(separator);

    if (index !== -1) {
      return text.slice(index + separator.length);
    }
  }

  return text;
}

async function getIndexRecords() {
  console.log("HEXORA Common Crawl importer");
  console.log("--------------------------------");
  console.log(`Index: ${CC_INDEX}`);
  console.log(`Target: ${MAX_PAGES} pages`);
  console.log("");

  const response = await fetch(INDEX_URL, {
    headers: {
      "User-Agent": "HEXORA-SearchEngine/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Common Crawl index error: ${response.status} ${response.statusText}`
    );
  }

  const text = await response.text();

  const records = [];

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;

    try {
      records.push(JSON.parse(line));
    } catch {
      // Ignore malformed index lines.
    }

    if (records.length >= MAX_PAGES) break;
  }

  return records;
}

async function downloadPage(record) {
  const filename = record.filename;
  const offset = Number(record.offset);
  const length = Number(record.length);

  if (!filename || !Number.isFinite(offset) || !Number.isFinite(length)) {
    throw new Error("Invalid Common Crawl record");
  }

  const warcUrl =
    `https://data.commoncrawl.org/${filename}`;

  const end = offset + length - 1;

  const response = await fetch(warcUrl, {
    headers: {
      Range: `bytes=${offset}-${end}`,
      "User-Agent": "HEXORA-SearchEngine/1.0",
    },
  });

  if (!response.ok && response.status !== 206) {
    throw new Error(
      `WARC download failed: ${response.status}`
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const decoded = decodeWarcPayload(buffer);

  return extractHttpBody(decoded);
}

async function insertPage(page) {
  const { error } = await supabase
    .from(TABLE)
    .upsert(page, {
      onConflict: "url",
      ignoreDuplicates: false,
    });

  if (error) {
    throw error;
  }
}

async function main() {
  const records = await getIndexRecords();

  console.log(`Found ${records.length} Common Crawl records.`);
  console.log("");

  let imported = 0;
  let skipped = 0;
  let failed = 0;

  const seenUrls = new Set();

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const url = record.url;

    console.log(
      `[${i + 1}/${records.length}] ${url || "unknown URL"}`
    );

    try {
      if (!url) {
        skipped++;
        continue;
      }

      if (seenUrls.has(url)) {
        skipped++;
        continue;
      }

      seenUrls.add(url);

      const html = await downloadPage(record);

      if (!html || html.length < 100) {
        skipped++;
        console.log("  -> skipped: empty page");
        continue;
      }

      const title = getTitle(html);

      const text = cleanText(html)
        .slice(0, 100000);

      if (!text) {
        skipped++;
        console.log("  -> skipped: no text");
        continue;
      }

      const domain = getDomain(url);

      const page = {
        url,
        title: title || url,
        content: text,
        domain,
      };

      await insertPage(page);

      imported++;

      console.log(
        `  -> imported: ${title || url}`
      );

      // Small delay to avoid hammering Common Crawl/Supabase.
      await new Promise((resolve) =>
        setTimeout(resolve, 250)
      );
    } catch (error) {
      failed++;

      console.error(
        `  -> failed: ${error.message}`
      );
    }
  }

  console.log("");
  console.log("--------------------------------");
  console.log("HEXORA Common Crawl import finished");
  console.log(`Imported : ${imported}`);
  console.log(`Skipped  : ${skipped}`);
  console.log(`Failed   : ${failed}`);
  console.log("--------------------------------");
}

main().catch((error) => {
  console.error("");
  console.error("IMPORTER ERROR:");
  console.error(error);
  process.exit(1);
});
