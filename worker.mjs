import pg from "pg";
import { crawlBatch, checkCrawlerDatabase, closeCrawlerDatabase } from "../crawler.mjs";

const { Pool } = pg;
const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
if (!DATABASE_URL) throw new Error("[HEXORA] DATABASE_URL is missing");

const BATCH_SIZE = Math.max(1, Number(process.env.CRAWL_BATCH_SIZE || 8));
const INTERVAL_MS = Math.max(5000, Number(process.env.CRAWL_INTERVAL_MS || 15000));
const STALE_MINUTES = Math.max(5, Number(process.env.CRAWL_STALE_MINUTES || 30));
const pool = new Pool({
  connectionString: DATABASE_URL,
  max: Math.max(2, Number(process.env.CRAWL_WORKER_DB_POOL_MAX || 5)),
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000,
  ssl: /neon\.tech|neon\.com|neon\.io|neon\./i.test(DATABASE_URL) ? { rejectUnauthorized: false } : undefined,
});

let running = false;
let stopping = false;
let timer = null;

async function resetStaleJobs() {
  await pool.query(
    `UPDATE crawl_queue
     SET status='pending', started_at=NULL, error=COALESCE(error,'') || ' [reset after worker timeout]'
     WHERE status='processing'
       AND started_at < NOW() - ($1::text || ' minutes')::interval`,
    [String(STALE_MINUTES)]
  );
}

async function claimJobs(limit) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT id,url,priority,discovered_from
       FROM crawl_queue
       WHERE status='pending' AND attempts < $1
       ORDER BY priority DESC, created_at ASC
       FOR UPDATE SKIP LOCKED LIMIT $2`,
      [Math.max(1, Number(process.env.CRAWL_MAX_ATTEMPTS || 4)), limit]
    );
    if (!rows.length) {
      await client.query("COMMIT");
      return [];
    }
    const ids = rows.map((r) => r.id);
    await client.query(
      `UPDATE crawl_queue SET status='processing',started_at=NOW(),attempts=attempts+1 WHERE id=ANY($1::bigint[])`,
      [ids]
    );
    await client.query("COMMIT");
    return rows;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function runCycle() {
  if (running || stopping) return;
  running = true;
  const started = Date.now();
  try {
    await resetStaleJobs();
    const jobs = await claimJobs(BATCH_SIZE);
    if (!jobs.length) {
      console.log("[HEXORA] Crawler: queue empty");
      return;
    }
    const result = await crawlBatch(jobs);
    console.log(`[HEXORA] Crawler cycle: total=${result.total} successful=${result.successful} failed=${result.failed} durationMs=${Date.now() - started}`);
  } catch (error) {
    console.error("[HEXORA] Crawler cycle error:", error);
  } finally {
    running = false;
  }
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  if (timer) clearInterval(timer);
  console.log(`[HEXORA] ${signal} received; stopping crawler`);
  await closeCrawlerDatabase().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (e) => console.error("[HEXORA] Unhandled rejection:", e));
process.on("uncaughtException", (e) => console.error("[HEXORA] Uncaught exception:", e));

const health = await checkCrawlerDatabase();
if (!health.connected) throw new Error(`[HEXORA] Neon connection failed: ${health.error}`);
console.log(`[HEXORA] Crawler worker ready; batch=${BATCH_SIZE}; intervalMs=${INTERVAL_MS}`);
await runCycle();
timer = setInterval(runCycle, INTERVAL_MS);
