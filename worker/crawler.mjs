import { db } from "./_supabase.mjs";

const DEFAULT_SEEDS=[
 "https://en.wikipedia.org/",
 "https://www.india.gov.in/",
 "https://assam.gov.in/",
 "https://www.python.org/",
 "https://www.w3.org/"
];

export async function crawlBatch(supabase, limit=Number(process.env.CRAWL_BATCH_SIZE||12)){
  const seedText=process.env.HEXORA_SEED_URLS||DEFAULT_SEEDS.join(",");
  const seeds=seedText.split(",").map(x=>x.trim()).filter(Boolean);
  await supabase.from("crawl_queue").upsert(seeds.map(url=>({url,status:"queued"})),{onConflict:"url",ignoreDuplicates:true});

  // Recover jobs left in crawling state by a crashed worker.
  await supabase.from("crawl_queue").update({status:"queued",last_error:"requeued after worker restart"})
    .eq("status","crawling");

  const {data,error}=await supabase.from("crawl_queue").select("url").eq("status","queued").order("created_at",{ascending:true}).limit(limit);
  if(error) throw error;
  const urls=(data||[]).map(x=>x.url);
  const concurrency=Math.max(1,Number(process.env.CRAWL_CONCURRENCY||3));
  for(let i=0;i<urls.length;i+=concurrency){
    await Promise.all(urls.slice(i,i+concurrency).map(async url=>{
      try{await crawlOne(supabase,url)}
      catch(e){await supabase.from("crawl_queue").update({status:"error",last_error:String(e).slice(0,500)}).eq("url",url)}
    }));
  }
  return {processed:urls.length};
}

async function crawlOne(sb,url){
  await sb.from("crawl_queue").update({status:"crawling"}).eq("url",url);
  const u=new URL(url),robots=await getRobots(u.origin);
  if(!robots.canFetch("HEXORA-Bot/1.0",url)){await sb.from("crawl_queue").update({status:"blocked",last_error:"robots.txt"}).eq("url",url);return}
  const r=await fetch(url,{redirect:"follow",headers:{"user-agent":"HEXORA-Bot/1.0","accept":"text/html,application/xhtml+xml"},signal:AbortSignal.timeout(12000)});
  if(!r.ok||!(r.headers.get("content-type")||"").includes("text/html"))throw new Error(`HTTP ${r.status}`);
  const html=await r.text();
  const parsed=parseHtml(new URL(r.url).toString(),html);
  const hash=await sha256(parsed.text);
  await sb.from("pages").upsert({url:parsed.canonical,title:parsed.title,description:parsed.description,content:parsed.text,content_hash:hash,word_count:parsed.text.split(/\s+/).length,updated_at:new Date().toISOString()},{onConflict:"url"});
  const links=parsed.links.map(x=>({url:x,status:"queued"}));
  if(links.length)await sb.from("crawl_queue").upsert(links,{onConflict:"url"});
  await sb.from("crawl_queue").update({status:"done",last_crawled_at:new Date().toISOString(),last_error:null}).eq("url",url);
}
async function getRobots(origin){const r=await fetch(origin+"/robots.txt",{headers:{"user-agent":"HEXORA-Bot/1.0"},signal:AbortSignal.timeout(5000)});const txt=r.ok?await r.text():"";return new Robots(txt,origin)}
class Robots{constructor(txt,origin){this.origin=origin;this.disallow=[];let active=false;for(const line of txt.split(/\r?\n/)){const [k,...v]=line.split(":");if(!k)continue;const key=k.trim().toLowerCase(),val=v.join(":").trim();if(key==="user-agent")active=val==="*"||val.toLowerCase()==="hexora-bot";if(key==="disallow"&&active&&val)this.disallow.push(val)}}canFetch(_,url){try{const p=new URL(url);return !this.disallow.some(x=>p.pathname.startsWith(x))}catch{return false}}}
function parseHtml(url,html){
  const title=(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||new URL(url).hostname).replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,500);
  const description=html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i)?.[1]?.slice(0,1000)||"";
  const canonical=html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i)?.[1];
  const base=canonical?new URL(canonical,url).toString():url;
  const text=html.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<noscript[\s\S]*?<\/noscript>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/\s+/g," ").trim().slice(0,200000);
  const links=[...html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)].map(m=>{try{const x=new URL(m[1],url);return x.protocol.startsWith("http")?x.toString():null}catch{return null}}).filter(Boolean).slice(0,150);
  return {title,description,canonical:base,text,links:[...new Set(links)]};
}
async function sha256(text){const b=new TextEncoder().encode(text),h=await crypto.subtle.digest("SHA-256",b);return [...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,"0")).join("")}