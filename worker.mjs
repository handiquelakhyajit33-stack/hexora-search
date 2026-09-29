import {
  runCrawler,
  crawlBatch,
  normalizeOldQueueStatuses,
  seedQueue,
} from "../crawler.mjs";

const INTERVAL_MS = Number(
  process.env.CRAWLER_INTERVAL_MS || 15000
);

const BATCH_SIZE = Number(
  process.env.CRAWLER_BATCH_SIZE || 12
);

let running = false;

async function recoverQueue() {
  try {
    await normalizeOldQueueStatuses();
    console.log("[HEXORA] Queue recovery completed");
  } catch (error) {
    console.error(
      "[HEXORA] Queue recovery failed:",
      error?.message || error
    );
  }
}

async function runBatch() {
  if (running) {
    console.log("[HEXORA] Previous crawl batch still running");
    return;
  }

  running = true;

  try {
    console.log(
      `[HEXORA] Starting crawl batch: ${BATCH_SIZE}`
    );

    const result = await crawlBatch(BATCH_SIZE);

    console.log(
      `[HEXORA] Batch completed | processed: ${
        result?.processed ?? 0
      } | successful: ${
        result?.successful ?? 0
      } | failed: ${
        result?.failed ?? 0
      }`
    );

    return result;
  } catch (error) {
    console.error(
      "[HEXORA] Crawl batch error:",
      error?.message || error
    );
  } finally {
    running = false;
  }
}

async function startWorker() {
  console.log(
    `[HEXORA] crawler worker started: interval=${INTERVAL_MS}ms batch=${BATCH_SIZE}`
  );

  // Recover old queue states
  await recoverQueue();

  // Make sure seed URLs exist
  try {
    await seedQueue();
    console.log("[HEXORA] Seed queue ready");
  } catch (error) {
    console.error(
      "[HEXORA] Seed queue error:",
      error?.message || error
    );
  }

  // First crawl immediately
  await runBatch();

  // Continuous crawling
  setInterval(async () => {
    await runBatch();
  }, INTERVAL_MS);
}

// Prevent unhandled promise crashes
process.on("unhandledRejection", (error) => {
  console.error(
    "[HEXORA] Unhandled rejection:",
    error?.message || error
  );
});

process.on("uncaughtException", (error) => {
  console.error(
    "[HEXORA] Uncaught exception:",
    error?.message || error
  );
});

startWorker().catch((error) => {
  console.error(
    "[HEXORA] Worker startup failed:",
    error?.message || error
  );

  process.exit(1);
});
