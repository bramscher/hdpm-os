import {NextRequest,NextResponse} from 'next/server';
import {requireSection} from '@/lib/require-role';
import {dailyBillingActor} from '@/lib/daily-billing/server';
import {loadCloseout,removeCloseoutEntry,saveCloseoutEntry} from '@/lib/daily-billing/closeout-server';
import {OVERHEAD_KINDS} from '@/lib/daily-billing/closeout-kinds';

// Billing closeout reads a tech's timecard hours, so it sits behind its own section (Brody and Craig).
export async function GET(request:NextRequest){
 const guard=await requireSection('billing_closeout');if(!guard.ok)return guard.response;
 try{const actor=await dailyBillingActor(guard.email);const q=request.nextUrl.searchParams;
  return NextResponse.json(await loadCloseout(actor,q.get('technician')||'Alberto',q.get('from')||'',q.get('to')||''),{headers:{'Cache-Control':'private, no-store'}});}
 catch(e){return failure(e);}
}
export async function POST(request:NextRequest){
 const guard=await requireSection('billing_closeout');if(!guard.ok)return guard.response;
 try{const actor=await dailyBillingActor(guard.email);if(!actor.office)throw new Error('FORBIDDEN: office review required');
  const body=await request.json();
  if(body.op==='remove')return NextResponse.json({result:await removeCloseoutEntry(guard.email,String(body.id),Number(body.version))});
  if(body.op!=='save')throw new Error('Unknown closeout action');
  const kind=String(body.activity_kind||'');
  if(kind!=='job'&&!(kind in OVERHEAD_KINDS))throw new Error('Choose what the time was');
  if(kind==='job'&&!body.work_order_id)throw new Error('Choose the work order for job time');
  return NextResponse.json({result:await saveCloseoutEntry(guard.email,{id:String(body.id),version:body.version==null?undefined:Number(body.version),status:body.status,technician:String(body.technician),work_order_id:body.work_order_id||null,work_date:String(body.work_date),minutes:Math.round(Number(body.minutes)),activity_kind:kind,note:String(body.note||'')})});}
 catch(e){return failure(e);}
}
function failure(e:unknown){const message=e instanceof Error?e.message:'Billing closeout could not load';return NextResponse.json({error:message},{status:message.includes('FORBIDDEN')?403:message.includes('CONFLICT')?409:400});}
