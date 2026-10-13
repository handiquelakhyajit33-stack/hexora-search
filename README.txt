HEXORA backend package

Included:
- server.mjs: Neon/PostgreSQL search API, ads/PayPal endpoints from the supplied server source, plus Supabase Auth health endpoint check.
- crawler.mjs: supplied Neon + R2 crawler with storage protection.
- package.json: Node dependencies and scripts.

Important:
1. This ZIP contains the backend files available in this conversation. It does not include index.html or other frontend files because they were not present in the supplied files.
2. Keep your existing Railway environment variables and data. Do not clear Neon, Supabase, or R2.
3. Required variables include DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, and R2_ENDPOINT.
4. The crawler checks R2 usage using CLOUDFLARE_API_TOKEN or CF_API_TOKEN. If neither is configured, R2 usage may report unknown and the crawler can remain paused under storage protection. Do not disable storage protection to bypass this.
5. Supabase check in server.mjs verifies the Supabase Auth health endpoint. It does not migrate or sync database tables.
6. Before deploying, back up the current files. After extracting, run: npm install, then npm run check.
7. Railway service start command: npm start. For a separate crawler service, start command: npm run crawler.
