```javascript
// ============================================================
// HEXORA SEARCH ENGINE
// CRAWLER WORKER
// ============================================================

// Load the complete crawler module.
// We use namespace import so Railway will NOT fail with
// "does not provide an export named crawlBatch" at startup.

import * as crawler from "../crawler.mjs";

// ============================================================
// CONFIG
// ============================================================

const INTERVAL_MS =
  Number(
    process.env.CRAWLER_INTERVAL_MS || 15000
  );

const BATCH_SIZE =
  Number(
    process.env.CRAWLER_BATCH_SIZE || 12
  );

// Prevent two crawl batches from running together.
let running = false;

// ============================================================
// STARTUP INFORMATION
// ============================================================

console.log(
  "============================================================"
);

console.log(
  "[HEXORA] CRAWLER WORKER STARTING"
);

console.log(
  "[HEXORA] Interval: " +
    INTERVAL_MS +
    " ms"
);

console.log(
  "[HEXORA] Batch size: " +
    BATCH_SIZE
);

console.log(
  "[HEXORA] crawler.mjs exports: " +
    Object.keys(crawler).join(", ")
);

console.log(
  "============================================================"
);

// ============================================================
// CHECK REQUIRED FUNCTIONS
// ============================================================

function checkCrawlerFunctions() {
  const requiredFunctions = [
    "crawlBatch",
    "seedQueue",
    "normalizeOldQueueStatuses"
  ];

  for (
    const functionName of requiredFunctions
  ) {
    if (
      typeof crawler[functionName] !==
      "function"
    ) {
      console.error(
        "[HEXORA] Missing crawler function: " +
          functionName
      );
    } else {
      console.log(
        "[HEXORA] Found crawler function: " +
          functionName
      );
    }
  }

  if (
    typeof crawler.crawlBatch !==
    "function"
  ) {
    throw new Error(
      "crawler.mjs does not export crawlBatch()"
    );
  }
}

// ============================================================
// QUEUE RECOVERY
// ============================================================

async function recoverQueue() {
  console.log(
    "[HEXORA] Checking crawler queue..."
  );

  try {
    if (
      typeof crawler.normalizeOldQueueStatuses ===
      "function"
    ) {
      await crawler.normalizeOldQueueStatuses();

      console.log(
        "[HEXORA] Queue recovery completed"
      );
    } else {
      console.log(
        "[HEXORA] Queue recovery function not available"
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
  console.log(
    "[HEXORA] Preparing seed queue..."
  );

  try {
    if (
      typeof crawler.seedQueue ===
      "function"
    ) {
      await crawler.seedQueue();

      console.log(
        "[HEXORA] Seed queue ready"
      );
    } else {
      console.log(
        "[HEXORA] seedQueue() not available"
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
// RUN CRAWL BATCH
// ============================================================

async function runBatch() {
  if (running) {
    console.log(
      "[HEXORA] Previous crawl batch is still running"
    );

    return;
  }

  running = true;

  try {
    console.log(
      "------------------------------------------------------------"
    );

    console.log(
      "[HEXORA] Starting crawl batch: " +
        BATCH_SIZE
    );

    const result =
      await crawler.crawlBatch(
        BATCH_SIZE
      );

    console.log(
      "[HEXORA] Batch completed"
    );

    console.log(
      "[HEXORA] Processed: " +
        (result?.processed || 0)
    );

    console.log(
      "[HEXORA] Successful: " +
        (result?.successful || 0)
    );

    console.log(
      "[HEXORA] Failed: " +
        (result?.failed || 0)
    );

    console.log(
      "------------------------------------------------------------"
    );

    return result;
  } catch (error) {
    console.error(
      "[HEXORA] Crawl batch error:",
      error?.message || error
    );

    if (error?.stack) {
      console.error(
        error.stack
      );
    }
  } finally {
    running = false;
  }
}

// ============================================================
// WORKER START
// ============================================================

async function startWorker() {
  try {
    // First verify that crawler.mjs contains
    // the functions required by this worker.
    checkCrawlerFunctions();

    // Recover any old queue states.
    await recoverQueue();

    // Add/prepare crawler seeds.
    await prepareSeeds();

    // Run first batch immediately.
    await runBatch();

    // Continue crawling periodically.
    setInterval(
      async function () {
        await runBatch();
      },
      INTERVAL_MS
    );

    console.log(
      "[HEXORA] Crawler worker is now running"
    );

    console.log(
      "[HEXORA] Waiting for next crawl cycle..."
    );
  } catch (error) {
    consol
```
