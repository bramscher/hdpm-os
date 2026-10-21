'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {useRouter,useSearchParams} from 'next/navigation';
import {invoiceReportPeriods} from '@/lib/invoice-report-periods';
import {OVERHEAD_KINDS} from '@/lib/daily-billing/closeout-kinds';
import type {CloseoutDay,CloseoutEntry,Coverage} from '@/lib/daily-billing/closeout';
import BillingTabs from '../billing-tabs';
import '../review.css';
import './closeout.css';

type Wo={id:string;wo_number:string|null;property_name:string|null;description:string|null};
type Data={technician:string;from:string;to:string;techs:string[];hasTimecard:boolean;days:CloseoutDay[];coverage:Coverage[];workOrders:Wo[];
 summary:{workedMinutes:number;loggedMinutes:number;jobMinutes:number;overhead:Record<string,number>;unexplainedMinutes:number;notInvoicedMinutes:number;invoicedHourlyMinutes:number;openDays:number;balancedDays:number}};
type Draft={id:string;version?:number;status?:string;date:string;kind:string;woId:string;hours:string;note:string;locked:boolean};

const h=(min:number)=>{const v=Math.round(min/6)/10;return `${v.toFixed(1).replace(/\.0$/,'')} h`;};
const pretty=(d:string)=>new Date(d+'T12:00:00Z').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',timeZone:'UTC'});
const woText=(w:Wo)=>`${w.property_name||''} · ${w.wo_number||''} · ${w.description||''}`;
const coverageText:Record<string,string>={covered:'Invoiced',partial:'Partly invoiced',not_invoiced:'Not invoiced yet'};
const KINDS:[string,string][]=[['job','Work order'],...Object.entries(OVERHEAD_KINDS)];

export default function Closeout({admin}:{admin:boolean}){
 const params=useSearchParams();const router=useRouter();
 const [payPeriod,lastPeriod]=invoiceReportPeriods(new Date(),2).payroll;
 const [tech,setTech]=useState(params.get('technician')||'Alberto');
 const [from,setFrom]=useState(params.get('from')||payPeriod.from),[to,setTo]=useState(params.get('to')||payPeriod.to);
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false);
 const [open,setOpen]=useState<string|null>(params.get('date'));const [draft,setDraft]=useState<Draft|null>(null);const [search,setSearch]=useState('');
 const gen=useRef(0);
 const load=useCallback(async()=>{const g=++gen.current;setLoading(true);setError('');
  try{const r=await fetch(`/api/maintenance/daily-billing/closeout?technician=${encodeURIComponent(tech)}&from=${from}&to=${to}`,{cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.error);if(g===gen.current)setData(d);}
  catch(e){if(g===gen.current)setError((e as Error).message);}finally{if(g===gen.current)setLoading(false);}},[tech,from,to]);
 useEffect(()=>{void load();router.replace(`?technician=${encodeURIComponent(tech)}&from=${from}&to=${to}`,{scroll:false});return()=>{gen.current++}},[load,router,tech,from,to]);

 const newDraft=(date:string,over:Partial<Draft>={})=>{setSearch('');setError('');setDraft({id:crypto.randomUUID(),date,kind:'job',woId:'',hours:'',note:'',locked:false,...over});};
 const editDraft=(e:CloseoutEntry)=>{setSearch('');setError('');setDraft({id:e.id,version:e.version,status:e.status,date:e.work_date,kind:e.activity_kind||'job',woId:e.work_order_id||'',hours:String(Math.round(e.minutes/6)/10),note:e.note,locked:true});};
 async function post(body:Record<string,unknown>){setBusy(true);setError('');
  try{const r=await fetch('/api/maintenance/daily-billing/closeout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error);await load();return true;}
  catch(e){setError((e as Error).message);return false;}finally{setBusy(false);}}
 async function save(ev:React.FormEvent){ev.preventDefault();if(!draft)return;
  const minutes=Math.round(Number(draft.hours)*60);
  if(!(minutes>0))return setError('Enter the hours, e.g. 1.5');
  const wo=data?.workOrders.find(w=>w.id===draft.woId);
  const note=draft.note.trim()||(draft.kind==='job'?`Work at ${wo?.property_name||'work order'}`:'');
  if(!note)return setError('Say what the time was for');
  if(await post({op:'save',id:draft.id,version:draft.version,status:draft.status,technician:tech,work_order_id:draft.kind==='job'?draft.woId:null,work_date:draft.date,minutes,activity_kind:draft.kind,note}))setDraft(null);}
 async function remove(e:CloseoutEntry){if(await post({op:'remove',id:e.id,version:e.version})&&draft?.id===e.id)setDraft(null);}

 const s=data?.summary;
 const matches=draft&&data?(draft.locked?data.workOrders.filter(w=>w.id===draft.woId):data.workOrders.filter(w=>!search||woText(w).toLowerCase().includes(search.toLowerCase())).slice(0,60)):[];
 const pick=draft&&data&&!draft.locked&&draft.woId&&!matches.some(w=>w.id===draft.woId)?data.workOrders.filter(w=>w.id===draft.woId):[];
 return <>
  <BillingTabs active="closeout" admin={admin}/>
  <main className="db-review co-page">
   <header><div><h1>Billing closeout</h1><p>Every timecard hour goes to a work order or to named non-billable time. A day closes when nothing is left to explain.</p></div>
    <div className="db-actions"><button onClick={()=>void load()} disabled={loading}>{loading?'Refreshing…':'Refresh'}</button></div></header>
   {error&&!draft&&<div role="alert" className="db-error">{error}</div>}
   <div className="db-filters">
    <div className="co-seg" role="group" aria-label="Technician">{(data?.techs||['Alberto','Brody']).map(t=><button key={t} aria-pressed={tech===t} onClick={()=>{setTech(t);setOpen(null);setDraft(null);}}>{t}</button>)}</div>
    <label>From<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Through<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
    <button onClick={()=>{setFrom(payPeriod.from);setTo(payPeriod.to);}}>This pay period</button><button onClick={()=>{setFrom(lastPeriod.from);setTo(lastPeriod.to);}}>Last pay period</button>
   </div>
   {data&&!data.hasTimecard&&<div role="status" className="db-warning">No timecard found for {tech} in this period.</div>}
   {s&&<div className="db-tiles">
    <article><small>Timecard</small><strong>{h(s.workedMinutes)}</strong><span>{s.balancedDays} of {s.balancedDays+s.openDays} days closed</span></article>
    <article><small>On work orders</small><strong>{h(s.jobMinutes)}</strong><span>{s.workedMinutes?Math.round(s.jobMinutes/s.workedMinutes*100):0}% of the timecard</span></article>
    <article><small>Not billable</small><strong>{h(s.loggedMinutes-s.jobMinutes)}</strong><span>{Object.entries(s.overhead).map(([k,m])=>`${OVERHEAD_KINDS[k]||k} ${h(m)}`).join(' · ')||'None logged'}</span></article>
    <article className={s.unexplainedMinutes>15?'co-alert':''}><small>Unexplained</small><strong>{h(s.unexplainedMinutes)}</strong><span>Timecard time with nothing logged</span></article>
    <article className={s.notInvoicedMinutes>0?'co-warn':''}><small>Job time not invoiced</small><strong>{h(s.notInvoicedMinutes)}</strong><span>Logged on work orders, not on an invoice yet</span></article>
    <article><small>Invoiced hourly</small><strong>{h(s.invoicedHourlyMinutes)}</strong><span>By invoice date, for comparison</span></article>
   </div>}

   {data&&<section className="co-days">{data.days.filter(d=>d.status!=='no_time'||d.invoiced.length).map(d=>{const isOpen=open===d.date;
    return <article key={d.date} className={`co-day co-${d.status}`}>
     <button className="co-row" aria-expanded={isOpen} onClick={()=>{setOpen(isOpen?null:d.date);setDraft(null);}}>
      <b>{pretty(d.date)}</b><span>{d.span||(d.leaveMinutes?'Leave':'No clock times')}</span><span>Timecard {h(d.workedMinutes)}</span><span>Logged {h(d.loggedMinutes)}</span>
      <span className="co-status">{d.status==='balanced'?'✓ Closed':d.gapMinutes>0?`${h(d.gapMinutes)} to explain`:`${h(-d.gapMinutes)} over timecard`}</span>
     </button>
     {isOpen&&<div className="co-body">
      {d.invoiced.length>0&&<p className="db-note">Invoices dated this day: {d.invoiced.map(l=>`${l.label} (${l.flat?'flat':h(l.hours*60)}, ${l.code.replace('HDMS-','')}${l.status==='draft'?' draft':''})`).join(' · ')}</p>}
      {d.suggestions.length>0&&<div className="co-chips"><small>From {tech}&apos;s route and invoices:</small>{d.suggestions.map(sg=><button key={sg.woId} disabled={busy} onClick={()=>newDraft(d.date,{woId:sg.woId,hours:sg.minutes?String(sg.minutes/60):''})}>+ {sg.label}{sg.minutes?` · ${h(sg.minutes)}`:''}</button>)}</div>}
      {d.entries.length>0&&<table className="co-entries"><thead><tr><th>Time went to</th><th>Hours</th><th>Note</th><th>Billing</th><th/></tr></thead><tbody>{d.entries.map(e=><tr key={e.id} className={e.status==='draft'?'co-muted':''}>
       <td>{e.label}</td><td>{h(e.minutes)}</td><td>{e.note}</td>
       <td><span className={`co-badge co-${e.billable?e.coverage||'not_invoiced':'nonbill'}`}>{e.status==='draft'?'Draft (not counted)':e.billable?coverageText[e.coverage||'not_invoiced']:'Not billable'}</span></td>
       <td className="co-acts"><button disabled={busy} onClick={()=>editDraft(e)}>Edit</button><button disabled={busy} onClick={()=>void remove(e)}>Remove</button></td></tr>)}</tbody></table>}
      {draft?.date===d.date?<form className="co-form" onSubmit={save}>
       {error&&<p role="alert" className="db-error">{error}</p>}
       <div className="db-filters">
        <label>Time went to<select value={draft.kind} onChange={e=>setDraft({...draft,kind:e.target.value})}>{KINDS.map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
        <label>Hours<input type="number" min="0.1" max="16" step="0.05" value={draft.hours} onChange={e=>setDraft({...draft,hours:e.target.value})} required autoFocus/></label>
        {d.gapMinutes>0&&<button type="button" onClick={()=>setDraft({...draft,hours:String(Math.round((d.gapMinutes+(draft.locked?Number(draft.hours)*60:0))/6)/10)})}>Use the rest ({h(d.gapMinutes)})</button>}
       </div>
       {draft.kind==='job'&&<div className="db-filters">
        {!draft.locked&&<label className="co-grow">Find work order<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Property, work order number or description"/></label>}
        <label className="co-grow">Work order<select value={draft.woId} onChange={e=>setDraft({...draft,woId:e.target.value})} disabled={draft.locked} required><option value="">Choose…</option>{[...pick,...matches].map(w=><option key={w.id} value={w.id}>{woText(w).slice(0,120)}</option>)}</select></label>
       </div>}
       {draft.locked&&draft.kind==='job'&&<p className="db-note">To move this time to another work order, remove it and add it again.</p>}
       <label>What was it{draft.kind==='job'?' (optional)':''}<input value={draft.note} onChange={e=>setDraft({...draft,note:e.target.value})} placeholder={draft.kind==='job'?'e.g. replaced bath fan':'e.g. Home Depot for fan + duct'}/></label>
       <div className="db-actions"><button className="db-primary" disabled={busy}>{busy?'Saving…':draft.locked?'Save changes':'Add'}</button><button type="button" disabled={busy} onClick={()=>{setDraft(null);setError('');}}>Cancel</button></div>
      </form>:<div className="db-actions"><button className="db-primary" disabled={busy} onClick={()=>newDraft(d.date,{hours:d.gapMinutes>0?String(Math.round(d.gapMinutes/6)/10):''})}>+ Account for time</button></div>}
     </div>}
    </article>;})}</section>}

   {data&&data.coverage.some(c=>c.state!=='covered')&&<section><h2>Work orders to invoice</h2><p className="db-note">Job time logged here that no invoice covers yet. Coverage counts every invoice on the work order, whatever date it carries; flat-priced work counts as covered.</p>
    <div className="db-table-wrap"><table><thead><tr><th>Work order</th><th>Logged</th><th>Invoiced hourly</th><th>Invoices</th><th>State</th></tr></thead><tbody>{data.coverage.filter(c=>c.state!=='covered').map(c=><tr key={c.woId}><td><Link href={`/maintenance/board?q=${encodeURIComponent(c.label.split(' · ').at(-1)||'')}`}>{c.label}</Link></td><td>{h(c.loggedMinutes)}</td><td>{h(c.invoicedMinutes)}</td><td>{c.invoices.join(', ')||'—'}</td><td><span className={`co-badge co-${c.state}`}>{coverageText[c.state]}</span></td></tr>)}</tbody></table></div>
   </section>}
   <p className="db-note">Timecard hours are worked time only (no pay data). Entries saved here go into the daily work log as reviewed: work-order time billable, everything else not billable.</p>
  </main>
 </>;
}
