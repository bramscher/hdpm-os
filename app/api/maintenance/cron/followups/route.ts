import { NextRequest, NextResponse } from 'next/server';
import { getAgentConfig, isGloballyKilled } from '@/lib/agents/config';
import { publishFollowupQueue } from '@/lib/agents/followup-slack';
export const maxDuration=120;
export async function GET(request:NextRequest) {
  const secret=process.env.CRON_SECRET;
  if(!secret || request.headers.get('authorization')!==`Bearer ${secret}`)return NextResponse.json({error:'Unauthorized'},{status:401});
  const preview=request.nextUrl.searchParams.get('preview')==='1';
  const manual=request.nextUrl.searchParams.get('manual')==='1';
  const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',hour:'numeric',hourCycle:'h23'}).format(new Date()));
  if(!preview&&!manual&&hour!==8)return NextResponse.json({skipped:'Outside 8 AM Pacific'});
  try {
    if(!preview && (!(await getAgentConfig('estimate_chaser','team_review'))?.enabled || await isGloballyKilled()))return NextResponse.json({skipped:'Shared trial is disabled or paused'});
    return NextResponse.json(await publishFollowupQueue({preview}));
  }
  catch(e){return NextResponse.json({error:(e as Error).message},{status:503});}
}
