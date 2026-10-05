# HEXORA Railway Deployment

## Search service
Railway Start Command:

```bash
node server.mjs
```

Required variable:

```text
DATABASE_URL
```

Recommended variables:

```text
DB_POOL_MAX=8
```

## Crawler service
Create a second Railway service from the same GitHub repository.

Start Command:

```bash
node worker/worker.mjs
```

Required variables:

```text
DATABASE_URL
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME
```

Optional crawler variables:

```text
CRAWL_BATCH_SIZE=8
CRAWL_INTERVAL_MS=15000
CRAWL_TIMEOUT_MS=15000
CRAWL_MAX_HTML_BYTES=3000000
CRAWL_MAX_CONTENT=120000
CRAWL_MAX_LINKS=150
CRAWL_DOMAIN_DELAY_MS=1000
```

Search and crawler use the same Neon database but run as separate Railway services.
