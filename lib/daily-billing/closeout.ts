import {totals,type Day} from '@/lib/timekeeping/model';
import {invoiceServiceDate,recordedLaborHours} from '@/lib/invoice-labor';
import {normalizeTechnician,type HdmsInvoice} from '@/lib/invoices';
import {linkInvoices} from './links';
import {periodDays,type WorkRecord} from './model';
import {BALANCE_TOLERANCE,JOB_KINDS,OVERHEAD_KINDS} from './closeout-kinds';

/**
 * Billing closeout (Craig, 2026-10-20): every timecard hour of a tech's day lands
 * in one bucket — a work order (invoiced or not yet) or named non-billable time —
 * so the day can be closed with nothing unexplained. Brody, as billing coordinator,
 * fills it in from the tech's route, invoices and conversation.
 *
 * Coverage is per work order across all its invoices, not by invoice date: an
 * invoice often carries a different date than the day the work was done.
 */
export {OVERHEAD_KINDS,JOB_KINDS,BALANCE_TOLERANCE};

export interface CloseoutWo {id:string;wo_number:string|null;property_name:string|null;description:string|null}
export interface CloseoutInput {technician:string;from:string;to:string;timecard:Day[];records:WorkRecord[];invoices:HdmsInvoice[];workOrders:CloseoutWo[];routeStops:{date:string;work_order_id:string}[]}
export interface InvoicedLine {invoiceId:string;code:string;status:string;woId:string|null;label:string;hours:number;flat:boolean;amount:number}
export interface Coverage {woId:string;label:string;loggedMinutes:number;invoicedMinutes:number;flat:boolean;invoices:string[];state:'covered'|'partial'|'not_invoiced'}
export interface CloseoutEntry extends WorkRecord {label:string;billable:boolean;coverage?:Coverage['state']}
export interface CloseoutDay {date:string;off:boolean;span:string;workedMinutes:number;leaveMinutes:number;entries:CloseoutEntry[];invoiced:InvoicedLine[];suggestions:{woId:string;label:string;minutes:number;source:'route'|'invoice'}[];loggedMinutes:number;gapMinutes:number;status:'no_time'|'open'|'balanced'}

const isTech=(line:{technician?:string},tech:string)=>normalizeTechnician(line.technician)===tech||line.technician?.trim()===tech;
const clock=(iso:string)=>new Date(iso).toLocaleTimeString('en-US',{timeZone:'America/Los_Angeles',hour:'numeric',minute:'2-digit'});
export const woLabel=(w:CloseoutWo|undefined)=>w?[w.property_name?.trim(),w.wo_number].filter(Boolean).join(' · ')||'Work order':'Work order';
/** Entries that count toward the day: drafts are unfinished and excluded, as in the daily billing review. */
const counts=(r:WorkRecord)=>r.status!=='draft';

export function buildCloseout(input:CloseoutInput){
 const {technician,from,to}=input;
 const woById=new Map(input.workOrders.map(w=>[w.id,w]));
 const {invoiceWo}=linkInvoices(input.invoices,input.workOrders as any);
 const records=input.records.filter(r=>r.technician===technician&&r.work_date>=from&&r.work_date<=to&&!r.task_id);

 // Everything this tech has invoiced, per work order, whatever date the invoice carries.
 const byWo=new Map<string,{minutes:number;flat:boolean;invoices:Set<string>}>();
 const lines:(InvoicedLine&{date:string|null})[]=[];
 for(const inv of input.invoices){
  if(inv.status==='void'||inv.doc_type==='credit')continue;
  const woId=invoiceWo.get(inv.id)||null;
  for(const line of inv.line_items||[]){
   if((line.type||'labor')!=='labor'||!isTech(line,technician))continue;
   const hours=recordedLaborHours(line);const flat=!hours&&Number(line.amount)>0;
   lines.push({invoiceId:inv.id,code:inv.invoice_code,status:inv.status,woId,label:woId?woLabel(woById.get(woId)):`${inv.property_name||''} · ${inv.wo_reference||'no work order'}`,hours,flat,amount:Number(line.amount)||0,date:invoiceServiceDate(inv)});
   if(woId){const c=byWo.get(woId)||{minutes:0,flat:false,invoices:new Set<string>()};c.minutes+=hours*60;c.flat||=flat;c.invoices.add(inv.invoice_code);byWo.set(woId,c);}
  }
 }

 const logged=new Map<string,number>();
 for(const r of records)if(counts(r)&&r.work_order_id&&JOB_KINDS.includes(r.activity_kind||'job'))logged.set(r.work_order_id,(logged.get(r.work_order_id)||0)+Number(r.minutes));
 const coverage=new Map<string,Coverage>();
 for(const [woId,minutes] of logged){
  const c=byWo.get(woId);const invoicedMinutes=c?.minutes||0;
  // Flat-priced work (re-keys) covers its visit; hourly work must reach the logged time.
  const state:Coverage['state']=c?.flat||(c&&invoicedMinutes>=minutes-BALANCE_TOLERANCE)?'covered':invoicedMinutes>0?'partial':'not_invoiced';
  coverage.set(woId,{woId,label:woLabel(woById.get(woId)),loggedMinutes:minutes,invoicedMinutes,flat:!!c?.flat,invoices:[...(c?.invoices||[])],state});
 }

 const days:CloseoutDay[]=periodDays(from,to).map(date=>{
  const tc=input.timecard.filter(d=>d.date===date);const t=totals(tc);
  const shifts=tc.flatMap(d=>d.shifts).filter(s=>s.source!=='scheduled'&&s.end);
  const leaveMinutes=t.vacation+t.sick+t.holiday+t.loa_paid+t.loa_unpaid;
  const entries:CloseoutEntry[]=records.filter(r=>r.work_date===date).map(r=>{const job=JOB_KINDS.includes(r.activity_kind||'job');return {...r,billable:job,label:job?woLabel(woById.get(r.work_order_id||'')):OVERHEAD_KINDS[r.activity_kind||'other']||'Other',coverage:job&&r.work_order_id?coverage.get(r.work_order_id)?.state:undefined};});
  const invoiced=lines.filter(l=>l.date===date).map(({date:_,...l})=>l);
  const loggedMinutes=entries.filter(counts).reduce((n,e)=>n+Number(e.minutes),0);
  const workedMinutes=Math.round(t.worked);
  const have=new Set(entries.map(e=>e.work_order_id).filter(Boolean));
  const suggestions:CloseoutDay['suggestions']=[];
  const suggest=(woId:string,label:string,minutes:number,source:'route'|'invoice')=>{if(have.has(woId))return;have.add(woId);suggestions.push({woId,label,minutes,source});};
  for(const l of invoiced)if(l.woId)suggest(l.woId,l.label,Math.round(l.hours*60),'invoice');
  for(const s of input.routeStops)if(s.date===date)suggest(s.work_order_id,woLabel(woById.get(s.work_order_id)),0,'route');
  const gapMinutes=workedMinutes-loggedMinutes;
  return {date,off:tc.length>0&&tc.every(d=>d.off)&&!workedMinutes,span:shifts.map(s=>`${clock(s.start)}–${clock(s.end!)}`).join(', '),workedMinutes,leaveMinutes,entries,invoiced,suggestions,loggedMinutes,gapMinutes,
   status:!workedMinutes&&!loggedMinutes?'no_time':Math.abs(gapMinutes)<=BALANCE_TOLERANCE?'balanced':'open'};
 });

 const counted=records.filter(counts);
 const overhead:Record<string,number>={};
 for(const r of counted)if(!JOB_KINDS.includes(r.activity_kind||'job'))overhead[r.activity_kind||'other']=(overhead[r.activity_kind||'other']||0)+Number(r.minutes);
 const jobMinutes=counted.filter(r=>JOB_KINDS.includes(r.activity_kind||'job')).reduce((n,r)=>n+Number(r.minutes),0);
 const cov=[...coverage.values()];
 const summary={
  workedMinutes:days.reduce((n,d)=>n+d.workedMinutes,0),
  loggedMinutes:days.reduce((n,d)=>n+d.loggedMinutes,0),
  jobMinutes,overhead,
  // Unexplained = timecard time with nothing logged against it (never negative per day).
  unexplainedMinutes:days.reduce((n,d)=>n+Math.max(0,d.gapMinutes),0),
  notInvoicedMinutes:cov.reduce((n,c)=>n+(c.state==='covered'?0:Math.max(0,c.loggedMinutes-c.invoicedMinutes)),0),
  invoicedHourlyMinutes:lines.filter(l=>l.date&&l.date>=from&&l.date<=to).reduce((n,l)=>n+l.hours*60,0),
  openDays:days.filter(d=>d.status==='open').length,balancedDays:days.filter(d=>d.status==='balanced').length,
 };
 const rank={not_invoiced:0,partial:1,covered:2};
 return {days,coverage:cov.sort((a,b)=>rank[a.state]-rank[b.state]||a.label.localeCompare(b.label)),summary};
}
