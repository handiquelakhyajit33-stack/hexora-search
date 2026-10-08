import {
  runCrawlCycle,
  shutdownCrawler
} from "../crawler.mjs";

const INTERVAL = Math.max(
  5000,
  Number(
    process.env.CRAWL_WORKER_INTERVAL_MS ||
      15000
  )
);

let stopping = false;

console.log(
  "[HEXORA] crawler worker started"
);

console.log(
  `[HEXORA] interval=${INTERVAL}ms`
);

console.log(
  `[HEXORA] batch=${
    process.env.CRAWL_BATCH_SIZE || 5
  }`
);

async function sleep(ms) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}

async function loop() {
  while (!stopping) {
    try {
      const result =
        await runCrawlCycle();

      console.log(
        `[HEXORA] cycle: ` +
        `jobs=${result.jobs}, ` +
        `indexed=${result.indexed}, ` +
        `failed=${result.failed}, ` +
        `blocked=${result.blocked}, ` +
        `discovered=${result.discovered}`
      );

      if (
        result.storagePaused
      ) {
        console.warn(
          "[HEXORA] storage protection active"
        );
      }
    } catch (error) {
      console.error(
        "[HEXORA] crawl cycle failed:",
        error?.message || error
      );

      await sleep(15000);
    }

    if (!stopping) {
      await sleep(INTERVAL);
    }
  }
}

async function stop(signal) {
  if (stopping) {
    return;
  }

  stopping = true;

  console.log(
    `[HEXORA] ${signal} received`
  );

  try {
    await shutdownCrawler();
  } catch (error) {
    console.error(
      "[HEXORA] shutdown error:",
      error?.message || error
    );
  }

  process.exit(0);
}

process.on(
  "SIGTERM",
  () => stop("SIGTERM")
);

process.on(
  "SIGINT",
  () => stop("SIGINT")
);

await loop();
