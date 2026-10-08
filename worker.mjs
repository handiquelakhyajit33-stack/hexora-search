```js
import {
  runCrawlCycle,
  shutdownCrawler,
} from "../crawler.mjs";

const CRAWL_INTERVAL = Math.max(
  5000,
  Number(
    process.env.CRAWL_WORKER_INTERVAL_MS || 15000
  )
);

const DEMAND_INTERVAL = Math.max(
  15 * 60 * 1000,
  Number(
    process.env.DEMAND_REFRESH_INTERVAL_MS ||
      60 * 60 * 1000
  )
);

let stopping = false;
let demandRunning = false;

console.log(
  "[HEXORA] crawler worker started"
);

console.log(
  `[HEXORA] crawl interval=${CRAWL_INTERVAL}ms`
);

console.log(
  `[HEXORA] demand refresh interval=${DEMAND_INTERVAL}ms`
);

console.log(
  `[HEXORA] crawl batch=${
    process.env.CRAWL_BATCH_SIZE || 5
  }`
);

async function sleep(ms) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}

/*
 * Run the demand collector.
 *
 * This is intentionally isolated from the crawler.
 * If demand collection fails, the crawler continues.
 */
async function refreshDemand() {
  if (demandRunning) {
    return;
  }

  demandRunning = true;

  try {
    console.log(
      "[HEXORA] starting demand intelligence..."
    );

    const module =
      await import("../demand-trends.mjs");

    if (
      typeof module.runDemandCollection ===
      "function"
    ) {
      await module.runDemandCollection();

      console.log(
        "[HEXORA] demand intelligence completed"
      );
    } else {
      console.warn(
        "[HEXORA] demand collector does not export runDemandCollection()"
      );
    }
  } catch (error) {
    /*
     * IMPORTANT:
     * Demand collector failure must NEVER
     * stop the HEXORA crawler.
     */
    console.error(
      "[HEXORA] demand intelligence failed:",
      error?.message || error
    );
  } finally {
    demandRunning = false;
  }
}

async function crawl() {
  try {
    const result =
      await runCrawlCycle();

    console.log(
      `[HEXORA] cycle: ` +
      `jobs=${result.jobs}, ` +
      `indexed=${result.indexed}, ` +
      `failed=${result.failed}, ` +
      `blocked=${result.blocked}, ` +
      `discovered=${result.di
```
