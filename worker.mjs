import {
  crawlBatch,
  seedQueue,
  normalizeOldQueueStatuses
} from "../crawler.mjs";

const INTERVAL_MS =
  Math.max(
    10000,
    Number(
      process.env.CRAWL_INTERVAL_MS ||
        30000
    )
  );

const BATCH_SIZE =
  Math.max(
    1,
    Number(
      process.env.CRAWL_BATCH_SIZE ||
        12
    )
  );

let stopping = false;
let running = false;

for (
  const signal of [
    "SIGINT",
    "SIGTERM"
  ]
) {
  process.on(
    signal,
    () => {
      stopping = true;

      console.log(
        `[HEXORA] ${signal} received; stopping after current cycle.`
      );
    }
  );
}

async function runBatch() {
  if (running) {
    return;
  }

  running = true;

  try {
    const result =
      await crawlBatch(
        BATCH_SIZE
      );

    console.log(
      `[HEXORA] Crawl cycle: ${JSON.stringify(
        result
      )}`
    );
  } catch (error) {
    console.error(
      "[HEXORA] Crawl cycle failed:",
      error?.stack ||
        error
    );
  } finally {
    running = false;
  }
}

try {
  console.log(
    "======================================"
  );

  console.log(
    "       HEXORA CRAWLER WORKER"
  );

  console.log(
    "======================================"
  );

  await normalizeOldQueueStatuses();

  await seedQueue();

  await runBatch();

  while (!stopping) {
    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          INTERVAL_MS
        )
    );

    if (!stopping) {
      await runBatch();
    }
  }
} catch (error) {
  console.error(
    "[HEXORA] Worker fatal error:",
    error?.stack ||
      error
  );

  process.exitCode = 1;
}
