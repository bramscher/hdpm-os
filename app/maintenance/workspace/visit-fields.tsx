'use client';
import { useState } from 'react';
import { dayPlan, clockMinutes } from '@/lib/maintenance-workspace/planning';
import type { Visit, Workspace } from '@/lib/maintenance-workspace/model';
const time=(n:number)=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
export default function VisitFields({data,visit,day}:{data:Workspace;visit?:Visit;day:string}) {
  const [date,setDate]=useState(visit?.work_date||day),[start,setStart]=useState(time(visit?.start_minute??510)),[minutes,setMinutes]=useState(visit?.planned_minutes||60),[crew,setCrew]=useState<string[]>(visit?.technicians||[]);
  const ordered=[...data.staff].sort((a,b)=>Number(['Alberto','Brody'].includes(b.person))-Number(['Alberto','Brody'].includes(a.person)));
  return <>
    <label>Planned date<input name="date" type="date" value={date} onChange={e=>setDate(e.target.value)} required/></label>
    <div className="mw-filters"><label>Start time (Pacific)<input name="start" type="time" value={start} onChange={e=>setStart(e.target.value)} required/></label><label>Planned minutes per technician<input name="minutes" type="number" min="1" max="960" value={minutes} onChange={e=>setMinutes(Number(e.target.value))} required/></label></div>
    <fieldset><legend>Technicians & availability</legend>{ordered.map(p=>{const plan=date?dayPlan(data,p.person,date,visit?.id):null;const workweek=data.availability?.find(a=>a.person===p.person)?.schedule;const outside=workweek&&workweek.end>workweek.start&&(clockMinutes(start)<clockMinutes(workweek.start)||clockMinutes(start)+minutes>clockMinutes(workweek.end));const overlap=data.visits.some(v=>v.id!==visit?.id&&v.work_date===date&&v.status==='planned'&&v.technicians.includes(p.person)&&v.start_minute<clockMinutes(start)+minutes&&v.start_minute+v.planned_minutes>clockMinutes(start));return <label key={p.person} className="mw-check"><input type="checkbox" name="technicians" value={p.person} checked={crew.includes(p.person)} onChange={e=>setCrew(s=>e.target.checked?[...s,p.person]:s.filter(x=>x!==p.person))}/><span>{p.name||p.person}<small className={`mw-crew-capacity ${overlap||outside?'mw-warning':''}`}>{overlap?'Time conflict':outside?'Outside saved working hours':plan?.available!=null?`${(plan.available/60).toFixed(1)}h unbooked before this visit${crew.includes(p.person)&&minutes>plan.available?' · exceeds remaining capacity':''}`:'Workweek not set'}</small></span></label>;})}</fieldset>
    <label>Status<select name="status" defaultValue={visit?.status||'planned'}><option value="planned">Planned</option><option value="complete">Visit complete</option><option value="cancelled">Cancelled</option></select></label>
    <label>Visit notes<textarea name="note" defaultValue={visit?.note}/></label>
    <p className="mw-footnote">Scheduling reserves time; it does not approve scope. Revenue appears after approved pricing is added. Capacity is a planning guide and does not change payroll or prevent authorized overtime.</p>
  </>;
}
