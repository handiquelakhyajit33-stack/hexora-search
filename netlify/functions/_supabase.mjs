import { createClient } from "@supabase/supabase-js";
export function db(){
  const url=process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key) throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing");
  return createClient(url,key);
}
export function response(status,body){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}})}
export function auth(req){
  const expected=process.env.ADMIN_TOKEN;
  if(!expected) return true;
  return req.headers.get("x-admin-token")===expected;
}