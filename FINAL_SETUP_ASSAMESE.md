# HEXORA — Clean R2 Search Package (Assamese)

## এই ZIP-ত কি আছে
- HEXORA frontend + API server
- R2-only continuous crawler
- R2-only Common Crawl importer (আলাদা job হিচাপে চলাব)
- R2 page HTML, metadata, URL de-duplication আৰু JSON search index
- আগৰ Neon index-ৰ read-only search support
- `.env.example` আৰু deployment guide

## গুৰুত্বপূৰ্ণ সীমা
কোনো ZIP-এ ভুল Cloudflare secret key ঠিক কৰিব নোৱাৰে বা Railway/R2/Neon-ত live deployment সফল হ'ব বুলি নিশ্চিত কৰিব নোৱাৰে। Deploy কৰাৰ আগতে syntax checks কৰা হৈছে; live credentials আৰু external services-ত পৰীক্ষা কৰা হোৱা নাই।

## Railway-ত variables
R2 ব্যৱহাৰ কৰা প্ৰতিটো service-ত একে Cloudflare account আৰু একে R2 API token-ৰ pair set কৰিবা:
- `R2_ACCOUNT_ID` = Cloudflare Account ID মাত্ৰ; endpoint URL নহয়
- `R2_ACCESS_KEY_ID` = সেই R2 token-ৰ Access Key ID
- `R2_SECRET_ACCESS_KEY` = একে token-ৰ Secret Access Key
- `R2_BUCKET_NAME` = `hexora`

Quotes, extra spaces বা line breaks নাথাকিব। Secret key কাকো chat-ত নিদিবা। Signature error থাকিলে Cloudflare Dashboard-ত `hexora` bucket-ৰ Object Read & Write access থকা নতুন R2 token সৃষ্টি কৰি Access Key ID আৰু Secret Access Key একেলগে copy কৰা, তাৰ পিছত Railway Variables update কৰি crawler redeploy কৰা।

## তিনিটা Railway service
1. **API/server**: Start Command `npm start`. `DATABASE_URL` কেৱল এই service-ত দিবা, যদি আগৰ Neon results পঢ়িব বিচৰা। Server search-এ Neon-ত SELECT কৰে; crawler/importer Neon-ৰ সৈতে connect নকৰে।
2. **Continuous crawler**: Start Command `npm run crawler`. `DATABASE_URL` নাথাকিব।
3. **Common Crawl importer**: এককালীন/আলাদা job হিচাপে `npm run import:commoncrawl`; always-on crawler-ৰ start command হিচাপে নলগাবা। `DATABASE_URL` নাথাকিব।

## Search/index বিষয়ে
R2-ত page save কৰিলেই Google-scale full-text search নিজে নিজে নাহে। এই package-এ `index/`-ত JSON index documents ৰাখে আৰু server-এ সীমিত সংখ্যক index object cache কৰি search কৰে। বৃহৎ scale-ত dedicated/sharded search index লাগিব। Default Common Crawl domains-ৰ তালিকা sample; worldwide coverage নিশ্চিত নহয়।

## Existing Neon data
Neon data delete বা migrate নকৰিবা। `archive-neon-to-r2.mjs` কেৱল পুৰণি Neon content SELECT কৰি R2-ত archive কৰে; এতিয়া ই Neon-ত `UPDATE` নকৰে। `migrate-supabase.mjs` আৰু `recalculate-authority.mjs` optional maintenance scripts—এইবোৰ চলোৱাৰ আগতে code/DB effects বুজি ল'বা; default deployment-ৰ বাবে নালাগে।

## Smoke test
Deploy-ৰ পিছত server service-ৰ `/health` আৰু `/api/health` খুলি চাবা। Crawler logs-ত `R2 connection verified` আৰু `R2 saved HTML + metadata + search index` দেখা লাগিব। `request signature does not match` থাকিলে deployment code-তকৈ প্ৰথমে R2 account/key/bucket variables ঠিক কৰা।
