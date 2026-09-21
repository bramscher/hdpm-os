import { after, NextRequest, NextResponse } from 'next/server';
import { requireFollowupReviewer } from '@/lib/agents/followup-access';
import { loadFollowupQueue, decideFollowup } from '@/lib/agents/followup-service';
export const maxDuration=60;
export async function GET() {
  const guard=await requireFollowupReviewer();if(!guard.ok)return guard.response;
  try{return NextResponse.json(await loadFollowupQueue());}
  catch(e){return NextResponse.json({error:(e as Error).message},{status:503});}
}
export async function POST(req:NextRequest) {
  const guard=await requireFollowupReviewer();if(!guard.ok)return guard.response;
  let id:string|undefined;
  try {
    const input=await req.json();id=input.id;
    const result=await decideFollowup(guard.email,input);
    return NextResponse.json(result);
  } catch(e){return NextResponse.json({error:(e as Error).message},{status:409});}
  finally {if(id)after(async()=>{const {refreshFollowupSlack}=await import('@/lib/agents/followup-slack');await refreshFollowupSlack(id!);});}
}
