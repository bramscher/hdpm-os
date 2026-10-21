import {getSupabaseAdmin} from '@/lib/supabase';
import {getDashboardConfig} from '@/lib/dashboard-config';
import {fetchAllRows} from '@/lib/maintenance/tripwire-engine';
import type {Day} from '@/lib/timekeeping/model';
import type {HdmsInvoice} from '@/lib/invoices';
import {buildCloseout,JOB_KINDS,type CloseoutWo} from './closeout';
import {validateDailyPeriod} from './access';
import {inHouseVendorFilter} from './links';
import type {WorkRecord} from './model';
import type {dailyBillingActor} from './server';

type Actor=Awaited<ReturnType<typeof dailyBillingActor>>;
/** Field techs whose days are closed out. Brody coordinates and is mostly not billable (Craig, 2026-10-20). */
export const CLOSEOUT_TECHS=['Alberto','Brody'];

export async function loadCloseout(actor:Actor,technician:string,from:string,to:string){
 if(!actor.office)throw new Error('FORBIDDEN: office review required');
 if(!CLOSEOUT_TECHS.includes(technician))throw new Error('Choose a field technician');
 validateDailyPeriod(from,to);
 const db=getSupabaseAdmin();const cfg=await getDashboardConfig();
 const [employees,records,invoices,workOrders,plans]=await Promise.all([
  db.from('timekeeping_employee').select('id').eq('staff_person',technician).then(r=>{if(r.error)throw new Error(r.error.message);return r.data||[];}),
  fetchAllRows<WorkRecord>(()=>db.from('maintenance_work_record').select('*').eq('technician',technician).gte('work_date',from).lte('work_date',to) as any,'Work entries'),
  fetchAllRows<HdmsInvoice>(()=>db.from('hdms_invoices').select('*') as any,'Invoices'),
  fetchAllRows<CloseoutWo>(()=>db.from('work_orders').select('id,wo_number,property_name,description').or(inHouseVendorFilter(cfg.internalVendorIds)) as any,'Work orders'),
  fetchAllRows<{id:string;route_date:string}>(()=>db.from('maint_route_plan').select('id,route_date').eq('status','published').ilike('assigned_tech',technician).gte('route_date',from).lte('route_date',to) as any,'Routes'),
 ]);
 // Timecard worked time only; pay rates and payroll fields are never read here.
 const sheets=employees.length?await fetchAllRows<{id:string;days:Day[]}>(()=>db.from('timekeeping_sheet').select('id,days').in('employee_id',employees.map(e=>e.id)).lte('period_start',to).gte('period_end',from) as any,'Timecards'):[];
 const stops=plans.length?await fetchAllRows<{id:string;route_plan_id:string;work_order_id:string}>(()=>db.from('maint_route_stop').select('id,route_plan_id,work_order_id').in('route_plan_id',plans.map(p=>p.id)) as any,'Route stops'):[];
 const planDate=new Map(plans.map(p=>[p.id,p.route_date]));
 // The office can route or log any work order, so pull in the ones outside the in-house list.
 const known=new Set(workOrders.map(w=>w.id));
 const extraIds=[...new Set([...stops.map(s=>s.work_order_id),...records.map(r=>r.work_order_id||'')])].filter(id=>id&&!known.has(id));
 if(extraIds.length){const {data,error}=await db.from('work_orders').select('id,wo_number,property_name,description').in('id',extraIds);if(error)throw new Error(error.message);workOrders.push(...(data||[]));}
 const timecard=sheets.flatMap(s=>s.days||[]).filter(d=>d.date>=from&&d.date<=to);
 const result=buildCloseout({technician,from,to,timecard,records,invoices,workOrders,routeStops:stops.map(s=>({date:planDate.get(s.route_plan_id)!,work_order_id:s.work_order_id}))});
 return {...result,technician,from,to,techs:CLOSEOUT_TECHS,hasTimecard:sheets.length>0,
  workOrders:workOrders.map(w=>({id:w.id,wo_number:w.wo_number,property_name:w.property_name,description:(w.description||'').slice(0,90)}))};
}

/**
 * Save one closeout entry: add or edit it through the daily billing RPC, then
 * mark it reviewed (job time billable, everything else not billable) so the
 * coordinator's entry doesn't sit in the review queue.
 */
export async function saveCloseoutEntry(email:string,entry:{id:string;version?:number;status?:string;technician:string;work_order_id:string|null;work_date:string;minutes:number;activity_kind:string;note:string}){
 if(!CLOSEOUT_TECHS.includes(entry.technician))throw new Error('Choose a field technician');
 const db=getSupabaseAdmin();
 const rpc=async(request:Record<string,unknown>)=>{const {data,error}=await db.rpc('maintenance_daily_billing_apply',{actor:email,request});if(error)throw new Error(error.message);return data as WorkRecord;};
 let version=entry.version;
 // Submitted and reviewed entries must be returned before the RPC lets them change.
 if(version!=null&&entry.status&&!['draft','returned'].includes(entry.status))version=(await rpc({op:'review',id:entry.id,version,status:'returned',billability:'review',note:'Editing in billing closeout'})).version;
 const saved=await rpc({op:'record',id:entry.id,version,technician:entry.technician,work_order_id:entry.work_order_id,work_date:entry.work_date,minutes:entry.minutes,activity_kind:entry.activity_kind,progress:'done',note:entry.note,materials:'',status:'submitted'});
 const billable=JOB_KINDS.includes(entry.activity_kind);
 return rpc({op:'review',id:saved.id,version:saved.version,status:'reviewed',billability:billable?'billable':'nonbillable',note:billable?'Billing closeout: job time':'Billing closeout: not billable'});
}

export async function removeCloseoutEntry(email:string,id:string,version:number){
 const {data,error}=await getSupabaseAdmin().rpc('maintenance_closeout_remove',{actor:email,record_id:id,record_version:version});
 if(error)throw new Error(/maintenance_closeout_remove|function .* does not exist|schema cache/i.test(error.message)?'Removing entries needs migration 20261037_closeout_remove_entry.sql. Edit the entry instead until it is applied.':error.message);
 return data;
}
