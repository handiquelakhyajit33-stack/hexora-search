```javascript
// ============================================================
// HEXORA SEARCH ENGINE - CRAWLER WORKER
// ============================================================

import * as crawler from "../crawler.mjs";

const INTERVAL_MS =
  Number(process.env.CRAWLER_INTERVAL_MS || 15000);

const BATCH_SIZE =
  Number(process.env.CRAWLER_BATCH_SIZE || 12);

let running = false;

// ============================================================
// CHECK CRAWLER MODULE
// ============================================================

console.log(
  "[HEXORA] crawler exports:",
  Object.keys(crawler).join(", ")
);

// ============================================================
// RUN ONE BATCH
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
    if (typeof crawler.crawlBatch !== "function") {
      throw new Error(
        "crawler.mjs does not contain crawlBatch()"
      );
    }

    console.log(
      "[HEXORA] Starting crawl batch: " +
        BATCH_SIZE
    );

    const result =
      await crawler.crawlBatch(BATCH_SIZE);

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
      error?.message || error
    );
  } finally {
    running = false;
  }
}

// ============================================================
// RECOVER QUEUE
// ============================================================

async function recoverQueue() {
  try {
    if (
      typeof crawler.normalizeOldQueueStatuses ===
      "function"
    ) {
      await crawler.normalizeOldQueueStatuses();

      console.log(
        "[HEXORA] Queue recovery completed"
      );
    }
  } catch (error) {
    console.error(
      "[HEXORA] Queue recovery failed:",
      error?.message || error
    );
  }
}

// ============================================================
// SEED QUEUE
// ============================================================

async function prepareSeeds() {
  try {
    if (
      typeof crawler.seedQueue === "function"
    ) {
      await crawler.seedQueue();

      console.log(
        "[HEXORA] Seed queue ready"
      );
    }
  } catch (error) {
    console.error(
      "[HEXORA] Seed queue error:",
      error?.message || error
    );
  }
}

// ============================================================
// START WORKER
// ============================================================

async function startWorker() {
  console.log(
    "[HEXORA] CRAWLER WORKER STARTING"
  );

  console.log(
    "[HEXORA] Interval:",
    INTERVAL_MS,
    "ms"
  );

  console.log(
    "[HEXORA] Batch:",
    BATCH_SIZE
  );

  await recoverQueue();

  await prepareSeeds();

  await runBatch();

  setInterval(
    async function () {
      await runBatch();
    },
    INTERVAL_MS
  );
}

// ============================================================
// ERROR HANDLING
// ============================================================

process.on(
  "unhandledRejection",
  function (error) {
    console.error(
      "[HEXORA] Unhandled rejection:",
      error?.message || error
    );
  }
);

process.on(
  "uncaughtException",
  function (error) {
    console.error(
      "[HEXORA] Uncaught exception:",
      error?.message || error
    );
  }
);

// ============================================================
// START
// ============================================================

startWorker().catch(
  function (error) {
    console.error(
      "[HEXORA] Worker startup failed:",
      error?.message || error
    );

    process.exit(1);
  }
);
```
