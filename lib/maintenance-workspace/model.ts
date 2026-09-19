import type { AvailabilityProfile } from './planning';
export interface Job { id:string; work_order_id:string; property_name:string; property_address:string; unit_name:string|null; title:string; status:string; progress_billing:boolean; approval_note:string }
export interface Task { id:string; job_id:string; description:string; item_code:string|null; pricing_method:string; amount:number; service_value:number; quantity:number; approved:boolean }
export interface Visit { id:string; job_id:string; technicians:string[]; work_date:string; start_minute:number; planned_minutes:number; status:string; note:string; version:number; source:string }
export interface WorkRecord { id:string; task_id:string; visit_id:string|null; technician:string; work_date:string; minutes:number; progress:'done'|'partial'|'blocked'; note:string; materials:string; status:'draft'|'submitted'|'returned'|'reviewed'|'held'; review_note:string; review_owner:string|null; version:number }
export interface Allocation { task_id:string; invoice_id:string; amount:number; service_value:number; benchmark:number }
export interface WorkspaceInvoice { id:string; invoice_code:string; status:string; maintenance_job_id:string; total_amount:number }
export interface Target { technician:string; effective_from:string; benchmark:number; min_hours:number; max_hours:number }
export interface Workspace { availability?:AvailabilityProfile[]; availabilityError?:string; office:boolean; person:string; jobs:Job[]; tasks:Task[]; visits:Visit[]; records:WorkRecord[]; allocations:Allocation[]; invoices:WorkspaceInvoice[]; staff:{person:string; name:string}[]; targets:Target[] }
export const pacificDay=(date=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
export function shiftDay(day:string,n:number){const d=new Date(`${day}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
export function calendarDays(day:string,mode:'day'|'week'|'month'){
 const date=new Date(`${day}T12:00:00Z`);
 const start=mode==='day'?day:mode==='week'?shiftDay(day,-((date.getUTCDay()+6)%7)):`${day.slice(0,7)}-01`;
 const count=mode==='day'?1:mode==='week'?7:new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();
 return Array.from({length:count},(_,i)=>shiftDay(start,i));
}
export function taskReady(task:Task,records:WorkRecord[]){const rs=records.filter(r=>r.task_id===task.id);return task.approved&&rs.some(r=>r.status==='reviewed'&&r.progress==='done')&&rs.every(r=>r.status==='reviewed');}
export function targetFor(targets:Target[],person:string,day:string){return [...targets].filter(t=>t.technician===person&&t.effective_from<=day).sort((a,b)=>b.effective_from.localeCompare(a.effective_from))[0]??{benchmark:95,min_hours:6,max_hours:8};}
// Allocate cents once across technician/service dates, including work on earlier days.
export function valueContributions(task:Task,records:WorkRecord[]){
 const rs=records.filter(r=>r.task_id===task.id&&r.status==='reviewed').sort((a,b)=>a.id.localeCompare(b.id));
 if(!taskReady(task,records))return [];
 const minutes=rs.reduce((s,r)=>s+r.minutes,0);const cents=Math.round(Number(task.service_value)*100);let used=0;
 return rs.map((r,i)=>{const value=i===rs.length-1?cents-used:Math.floor(cents*r.minutes/minutes);used+=value;return {technician:r.technician,day:r.work_date,value:value/100};});
}
export function dayMetrics(data:Workspace,person:string,day:string){
 let completed=0,draft=0,issued=0,voided=0;
 for(const t of data.tasks){const value=valueContributions(t,data.records).filter(c=>c.technician===person&&c.day===day).reduce((s,c)=>s+c.value,0);completed+=value;
 const a=data.allocations.find(a=>a.task_id===t.id);const inv=data.invoices.find(i=>i.id===a?.invoice_id);
 if(inv?.status==='draft')draft+=value;else if(inv?.status==='void')voided+=value;else if(inv)issued+=value;
 }
 const target=targetFor(data.targets,person,day);
 return {actual:data.records.filter(r=>r.technician===person&&r.work_date===day&&r.status!=='draft').reduce((s,r)=>s+r.minutes,0)/60,completed,draft,issued,voided,unbilled:completed-draft-issued-voided,equivalent:completed/Number(target.benchmark),target};
}
