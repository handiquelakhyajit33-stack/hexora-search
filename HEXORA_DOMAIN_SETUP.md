# HEXORA Domain Setup

Production domain:

https://www.hexsorasearch.com

Deploy the HEXORA search service on Railway and attach the custom domain from Railway's service settings.

Configure DNS at the domain registrar exactly as Railway instructs.

Keep all secrets server-side. Never put DATABASE_URL, R2 secret keys, or SUPABASE_SERVICE_ROLE_KEY in frontend JavaScript.
