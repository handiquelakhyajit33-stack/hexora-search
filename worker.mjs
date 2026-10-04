// ============================================================
// HEXORA SEARCH ENGINE - CRAWLER WORKER
// Neon queue -> crawler.mjs
// ============================================================

import pg from "pg";
import {
  crawlBatch,
  closeCrawlerDatabase,
} from "../crawler.mjs";

const { Pool } = pg;

// ============================================================
// CONFIG
// ============================================================

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("[HEXORA] DATABASE_URL is missing");
  process.exit(1);
}

const BATCH_SIZE = Number(process.env.CRAWL_BATCH_SIZE || 12);
const INTERVAL_MS = Number(process.env.CRAWL_INTERVAL_MS || 15000);

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 5,
  ssl: {
    rejectUnauthorized: false,
  },
});

// ============================================================
// DATABASE TEST
// ============================================================

async function checkDatabase() {
  const result = await pool.query("SELECT NOW() AS now");

  console.log(
    `[HEXORA] Neon connected: ${result.rows[0].now}`
  );
}

// ============================================================
// CLAIM JOBS
// ============================================================

async function claimJobs(limit) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `
      SELECT id, url, status, created_at
      FROM crawl_queue
      WHERE status = 'queued'
      ORDER BY id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT $1
      `,
      [limit]
    );

    if (result.rows.length === 0) {
      await client.query("COMMIT");
      return [];
    }

    const ids = result.rows.map((row) => row.id);

    await client.query(
      `
      UPDATE crawl_queue
      SET status = 'processing'
      WHERE id = ANY($1::bigint[])
      `,
      [ids]
    );

    await client.query("COMMIT");

    console.log(
      `[HEXORA] Claimed ${result.rows.length} jobs`
    );

    return result.rows;
  } catch (error) {
    await client.query("ROLLBACK");

    console.error(
      "[HEXORA] Queue claim error:",
      error.message
    );

    return [];
  } finally {
    client.release();
  }
}

// ============================================================
// RESET STUCK PROCESSING JOBS
// ============================================================

async function resetStuckJobs() {
  try {
    const result = await pool.query(
      `
      UPDATE crawl_queue
      SET status = 'queued'
      WHERE status = 'processing'
      AND (
        last_crawled_at IS NULL
        OR last_crawled_at < NOW() - INTERVAL '30 minutes'
      )
      RETURNING id
      `
    );

    if (result.rowCount > 0) {
      console.log(
        `[HEXORA] Reset ${result.rowCount} stuck processing jobs`
      );
    }
  } catch (error) {
    console.error(
      "[HEXORA] Stuck-job reset error:",
      error.message
    );
  }
}

// ============================================================
// RUN ONE CYCLE
// ============================================================

let running = false;

async function runCycle() {
  if (running) {
    return;
  }

  running = true;

  try {
    await resetStuckJobs();

    const jobs = await claimJobs(BATCH_SIZE);

    if (jobs.length === 0) {
      console.log(
        "[HEXORA] No queued jobs available"
      );

      return;
    }

    console.log(
      `[HEXORA] Processing ${jobs.length} URLs`
    );

    const result = await crawlBatch(jobs);

    console.log(
      `[HEXORA] Batch complete: total=${result.total} successful=${result.successful} failed=${result.failed}`
    );
  } catch (error) {
    console.error(
      "[HEXORA] Worker cycle error:",
      error
    );
  } finally {
    running = false;
  }
}

// ============================================================
// START
// ============================================================

async function start() {
  try {
    await checkDatabase();

    console.log(
      `[HEXORA] crawler worker started: interval=${INTERVAL_MS}ms batch=${BATCH_SIZE}`
    );

    await runCycle();

    setInterval(runCycle, INTERVAL_MS);
  } catch (error) {
    console.error(
      "[HEXORA] Worker startup failed:",
      error
    );

    process.exit(1);
  }
}

// ============================================================
// SHUTDOWN
// ============================================================

async function shutdown(signal) {
  console.log(
    `[HEXORA] ${signal} received. Shutting down...`
  );

  try {
    await closeCrawlerDatabase();
  } catch {}

  try {
    await pool.end();
  } catch {}

  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

start();
