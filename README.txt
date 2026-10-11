HEXORA server package

Included:
- server.mjs: Node.js HTTP API server using Neon/PostgreSQL
- package.json: runtime dependencies and syntax-check script
- .env.example: required/optional environment variable names
- pages-compat.sql: non-destructive compatibility migration for the pages table

Verification performed in this package build:
1. `node --check server.mjs` passed (JavaScript syntax check).
2. ZIP archive integrity test passed after packaging.

Important limitations:
- A syntax check cannot guarantee the deployed service will never crash. Runtime also depends on a valid Neon DATABASE_URL, network access, database permissions, the compatibility SQL having been applied, and the existing frontend files (e.g. index.html) if the website UI is served by this same service.
- This package has not been tested against your live Neon/Supabase/Railway environment because those credentials and runtime services are not available here.
- The server reads search pages from Neon `pages`; this package does not include the crawler worker or Common Crawl importer.
- The SQL does not delete existing page data. Back up the database before making schema changes.

Deploy steps:
1. Extract the ZIP and place server.mjs/package.json in the Railway service repository root.
2. Ensure Railway uses `npm install` and `npm start`.
3. Set DATABASE_URL to the Neon connection string (do not paste secrets into chat).
4. Run pages-compat.sql on the Neon database using the SQL editor.
5. Run `npm run check` locally or in the build environment, then deploy.
6. Check `https://YOUR-RAILWAY-DOMAIN/health` and inspect Railway logs.
