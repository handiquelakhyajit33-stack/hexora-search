# HEXORA 24/7 Crawler — Railway

This project now includes a persistent crawler worker for Railway. It is separate from the Netlify scheduled function.

## Railway service
Use the repository root as the Railway service. Start command:

    npm run crawler

## Required variables
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY

Optional:
- HEXORA_SEED_URLS — comma-separated seed URLs
- CRAWL_BATCH_SIZE — default 12
- CRAWL_CONCURRENCY — default 3
- CRAWL_INTERVAL_MS — default 15000

## Important
The worker respects robots.txt, uses the HEXORA-Bot user agent, rate-limits itself through concurrency, stores pages in Supabase, and queues discovered links. It is designed to restart after crashes.

The existing Netlify function can remain for the frontend/API, while Railway runs the 24/7 crawler.
