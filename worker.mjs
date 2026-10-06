import {
  runCrawlCycle,
  shutdownCrawler
} from "../crawler.mjs";

const INTERVAL = Math.max(
  5000,
  Number(process.env.CRAWL_WORKER_INTERVAL_MS || 15000)
);

let stopping = false;

console.log(
  `[HEXORA] crawler worker started`
);

console.log(
  `[HEXORA] interval=${INTERVAL}ms`
);

console.log(
  `[HEXORA] batch=${process.env.CRAWL_BATCH_SIZE || 5}`
);

async function loop() {
  while (!stopping) {
    try {
      const result =
        await runCrawlCycle();

      console.log(
        `[HEXORA] cycle: jobs=${result.jobs}, completed=${result.completed}`
      );
    } catch (error) {
      console.error(
        "[HEXORA] crawl cycle failed:",
        error?.message || error
      );

      await new Promise(resolve =>
        setTimeout(resolve, 15000)
      );
    }

    if (!stopping) {
      await new Promise(resolve =>
        setTimeout(resolve, INTERVAL)
      );
    }
  }
}

async function stop(signal) {
  if (stopping) return;

  stopping = true;

  console.log(
    `[HEXORA] ${signal} received`
  );

  try {
    await shutdownCrawler();
  } catch {}

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
