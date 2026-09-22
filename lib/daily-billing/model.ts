import {normalizeTechnician,type HdmsInvoice} from '@/lib/invoices';
import {invoiceServiceDate,recordedLaborHours} from '@/lib/invoice-labor';
import {shiftDay} from '@/lib/maintenance-workspace/model';
export interface WorkOrder {id:string;wo_number:string|null;property_name:string|null;description:string|null;assigned_tech:string|null;assigned_to:string|null;completed_date:string|null;status:string|null;appfolio_status:string|null;stage:string|null;canceled_date:string|null;appfolio_link:string|null;vendor_name?:string|null;vendor_id?:string|null}
export interface WorkRecord {id:string;task_id:string|null;work_order_id?:string|null;technician:string;work_date:string;minutes:number;activity_kind?:string;progress:string;note:string;materials:string;status:string;billability?:string;review_note:string;review_owner:string|null;review_due?:string|null;version:number}
export interface Bill {id:string;hdms_invoice_id:string|null;reference:string|null;total_amount:number;synced_at:string}
export interface Decision {issue_key:string;disposition:string;owner:string;review_on:string;note:string;updated_at:string}
export interface Issue {key:string;kind:string;title:string;detail:string;day:string|null;person:string|null;woId?:string;invoiceId?:string;recordId?:string;property:string;href:string;decision?:Decision;overdue:boolean}
export interface DaySummary {date:string;projectHours:number;otherHours:number;recordCount:number;draftHours:number;issuedHours:number;issuedLabor:number;draftLabor:number;invoiceCount:number;incomplete:boolean;issueCount:number;workedHours?:number|null;scheduledHours?:number;unexplainedHours?:number|null}
export interface Input {from:string;to:string;today:string;technician:string;invoices:HdmsInvoice[];workOrders:WorkOrder[];records:WorkRecord[];bills:Bill[];decisions:Decision[];tasks:{id:string;job_id:string;description:string;pricing_method:string;approved:boolean}[];jobs:{id:string;work_order_id:string;property_name:string}[];allocations:{task_id:string;invoice_id:string}[];billsFresh:boolean}
export function periodDays(from:string,to:string){const result:string[]=[];for(let day=from;day<=to&&result.length<93;day=shiftDay(day,1))result.push(day);return result;}
const techName=(value:string|null|undefined)=>normalizeTechnician(value)||value?.trim()||'';
export function buildDailyBilling(input:Input){
 const {from,to,today,technician}=input;
 const days:DaySummary[]=periodDays(from,to).map(date=>({date,projectHours:0,otherHours:0,recordCount:0,draftHours:0,issuedHours:0,issuedLabor:0,draftLabor:0,invoiceCount:0,incomplete:false,issueCount:0}));
 const byDay=new Map(days.map(d=>[d.date,d]));const woById=new Map(input.workOrders.map(w=>[w.id,w]));const refs=new Map<string,WorkOrder[]>();
 for(const wo of input.workOrders){if(wo.wo_number){const key=wo.wo_number.trim();refs.set(key,[...(refs.get(key)||[]),wo]);}}
 const liveInvoices=input.invoices.filter(i=>i.status!=='void'&&i.doc_type!=='credit');
 const invoiceWo=new Map<string,string>();const ambiguous=new Set<string>();
 for(const invoice of liveInvoices){if(invoice.work_order_id){invoiceWo.set(invoice.id,invoice.work_order_id);continue;}const matches=refs.get(invoice.wo_reference?.trim()||'')||[];if(matches.length===1)invoiceWo.set(invoice.id,matches[0].id);else if(matches.length>1)ambiguous.add(invoice.id);}
 const issues:Issue[]=[];
 function add(issue:Omit<Issue,'overdue'|'decision'>){const decision=input.decisions.find(d=>d.issue_key===issue.key);const overdue=!!decision&&decision.review_on<=today;issues.push({...issue,decision,overdue});}
 const invoiceHasTech=(i:HdmsInvoice)=>!technician||(i.line_items||[]).some(l=>(l.type||'labor')==='labor'&&(!l.technician||techName(l.technician)===technician));
 for(const invoice of input.invoices){if(invoice.status==='void')continue;const day=invoiceServiceDate(invoice);if(!day||!byDay.has(day)||!invoiceHasTech(invoice))continue;
  const row=byDay.get(day)!;row.invoiceCount++;
  const labor=(invoice.line_items||[]).filter(l=>(l.type||'labor')==='labor'&&(!technician||techName(l.technician)===technician));
  for(const line of labor){const h=invoice.doc_type==='credit'?0:recordedLaborHours(line);const dollars=Number(line.amount)||0;if(invoice.status==='draft'){row.draftHours+=h;row.draftLabor+=dollars;}else{row.issuedHours+=h;row.issuedLabor+=dollars;}}
  const missing=(invoice.line_items||[]).some(l=>(l.type||'labor')==='labor'&&(!l.technician||(!l.workspace_task_id&&(!l.pricing_method||l.pricing_method==='hourly')&&!recordedLaborHours(l))))||(!invoice.line_items?.length&&Number(invoice.labor_amount)>0)||!invoice.completed_date;
  if(!invoice.line_items?.length&&!technician){if(invoice.status==='draft')row.draftLabor+=Number(invoice.labor_amount)||0;else row.issuedLabor+=Number(invoice.labor_amount)||0;}
  row.incomplete ||= missing;
  const base={day,person:technician||null,property:invoice.property_name,invoiceId:invoice.id,woId:invoiceWo.get(invoice.id),href:`/maintenance/invoices?tab=invoices&invoice=${invoice.id}`};
  if(invoice.doc_type==='credit'){add({...base,key:`invoice:${invoice.id}:credit_review`,kind:'credit_review',title:'Credit adjustment',detail:'Review the credit against its original invoice; it contributes no measured hours.'});continue;}
  if(missing||ambiguous.has(invoice.id)||!invoiceWo.has(invoice.id))add({...base,key:`invoice:${invoice.id}:data_quality`,kind:'data_quality',title:'Check invoice details',detail:ambiguous.has(invoice.id)?'Work-order reference matches multiple records. Match it manually.':!invoiceWo.has(invoice.id)?'No unique work-order link was found.':'Missing technician, measured hours, or completed date; totals may be partial.'});
  if(invoice.status==='draft')add({...base,key:`invoice:${invoice.id}:draft`,kind:'draft',title:'Draft awaiting issuance',detail:`${invoice.invoice_code} has not been issued.`});
  else {const matched=input.bills.filter(b=>b.hdms_invoice_id===invoice.id);const billed=matched.reduce((n,b)=>n+Number(b.total_amount),0);
   if(!input.billsFresh||!matched.length||Math.abs(billed-Number(invoice.total_amount))>.01)add({...base,key:`invoice:${invoice.id}:posting`,kind:'posting',title:!input.billsFresh?'AppFolio verification unavailable':!matched.length?'Verify AppFolio posting':'AppFolio amount differs',detail:!input.billsFresh?'Refresh the AppFolio source before deciding this is unbilled.':!matched.length?'No matched bill found. Check for an existing direct bill before entering another.':`Invoice $${Number(invoice.total_amount).toFixed(2)}; matched AppFolio bills $${billed.toFixed(2)}.`});
  }
 }
 const taskById=new Map(input.tasks.map(t=>[t.id,t]));const jobById=new Map(input.jobs.map(j=>[j.id,j]));
 for(const r of input.records){if(r.work_date<from||r.work_date>to||(technician&&r.technician!==technician))continue;const day=byDay.get(r.work_date)!;day.recordCount++;
  if(r.status!=='draft'){if(['job','callback'].includes(r.activity_kind||'job'))day.projectHours+=Number(r.minutes)/60;else day.otherHours+=Number(r.minutes)/60;}
  const task=taskById.get(r.task_id||'');const job=jobById.get(task?.job_id||'');const woId=r.work_order_id||job?.work_order_id;const wo=woById.get(woId||'');
  const base={day:r.work_date,person:r.technician,woId:woId||undefined,recordId:r.id,property:wo?.property_name||job?.property_name||'Other activity',href:r.task_id?'/maintenance/workspace':`/maintenance/daily-billing?date=${r.work_date}&record=${r.id}`};
  if(['draft','submitted','held','returned'].includes(r.status))add({...base,key:`record:${r.id}:review`,kind:'review',title:r.status==='held'?'Work held for review':r.status==='draft'?'Finish daily work entry':r.status==='returned'?'Work entry needs correction':'Review work performed',detail:r.review_note||r.note});
  else if(r.progress!=='done')add({...base,key:`record:${r.id}:in_progress`,kind:'in_progress',title:'Work in progress / billing milestone',detail:r.note||'Keep visible until the agreed billing milestone; not automatically overdue.'});
  else if((r.billability==='billable'||(r.task_id&&task?.approved))&&!input.allocations.some(a=>a.task_id===r.task_id&&liveInvoices.some(i=>i.id===a.invoice_id)))add({...base,key:`record:${r.id}:ready`,kind:'ready',title:'Verify billing covers reviewed work',detail:'A work-order invoice alone does not prove this visit is covered. Match the work to approved scope and verify coverage before preparing another draft.'});
 }
 for(const wo of input.workOrders){const date=wo.completed_date?.slice(0,10)||null;const person=techName(wo.assigned_tech)||techName(wo.assigned_to);if(technician&&person!==technician)continue;
  if(wo.canceled_date||/cancel/i.test(wo.appfolio_status||''))continue;
  const done=!!date||wo.status==='done'||['completed','complete','work completed','closed'].includes((wo.appfolio_status||'').toLowerCase())||['VERIFY','CLOSED'].includes(wo.stage||'');
  if(!done||(date&&(date<from||date>to)))continue;
  const hasInvoice=liveInvoices.some(i=>invoiceWo.get(i.id)===wo.id);const exactBills=input.billsFresh&&(refs.get(wo.wo_number?.trim()||'')||[]).length===1?input.bills.filter(b=>b.reference?.trim()===wo.wo_number?.trim()&&!!wo.wo_number):[];
  if(hasInvoice||exactBills.length)continue;
  add({key:`wo:${wo.id}:no_invoice`,kind:'no_invoice',title:date?'Completed work: check billing':'Completed work: missing completion date',detail:'No linked invoice or exact work-order bill reference found. Verify direct AppFolio billing before creating an invoice.',day:date,person:person||null,woId:wo.id,property:wo.property_name||'Work order',href:wo.appfolio_link||`/maintenance/board?q=${encodeURIComponent(wo.wo_number||wo.id)}`});
 }
 const active=issues.filter(i=>!i.decision||i.overdue);
 for(const row of days)row.issueCount=active.filter(i=>i.day===row.date).length;
 return {days,issues,counts:{active:active.length,deferred:issues.filter(i=>i.decision&&!i.overdue).length}};
}
