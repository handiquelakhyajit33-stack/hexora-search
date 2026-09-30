```javascript
// ============================================================
// HEXORA SEARCH ENGINE - CRAWLER WORKER
// ============================================================

import {
  crawlBatch,
  normalizeOldQueueStatuses,
  seedQueue
} from "../crawler.mjs";

// ============================================================
// CONFIG
// ============================================================

const INTERVAL_MS =
  Number(
    process.env.CRAWLER_INTERVAL_MS ||
      15000
  );

const BATCH_SIZE =
  Number(
    process.env.CRAWLER_BATCH_SIZE ||
      12
  );

let running = false;

// ============================================================
// QUEUE RECOVERY
// ============================================================

async function recoverQueue() {
  try {
    await normalizeOldQueueStatuses();

    console.log(
      "[HEXORA] Queue recovery completed"
    );
  } catch (error) {
    console.error(
      "[HEXORA] Queue recovery failed:",
      error?.message ||
        error
    );
  }
}

// ============================================================
// SEED
// ============================================================

async function prepareSeeds() {
  try {
    await seedQueue();

    console.log(
      "[HEXORA] Seed queue ready"
    );
  } catch (error) {
    console.error(
      "[HEXORA] Seed queue error:",
      error?.message ||
        error
    );
  }
}

// ============================================================
// RUN BATCH
// ============================================================

async function runBatch() {
  if (running) {
    console.log(
      "[HEXORA] Previous crawl batch still running"
    );

    return;
  }

  running = true;

  try {
    console.log(
      "[HEXORA] Starting crawl batch: " +
        BATCH_SIZE
    );

    const result =
      await crawlBatch(
        BATCH_SIZE
      );

    console.log(
      "[HEXORA] Batch completed | processed: " +
        (result?.processed || 0) +
        " | successful: " +
        (result?.successful || 0) +
        " | failed: " +
        (result?.failed || 0)
    );
  } catch (error) {
    console.error(
      "[HEXORA] Crawl batch error:",
      error?.message ||
        error
    );
  } finally {
    running = false;
  }
}

// ============================================================
// START WORKER
// ============================================================

async function startWorker() {
  console.log(
    "[HEXORA] crawler worker started | interval=" +
      INTERVAL_MS +
      "ms | batch=" +
      BATCH_SIZE
  );

  await recoverQueue();

  await prepareSeeds();

  // First crawl immediately
  await runBatch();

  // Continuous crawling
  setInterval(
    function() {
      runBatch();
    },
    INTERVAL_MS
  );
}

// ============================================================
// ERROR HANDLERS
// ============================================================

process.on(
  "unhandledRejection",
  function(error) {
    console.error(
      "[HEXORA] Unhandled rejection:",
      error?.message ||
        error
    );
  }
);

process.on(
  "uncaughtException",
  function(error) {
    console.error(
      "[HEXORA] Uncaught exception:",
      error?.message ||
        error
    );
  }
);

// ============================================================
// START
// ============================================================

startWorker().catch(
  function(error) {
    console.error(
      "[HEXORA] Worker startup failed:",
      error?.message ||
        error
    );

    process.exit(1);
  }
);
```
