# HEXORA — R2-only crawler and combined search (Assamese)

## What this project does
- The continuous crawler and Common Crawl importer save new HTML, metadata, deduplication keys, queue records and search-index JSON documents to Cloudflare R2 only.
- They do not import `pg` and do not connect to or write to Neon.
- The API server can read the existing Neon index and combines it with the R2 index. Do not run migration scripts if you want to keep Neon untouched.
- The crawler uses seed URLs by default; `CRAWL_SEED_URLS` can override the defaults.
- Duplicate normalized URLs are skipped when their `index/<hostname>/<sha256-url>.json` object already exists.

## Railway services
1. API/server service start command: `npm start`.
2. Crawler service start command: `npm run crawler`.
3. Common Crawl importer: run `npm run import:commoncrawl` as a separate one-time/job service. Do not use this command as the always-on crawler.
4. Set these variables in every service that accesses R2: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME=hexora`.
5. Set `DATABASE_URL` only in the API/server service if you want it to read old Neon results. Do not set it in crawler/importer services.
6. Deploy the server and crawler separately; don't replace the existing server start command with the crawler command.

## If logs show “request signature does not match”
- Create a Cloudflare R2 API token with Object Read & Write access for the `hexora` bucket.
- Copy its **Access Key ID** and **Secret Access Key** as a pair, plus the correct Cloudflare Account ID. These values must be from the same R2 token/account.
- Re-enter the values in Railway Variables without quotes or extra spaces, check `R2_BUCKET_NAME=hexora`, then redeploy the crawler.
- Never send the secret key in chat or commit it to GitHub. Code trims surrounding whitespace but cannot repair a wrong/revoked key or an account/key mismatch.
- The crawler now checks the R2 bucket before entering its loop and exits with one clear error if authentication fails instead of repeating the same error forever.

## Important limits
- This is a search-engine foundation, not Google-scale coverage. The Common Crawl default domain list is a sample, while the continuous crawler expands from seed links subject to each site's robots policy and rate limits.
- R2 is object storage, not a native full-text search database. The API loads a bounded set of JSON index objects into memory and caches it; very large indexes need a dedicated sharded index/search service to remain fast.
- Syntax checks passed for the JavaScript files in this package. This ZIP has not been live-tested against your Railway environment, R2 credentials, Neon database or Common Crawl; no ZIP can guarantee zero crashes before those external settings are validated.
