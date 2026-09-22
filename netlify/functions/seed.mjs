import { db, response, auth } from "./_supabase.mjs";
export default async (req)=>{
  if(req.method!=="POST")return response(405,{error:"Method not allowed"});
  if(!auth(req))return response(401,{error:"Unauthorized"});
  try{
    const body=await req.json();const urls=Array.isArray(body.urls)?body.urls:[];
    const rows=urls.map(u=>({url:String(u),status:"queued"})).filter(x=>/^https?:\/\//i.test(x.url));
    if(rows.length)await db().from("crawl_queue").upsert(rows,{onConflict:"url"});
    return response(200,{ok:true,queued:rows.length});
  }catch(e){return response(500,{error:e.message})}
}