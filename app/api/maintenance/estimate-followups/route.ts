import { after, NextRequest, NextResponse } from 'next/server';
import { requireFollowupReviewer } from '@/lib/agents/followup-access';
import { loadFollowupQueue, decideFollowup, decideVendorBatch } from '@/lib/agents/followup-service';
export const maxDuration=60;
export async function GET() {
  const guard=await requireFollowupReviewer();if(!guard.ok)return guard.response;
  try{return NextResponse.json(await loadFollowupQueue());}
  catch(e){return NextResponse.json({error:(e as Error).message},{status:503});}
}
export async function POST(req:NextRequest) {
  const guard=await requireFollowupReviewer();if(!guard.ok)return guard.response;
  let ids:string[]=[];
  try {
    const input=await req.json();
    if(input.op==='send_vendor_batch'){const result=await decideVendorBatch(guard.email,input);ids=input.items.map((i:{id:string})=>i.id);return NextResponse.json(result);}
    if(typeof input.id==='string')ids=[input.id];
    const result=await decideFollowup(guard.email,input);
    return NextResponse.json(result);
  } catch(e){return NextResponse.json({error:(e as Error).message},{status:409});}
  finally {if(ids.length)after(async()=>{const {refreshFollowupSlack}=await import('@/lib/agents/followup-slack');for(const id of ids)await refreshFollowupSlack(id);});}
}
