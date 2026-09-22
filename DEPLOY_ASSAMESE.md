HEXORA FINAL NETLIFY DEPLOY

1) Supabase খুলক.
2) SQL Editor -> supabase/schema.sql-ৰ সকলো SQL paste -> Run.
3) Netlify-ত এই ZIP deploy কৰক.
4) Netlify -> Site configuration -> Environment variables:
   SUPABASE_URL = আপোনাৰ Supabase URL
   SUPABASE_SERVICE_ROLE_KEY = Supabase service role key
   ADMIN_TOKEN = নিজৰ এটা secret token
   HEXORA_SEED_URLS = https://en.wikipedia.org/,https://www.india.gov.in/,https://assam.gov.in/,https://www.python.org/

5) Redeploy.

Scheduled crawler:
- প্রতি 2 ঘণ্টাত চলিব.
- প্রথমে seed URLs queue কৰিব.
- প্রতি run-ত কেইটামান page fetch কৰি pages table-ত index কৰিব.
- discovered links queue-ত যোগ হ'ব.

Manual seed:
POST /.netlify/functions/seed
Header: x-admin-token: YOUR_ADMIN_TOKEN
JSON:
{"urls":["https://example.com"]}

Search:
Homepage-ত query লিখিলেই /.netlify/functions/search নিজৰ Supabase index search কৰিব.

IMPORTANT:
HEXORA বাহিৰৰ Google/Bing/Tavily search-result API ব্যৱহাৰ নকৰে. Search coverage index হোৱা pages-ৰ ওপৰত নিৰ্ভৰ কৰিব. Netlify scheduled functions 30-second execution limit-ৰ বাবে crawler-টো small batches-ত design কৰা হৈছে; বৃহৎ web-scale crawlingৰ বাবে Netlify Background Functions/অন্য worker infrastructure ব্যৱহাৰ কৰিব লাগিব.

Mobile fix: responsive header, single HEXORA hero, horizontally scrollable search tabs/trending chips, stacked cards, no duplicated screenshot background.
