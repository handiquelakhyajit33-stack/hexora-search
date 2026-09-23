import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { db } from "./netlify/functions/_supabase.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const HOST = "0.0.0.0";

function send(res,status,data,type="application/json"){
  res.writeHead(status,{"content-type":type,"cache-control":"no-store"});
  res.end(type.includes("json") ? JSON.stringify(data) : data);
}
function escRegExp(s){return s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}
function score(p,ws){
  const t=(p.title||"").toLowerCase(),d=(p.description||"").toLowerCase(),u=(p.url||"").toLowerCase(),b=(p.content||"").toLowerCase();
  let s=0;
  for(const w of ws){if(t.includes(w))s+=30;if(d.includes(w))s+=12;if(u.includes(w))s+=8;s+=Math.min((b.match(new RegExp(escRegExp(w),"g"))||[]).length,25);}
  if(ws.length>1&&ws.every(w=>t.includes(w)))s+=40;
  return s;
}
function newsScore(n,ws){
  const t=(n.title||"").toLowerCase(),d=(n.description||"").toLowerCase(),s=(n.source_name||"").toLowerCase();let x=0;
  for(const w of ws){if(t.includes(w))x+=40;if(d.includes(w))x+=15;if(s.includes(w))x+=4;}
  const age=n.published_at?Math.max(0,(Date.now()-Date.parse(n.published_at))/86400000):999;
  return x+Math.max(0,20-age);
}
function snippet(p,ws){
  const text=(p.content||p.description||"").replace(/\s+/g," ");let at=Infinity;
  for(const w of ws){const i=text.toLowerCase().indexOf(w);if(i>=0)at=Math.min(at,i)}
  if(!isFinite(at))return text.slice(0,280);return text.slice(Math.max(0,at-110),at+230);
}
async function search(q){
  const words=[...new Set(q.toLowerCase().split(/\s+/).filter(Boolean))].slice(0,8);const sb=db();
  const [{data:pages,error:pErr},{data:news,error:nErr}]=await Promise.all([
    sb.from("pages").select("url,title,description,content,updated_at").limit(1200),
    sb.from("news").select("title,description,url,source_name,source_domain,published_at,image_url").order("published_at",{ascending:false}).limit(300)
  ]);
  if(pErr)throw pErr;if(nErr)throw nErr;
  const pageResults=(pages||[]).map(p=>({...p,type:"web",score:score(p,words),snippet:snippet(p,words)})).filter(x=>x.score>0);
  const newsResults=(news||[]).map(n=>({...n,type:"news",score:newsScore(n,words),snippet:n.description||""})).filter(x=>x.score>0);
  const results=[...newsResults,...pageResults].sort((a,b)=>b.score-a.score).slice(0,30);
  return {query:q,total:results.length,results};
}
async function news(){
  const {data,error}=await db().from("news").select("id,title,description,url,source_name,source_domain,published_at,image_url").order("published_at",{ascending:false}).limit(12);
  if(error)throw error;return {items:data||[],generated:false,source:"publisher feeds"};
}
function contentType(file){const e=path.extname(file).toLowerCase();return ({".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json",".svg":"image/svg+xml",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".ico":"image/x-icon"}[e]||"application/octet-stream")}
function serveStatic(req,res){
  let pathname=decodeURIComponent(new URL(req.url,`http://${req.headers.host||"localhost"}`).pathname);
  if(pathname==="/")pathname="/index.html";
  const root=path.resolve(__dirname);const file=path.resolve(root,"."+pathname);
  if(!file.startsWith(root))return send(res,403,{error:"Forbidden"});
  fs.readFile(file,(err,data)=>{
    if(err){
      if(!path.extname(pathname)) return fs.readFile(path.join(root,"index.html"),(e,d)=>e?send(res,404,{error:"Not found"}):send(res,200,d,"text/html; charset=utf-8"));
      return send(res,404,{error:"Not found"});
    }
    send(res,200,data,contentType(file));
  });
}
const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,`http://${req.headers.host||"localhost"}`);
    if(req.method==="GET"&&u.pathname==="/health")return send(res,200,{ok:true,service:"HEXORA",status:"running",port:PORT});
    if(req.method==="GET"&&u.pathname==="/api/search"){const q=u.searchParams.get("q")?.trim();if(!q)return send(res,400,{error:"Missing search query"});return send(res,200,await search(q));}
    if(req.method==="GET"&&u.pathname==="/api/news")return send(res,200,await news());
    return serveStatic(req,res);
  }catch(e){console.error(e);return send(res,500,{error:e?.message||"Server error"})}
});
server.listen(PORT,HOST,()=>console.log(`HEXORA server running on http://${HOST}:${PORT}`));

if(process.env.DISABLE_CRAWLER!=="1") {
  const child=spawn(process.execPath,[path.join(__dirname,"worker/worker.mjs")],{stdio:"inherit",env:process.env});
  child.on("exit",code=>console.log(`HEXORA crawler exited with code ${code}`));
  const stop=()=>{try{child.kill("SIGTERM")}catch{};server.close(()=>process.exit(0))};
  process.on("SIGTERM",stop);process.on("SIGINT",stop);
}
