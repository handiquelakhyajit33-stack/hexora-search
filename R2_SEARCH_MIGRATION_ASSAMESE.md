# HEXORA — R2 Search Migration (Assamese)

এই version-ত crawler-এ Neon-লৈ কোনো INSERT/UPDATE/DELETE কৰা নহয়। নতুন page body, searchable index, আৰু queue R2-ত থাকে। Neon-ৰ পুৰণি pages delete কৰা নহয়; server-এ পুৰণি Neon result আৰু R2 index result একেলগে দেখুৱাবলৈ চেষ্টা কৰে। Neon crawl_queue-ৰ pending URL-সমূহ crawler-এ কেৱল SELECT কৰি batch-ত R2 queue-লৈ কপি কৰে।

## Railway environment variables

`hexora-crawler` আৰু `hexora-server` দুয়োটা service-ত এই variables set কৰক:
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME=hexora`

Crawler-ত `DATABASE_URL` থাকিলে সি পুৰণি `crawl_queue`-ৰ পৰা URL পঢ়ি R2-লৈ import কৰিব; crawler-এ Neon-ত status update নকৰে। Server-ত `DATABASE_URL` আগৰ দৰেই ৰাখিব, কাৰণ পুৰণি Neon search আৰু Ads/PayPal features-এ DB ব্যৱহাৰ কৰে।

Optional: `CRAWL_SEED_URLS=https://example.com,https://example.org` দিলে সেই URL-সমূহ R2 queue-ত যোগ হয়। `R2_INDEX_CACHE_MS=60000` cache refresh interval; `R2_INDEX_MAX_OBJECTS=10000` maximum index objects loaded per server process.

## Note

এই R2 JSON index implementation prototype/early scale-ৰ বাবে। অতি বৃহৎ index-ত সকলো index object server memory-ত cache কৰাৰ খৰচ বাঢ়িব পাৰে; production-scale-ৰ বাবে dedicated sharded index/search service লাগিব পাৰে।
