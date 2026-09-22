import { db, response } from "./_supabase.mjs";

export default async (req) => {
  try {
    const q = new URL(req.url).searchParams.get("q")?.trim();
    if (!q) return response(400, {error:"Missing search query"});
    const words=[...new Set(q.toLowerCase().split(/\s+/).filter(Boolean))].slice(0,8);
    const sb=db();

    const [{data:pages,error:pErr},{data:news,error:nErr}] = await Promise.all([
      sb.from("pages").select("url,title,description,content,updated_at").limit(1200),
      sb.from("news").select("title,description,url,source_name,source_domain,published_at,image_url").order("published_at",{ascending:false}).limit(300)
    ]);
    if(pErr) throw pErr;
    if(nErr) throw nErr;

    const pageResults=(pages||[]).map(p=>({...p,type:"web",score:score(p,words),snippet:snippet(p,words)}))
      .filter(x=>x.score>0);
    const newsResults=(news||[]).map(n=>({...n,type:"news",score:newsScore(n,words),snippet:n.description||""}))
      .filter(x=>x.score>0);

    const results=[...newsResults,...pageResults].sort((a,b)=>b.score-a.score).slice(0,30);
    return response(200,{query:q,total:results.length,results});
  } catch(e) {
    return response(500,{error:e.message});
  }
};

function score(p,ws){
  const t=(p.title||"").toLowerCase(),d=(p.description||"").toLowerCase(),u=(p.url||"").toLowerCase(),b=(p.content||"").toLowerCase();
  let s=0;
  for(const w of ws){
    if(t.includes(w))s+=30;if(d.includes(w))s+=12;if(u.includes(w))s+=8;
    s+=Math.min((b.match(new RegExp(escapeRegExp(w),"g"))||[]).length,25);
  }
  if(ws.length>1&&ws.every(w=>t.includes(w)))s+=40;
  return s;
}
function newsScore(n,ws){
  const t=(n.title||"").toLowerCase(),d=(n.description||"").toLowerCase(),s=(n.source_name||"").toLowerCase();
  let x=0;
  for(const w of ws){if(t.includes(w))x+=40;if(d.includes(w))x+=15;if(s.includes(w))x+=4;}
  const age=n.published_at?Math.max(0,(Date.now()-Date.parse(n.published_at))/86400000):999;
  return x+Math.max(0,20-age);
}
function snippet(p,ws){
  const text=(p.content||p.description||"").replace(/\s+/g," ");
  let at=Infinity;for(const w of ws){const i=text.toLowerCase().indexOf(w);if(i>=0)at=Math.min(at,i)}
  if(!isFinite(at))return text.slice(0,280);
  return text.slice(Math.max(0,at-110),at+230);
}
function escapeRegExp(s){return s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}