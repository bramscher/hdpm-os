import {NextRequest,NextResponse} from 'next/server';
import {requireCompanySession} from '@/lib/require-role';
import {getSupabaseAdmin} from '@/lib/supabase';
import {dailyBillingActor,loadDailyBilling} from '@/lib/daily-billing/server';
import {pacificDay} from '@/lib/maintenance-workspace/model';
export async function GET(request:NextRequest){
 const guard=await requireCompanySession();if(!guard.ok)return guard.response;
 try{const actor=await dailyBillingActor(guard.email);const query=request.nextUrl.searchParams;return NextResponse.json(await loadDailyBilling(actor,query.get('from')||pacificDay(),query.get('to')||pacificDay(),query.get('technician')||''),{headers:{'Cache-Control':'private, no-store'}});}catch(e){return failure(e);}
}
export async function POST(request:NextRequest){
 const guard=await requireCompanySession();if(!guard.ok)return guard.response;
 try{await dailyBillingActor(guard.email);const body=await request.json();if(!['record','review','disposition'].includes(body.op))throw new Error('Unknown daily billing action');
 const {data,error}=await getSupabaseAdmin().rpc('maintenance_daily_billing_apply',{actor:guard.email,request:body});if(error)throw new Error(error.message);return NextResponse.json({result:data});}catch(e){return failure(e);}
}
function failure(e:unknown){const message=e instanceof Error?e.message:'Daily billing could not load';return NextResponse.json({error:message},{status:message.includes('FORBIDDEN')?403:message.includes('CONFLICT')?409:400});}
