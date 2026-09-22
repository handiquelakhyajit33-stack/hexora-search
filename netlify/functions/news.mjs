import { db, response } from "./_supabase.mjs";
export default async ()=>{
  try{
    const {data,error}=await db().from("news").select("id,title,description,url,source_name,source_domain,published_at,image_url").order("published_at",{ascending:false}).limit(12);
    if(error) throw error;
    return response(200,{items:data||[],generated:false,source:"publisher feeds"});
  }catch(e){return response(500,{error:e.message})}
}