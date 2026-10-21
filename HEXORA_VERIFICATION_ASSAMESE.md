HEXORA ZIP — Verification Notes

এই প্যাকেজত মূল project structure ৰখা হৈছে।

কৰা হোৱা static checks:
- সকলো .mjs আৰু .js ফাইলত Node.js syntax check
- package.json আৰু railway.json JSON parse check
- ZIP archive integrity check

Fixes:
- demand-trends.mjs-ৰ আৰম্ভণি/শেষত থকা ভুল Markdown code fences আঁতৰোৱা হৈছে; এইবোৰে Node.js syntax error কৰিছিল।
- Search API-ত invalid canonical URL (যেনে /null) পৰিষ্কাৰ কৰি fallback URL ব্যৱহাৰ কৰা হৈছে।
- Plain brand-name query-ত official homepage-ৰ ranking boost যোগ কৰা হৈছে।
- Frontend-ত image_items-ৰ পৰা thumbnail fallback যোগ কৰা হৈছে।
- Crawler-ৰ numeric environment settings-ত invalid value দিলে NaN নহ’বলৈ validation যোগ কৰা হৈছে।
- Dockerfile-ৰ exposed port 3000-ৰ পৰা 8080 কৰা হৈছে, যাতে server-ৰ default port-ৰ সৈতে মিলে।
- R2 bucket preflight সফল হোৱাৰ পিছত seed queue-ত সাময়িক R2 error হ’লে crawler process তৎক্ষণাৎ বন্ধ নকৰি পুনৰ চেষ্টা কৰে।

সীমাবদ্ধতা:
এই পৰীক্ষাত live Railway deployment, Neon database, Cloudflare R2 credentials/permissions, আৰু বাস্তৱ website crawling চলাই চোৱা হোৱা নাই। সেয়ে কোনো live-service failure নোহোৱাৰ নিশ্চয়তা দিয়া সম্ভৱ নহয়। R2 credentials/bucket ভুল থাকিলে crawler স্পষ্ট error দি বন্ধ হ’ব—ভুল configuration লুকুৱাই ৰখা হোৱা নাই।

Railway commands:
- API service: node server.mjs
- Crawler service: node crawler.mjs
