import { db } from "../netlify/functions/_supabase.mjs";
import { crawlBatch } from "./crawler.mjs";

const intervalMs = Math.max(5000, Number(process.env.CRAWL_INTERVAL_MS || 15000));
const batchSize = Math.max(1, Number(process.env.CRAWL_BATCH_SIZE || 12));

console.log(`HEXORA crawler worker started: interval=${intervalMs}ms batch=${batchSize}`);

let stopping=false;
for (const sig of ["SIGINT","SIGTERM"]) process.on(sig,()=>{ stopping=true; console.log(`Received ${sig}; stopping after current cycle.`); });

while(!stopping){
  try {
    const result=await crawlBatch(db(),batchSize);
    console.log(new Date().toISOString(), "crawl cycle", result);
  } catch (e) {
    console.error(new Date().toISOString(), "crawl cycle failed", e);
  }
  if(stopping) break;
  await new Promise(r=>setTimeout(r,intervalMs));
}
console.log("HEXORA crawler worker stopped");
