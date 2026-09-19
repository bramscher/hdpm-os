import { NextRequest,NextResponse } from 'next/server';
import { requireRole } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
export async function GET(req:NextRequest){
 const g=await requireRole('maintenance','pm','manager');if(!g.ok)return g.response;
 const db=getSupabaseAdmin(),id=req.nextUrl.searchParams.get('id');
 let q=db.from('estimate_saved_draft').select('*').order('updated_at',{ascending:false});if(id)q=q.eq('id',id);
 const {data,error}=await q.limit(100);if(error)return NextResponse.json({error:error.message},{status:400});
 const ids=(data||[]).map(d=>d.id);
 const headers=ids.length?await db.from('estimate').select('id,status,current_version_id,source_saved_draft_id').in('source_saved_draft_id',ids).not('current_version_id','is',null):{data:[],error:null};
 if(headers.error)return NextResponse.json({error:headers.error.message},{status:400});
 const used=new Set((headers.data||[]).map(e=>e.source_saved_draft_id));
 let issued=null;
 const header=id?headers.data?.[0]:null;
 if(header){
  const {data:version,error:versionError}=await db.from('estimate_version').select('owner_total,status').eq('id',header.current_version_id).single();
  if(versionError)return NextResponse.json({error:versionError.message},{status:400});
  issued={estimateId:header.id,versionId:header.current_version_id,ownerTotal:Number(version.owner_total),status:header.status,authorization:version.status};
 }
 return NextResponse.json({drafts:(data||[]).filter(d=>id||!used.has(d.id)),issued});
}
export async function POST(req:NextRequest){const g=await requireRole('maintenance','pm','manager');if(!g.ok)return g.response;try{const b=await req.json();if(JSON.stringify(b.payload).length>150000||!Array.isArray(b.payload?.rows))throw new Error('Invalid estimate draft');const {data,error}=await getSupabaseAdmin().rpc('maintenance_save_estimate_draft',{actor:g.email,request:b});if(error)throw error;return NextResponse.json({draft:data});}catch(e){return NextResponse.json({error:(e as Error).message},{status:409});}}
