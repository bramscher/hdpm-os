import { NextRequest, NextResponse } from 'next/server';
import { requireCompanySession } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { resolvePriceBookItem } from '@/lib/turn-estimator/price-book';
import { priceLine } from '@/lib/turn-estimator/pricing';
export async function GET(){
 const guard=await requireCompanySession();if(!guard.ok)return guard.response;
 try{
  const db=getSupabaseAdmin();const {data:actor,error}=await db.from('staff').select('person,access_role').ilike('email',guard.email).eq('active',true).single();
  if(error||!actor)return NextResponse.json({error:'An active staff profile is required'},{status:403});
  const office=['admin','manager','pm','maintenance','finance'].includes(actor.access_role);
  // Explicit pagination prevents the Supabase default 1,000-row cap from hiding unbilled work.
  async function all(table:string,columns='*') {let rows:Record<string,unknown>[]=[];for(let offset=0;;offset+=1000){const order=table==='staff'?'person':table==='maintenance_target'?'technician':table==='maintenance_billing_allocation'?'task_id':'id';let query=db.from(table).select(columns).order(order);if(table==='hdms_invoices')query=query.not('maintenance_job_id','is',null);if(table==='maintenance_target')query=query.order('effective_from');const r=await query.range(offset,offset+999);if(r.error)throw r.error;rows=rows.concat(r.data as unknown as Record<string,unknown>[]);if(r.data.length<1000)return rows;}}
  const [jobs,tasks,visits,records,allocations,invoices,staff,targets]=await Promise.all([
   all('maintenance_job'),all('maintenance_task'),all('maintenance_visit'),all('maintenance_work_record'),
   office?all('maintenance_billing_allocation'):[],office?all('hdms_invoices','id,invoice_code,status,maintenance_job_id,total_amount'):[],
   all('staff','person,name,active'),office?all('maintenance_target'):[]]);
  const visibleVisits=office?visits:visits.filter(v=>(v.technicians as string[]).includes(actor.person)&&v.status!=='cancelled');
  const allowed=new Set(visibleVisits.map(v=>v.job_id));
  return NextResponse.json({office,person:actor.person,jobs:office?jobs:jobs.filter(j=>allowed.has(j.id)).map(({approval_note,...j})=>j),tasks:office?tasks:tasks.filter(t=>allowed.has(t.job_id)).map(t=>({id:t.id,job_id:t.job_id,description:t.description,quantity:t.quantity,approved:t.approved})),visits:visibleVisits,records:office?records:records.filter(r=>r.technician===actor.person),allocations,invoices:invoices.filter(i=>i.maintenance_job_id),staff:staff.filter(s=>s.active&&(office||s.person===actor.person)).map(s=>({person:s.person,name:s.name})),targets});
 }catch(e){return failure(e);}
}
export async function POST(req:NextRequest){
 const guard=await requireCompanySession();if(!guard.ok)return guard.response;
 try{
  const body=await req.json();
  for(const key of ['minutes','start_minute','planned_minutes','benchmark','min_hours','max_hours','version'])if(body[key]!=null&&(!Number.isFinite(Number(body[key]))||Number(body[key])<0))throw new Error('Invalid numeric value');
  if(body.op==='task'){
   const item=await resolvePriceBookItem(body.item_code);
   if(!item||/placeholder/i.test(`${item.name} ${item.internal_instructions}`))throw new Error('This item needs approved pricing in the price book');
   if(['allowance','quoted','package'].includes(item.pricing_method))throw new Error('Use an itemized approved scope for allowances, quotes and packages');
   for(const k of ['qty','minutes','est_material_cost'])if(body[k]!=null&&(!Number.isFinite(Number(body[k]))||Number(body[k])<0))throw new Error('Invalid quantity, time or cost');
   const qty=Number(body.qty??1);if(qty<=0)throw new Error('Quantity must be positive');
   const line=priceLine({item,qty,minutes:body.minutes==null?undefined:Number(body.minutes),estMaterialCost:Number(body.est_material_cost??0),description:body.description||undefined});
   body.amount=line.owner_extended;body.quantity=qty;body.pricing_method=item.pricing_method;body.description=line.description;
   body.invoice_type=item.category==='appliances'?'appliance':item.category==='materials'||item.pricing_method==='cost_plus'?'materials':item.category==='coordination'?'other':'labor';
   body.service_value=body.in_house===false?0:['coordination','materials','appliances'].includes(item.category)||item.pricing_method==='cost_plus'?0:line.owner_extended;
  }
  const {data,error}=await getSupabaseAdmin().rpc('maintenance_workspace_apply',{actor:guard.email,request:body});if(error)throw error;
  return NextResponse.json({result:data});
 }catch(e){return failure(e);}
}
function failure(e:unknown){const message=e instanceof Error?e.message:(e as {message?:string})?.message||'Unable to load maintenance workspace';return NextResponse.json({error:message},{status:message.includes('FORBIDDEN')?403:message.includes('CONFLICT')?409:400});}
