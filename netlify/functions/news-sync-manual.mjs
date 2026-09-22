import sync from "./news-sync.mjs";
export default async(req)=>{
  if(req.method!=="POST")return new Response(JSON.stringify({error:"Method not allowed"}),{status:405,headers:{"content-type":"application/json"}});
  if(process.env.ADMIN_TOKEN && req.headers.get("x-admin-token")!==process.env.ADMIN_TOKEN)
    return new Response(JSON.stringify({error:"Unauthorized"}),{status:401,headers:{"content-type":"application/json"}});
  await sync();
  return new Response(JSON.stringify({ok:true,source:"publisher feeds",generated:false}),{headers:{"content-type":"application/json"}});
}