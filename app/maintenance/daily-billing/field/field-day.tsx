'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {useRouter,useSearchParams} from 'next/navigation';
import {pacificDay} from '@/lib/maintenance-workspace/model';
import {localTime} from '@/lib/timekeeping/model';
import type {SampleSpec,SampleStop} from '@/lib/field-time/sample';
import '../review.css';
import '../field-time.css';

type Alloc={work_order_id:string;percent:number;name?:string};
type Cand={work_order_id:string;tier:number;today:boolean;name:string};
type Seg={id:string;kind:string;started_at:string;ended_at:string;minutes:number;place:string;property_label:string;label:string|null;note:string;state:'suggested'|'confirmed';confirmed_by:string|null;needs_input:boolean;allocations:Alloc[];candidates:Cand[]};
type Summary={onSite:number;parts:number;dump:number;inspection:number;drive:number;shop:number;other:number;unlabeled:number;breaks:number;unconfirmed:number};
type Option={id:string;label:string;unitRowId:string};
type Data={technician:string;date:string;source:'device'|'sample';admin:boolean;self:boolean;techs:string[];sources:string[];
 day:{id:string;source:string;version:number;built_at:string|null;sample_spec:SampleSpec|null}|null;segments:Seg[];summary:Summary|null;jobs:{id:string;name:string;tier:number}[];
 sampleOptions:{places:{id:string;name:string;kind:string}[];workOrders:Option[];inspectionStops:Option[]}|null};

const KIND:Record<string,string>={on_site:'Job',inspection:'Inspection',parts_run:'Parts run',dump_run:'Dump run',shop:'Shop',drive:'Drive',stop:'Stop',no_data:'No signal',break:'Break'};
const LABELS:Record<string,string>={personal:'Personal / break',estimate:'Estimate or walkthrough',other_work:'Other work (describe it)',phone_off:'Phone off / no signal',general:'Van stock / general (overhead)'};
const STOP_KINDS=['on_site','inspection','shop','stop'],TRIP_KINDS=['parts_run','dump_run'];
const hm=(m:number)=>{const h=Math.floor(m/60),r=Math.round(m%60);return h&&r?`${h} h ${r} m`:h?`${h} h`:`${r} m`;};
/** Whole percentages that add up to 100, the remainder on the first jobs. */
const evenSplit=(ids:string[])=>ids.map((work_order_id,i)=>({work_order_id,percent:Math.floor(100/ids.length)+(i<100%ids.length?1:0)}));
const addMinutes=(t:string,n:number)=>{const [h,m]=t.split(':').map(Number);const x=Math.min(23*60+59,Math.max(0,h*60+m+n));return `${String(Math.floor(x/60)).padStart(2,'0')}:${String(x%60).padStart(2,'0')}`;};
const placeValue=(p:SampleStop['place'])=>p.type==='point'?'point':`${p.type}:${p.id}`;

export default function FieldDay(){
 const params=useSearchParams(),router=useRouter();
 const [technician,setTechnician]=useState(params.get('technician')||''),[date,setDate]=useState(params.get('date')||pacificDay()),[source,setSource]=useState(params.get('source')||'');
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[open,setOpen]=useState<string|null>(null);
 const generation=useRef(0);
 const load=useCallback(async()=>{const gen=++generation.current;setError('');try{const q=new URLSearchParams({date});if(technician)q.set('technician',technician);if(source)q.set('source',source);const r=await fetch(`/api/maintenance/field-time?${q}`,{cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.error);if(gen===generation.current){setData(d);if(!technician)setTechnician(d.technician);}}catch(e){if(gen===generation.current)setError((e as Error).message);}},[technician,date,source]);
 useEffect(()=>{void load();return()=>{generation.current++;};},[load]);
 useEffect(()=>{const q=new URLSearchParams({date});if(technician)q.set('technician',technician);if(source)q.set('source',source);router.replace(`/maintenance/daily-billing/field?${q}`,{scroll:false});},[technician,date,source,router]);
 async function post(body:Record<string,unknown>){setBusy(true);setError('');try{const r=await fetch('/api/maintenance/field-time',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error);return d;}catch(e){setError((e as Error).message);if(String((e as Error).message).includes('reload'))void load();return null;}finally{setBusy(false);}}
 const apply=(d:Data|null)=>{if(d){setData(d);setOpen(null);}};
 const canAct=!!data&&(data.admin||(data.self&&data.source==='device'));
 const s=data?.summary;
 const readyToConfirm=(data?.segments||[]).some(x=>x.state==='suggested'&&!x.needs_input);
 return <main className="db-review">
  <header><div><Link href="/maintenance/daily-billing">← Daily Billing Review</Link><h1>Field day</h1><p>Where the paid day went, from location: jobs, parts and dump runs, inspections, driving and anything unexplained. Confirm each piece, pick the job, or say what it was.</p></div>
   <div className="db-actions"><Link href="/maintenance/daily-billing/locations">Stop locations</Link><button onClick={()=>void load()} disabled={busy}>Refresh</button></div></header>
  <div className="db-filters">
   {data&&<label>Technician<select value={technician} onChange={e=>{setTechnician(e.target.value);setSource('');setOpen(null);}}>{data.techs.map(t=><option key={t}>{t}</option>)}</select></label>}
   <label>Date<input type="date" value={date} max={pacificDay()} onChange={e=>{setDate(e.target.value);setSource('');setOpen(null);}}/></label>
   {data?.admin&&<div className="db-actions" role="group" aria-label="Source"><button aria-pressed={data.source==='device'} onClick={()=>setSource('device')}>Phone{data.sources.includes('device')?'':' (none)'}</button><button aria-pressed={data.source==='sample'} onClick={()=>setSource('sample')}>Sample day{data.sources.includes('sample')?'':' (none)'}</button></div>}
  </div>
  {error&&<div role="alert" className="db-error">{error}</div>}
  {data&&<>
   {data.source==='sample'&&<p className="db-note">Sample days are typed in to test matching before the iPhone app. They show in Daily Billing Review only with <b>Show sample days</b> on, and never become payroll or invoices.</p>}
   {s&&<div className="db-tiles">
    <article><small>Job time</small><strong>{hm(s.onSite)}</strong><span>On site at work orders</span></article>
    <article><small>Parts runs</small><strong>{hm(s.parts)}</strong><span>Drive there, store, drive back</span></article>
    {s.dump>0&&<article><small>Dump runs</small><strong>{hm(s.dump)}</strong><span>Charged flat per job</span></article>}
    {s.inspection>0&&<article><small>Inspections</small><strong>{hm(s.inspection)}</strong><span>Not billed as maintenance</span></article>}
    <article><small>Drive and shop</small><strong>{hm(s.drive+s.shop)}</strong><span>{hm(s.drive)} driving · {hm(s.shop)} at the shop</span></article>
    <article><small>Needs labeling</small><strong>{hm(s.unlabeled)}</strong><span>{hm(s.unconfirmed)} not yet confirmed</span></article>
   </div>}
   {data.day?<section>
    <div className="db-between"><h2>Timeline · {data.technician} · {data.date}</h2><div className="db-actions">
     {canAct&&readyToConfirm&&<button className="db-primary" disabled={busy} onClick={async()=>apply(await post({op:'confirm_all',day_id:data.day!.id,version:data.day!.version}))}>Confirm all suggestions</button>}
     {data.admin&&data.source==='sample'&&<button disabled={busy} onClick={async()=>apply(await post({op:'rebuild',technician:data.technician,date:data.date,source:data.source}))}>Rebuild</button>}
    </div></div>
    {!data.segments.length&&<p className="db-empty">No segments yet.</p>}
    <div className="db-stack">{data.segments.map(seg=><SegmentCard key={`${seg.id}|${data.day!.version}`} seg={seg} data={data} canAct={canAct} busy={busy} open={open===seg.id} setOpen={v=>setOpen(v?seg.id:null)}
     onConfirm={async body=>apply(await post({op:'confirm',segment_id:seg.id,version:data.day!.version,...body}))}
     onSaveLocation={async()=>{const r=await fetch('/api/maintenance/field-time/locations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'place_from_stop',technician:data.technician,date:data.date,source:data.source,segment_id:seg.id})});const d=await r.json();if(!r.ok){setError(d.error);return;}router.push(`/maintenance/daily-billing/locations?add=1&lat=${d.latitude}&lng=${d.longitude}`);}}/>)}</div>
   </section>:<p className="db-empty">{data.admin?'No field time for this day yet. Type a sample day below to test matching.':'No field time for this day. It appears once the iPhone app records your day.'}</p>}
   {data.admin&&data.sampleOptions&&<SampleEditor key={`${data.technician}|${data.date}|${data.day?.version??0}`} data={data} busy={busy}
    onSave={async spec=>{const d=await post({op:'sample_save',technician:data.technician,date:data.date,spec});if(d){setSource('sample');apply(d);}}}
    onDelete={async()=>{if(!data.day||data.source!=='sample')return;const d=await post({op:'delete_sample',day_id:data.day.id});if(d)void load();}}/>}
  </>}
 </main>;
}

function SegmentCard({seg,data,canAct,busy,open,setOpen,onConfirm,onSaveLocation}:{seg:Seg;data:Data;canAct:boolean;busy:boolean;open:boolean;setOpen:(v:boolean)=>void;onConfirm:(body:Record<string,unknown>)=>Promise<void>;onSaveLocation:()=>Promise<void>}){
 const [kind,setKind]=useState(seg.kind),[rows,setRows]=useState<Alloc[]>(seg.allocations),[label,setLabel]=useState(seg.label||''),[note,setNote]=useState(seg.note);
 const names=new Map([...data.jobs.map(j=>[j.id,j.name] as const),...seg.candidates.map(c=>[c.work_order_id,c.name] as const),...seg.allocations.map(a=>[a.work_order_id,a.name||'Work order'] as const)]);
 const options=[...seg.candidates.map(c=>({id:c.work_order_id,name:c.name,hint:c.today?'today':c.tier===1?'yours':''})),...data.jobs.map(j=>({id:j.id,name:j.name,hint:j.tier===1?'yours':''}))].filter((o,i,all)=>all.findIndex(x=>x.id===o.id)===i&&!rows.some(r=>r.work_order_id===o.id));
 const isTrip=TRIP_KINDS.includes(kind),isStop=STOP_KINDS.includes(kind),takesJobs=kind==='on_site'||isTrip,takesLabel=kind==='stop'||kind==='no_data';
 const general=isTrip&&label==='general';
 const total=rows.reduce((n,r)=>n+r.percent,0);
 const setJobs=(ids:string[])=>setRows(evenSplit(ids));
 const title=seg.property_label||seg.place||KIND[seg.kind];
 const quickConfirm=seg.state==='suggested'&&!seg.needs_input;
 return <article className={`db-card ft-seg ${seg.needs_input?'ft-needs':''}`}>
  <div className="ft-time">{localTime(seg.started_at)}–{localTime(seg.ended_at)}<small>{hm(seg.minutes)}</small></div>
  <div className="ft-main"><div className="db-actions"><span className={`ft-kind ft-${seg.kind}`}>{KIND[seg.kind]||seg.kind}</span><b>{title}</b></div>
   {seg.allocations.length>0&&<p>{seg.allocations.map(a=>`${a.name}${seg.allocations.length>1?` (${a.percent}%)`:''}`).join(' · ')}</p>}
   {seg.label&&<p>{LABELS[seg.label]}{seg.note?` — ${seg.note}`:''}</p>}
   {seg.needs_input&&<p>{seg.kind==='on_site'?'Which job was this?':TRIP_KINDS.includes(seg.kind)?'Which jobs were these parts for?':'What was this time?'}</p>}
  </div>
  <div className="db-actions"><span className="db-badge">{seg.state==='confirmed'?'Confirmed':'Suggested'}</span>
   {canAct&&quickConfirm&&!open&&<button disabled={busy} onClick={()=>void onConfirm({})}>Confirm</button>}
   {canAct&&!['drive','break'].includes(seg.kind)&&<button disabled={busy} aria-expanded={open} onClick={()=>setOpen(!open)}>{open?'Close':seg.needs_input?'Fill in':'Change'}</button>}
  </div>
  {open&&<div className="ft-edit">
   {(isStop||isTrip)&&<label>What it was<select value={kind} onChange={e=>{setKind(e.target.value);setLabel('');if(!['on_site',...TRIP_KINDS].includes(e.target.value))setRows([]);}}>{(isStop?STOP_KINDS:TRIP_KINDS).map(k=><option key={k} value={k}>{KIND[k]}</option>)}</select></label>}
   {takesJobs&&!general&&<>
    {rows.map((r,i)=><div className="ft-split" key={r.work_order_id}><span>{names.get(r.work_order_id)||'Work order'}</span>
     <input type="number" min="1" max="100" aria-label="Percent" value={r.percent} onChange={e=>setRows(rows.map((x,j)=>j===i?{...x,percent:Math.round(Number(e.target.value)||0)}:x))}/>
     <button type="button" onClick={()=>setJobs(rows.filter((_,j)=>j!==i).map(x=>x.work_order_id))}>Remove</button></div>)}
    <label>{rows.length?'Split with another job':'Job'}<select value="" onChange={e=>{if(e.target.value)setJobs([...rows.map(r=>r.work_order_id),e.target.value]);}}><option value="">Choose a work order…</option>{options.map(o=><option key={o.id} value={o.id}>{o.name}{o.hint?` — ${o.hint}`:''}</option>)}</select></label>
    {rows.length>1&&<p className="db-note">Split evenly by default; adjust if most of the time was for one job. Total {total}%.</p>}
   </>}
   {isTrip&&<label className="db-check"><input type="checkbox" checked={general} onChange={e=>{setLabel(e.target.checked?'general':'');if(e.target.checked)setRows([]);}}/>Van stock / general (overhead, not charged to a job)</label>}
   {takesLabel&&<label>What it was<select value={label} onChange={e=>setLabel(e.target.value)}><option value="">Choose…</option>{Object.entries(LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>}
   {(takesLabel||kind==='inspection')&&<label>Note<textarea value={note} onChange={e=>setNote(e.target.value)} placeholder={label==='other_work'?'What was the other work?':'Optional'}/></label>}
   <div className="db-actions"><button className="db-primary" disabled={busy||(takesJobs&&!general&&(!rows.length||total!==100))} onClick={()=>void onConfirm({kind,allocations:takesJobs&&!general?rows.map(({work_order_id,percent})=>({work_order_id,percent})):[],label:takesLabel||general?label:'',note})}>Confirm</button>
    {data.admin&&seg.kind==='stop'&&<button type="button" disabled={busy} onClick={()=>void onSaveLocation()}>Save as location</button>}</div>
  </div>}
 </article>;
}

function SampleEditor({data,busy,onSave,onDelete}:{data:Data;busy:boolean;onSave:(spec:SampleSpec)=>Promise<void>;onDelete:()=>Promise<void>}){
 const opts=data.sampleOptions!;
 const shop=opts.places.find(p=>p.kind==='shop');
 const initial:SampleSpec=data.source==='sample'&&data.day?.sample_spec?data.day.sample_spec:{start:'07:00',end:'15:30',stops:shop?[{arrive:'07:00',depart:'07:20',place:{type:'place',id:shop.id}}]:[],breaks:[],phoneOff:[]};
 const [spec,setSpec]=useState<SampleSpec>(initial),[show,setShow]=useState(!data.day);
 const setStop=(i:number,patch:Partial<SampleStop>)=>setSpec({...spec,stops:spec.stops.map((s,j)=>j===i?{...s,...patch}:s)});
 const choose=(i:number,value:string)=>{if(value==='point'){setStop(i,{place:{type:'point',lat:44.2568,lng:-121.1843}});return;}const [type,id]=value.split(':');setStop(i,{place:{type:type as 'place'|'unit',id}});};
 const addStop=()=>{const last=spec.stops.at(-1);const arrive=last?addMinutes(last.depart,15):spec.start;setSpec({...spec,stops:[...spec.stops,{arrive,depart:addMinutes(arrive,60),place:shop?{type:'place',id:shop.id}:{type:'point',lat:44.2568,lng:-121.1843}}]});};
 const ranges=(key:'breaks'|'phoneOff',label:string)=><div className="db-stack">{(spec[key]||[]).map((r,i)=><div className="db-filters" key={i}>
  <label>{label} from<input type="time" value={r.start} onChange={e=>setSpec({...spec,[key]:(spec[key]||[]).map((x,j)=>j===i?{...x,start:e.target.value}:x)})}/></label>
  <label>to<input type="time" value={r.end} onChange={e=>setSpec({...spec,[key]:(spec[key]||[]).map((x,j)=>j===i?{...x,end:e.target.value}:x)})}/></label>
  <button type="button" onClick={()=>setSpec({...spec,[key]:(spec[key]||[]).filter((_,j)=>j!==i)})}>Remove</button></div>)}</div>;
 return <section className="db-card ft-sample">
  <div className="db-between"><h2>Sample day</h2><button aria-expanded={show} onClick={()=>setShow(!show)}>{show?'Hide':data.source==='sample'&&data.day?'Edit sample day':'Type a sample day'}</button></div>
  {show&&<>
   <p className="db-note">Type the stops as they happened. The server turns them into GPS fixes (every 2 minutes, driving in between) and runs the same matching the iPhone app will use. Pick a work order&apos;s property, a store, the dump, the shop, an inspection stop, or typed coordinates for anywhere else.</p>
   <div className="db-filters"><label>Clocked in<input type="time" value={spec.start} onChange={e=>setSpec({...spec,start:e.target.value})}/></label><label>Clocked out<input type="time" value={spec.end} onChange={e=>setSpec({...spec,end:e.target.value})}/></label></div>
   {spec.stops.map((stop,i)=><div className="ft-sample-row" key={i}>
    <label>Arrive<input type="time" value={stop.arrive} onChange={e=>setStop(i,{arrive:e.target.value})}/></label>
    <label>Leave<input type="time" value={stop.depart} onChange={e=>setStop(i,{depart:e.target.value})}/></label>
    <label>Where<select value={placeValue(stop.place)} onChange={e=>choose(i,e.target.value)}>
     <optgroup label="Locations">{opts.places.map(p=><option key={`p${p.id}`} value={`place:${p.id}`}>{p.name}</option>)}</optgroup>
     {opts.workOrders.length>0&&<optgroup label="Work orders">{opts.workOrders.map(w=><option key={`w${w.id}`} value={`unit:${w.unitRowId}`}>{w.label}</option>)}</optgroup>}
     {opts.inspectionStops.length>0&&<optgroup label="Inspection route">{opts.inspectionStops.map(s=><option key={`i${s.id}`} value={`unit:${s.unitRowId}`}>{s.label}</option>)}</optgroup>}
     <option value="point">Typed coordinates…</option>
    </select>{stop.place.type==='point'&&<span className="ft-point"><input type="number" step="0.0001" aria-label="Latitude" value={stop.place.lat} onChange={e=>setStop(i,{place:{type:'point',lat:Number(e.target.value),lng:(stop.place as {lng:number}).lng}})}/><input type="number" step="0.0001" aria-label="Longitude" value={stop.place.lng} onChange={e=>setStop(i,{place:{type:'point',lat:(stop.place as {lat:number}).lat,lng:Number(e.target.value)}})}/></span>}</label>
    <button type="button" onClick={()=>setSpec({...spec,stops:spec.stops.filter((_,j)=>j!==i)})}>Remove</button>
   </div>)}
   <div className="db-actions"><button type="button" onClick={addStop}>+ Stop</button><button type="button" onClick={()=>setSpec({...spec,breaks:[...(spec.breaks||[]),{start:'12:00',end:'12:30'}]})}>+ Break</button><button type="button" onClick={()=>setSpec({...spec,phoneOff:[...(spec.phoneOff||[]),{start:'13:00',end:'14:00'}]})}>+ Phone off</button></div>
   {ranges('breaks','Break')}{ranges('phoneOff','Phone off')}
   <div className="db-actions"><button className="db-primary" disabled={busy} onClick={()=>void onSave(spec)}>{busy?'Building…':'Save and build the day'}</button>
    {data.source==='sample'&&data.day&&<button disabled={busy} onClick={()=>void onDelete()}>Delete sample day</button>}</div>
  </>}
 </section>;
}
