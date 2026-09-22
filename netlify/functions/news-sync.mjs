import { db } from "./_supabase.mjs";

export const config={schedule:"*/30 * * * *"};

const FEEDS=[
  {name:"The Indian Express",url:"https://indianexpress.com/section/india/feed/"},
  {name:"The Indian Express — Assam",url:"https://indianexpress.com/section/north-east-india/assam/feed/"},
  {name:"The Indian Express — North East India",url:"https://indianexpress.com/section/north-east-india/feed/"},
  {name:"The Indian Express — Technology",url:"https://indianexpress.com/section/technology/feed/"},
  {name:"The Indian Express — Sports",url:"https://indianexpress.com/section/sports/feed/"},
  {name:"The Indian Express — Cricket",url:"https://indianexpress.com/section/sports/cricket/feed/"},
  {name:"The Indian Express — Education",url:"https://indianexpress.com/section/education/feed/"},
  {name:"The Indian Express — World",url:"https://indianexpress.com/section/world/feed/"}
];

export default async()=>{
  const sb=db();
  for(const feed of FEEDS){
    try{
      const r=await fetch(feed.url,{headers:{"user-agent":"HEXORA-NewsBot/1.0","accept":"application/rss+xml,application/xml,text/xml"},signal:AbortSignal.timeout(10000)});
      if(!r.ok) continue;
      const xml=await r.text();
      const items=parseRss(xml);
      for(const item of items.slice(0,20)){
        if(!item.url||!item.title)continue;
        const u=new URL(item.url);
        await sb.from("news").upsert({
          title:item.title.slice(0,500),
          description:strip(item.description).slice(0,1000),
          url:item.url,
          source_name:feed.name,
          source_domain:u.hostname,
          published_at:item.date||new Date().toISOString(),
          image_url:item.image_url||null,
          fetched_at:new Date().toISOString()
        },{onConflict:"url"});
      }
    }catch(e){ /* one feed failing must not stop other real feeds */ }
  }
};

function parseRss(xml){
  const out=[];
  const blocks=[...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map(x=>x[0]);
  for(const b of blocks){
    const title=text(tag(b,"title"));
    const url=text(tag(b,"link"))||text(tag(b,"guid"));
    const desc=text(tag(b,"description"))||text(tag(b,"content:encoded"));
    const date=text(tag(b,"pubDate"))||text(tag(b,"dc:date"));
    const media=b.match(/<media:content[^>]+url=["']([^"']+)/i)?.[1]||b.match(/<enclosure[^>]+url=["']([^"']+)/i)?.[1]||null;
    out.push({title,url,description:desc,date:date?new Date(date).toISOString():new Date().toISOString(),image_url:media});
  }
  return out;
}
function tag(s,n){return s.match(new RegExp("<"+n+"[^>]*>([\\\\s\\\\S]*?)</"+n+">","i"))?.[1]||""}
function text(s){return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1").replace(/<[^>]+>/g," ").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/\s+/g," ").trim()}
function strip(s){return text(s)}
