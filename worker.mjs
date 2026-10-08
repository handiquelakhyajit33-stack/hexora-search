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
  60000,
  Number(
    process.env.DEMAND_REFRESH_INTERVAL_MS || 900000
  )
);

let stopping = false;

let lastDemandRun = 0;

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
  `[HEXORA] batch=${
    process.env.CRAWL_BATCH_SIZE || 5
  }`
);

async function sleep(ms) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}

async function runDemandRefresh() {
  const now = Date.now();

  if (
    now - lastDemandRun <
    DEMAND_INTERVAL
  ) {
    return;
  }

  lastDemandRun = now;

  try {
    console.log(
      "[HEXORA] refreshing search demand..."
    );

    const module =
      await import("../demand-trends.mjs");

    console.log(
      "[HEXORA] demand refresh completed"
    );
  } catch (error) {
    console.error(
      "[HEXORA] demand refresh failed:",
      error?.message || error
    );
  }
}

async function loop() {
  while (!stopping) {
    try {
      await runDemandRefresh();
    } catch (error) {
      console.error(
        "[HEXORA] demand cycle error:",
        error?.message || error
      );
    }

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
      await sleep(CRAWL_INTERVAL);
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
```
