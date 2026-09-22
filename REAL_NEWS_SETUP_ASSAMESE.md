HEXORA REAL NEWS SETUP

এই build-ত News card-ত কোনো sample/fake/AI-generated news লিখা নাই।
News table-ত কেৱল publisher feed-ৰ পৰা অহা:
- title
- description/excerpt
- source name
- source domain
- original article URL
- published time
- optional publisher-provided image

Netlify Scheduled Function `news-sync` প্রতি 30 মিনিটত configured publisher feeds fetch কৰে।

বৰ্তমান configured:
- The Indian Express — India
- The Indian Express — Assam
- The Indian Express — North East India
- The Indian Express — Technology
- The Indian Express — Sports
- The Indian Express — Cricket
- The Indian Express — Education
- The Indian Express — World

The Indian Express নিজেই এই RSS feeds publish কৰে; তেওঁলোকৰ RSS page-ত Assam, India, Sports, Cricket, Education, World আদি feed paths listed আছে.

IMPORTANT COPYRIGHT:
RSS feed use কৰাটো source terms/license অনুসৰি কৰিব লাগিব। Indian Express-এ RSS terms-ত personal/non-commercial use বুলি উল্লেখ কৰিছে আৰু commercial/public useৰ বাবে permission/license লাগিব পাৰে। HEXORA-ই full article copy নকৰে; headline + short description + source + original link দেখুৱায়। Public/commercial launchৰ আগতে source permissions/terms verify কৰক.

AI rule:
HEXORA-ৰ news ingestion pipeline-এ headline বা news story generate নকৰে। UI-ত দেখুওৱা news source feedৰ পৰা অহা metadata। কোনো source feed unavailable হলে HEXORA fake placeholder news দেখুৱাব নোৱাৰে।

Web search:
Web search HEXORA-ৰ own pages indexৰ পৰা চলে। Crawler robots.txt আৰু crawl restrictions মানে। Coverage যত crawl/index হব, তত search result বৃদ্ধি পাব।

Deploy:
1. Supabase SQL Editor -> `supabase/schema.sql` সম্পূৰ্ণ Run.
2. Netlify deploy.
3. Environment variables:
   SUPABASE_URL
   SUPABASE_SERVICE_ROLE_KEY
   ADMIN_TOKEN
   HEXORA_SEED_URLS
4. Redeploy.
5. প্ৰথমবাৰ `/.netlify/functions/news-sync-manual`-লৈ POST কৰি real news sync কৰিব পাৰিব (x-admin-token header সহ).
