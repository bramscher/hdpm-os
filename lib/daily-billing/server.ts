import {getSupabaseAdmin} from '@/lib/supabase';
import {getDashboardConfig} from '@/lib/dashboard-config';
import {totals,type Day} from '@/lib/timekeeping/model';
import {buildDailyBilling,type Input,type WorkRecord,type WorkOrder,type Bill,type Decision} from './model';
import {dailyBillingAccess,validateDailyPeriod} from './access';
import {inHouseVendorFilter} from './links';
import {fieldForReview} from '@/lib/field-time/server';
import {pacificDay} from '@/lib/maintenance-workspace/model';
import type {HdmsInvoice} from '@/lib/invoices';
export async function dailyBillingActor(email:string){
 const {data,error}=await getSupabaseAdmin().from('staff').select('person,name,email,access_role').ilike('email',email).eq('active',true).single();
 if(error||!data||!dailyBillingAccess(data.access_role||'read_only',data.email).allowed)throw new Error('FORBIDDEN: active maintenance staff required');
 return {...data,...dailyBillingAccess(data.access_role,data.email)} as {person:string;name:string;email:string;access_role:string;office:boolean;admin:boolean;allowed:boolean};
}
export async function loadDailyBilling(actor:Awaited<ReturnType<typeof dailyBillingActor>>,from:string,to:string,requestedTech:string,opts:{fieldSample?:boolean}={}){
 validateDailyPeriod(from,to);const db=getSupabaseAdmin();const cfg=await getDashboardConfig();
 const technician=actor.office?requestedTech:actor.person;const warnings:string[]=[];
 async function all(table:string,columns='*',filter?:(q:any)=>any){const rows:any[]=[];for(let offset=0;;offset+=1000){let q=db.from(table).select(columns).order(table==='staff'?'person':table==='maintenance_billing_review'?'issue_key':table==='maintenance_billing_allocation'?'task_id':'id');if(filter)q=filter(q);const {data,error}=await q.range(offset,offset+999);if(error)throw new Error(`${table}: ${error.message}`);rows.push(...(data||[]));if((data||[]).length<1000)return rows;}}
 const vendorFilter=inHouseVendorFilter(cfg.internalVendorIds);
 const [workOrders,records,jobs,tasks,staff]=await Promise.all([
  all('work_orders','id,wo_number,property_name,description,assigned_tech,assigned_to,completed_date,status,appfolio_status,stage,canceled_date,appfolio_link,vendor_name,vendor_id',q=>q.or(vendorFilter)),
  all('maintenance_work_record','*',q=>{q=q.gte('work_date',from).lte('work_date',to);return actor.office?q:q.eq('technician',actor.person)}),
  all('maintenance_job','id,work_order_id,property_name'),all('maintenance_task','id,job_id,description,pricing_method,approved,service_value'),
  all('staff','person,name',q=>q.eq('active',true)),
 ]);
 let migrationReady=true;let decisions:Decision[]=[];
 try{if(actor.office)decisions=await all('maintenance_billing_review');else {const {error}=await db.from('maintenance_billing_review').select('issue_key').limit(0);if(error)throw error;}}
 catch{migrationReady=false;warnings.push('Daily closeout setup is pending. Existing billing data is available, but new entries and decisions cannot be saved yet.');}
 let invoices:HdmsInvoice[]=[],bills:Bill[]=[],allocations:Input['allocations']=[];let billsFresh=false,lastBillSync:string|null=null;
 if(actor.office){
  [invoices,allocations]=await Promise.all([all('hdms_invoices','*'),all('maintenance_billing_allocation','task_id,invoice_id')]);
  try{bills=await all('af_bills','id,hdms_invoice_id,reference,total_amount,synced_at');lastBillSync=bills.map(b=>b.synced_at).sort().at(-1)||null;billsFresh=!!lastBillSync&&Date.now()-Date.parse(lastBillSync)<36*3600000;}
  catch{warnings.push('AppFolio bills could not load. Posting status is unknown.');}
  if(!billsFresh)warnings.push('AppFolio verification is unavailable or more than 36 hours old. Unmatched items need checking, not automatic rebilling.');
 }
 const today=pacificDay();
 const data=buildDailyBilling({from,to,today,technician,workOrders:actor.office?workOrders:[],invoices,records,jobs,tasks,allocations,bills,decisions,billsFresh});
 // Payroll comparison is read and serialized only for the admin, never merely hidden in the UI.
 // With no technician selected, timecards for both field techs are summed per day.
 if(actor.admin){
  try{
   const employees=await all('timekeeping_employee','id,staff_person',q=>technician?q.eq('staff_person',technician):q.in('staff_person',['Alberto','Brody']));
   const sheets=employees.length?await all('timekeeping_sheet','id,employee_id,days',q=>q.in('employee_id',employees.map(e=>e.id)).lte('period_start',to).gte('period_end',from)):[];
   for(const day of data.days){const ds:Day[]=sheets.flatMap(s=>(s.days||[]).filter((d:Day)=>d.date===day.date));const total=totals(ds);day.workedHours=ds.length?total.worked/60:null;day.scheduledHours=total.scheduled/60;day.unexplainedHours=ds.length&&total.scheduled===0?total.worked/60-day.projectHours-day.otherHours:null;}
  }catch{warnings.push('Worked-time comparison could not load; payroll values are unknown.');for(const d of data.days){d.workedHours=null;d.unexplainedHours=null;}}
 }
 // Field time (location evidence): an admin gets every category and the not-fully-billed items; anyone else only their own job and parts time.
 let field:{source:'device'|'sample';links:{technician:string;date:string}[];ready:boolean}={source:'device',links:[],ready:false};
 try{
  const f=await fieldForReview({actor,from,to,technician,sample:!!opts.fieldSample,invoices,decisions,today});
  for(const day of data.days){const t=f.days.get(day.date);if(t)day.field=t;}
  for(const issue of data.issues)if(issue.kind==='no_invoice'&&issue.woId&&f.noInvoiceNotes.has(issue.woId))issue.detail+=` ${f.noInvoiceNotes.get(issue.woId)}`;
  if(f.issues.length){
   data.issues.push(...f.issues);
   const active=data.issues.filter(i=>!i.decision||i.overdue);
   for(const row of data.days)row.issueCount=active.filter(i=>i.day===row.date).length;
   data.counts={active:active.length,deferred:data.issues.filter(i=>i.decision&&!i.overdue).length};
  }
  field={source:f.source,links:f.links,ready:true};
 }catch{if(actor.admin)warnings.push('Field time is not set up yet. Run supabase/migrations/20261029_field_time.sql to turn it on.');}
 const selectedRecords=(records as WorkRecord[]).filter(r=>!technician||r.technician===technician);
 const allowedWo=new Set(selectedRecords.map(r=>r.work_order_id).filter(Boolean));
 // A technician can choose an in-house work order, but receives only their own activity and no invoice/payroll totals.
 const visibleOrders=(workOrders as WorkOrder[]).filter(w=>actor.office||w.status==='open'||allowedWo.has(w.id));
 return {...data,office:actor.office,admin:actor.admin,person:actor.person,technician,from,to,today,migrationReady,warnings,lastBillSync,field,
  days:actor.office?data.days:data.days.map(({date,projectHours,otherHours,recordCount,issueCount,field})=>({date,projectHours,otherHours,recordCount,issueCount,field})),
  records:selectedRecords,workOrders:visibleOrders.map(w=>({id:w.id,wo_number:w.wo_number,property_name:w.property_name,description:w.description})),
  tasks:tasks.map(t=>({id:t.id,job_id:t.job_id,description:t.description})),jobs,
  staff:actor.office?staff:staff.filter(s=>s.person===actor.person),
  invoiceOptions:actor.office?invoices.filter(i=>i.status!=='void'&&i.doc_type!=='credit').map(i=>({id:i.id,invoice_code:i.invoice_code,wo_reference:i.wo_reference,work_order_id:i.work_order_id})):[],
 };
}
