import crypto from "node:crypto";
import dns from "node:dns/promises";
import * as cheerio from "cheerio";
import pg from "pg";
import { putHtml } from "./storage.mjs";

const { Pool } = pg;
const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
if (!DATABASE_URL) throw new Error("[HEXORA] DATABASE_URL is missing");

const USER_AGENT = process.env.HEXORA_USER_AGENT || "HEXORA-Bot/1.0 (+https://www.hexsorasearch.com/)";
const REQUEST_TIMEOUT = Math.max(3000, Number(process.env.CRAWL_TIMEOUT_MS || 15000));
const MAX_CONTENT = Math.max(10000, Number(process.env.CRAWL_MAX_CONTENT || 120000));
const MAX_HTML_BYTES = Math.max(100000, Number(process.env.CRAWL_MAX_HTML_BYTES || 3000000));
const MAX_LINKS = Math.max(10, Number(process.env.CRAWL_MAX_LINKS || 150));
const DOMAIN_DELAY = Math.max(100, Number(process.env.CRAWL_DOMAIN_DELAY_MS || 1000));
const MAX_REDIRECTS = Math.max(0, Number(process.env.CRAWL_MAX_REDIRECTS || 5));
const MAX_RETRIES = Math.max(1, Number(process.env.CRAWL_MAX_RETRIES || 3));

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: Math.max(2, Number(process.env.CRAWL_DB_POOL_MAX || 6)),
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000,
  ssl: /neon\.tech|neon\.com|neon\.io|neon\./i.test(DATABASE_URL) ? { rejectUnauthorized: false } : undefined,
});

const robotsCache = new Map();
const domainLastRequest = new Map();

const BLOCKED_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".ico",
  ".mp3", ".wav", ".ogg", ".mp4", ".webm", ".avi", ".mov",
  ".zip", ".rar", ".7z", ".gz", ".tar", ".pdf", ".doc", ".docx",
  ".xls", ".xlsx", ".ppt", ".pptx", ".apk", ".exe", ".dmg", ".iso",
]);

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function sha256(value) { return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex"); }
function cleanText(value) { return String(value || "").replace(/\s+/g, " ").replace(/\u00a0/g, " ").trim(); }
function domainOf(url) { try { return new URL(url).hostname.toLowerCase(); } catch { return ""; } }

function isPrivateIPv4(ip) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return false;
  return p[0] === 10 || p[0] === 127 || (p[0] === 169 && p[1] === 254) || (p[0] === 192 && p[1] === 168) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31);
}

function isPrivateIPv6(ip) {
  const value = ip.toLowerCase();
  return value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80:") || value === "::";
}

async function assertPublicHost(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Blocked private/local hostname");
  }
  const records = await dns.lookup(host, { all: true, verbatim: true });
  for (const record of records) {
    if (record.family === 4 && isPrivateIPv4(record.address)) throw new Error("Blocked private IPv4 address");
    if (record.family === 6 && isPrivateIPv6(record.address)) throw new Error("Blocked private IPv6 address");
  }
}

function normalizeUrl(input, baseUrl = null) {
  try {
    const url = new URL(input, baseUrl || undefined);
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = "";
    url.username = "";
    url.password = "";
    const remove = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid", "msclkid", "mc_cid", "mc_eid"];
    for (const key of remove) url.searchParams.delete(key);
    if (url.pathname.length > 2048 || url.toString().length > 8192) return null;
    return url.toString();
  } catch { return null; }
}

function isValidCrawlUrl(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    if (!u.hostname || u.hostname.length < 3 || u.hostname.length > 253) return false;
    const pathname = u.pathname.toLowerCase();
    if ([...BLOCKED_EXTENSIONS].some((ext) => pathname.endsWith(ext))) return false;
    if (["/login", "/signin", "/sign-in", "/signup", "/sign-up", "/register", "/logout", "/wp-login.php"].some((part) => pathname.includes(part))) return false;
    return true;
  } catch { return false; }
}

function detectLanguage(text) {
  const value = String(text || "");
  const counts = {
    as: (value.match(/[\u0980-\u09FF]/g) || []).length,
    hi: (value.match(/[\u0900-\u097F]/g) || []).length,
    ar: (value.match(/[\u0600-\u06FF]/g) || []).length,
    zh: (value.match(/[\u4E00-\u9FFF]/g) || []).length,
    en: (value.match(/[A-Za-z]/g) || []).length,
  };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (!total) return "unknown";
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (best[1] / total >= 0.2) return best[0];
  return "unknown";
}

function qualityScore({ title, description, content, wordCount, links }) {
  let score = 0;
  if (title) score += 20;
  if (description) score += 15;
  if (wordCount >= 50) score += 10;
  if (wordCount >= 200) score += 10;
  if (wordCount >= 500) score += 10;
  if (wordCount >= 1000) score += 10;
  if (content.length >= 1000) score += 10;
  if (content.length >= 5000) score += 5;
  if (links > 0) score += 5;
  return Math.min(100, score);
}

function parseRobots(text) {
  const rules = [];
  const sitemaps = [];
  let active = false;
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.split("#")[0].trim();
    if (!line) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (key === "user-agent") active = value === "*" || value.toLowerCase() === "hexora-bot" || value.toLowerCase().includes("hexora");
    else if (active && key === "disallow" && value) rules.push({ type: "disallow", path: value });
    else if (active && key === "allow" && value) rules.push({ type: "allow", path: value });
    else if (key === "sitemap" && value) sitemaps.push(value);
  }
  return { rules, sitemaps };
}

async function fetchRobots(domain) {
  const cached = robotsCache.get(domain);
  if (cached && Date.now() - cached.timestamp < 15 * 60 * 1000) return cached;
  const result = { allowAll: true, rules: [], sitemaps: [], timestamp: Date.now() };
  try {
    const url = `https://${domain}/robots.txt`;
    await assertPublicHost(domain);
    const response = await fetchWithRedirects(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/plain,*/*" } }, 10000, 2);
    if (response.ok) {
      const parsed = parseRobots(await response.text());
      result.rules = parsed.rules;
      result.sitemaps = parsed.sitemaps.filter((s) => normalizeUrl(s));
      result.allowAll = parsed.rules.length === 0;
    }
  } catch {}
  robotsCache.set(domain, result);
  return result;
}

function robotsAllowed(url, robots) {
  if (!robots || robots.allowAll) return true;
  const pathname = new URL(url).pathname || "/";
  let best = null;
  for (const rule of robots.rules) {
    if (!pathname.startsWith(rule.path)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.type === "allow")) best = rule;
  }
  return !best || best.type === "allow";
}

async function respectDomainDelay(url) {
  const domain = domainOf(url);
  const last = domainLastRequest.get(domain) || 0;
  const wait = DOMAIN_DELAY - (Date.now() - last);
  if (wait > 0) await sleep(wait);
  domainLastRequest.set(domain, Date.now());
}

async function fetchWithRedirects(startUrl, options = {}, timeoutMs = REQUEST_TIMEOUT, maxRedirects = MAX_REDIRECTS) {
  let current = normalizeUrl(startUrl);
  if (!current) throw new Error("Invalid URL");
  for (let redirect = 0; redirect <= maxRedirects; redirect++) {
    const parsed = new URL(current);
    await assertPublicHost(parsed.hostname);
    await respectDomainDelay(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(current, { ...options, redirect: "manual", signal: controller.signal });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return response;
        const next = normalizeUrl(location, current);
        if (!next) throw new Error("Invalid redirect URL");
        current = next;
        continue;
      }
      return Object.defineProperty(response, "hexoraFinalUrl", { value: current });
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Too many redirects");
}

async function readLimitedText(response, maxBytes) {
  const length = Number(response.headers.get("content-length") || 0);
  if (length > maxBytes) throw new Error("Response exceeds crawler size limit");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("Response exceeds crawler size limit");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function fetchHtml(url) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetchWithRedirects(url, {
        method: "GET",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml;q=0.95,*/*;q=0.2",
          "Accept-Language": "en-US,en;q=0.8,as;q=0.7,hi;q=0.6,bn;q=0.5",
        },
      });
      const finalUrl = normalizeUrl(response.hexoraFinalUrl || url) || url;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get("content-type") || "";
      if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) throw new Error(`Not HTML: ${contentType || "unknown"}`);
      const html = await readLimitedText(response, MAX_HTML_BYTES);
      if (html.length < 100) throw new Error("Empty or very small HTML");
      return { ok: true, status: response.status, finalUrl, html, contentType };
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES) await sleep(Math.min(15000, 1000 * 2 ** (attempt - 1)));
    }
  }
  return { ok: false, status: 0, finalUrl: url, error: lastError?.message || "Fetch failed" };
}

function parseHtml(html, url) {
  const $ = cheerio.load(html);
  $("script,style,noscript,template,svg,canvas").remove();
  const title = cleanText($("title").first().text() || $("meta[property='og:title']").attr("content") || "").slice(0, 1000);
  const description = cleanText($("meta[name='description']").attr("content") || $("meta[property='og:description']").attr("content") || "").slice(0, 2000);
  const canonicalRaw = $("link[rel='canonical']").attr("href");
  const canonical = normalizeUrl(canonicalRaw, url) || url;
  const content = cleanText($("body").text()).slice(0, MAX_CONTENT);
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  const language = detectLanguage(`${title} ${description} ${content}`);
  const links = [];
  const imageItems = [];
  const videoItems = [];

  $("a[href]").each((_, el) => {
    if (links.length >= MAX_LINKS) return;
    const href = normalizeUrl($(el).attr("href"), canonical);
    if (href && isValidCrawlUrl(href)) links.push({ url: href, anchor: cleanText($(el).text()).slice(0, 300) });
  });

  $("img[src]").each((_, el) => {
    if (imageItems.length >= 12) return;
    const src = normalizeUrl($(el).attr("src"), canonical);
    if (!src) return;
    const alt = cleanText($(el).attr("alt") || "").slice(0, 300);
    imageItems.push({ url: src, alt });
  });

  $("video[src], video source[src]").each((_, el) => {
    if (videoItems.length >= 8) return;
    const src = normalizeUrl($(el).attr("src"), canonical);
    if (src) videoItems.push({ url: src });
  });

  $("meta[property='og:video'], meta[property='og:video:url'], meta[property='og:video:secure_url']").each((_, el) => {
    const src = normalizeUrl($(el).attr("content"), canonical);
    if (src && videoItems.length < 8) videoItems.push({ url: src });
  });

  const publishedRaw = $("meta[property='article:published_time'], meta[name='date'], time[datetime]").first().attr("content") || $("time[datetime]").first().attr("datetime") || "";
  const publishedAt = publishedRaw && !Number.isNaN(Date.parse(publishedRaw)) ? new Date(publishedRaw).toISOString() : null;
  const ogType = String($("meta[property='og:type']").attr("content") || "").toLowerCase();
  const crawlStatus = /article|news/i.test(ogType) || publishedAt ? "news" : "indexed";

  return {
    title,
    description,
    canonical,
    content,
    wordCount,
    language,
    links,
    imageItems: [...new Map(imageItems.map((x) => [x.url, x])).values()],
    videoItems: [...new Map(videoItems.map((x) => [x.url, x])).values()],
    publishedAt,
    crawlStatus,
    qualityScore: qualityScore({ title, description, content, wordCount, links: links.length }),
  };
}

async function savePage({ originalUrl, finalUrl, parsed, contentHash, r2Key, statusCode }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const page = await client.query(
      `INSERT INTO pages
       (url, canonical_url, title, description, excerpt, content, domain, language, content_hash,
        word_count, status_code, crawl_status, last_crawled_at, updated_at, published_at,
        r2_key, quality_score, image_items, video_items)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW(),$13,$14,$15,$16,$17)
       ON CONFLICT (url) DO UPDATE SET
         canonical_url=EXCLUDED.canonical_url,
         title=EXCLUDED.title,
         description=EXCLUDED.description,
         excerpt=EXCLUDED.excerpt,
         content=EXCLUDED.content,
         domain=EXCLUDED.domain,
         language=EXCLUDED.language,
         content_hash=EXCLUDED.content_hash,
         word_count=EXCLUDED.word_count,
         status_code=EXCLUDED.status_code,
         crawl_status=EXCLUDED.crawl_status,
         last_crawled_at=NOW(),
         updated_at=NOW(),
         published_at=EXCLUDED.published_at,
         r2_key=EXCLUDED.r2_key,
         quality_score=EXCLUDED.quality_score,
         image_items=EXCLUDED.image_items,
         video_items=EXCLUDED.video_items
       RETURNING id`,
      [
        originalUrl,
        parsed.canonical || finalUrl,
        parsed.title,
        parsed.description,
        parsed.content.slice(0, 800),
        parsed.content,
        domainOf(parsed.canonical || finalUrl),
        parsed.language,
        contentHash,
        parsed.wordCount,
        statusCode,
        parsed.crawlStatus,
        parsed.publishedAt,
        r2Key,
        parsed.qualityScore,
        JSON.stringify(parsed.imageItems),
        JSON.stringify(parsed.videoItems),
      ]
    );
    const pageId = page.rows[0].id;

    await client.query("DELETE FROM page_links WHERE source_page_id = $1", [pageId]);
    for (const link of parsed.links.slice(0, MAX_LINKS)) {
      await client.query(
        `INSERT INTO page_links (source_page_id,target_url,anchor_text)
         VALUES ($1,$2,$3) ON CONFLICT (source_page_id,target_url)
         DO UPDATE SET anchor_text=EXCLUDED.anchor_text`,
        [pageId, link.url, link.anchor]
      );
      await client.query(
        `INSERT INTO crawl_queue (url,status,priority,discovered_from)
         VALUES ($1,'pending',$2,$3)
         ON CONFLICT (url) DO NOTHING`,
        [link.url, Math.max(1, Math.min(100, 40 + (link.anchor ? 10 : 0))), finalUrl]
      );
    }
    await client.query("UPDATE domains SET pages_count = pages_count + 1, updated_at = NOW() WHERE domain = $1", [domainOf(parsed.canonical || finalUrl)]).catch(() => {});
    await client.query("COMMIT");
    return pageId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function markQueue(id, status, error = null) {
  if (!id) return;
  const attemptsLimit = Math.max(1, Number(process.env.CRAWL_MAX_ATTEMPTS || 4));
  if (status === "failed") {
    await pool.query(
      `UPDATE crawl_queue SET status=CASE WHEN attempts >= $2 THEN 'failed' ELSE 'pending' END,
       error=$3, finished_at=NOW() WHERE id=$1`,
      [id, attemptsLimit, String(error || "Crawl failed").slice(0, 2000)]
    );
  } else {
    await pool.query(`UPDATE crawl_queue SET status=$2, finished_at=NOW(), error=NULL WHERE id=$1`, [id, status]);
  }
}

async function enqueueSitemaps(domain, robots) {
  for (const sitemap of robots.sitemaps || []) {
    const url = normalizeUrl(sitemap);
    if (!url || !isValidCrawlUrl(url)) continue;
    await pool.query(
      `INSERT INTO crawl_queue (url,status,priority,discovered_from) VALUES ($1,'pending',90,$2) ON CONFLICT (url) DO NOTHING`,
      [url, `https://${domain}/robots.txt`]
    ).catch(() => {});
  }
}

export async function crawlUrl(job) {
  const jobId = job?.id ?? null;
  const original = normalizeUrl(job?.url || job);
  if (!original || !isValidCrawlUrl(original)) {
    await markQueue(jobId, "failed", "Invalid or blocked URL");
    return { ok: false, url: job?.url || job, error: "Invalid or blocked URL" };
  }

  try {
    const domain = domainOf(original);
    const robots = await fetchRobots(domain);
    await enqueueSitemaps(domain, robots);
    if (!robotsAllowed(original, robots)) {
      await markQueue(jobId, "blocked", "Blocked by robots.txt");
      return { ok: false, blocked: true, url: original, error: "Blocked by robots.txt" };
    }

    const existing = await pool.query("SELECT id, content_hash FROM pages WHERE url=$1 LIMIT 1", [original]);
    if (existing.rowCount && existing.rows[0].content_hash) {
      await markQueue(jobId, "done");
      return { ok: true, duplicate: true, url: original, pageId: existing.rows[0].id };
    }

    const fetched = await fetchHtml(original);
    if (!fetched.ok) {
      await markQueue(jobId, "failed", fetched.error);
      return { ok: false, url: original, error: fetched.error };
    }

    const finalUrl = fetched.finalUrl;
    const finalRobots = await fetchRobots(domainOf(finalUrl));
    if (!robotsAllowed(finalUrl, finalRobots)) {
      await markQueue(jobId, "blocked", "Redirect target blocked by robots.txt");
      return { ok: false, blocked: true, url: finalUrl, error: "Redirect target blocked" };
    }

    const parsed = parseHtml(fetched.html, finalUrl);
    if (!parsed.content && !parsed.title) {
      await markQueue(jobId, "failed", "No readable page content");
      return { ok: false, url: finalUrl, error: "No readable page content" };
    }

    const contentHash = sha256(fetched.html);
    const duplicate = await pool.query("SELECT id FROM pages WHERE content_hash=$1 AND url<>$2 LIMIT 1", [contentHash, original]);
    if (duplicate.rowCount) {
      await markQueue(jobId, "done");
      return { ok: true, duplicate: true, url: finalUrl, duplicateOf: duplicate.rows[0].id };
    }

    const r2 = await putHtml({ url: finalUrl, html: fetched.html, contentHash, metadata: { language: parsed.language } });
    const pageId = await savePage({ originalUrl: original, finalUrl, parsed, contentHash, r2Key: r2.key, statusCode: fetched.status });
    await markQueue(jobId, "done");
    return { ok: true, pageId, url: original, finalUrl, title: parsed.title, language: parsed.language, links: parsed.links.length, images: parsed.imageItems.length, videos: parsed.videoItems.length, r2Key: r2.key };
  } catch (error) {
    console.error("[HEXORA] Crawl failed:", original, error?.message || error);
    await markQueue(jobId, "failed", error?.message || String(error)).catch(() => {});
    return { ok: false, url: original, error: error?.message || String(error) };
  }
}

export async function crawlBatch(jobs = []) {
  const list = Array.isArray(jobs) ? jobs : [];
  const results = [];
  for (const job of list) {
    results.push(await crawlUrl(job));
    await sleep(DOMAIN_DELAY);
  }
  const successful = results.filter((r) => r.ok).length;
  return { total: results.length, successful, failed: results.length - successful, results };
}

export async function checkCrawlerDatabase() {
  try {
    const result = await pool.query("SELECT NOW() AS now");
    return { connected: true, now: result.rows[0]?.now || null };
  } catch (error) {
    return { connected: false, error: error?.message || String(error) };
  }
}

export async function closeCrawlerDatabase() { await pool.end(); }
async function main() {
  console.log("[HEXORA] Crawler starting...");

  const db = await checkCrawlerDatabase();

  if (!db.connected) {
    throw new Error(`[HEXORA] Database connection failed: ${db.error}`);
  }

  console.log("[HEXORA] Database connected:", db.now);
  console.log("[HEXORA] Crawler is ready and waiting for crawl jobs...");

  while (true) {
    try {
      const result = await pool.query(`
        SELECT id, url
        FROM crawl_queue
        WHERE status = 'pending'
        ORDER BY priority DESC, id ASC
        LIMIT 5
      `);

      if (result.rows.length === 0) {
        console.log("[HEXORA] No pending jobs. Waiting 10 seconds...");
        await sleep(10000);
        continue;
      }

      for (const job of result.rows) {
        await pool.query(
          `UPDATE crawl_queue SET status='processing', started_at=NOW()
           WHERE id=$1`,
          [job.id]
        );

        console.log(`[HEXORA] Crawling: ${job.url}`);

        await crawlUrl(job);
      }
    } catch (error) {
      console.error("[HEXORA] Worker error:", error?.message || error);
      await sleep(5000);
    }
  }
}

main().catch((error) => {
  console.error("[HEXORA] Fatal crawler error:", error);
  process.exit(1);
});
