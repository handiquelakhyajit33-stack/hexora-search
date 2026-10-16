HEXORA — UI-PRESERVED R2 PACKAGE

UI preservation: index.html and main.js are byte-for-byte identical to the supplied hexora-search-main (10).zip. No UI redesign was made.

Architecture: crawler.mjs and commoncrawl-importer.mjs store new crawl/import records and per-page JSON search documents in Cloudflare R2 and do not connect to or write to Neon. server.mjs combines the existing Neon results (when DATABASE_URL is configured on the API service) with the R2 index.

Important limits: R2 is object storage, not a native full-text search database. The current server reads a bounded number of R2 index objects (R2_INDEX_MAX_OBJECTS, default 10,000), so this is a working foundation but not Google-scale coverage or performance. Live R2 credentials and Railway deployment were not tested here. Keep DATABASE_URL only on the API/server service if you want existing Neon results; do not add it to crawler/importer services. Do not run migration scripts unless you intend to migrate data.

Deployment: API service command `npm start`; crawler service command `npm run crawler`; Common Crawl importer should run as a separate job with `npm run import:commoncrawl`. Configure R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME=hexora in each R2-using service. Re-enter credentials in Railway; do not share secret keys in chat.
