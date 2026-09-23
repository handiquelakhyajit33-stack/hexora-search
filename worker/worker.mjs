import { createClient } from "@supabase/supabase-js";
import { crawlBatch } from "../crawler.mjs";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing"
  );
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

const intervalMs = Math.max(
  5000,
  Number(process.env.CRAWL_INTERVAL_MS || 15000)
);

const batchSize = Math.max(
  1,
  Number(process.env.CRAWL_BATCH_SIZE || 12)
);

console.log(
  `HEXORA crawler worker started: interval=${intervalMs}ms batch=${batchSize}`
);

let stopping = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    console.log(
      `Received ${signal}; stopping after current cycle.`
    );
  });
}

while (!stopping) {
  try {
    const result = await crawlBatch(
      supabase,
      batchSize
    );

    console.log(
      new Date().toISOString(),
      "crawl cycle",
      result
    );
  } catch (error) {
    console.error(
      new Date().toISOString(),
      "crawl cycle failed:",
      error
    );
  }

  if (stopping) break;

  await new Promise((resolve) =>
    setTimeout(resolve, intervalMs)
  );
}

console.log("HEXORA crawler worker stopped");
