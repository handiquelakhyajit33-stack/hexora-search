// ============================================================
// HEXORA SEARCH ENGINE
// NEON CRAWLER WORKER
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

const DATABASE_URL = process.env.DATABASE_URL || "";

const BATCH_SIZE = Math.max(
  1,
  Number(process.env.CRAWL_BATCH_SIZE || 12)
);

const INTERVAL_MS = Math.max(
  5000,
  Number(process.env.CRAWL_INTERVAL_MS || 15000)
);

if (!DATABASE_URL) {
  console.error(
    "[HEXORA] ERROR: DATABASE_URL is missing"
  );

  process.exit(1);
}

// ============================================================
// NEON CONNECTION
// ============================================================

const pool = new Pool({
  connectionString: DATABASE_URL,

  max: 5,

  idleTimeoutMillis: 30000,

  connectionTimeoutMillis: 15000,

  ssl: {
    rejectUnauthorized: false,
  },
});

// ============================================================
// DATABASE TEST
// ============================================================

async function checkDatabase() {
  const result = await pool.query(
    "SELECT NOW() AS now"
  );

  console.log(
    `[HEXORA] Neon connected: ${result.rows[0].now}`
  );
}

// ============================================================
// QUEUE STATUS
// ============================================================

async function showQueueStatus() {
  try {
    const result = await pool.query(`
      SELECT
        status,
        COUNT(*)::bigint AS total
      FROM crawl_queue
      GROUP BY status
      ORDER BY status
    `);

    const status = {};

    for (const row of result.rows) {
      status[row.status] = Number(row.total);
    }

    console.log(
      `[HEXORA] Queue: queued=${status.queued || 0} processing=${status.processing || 0} done=${status.done || 0} failed=${status.failed || 0} error=${status.error || 0}`
    );

    return status;
  } catch (error) {
    console.error(
      "[HEXORA] Queue status error:",
      error.message
    );

    return {};
  }
}

// ============================================================
// RESET STUCK PROCESSING JOBS
// ============================================================

async function resetStuckJobs() {
  try {
    const result = await pool.query(`
      UPDATE crawl_queue
      SET
        status = 'queued',
        last_error = NULL
      WHERE status = 'processing'
      AND (
        last_crawled_at IS NULL
        OR last_crawled_at < NOW() - INTERVAL '30 minutes'
      )
      RETURNING id
    `);

    if (result.rowCount > 0) {
      console.log(
        `[HEXORA] Reset ${result.rowCount} stuck processing jobs`
      );
    }
  } catch (error) {
    console.error(
      "[HEXORA] Reset processing jobs error:",
      error.message
    );
  }
}

// ============================================================
// CLAIM QUEUED JOBS
// ============================================================

async function claimJobs(limit) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // --------------------------------------------------------
    // Lock queued jobs
    // --------------------------------------------------------

    const selected = await client.query(
      `
      SELECT
        id,
        url,
        status,
        created_at
      FROM crawl_queue
      WHERE status = 'queued'
      ORDER BY id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT $1
      `,
      [limit]
    );

    if (selected.rows.length === 0) {
      await client.query("COMMIT");

      return [];
    }

    const ids = selected.rows.map(
      (row) => row.id
    );

    // --------------------------------------------------------
    // Change queued -> processing
    // --------------------------------------------------------

    await client.query(
      `
      UPDATE crawl_queue
      SET
        status = 'processing'
      WHERE id = ANY($1::bigint[])
      `,
      [ids]
    );

    await client.query("COMMIT");

    console.log(
      `[HEXORA] Claimed ${selected.rows.length} jobs`
    );

    return selected.rows;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

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
// RUN CRAWL CYCLE
// ============================================================

let cycleRunning = false;

async function runCycle() {
  if (cycleRunning) {
    console.log(
      "[HEXORA] Previous crawl cycle is still running"
    );

    return;
  }

  cycleRunning = true;

  const startedAt = Date.now();

  try {
    // --------------------------------------------------------
    // Reset jobs stuck for more than 30 minutes
    // --------------------------------------------------------

    await resetStuckJobs();

    // --------------------------------------------------------
    // Show queue status
    // --------------------------------------------------------

    const queue = await showQueueStatus();

    if (!queue.queued || queue.queued <= 0) {
      console.log(
        "[HEXORA] No queued jobs available"
      );

      return;
    }

    // --------------------------------------------------------
    // Claim jobs
    // --------------------------------------------------------

    const jobs = await claimJobs(BATCH_SIZE);

    if (!jobs.length) {
      console.log(
        "[HEXORA] Queue had jobs, but none could be claimed"
      );

      return;
    }

    console.log(
      `[HEXORA] Processing ${jobs.length} URLs`
    );

    // --------------------------------------------------------
    // Crawl
    // --------------------------------------------------------

    const result = await crawlBatch(jobs);

    const total =
      Number(result?.total || jobs.length);

    const successful =
      Number(result?.successful || 0);

    const failed =
      Number(result?.failed || 0);

    console.log(
      `[HEXORA] Batch complete: total=${total} successful=${successful} failed=${failed}`
    );

    console.log(
      `[HEXORA] Cycle finished in ${Date.now() - startedAt}ms`
    );
  } catch (error) {
    console.error(
      "[HEXORA] Crawl cycle error:",
      error
    );

    // --------------------------------------------------------
    // If crawler itself crashes before updating jobs,
    // return currently processing jobs to queued.
    // --------------------------------------------------------

    try {
      await pool.query(`
        UPDATE crawl_queue
        SET
          status = 'queued'
        WHERE status = 'processing'
        AND last_crawled_at IS NULL
      `);
    } catch (resetError) {
      console.error(
        "[HEXORA] Emergency queue reset error:",
        resetError.message
      );
    }
  } finally {
    cycleRunning = false;
  }
}

// ============================================================
// START WORKER
// ============================================================

async function startWorker() {
  console.log(
    "============================================================"
  );

  console.log(
    "HEXORA CRAWLER WORKER"
  );

  console.log(
    "============================================================"
  );

  console.log(
    `[HEXORA] Batch size: ${BATCH_SIZE}`
  );

  console.log(
    `[HEXORA] Interval: ${INTERVAL_MS}ms`
  );

  try {
    // --------------------------------------------------------
    // Test Neon
    // --------------------------------------------------------

    await checkDatabase();

    console.log(
      "[HEXORA] Neon database ready"
    );

    console.log(
      "[HEXORA] Starting crawler loop..."
    );

    // --------------------------------------------------------
    // Run immediately
    // --------------------------------------------------------

    await runCycle();

    // --------------------------------------------------------
    // Continue forever
    // --------------------------------------------------------

    setInterval(
      runCycle,
      INTERVAL_MS
    );
  } catch (error) {
    console.error(
      "[HEXORA] Worker startup failed:",
      error
    );

    try {
      await pool.end();
    } catch {}

    process.exit(1);
  }
}

// ============================================================
// SHUTDOWN
// ============================================================

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  console.log(
    `[HEXORA] ${signal} received`
  );

  console.log(
    "[HEXORA] Shutting down worker..."
  );

  try {
    await closeCrawlerDatabase();
  } catch (error) {
    console.error(
      "[HEXORA] Crawler database close error:",
      error.message
    );
  }

  try {
    await pool.end();
  } catch (error) {
    console.error(
      "[HEXORA] Neon pool close error:",
      error.message
    );
  }

  console.log(
    "[HEXORA] Worker stopped"
  );

  process.exit(0);
}

// ============================================================
// SIGNALS
// ============================================================

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);

// ============================================================
// UNHANDLED ERRORS
// ============================================================

process.on(
  "unhandledRejection",
  (error) => {
    console.error(
      "[HEXORA] Unhandled rejection:",
      error
    );
  }
);

process.on(
  "uncaughtException",
  (error) => {
    console.error(
      "[HEXORA] Uncaught exception:",
      error
    );
  }
);

// ============================================================
// START
// ============================================================

startWorker();
