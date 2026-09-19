'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { calendarDays, dayMetrics, pacificDay, shiftDay, type Job, type Visit, type Workspace } from '@/lib/maintenance-workspace/model';
import { dayPlan, plannedValues, remainingScope } from '@/lib/maintenance-workspace/planning';

const money = (n:number) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
const hours = (n:number) => (n/60).toFixed(1);
const time = (n:number) => `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
interface Props { data:Workspace; jobs:Job[]; person:string; day:string; setDay:(day:string)=>void; editVisit:(job:Job,visit?:Visit,date?:string)=>void; openTime:(day:string,person:string)=>void; addWorkOrder:()=>void }
export default function SchedulePanel({data,jobs,person,day,setDay,editVisit,openTime,addWorkOrder}:Props) {
  const [mode,setMode] = useState<'day'|'week'|'month'>('week');
  const [allStaff,setAllStaff] = useState(false);
  const values = useMemo(()=>plannedValues(data),[data]);
  const dates = calendarDays(day,mode);
  const people = data.staff.filter(p=>person?p.person===person:allStaff||['Alberto','Brody'].includes(p.person)||data.visits.some(v=>v.technicians.includes(p.person)&&v.status!=='cancelled'));
  const visibleValues = values.filter(v=>dates.includes(v.day)&&people.some(p=>p.person===v.person)&&jobs.some(j=>j.id===v.jobId));
  const revenue = visibleValues.reduce((sum,v)=>sum+Math.round(v.revenue*100),0)/100;
  const service = visibleValues.reduce((sum,v)=>sum+Math.round(v.service*100),0)/100;
  const cells = people.flatMap(p=>dates.map(d=>dayPlan(data,p.person,d)));
  const unpriced = new Set(visibleValues.filter(v=>!v.priced).map(v=>v.jobId)).size;
  const futureCells = people.flatMap(p=>dates.filter(d=>d>=pacificDay()).map(d=>dayPlan(data,p.person,d)));
  const unknown = futureCells.filter(c=>c.capacity===null).length;
  const unscheduled = jobs.filter(j=>j.status==='active'&&(!data.tasks.some(t=>t.job_id===j.id)||remainingScope(data,j.id).length>0)&&!data.visits.some(v=>v.job_id===j.id&&v.status==='planned'&&v.work_date>=pacificDay()));
  function move(direction:number){setDay(mode==='month'?shiftDay(`${day.slice(0,7)}-01`,direction<0?-1:calendarDays(day,'month').length):shiftDay(day,direction*(mode==='week'?7:1)));}
  return <section aria-label="Capacity and planned revenue">
    <div className="mw-between"><div><h2>Capacity & planned revenue</h2><p>{dates[0]} — {dates[dates.length-1]} · Pacific time</p></div><div className="mw-actions"><button onClick={addWorkOrder}>Schedule a work order</button><Link href="/maintenance/invoices?tab=estimates">Approved estimates</Link><Link href="/turn-estimator/price-book">Price book</Link></div></div>
    {data.availabilityError&&<p role="alert" className="mw-error">{data.availabilityError}</p>}
    <div className="mw-grid mw-plan-summary">
      <article className="mw-card"><h3>Booked crew hours</h3><div className="mw-number">{hours(cells.reduce((sum,c)=>sum+c.booked,0))}h</div><p>All jobs for the displayed technicians</p></article>
      <article className="mw-card"><h3>Unbooked capacity</h3><div className="mw-number">{unknown>0&&unknown===futureCells.length?'Not set':`${hours(futureCells.reduce((sum,c)=>sum+(c.available||0),0))}h`}</div><p>{unknown?`${unknown} technician-days have no workweek set`:'Today onward; workweeks less breaks and recorded time off'}</p>{cells.some(c=>(c.overbooked||0)>0)&&<p className="mw-warning">{hours(cells.reduce((sum,c)=>sum+(c.overbooked||0),0))}h over capacity</p>}</article>
      <article className="mw-card"><h3>Planned revenue</h3><div className="mw-number">{money(revenue)}</div><p>Remaining approved charges on upcoming visits</p></article>
      <article className="mw-card"><h3>Planned service value</h3><div className="mw-number">{money(service)}</div><p>Excludes materials and coordination{unpriced?` · ${unpriced} scheduled jobs need priced scope`:''}</p></article>
    </div>
    <div className="mw-actions"><button onClick={()=>move(-1)}>Previous</button>{(['day','week','month'] as const).map(m=><button key={m} aria-pressed={mode===m} onClick={()=>setMode(m)}>{m[0].toUpperCase()+m.slice(1)}</button>)}<button onClick={()=>move(1)}>Next</button><button onClick={()=>setDay(pacificDay())}>Today</button><label className="mw-check"><input type="checkbox" checked={allStaff} onChange={e=>setAllStaff(e.target.checked)}/>Show all staff</label></div>
    <div className="mw-calendar" style={{gridTemplateColumns:`140px repeat(${dates.length}, minmax(205px,1fr))`}}><b>Technician</b>{dates.map(d=><b key={d}>{new Date(`${d}T12:00:00`).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}</b>)}
      {people.map(p=><div className="mw-calendar-row" key={p.person}><strong>{p.name||p.person}{data.availability?.find(a=>a.person===p.person)?.schedule&&<small className="mw-crew-capacity">{data.availability.find(a=>a.person===p.person)!.schedule!.start}–{data.availability.find(a=>a.person===p.person)!.schedule!.end}</small>}</strong>{dates.map(d=>{
        const plan=dayPlan(data,p.person,d), actual=dayMetrics(data,p.person,d);
        const forecast=visibleValues.filter(v=>v.person===p.person&&v.day===d);
        const dailyRevenue=forecast.reduce((sum,v)=>sum+Math.round(v.revenue*100),0)/100;
        return <div key={d} className={d===pacificDay()?'mw-calendar-today':''}>
          <div className={`mw-capacity ${(plan.overbooked||0)>0||plan.conflict?'mw-warning':''}`}><b>{d<pacificDay()?'Past date':plan.capacity===null?'Workweek not set':`${hours(plan.available||0)}h unbooked`}</b><small>{hours(plan.booked)}h booked{plan.capacity!==null?` / ${hours(plan.capacity)}h capacity`:''}</small>{(plan.overbooked||0)>0&&<small>{hours(plan.overbooked!)}h over capacity</small>}{plan.conflict&&<small>Overlapping visits — review schedule</small>}</div>
          {data.visits.filter(v=>v.work_date===d&&v.technicians.includes(p.person)&&v.status!=='cancelled'&&jobs.some(j=>j.id===v.job_id)).sort((a,b)=>a.start_minute-b.start_minute).map(v=>{const planned=forecast.find(f=>f.visitId===v.id);return <button className="mw-calendar-visit" key={v.id} onClick={()=>editVisit(data.jobs.find(j=>j.id===v.job_id)!,v)}><b>{time(v.start_minute)} {data.jobs.find(j=>j.id===v.job_id)?.property_name}</b><small>{v.planned_minutes} min · {v.status}</small>{planned&&<small>{planned.priced?`${money(planned.revenue)} planned share`:'Needs approved pricing'}</small>}</button>;})}
          {forecast.length>0&&<p className="mw-forecast">{money(dailyRevenue)} planned revenue</p>}
          {actual.actual>0&&<button className="mw-calendar-actual" onClick={()=>openTime(d,p.person)}>{actual.actual.toFixed(1)}h actual · {money(actual.completed)} completed service<br/>Draft {money(actual.draft)} · Issued {money(actual.issued)}</button>}
        </div>;
      })}</div>)}
    </div>
    <p className="mw-footnote">Availability uses current saved Timekeeping workweeks, less all breaks, recorded off days and leave. Booked hours include every local job, even when filtering properties. AppFolio-only appointments and travel are not included; allow for them when booking. <Link href="/timekeeping">Review workweeks</Link>.</p>
    <p className="mw-footnote">Forecasts spread each job’s remaining approved value across all upcoming planned visits by crew minutes. Shared visits split the value between technicians; they never multiply the job total. Completed or already-drafted tasks are excluded. These are planning estimates, separate from earned revenue, invoices and cash receipts.</p>
    <h2>Work needing a visit</h2><div className="mw-grid">{unscheduled.map(j=>{const scope=remainingScope(data,j.id);return <button key={j.id} className="mw-card mw-job" onClick={()=>editVisit(j,undefined,day)}><h3>{j.property_name} {j.unit_name}</h3><p>{j.title}</p><b>{scope.length?`${money(scope.reduce((sum,t)=>sum+Number(t.amount),0))} approved scope`:'Needs approved pricing'}</b><p>Schedule visit →</p></button>;})}</div>
  </section>;
}
