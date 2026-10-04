import {
  claimJobs,
  crawlOne,
  closeCrawlerDB
} from "../crawler.mjs";


const intervalMs =
  Math.max(
    5000,
    Number(
      process.env.CRAWL_INTERVAL_MS ||
      15000
    )
  );


const batchSize =
  Math.max(
    1,
    Number(
      process.env.CRAWL_BATCH_SIZE ||
      12
    )
  );


const concurrency =
  Math.max(
    1,
    Number(
      process.env.CRAWL_CONCURRENCY ||
      3
    )
  );


console.log(
  `[HEXORA] Neon/R2 crawler started: interval=${intervalMs}ms batch=${batchSize} concurrency=${concurrency}`
);


let stopping =
  false;


for (
  const signal of
  [
    "SIGINT",
    "SIGTERM"
  ]
) {

  process.on(
    signal,
    () => {

      stopping =
        true;

      console.log(
        `[HEXORA] ${signal}; stopping after current cycle.`
      );

    }
  );
}


while (!stopping) {

  try {

    const jobs =
      await claimJobs(
        batchSize
      );


    let success =
      0;

    let failed =
      0;

    let blocked =
      0;


    for (
      let i = 0;
      i < jobs.length;
      i += concurrency
    ) {

      const results =
        await Promise.all(

          jobs
            .slice(
              i,
              i + concurrency
            )

            .map(
              crawlOne
            )

        );


      for (
        const r of
        results
      ) {

        if (
          r.status ===
          "success"
        ) {

          success++;

        } else if (
          r.status ===
          "blocked"
        ) {

          blocked++;

        } else {

          failed++;

        }
      }
    }


    console.log(
      new Date().toISOString(),
      "crawl cycle",
      {
        processed:
          jobs.length,

        success,

        failed,

        blocked
      }
    );


  } catch (e) {

    console.error(
      "[HEXORA] crawl cycle failed:",
      e
    );
  }


  if (!stopping) {

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          intervalMs
        )
    );

  }
}


await closeCrawlerDB();


console.log(
  "[HEXORA] crawler stopped"
);
