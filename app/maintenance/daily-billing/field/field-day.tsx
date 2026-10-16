'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useRouter,useSearchParams} from 'next/navigation';
import {pacificDay,shiftDay} from '@/lib/maintenance-workspace/model';
import type {SampleSpec,SampleStop} from '@/lib/field-time/sample';
import BillingTabs from '../billing-tabs';
import './field-day.css';

type Job={work_order_id:string;wo_number:string|null;property_name:string|null;title:string;sub:string;name:string;tier?:number;today?:boolean};
type Seg={id:string;kind:string;started_at:string;ended_at:string;minutes:number;place:string;property_label:string;label:string|null;note:string;state:'suggested'|'confirmed';confirmed_by:string|null;needs_input:boolean;allocations:(Job&{percent:number})[];candidates:Job[]};
type Bill={work_order_id:string;wo_number:string|null;property:string;title:string;done:boolean;onSite:number;parts:number;dumpRuns:number;pending:number;expected:number;billedHours:number;shortHours:number;hasDumpCharge:boolean;verdict:'waiting'|'no_invoice'|'short'|'dump_missing'|'flat'|'billed';invoices:{id:string;code:string}[]};
type Option={id:string;label:string;unitRowId:string};
type Data={technician:string;date:string;source:'device'|'sample';admin:boolean;self:boolean;techs:string[];sources:string[];
 day:{id:string;source:string;version:number;built_at:string|null;sample_spec:SampleSpec|null}|null;segments:Seg[];
 jobs:{id:string;tier:number;wo_number:string|null;title:string;sub:string;name:string}[];
 sampleOptions:{places:{id:string;name:string;kind:string}[];workOrders:Option[];inspectionStops:Option[]}|null;billing:Bill[]|null};
type Body={kind?:string;allocations?:{work_order_id:string;percent:number}[];label?:string;note?:string};
type Preset={kind?:string;label?:string};

// Kind colors from the Maintenance OS brand; each differs in lightness as well as hue.
const KIND:Record<string,{label:string;fill:string;ink:string;chip:string;chipInk:string}>={
 on_site:{label:'Job',fill:'#2f7d32',ink:'#ffffff',chip:'#e3f0e3',chipInk:'#1f5c22'},
 inspection:{label:'Inspection',fill:'#2c5f8a',ink:'#ffffff',chip:'#e1ebf5',chipInk:'#1f4a70'},
 parts_run:{label:'Parts run',fill:'#e2a227',ink:'#1a1a1a',chip:'#fbefd5',chipInk:'#6b4a00'},
 dump_run:{label:'Dump run',fill:'#0e6e6e',ink:'#ffffff',chip:'#dcefee',chipInk:'#0b5555'},
 drive:{label:'Drive',fill:'#e4e9e3',ink:'#3d433d',chip:'#eef1ed',chipInk:'#3d433d'},
 shop:{label:'Shop',fill:'#b7c3b6',ink:'#1a1a1a',chip:'#e7ece6',chipInk:'#3d433d'},
 stop:{label:'Other stop',fill:'#f2cfc6',ink:'#7d2418',chip:'#fbe6e1',chipInk:'#8f2c1f'},
 no_data:{label:'No signal',fill:'#f7e4df',ink:'#7d2418',chip:'#fbe6e1',chipInk:'#8f2c1f'},
 break:{label:'Break',fill:'#f1f1ee',ink:'#3d433d',chip:'#f1f1ee',chipInk:'#3d433d'},
};
const KIND_ORDER=['on_site','inspection','parts_run','dump_run','drive','shop','stop','no_data','break'];
const LABELS:Record<string,string>={personal:'Personal / break',estimate:'Estimate or walkthrough',other_work:'Other work',phone_off:'Phone off / no signal',general:'Van stock / general'};
const STOP_KINDS=['on_site','inspection','shop','stop'],TRIP_KINDS=['parts_run','dump_run'];
const ZONE='America/Los_Angeles';
const hm=(m:number)=>{const v=Math.round(m),h=Math.floor(v/60),r=v%60;return h&&r?`${h} h ${r} m`:h?`${h} h`:`${r} m`;};
const clock=(ms:number,withPeriod=true)=>new Date(ms).toLocaleTimeString('en-US',{timeZone:ZONE,hour:'numeric',minute:'2-digit'}).replace(withPeriod?/$^/:/\s?[AP]M$/,'');
const period=(ms:number)=>clock(ms).slice(-2);
/** "7:30–10:30 AM", or "11:20 AM–12:50 PM" across noon. */
const range=(a:string,b:string)=>{const s=Date.parse(a),e=Date.parse(b);return period(s)===period(e)?`${clock(s,false)}–${clock(e)}`:`${clock(s)}–${clock(e)}`;};
const longDate=(d:string)=>new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',timeZone:'UTC'});
/** Whole percentages that add up to 100, the remainder on the first jobs. */
const evenSplit=(ids:string[])=>ids.map((work_order_id,i)=>({work_order_id,percent:Math.floor(100/ids.length)+(i<100%ids.length?1:0)}));
const jobLabel=(j:{wo_number:string|null;title:string})=>[j.wo_number,j.title].filter(Boolean).join(' · ')||'Work order';
const placeOf=(s:Seg)=>s.property_label||s.place||KIND[s.kind]?.label||s.kind;

export default function FieldDay(){
 const params=useSearchParams(),router=useRouter();
 const [technician,setTechnician]=useState(params.get('technician')||''),[date,setDate]=useState(params.get('date')||pacificDay()),[source,setSource]=useState(params.get('source')||'');
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [selected,setSelected]=useState<string|null>(null),[editor,setEditor]=useState<{id:string;preset:Preset}|null>(null),[answered,setAnswered]=useState<string[]>([]);
 const generation=useRef(0);
 const load=useCallback(async()=>{const gen=++generation.current;setError('');try{const q=new URLSearchParams({date});if(technician)q.set('technician',technician);if(source)q.set('source',source);const r=await fetch(`/api/maintenance/field-time?${q}`,{cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.error);if(gen===generation.current){setData(d);if(!technician)setTechnician(d.technician);}}catch(e){if(gen===generation.current)setError((e as Error).message);}},[technician,date,source]);
 useEffect(()=>{void load();return()=>{generation.current++;};},[load]);
 useEffect(()=>{const q=new URLSearchParams({date});if(technician)q.set('technician',technician);if(source)q.set('source',source);router.replace(`/maintenance/daily-billing/field?${q}`,{scroll:false});},[technician,date,source,router]);
 async function post(body:Record<string,unknown>){setBusy(true);setError('');try{const r=await fetch('/api/maintenance/field-time',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error);return d;}catch(e){setError((e as Error).message);if(String((e as Error).message).includes('reload'))void load();return null;}finally{setBusy(false);}}
 const apply=(d:Data|null)=>{if(d){setData(d);setEditor(null);}};
 const confirm=async(seg:Seg,body:Body)=>{if(!data?.day)return;const d=await post({op:'confirm',segment_id:seg.id,version:data.day.version,...body});if(d){apply(d);setAnswered(a=>a.includes(seg.id)?a:[...a,seg.id]);}};
 async function saveAsLocation(seg:Seg){if(!data)return;const r=await fetch('/api/maintenance/field-time/locations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'place_from_stop',technician:data.technician,date:data.date,source:data.source,segment_id:seg.id})});const d=await r.json();if(!r.ok){setError(d.error);return;}router.push(`/maintenance/daily-billing/locations?add=1&lat=${d.latitude}&lng=${d.longitude}`);}
 const pick=(id:string)=>{setSelected(s=>s===id?null:id);(document.getElementById(`fd-seg-${id}-need`)||document.getElementById(`fd-seg-${id}`))?.scrollIntoView({behavior:'smooth',block:'center'});};
 const go=(patch:{technician?:string;date?:string;source?:string})=>{if(patch.technician!==undefined)setTechnician(patch.technician);if(patch.date!==undefined)setDate(patch.date);setSource(patch.source??'');setSelected(null);setEditor(null);setAnswered([]);};

 const tech=data?.technician||technician||'the tech';
 const canAct=!!data&&(data.admin||(data.self&&data.source==='device'));
 const segments=data?.segments||[];
 const needs=segments.filter(s=>s.needs_input);
 // Answered here stay in place (collapsed) so the next card doesn't slide under the pointer.
 const asked=segments.filter(s=>s.needs_input||answered.includes(s.id));
 const ready=segments.filter(s=>s.state==='suggested'&&!s.needs_input);
 const editorFor=(s:Seg)=>editor?.id===s.id?<SegmentEditor key={`${s.id}|${data?.day?.version}`} seg={s} data={data!} busy={busy} preset={editor.preset} onConfirm={b=>void confirm(s,b)} onCancel={()=>setEditor(null)} onSaveLocation={()=>void saveAsLocation(s)}/>:null;

 return <main className="fd">
  <BillingTabs active="field" admin={!!data?.admin}/>
  <div className="fd-wrap">
   <header className="fd-head">
    <div><h1>Field time</h1><p>Where {tech}’s paid day went, and what still needs an answer before it counts for billing.</p></div>
    <div className="fd-controls">
     {data&&data.techs.length>1&&<div role="group" aria-label="Technician" className="fd-seg">{data.techs.map(t=><button key={t} type="button" aria-pressed={t===data.technician} onClick={()=>go({technician:t})}>{t}</button>)}</div>}
     <div className="fd-date">
      <button type="button" aria-label="Previous day" onClick={()=>go({date:shiftDay(date,-1)})}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button>
      <label>{longDate(date)}<input type="date" aria-label="Date" value={date} max={pacificDay()} onClick={e=>{try{e.currentTarget.showPicker?.();}catch{}}} onChange={e=>e.target.value&&go({date:e.target.value})}/></label>
      <button type="button" aria-label="Next day" disabled={date>=pacificDay()} onClick={()=>go({date:shiftDay(date,1)})}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg></button>
     </div>
     {data?.admin?<div role="group" aria-label="Source" className="fd-seg"><button type="button" aria-pressed={data.source==='device'} onClick={()=>go({source:'device'})}>Phone</button><button type="button" aria-pressed={data.source==='sample'} onClick={()=>go({source:'sample'})}>Sample day</button></div>
      :data?.source==='sample'&&<span className="fd-pill">Sample day</span>}
    </div>
   </header>
   {data?.source==='sample'&&<p className="fd-muted">Sample day: the stops were typed in to test matching before the iPhone app. The work orders and invoices are real.</p>}
   {error&&<div role="alert" className="fd-error">{error}</div>}
   {data&&(data.day&&segments.length?<>
    <DayStrip segments={segments} source={data.source} selected={selected} onPick={pick}/>
    <div className="fd-cols">
     <div className="fd-main">
      <section className="fd-section" aria-labelledby="fd-needs-h">
       <div className="fd-between"><h2 id="fd-needs-h">{needs.length?`Needs ${tech}’s answer · ${needs.length}`:'Nothing waiting for an answer'}</h2><span className="fd-muted">Nothing counts for billing until it’s confirmed.</span></div>
       {asked.map(s=><NeedCard key={`${s.id}|${data.day!.version}`} seg={s} tech={tech} canAct={canAct} busy={busy} selected={selected===s.id}
        onAnswer={b=>void confirm(s,b)} onMore={preset=>setEditor({id:s.id,preset})} editor={editorFor(s)}/>)}
      </section>
      {ready.length>0?<section className="fd-ready" aria-labelledby="fd-ready-h">
       <div><h2 id="fd-ready-h">Ready to confirm · {ready.length}</h2><span>{readySummary(ready)}</span></div>
       {canAct&&<button type="button" className="fd-primary" disabled={busy} onClick={async()=>apply(await post({op:'confirm_all',day_id:data.day!.id,version:data.day!.version}))}>Confirm all {ready.length}</button>}
      </section>:!needs.length&&<section className="fd-ready"><div><h2>Everything on this day is confirmed</h2><span>Change any line below if it’s wrong.</span></div></section>}
      <section className="fd-card fd-timeline" aria-labelledby="fd-tl-h">
       <h2 id="fd-tl-h">Timeline</h2>
       <ol>{segments.map(s=>{const k=KIND[s.kind]||KIND.stop;const status=s.needs_input?['Needs answer','need']:s.state==='confirmed'?['Confirmed','ok']:['Suggested','sugg'];
        return <li key={s.id} id={`fd-seg-${s.id}`} className={`fd-row ${selected===s.id?'is-sel':''}`}>
         <span className="fd-time">{range(s.started_at,s.ended_at)} <span className="fd-muted">· {hm(s.minutes)}</span></span>
         <span className="fd-what"><span className="fd-chip" style={{background:k.chip,color:k.chipInk}}>{k.label}</span></span>
         {(()=>{const where=s.kind==='drive'||s.kind==='break'||s.kind==='no_data'?'—':placeOf(s),job=jobText(s);return <>
          <span className="fd-where" data-empty={where==='—'||undefined}>{where}</span>
          <span className="fd-job" data-empty={job==='—'||undefined}>{job}</span></>;})()}
         <span className={`fd-status ${status[1]}`}>{status[0]}</span>
         {canAct&&!s.needs_input&&!['drive','break'].includes(s.kind)?<button type="button" className="fd-link" aria-expanded={editor?.id===s.id} onClick={()=>setEditor(editor?.id===s.id?null:{id:s.id,preset:{}})}>{editor?.id===s.id?'Close':'Change'}</button>:<span/>}
         {!s.needs_input&&editor?.id===s.id&&<div className="fd-row-edit">{editorFor(s)}</div>}
        </li>;})}</ol>
      </section>
     </div>
     {data.billing&&<BillingPanel billing={data.billing} source={data.source}/>}
    </div>
   </>:<div className="fd-empty"><b>No field time for {tech} on {longDate(date)}.</b><span className="fd-muted">{data.admin?'Type a sample day below to test matching before the iPhone app.':'It appears once the iPhone app records your day.'}</span></div>)}
   {data?.admin&&data.sampleOptions&&<SampleEditor key={`${data.technician}|${data.date}|${data.day?.version??0}`} data={data} busy={busy}
    onRebuild={async()=>apply(await post({op:'rebuild',technician:data.technician,date:data.date,source:data.source}))}
    onSave={async spec=>{const d=await post({op:'sample_save',technician:data.technician,date:data.date,spec});if(d){setSource('sample');apply(d);}}}
    onDelete={async()=>{if(!data.day||data.source!=='sample')return;const d=await post({op:'delete_sample',day_id:data.day.id});if(d)void load();}}/>}
  </div>
 </main>;
}

function jobText(s:Seg){
 if(s.allocations.length)return s.allocations.map(a=>`${jobLabel(a)}${s.allocations.length>1?` (${a.percent}%)`:''}`).join(' · ');
 if(s.label)return `${LABELS[s.label]||s.label}${s.note?` — ${s.note}`:''}`;
 return s.needs_input?'Waiting for an answer':'—';
}

function readySummary(ready:Seg[]){
 const jobs=ready.filter(s=>s.kind==='on_site').slice(0,2).map(s=>`${placeOf(s)}, ${hm(s.minutes)}, to ${s.allocations[0]?.wo_number||'its job'}`);
 const count=(kind:string,one:string,many:string)=>{const n=ready.filter(s=>s.kind===kind).length;return n?`${n} ${n===1?one:many}`:'';};
 const more=ready.filter(s=>s.kind==='on_site').length-jobs.length;
 return [...jobs,more>0?`${more} more job${more>1?'s':''}`:'',count('inspection','inspection','inspections'),count('parts_run','parts run','parts runs'),count('dump_run','dump run','dump runs'),count('drive','drive','drives'),count('shop','shop stop','shop stops'),count('break','break','breaks')].filter(Boolean).join(' · ');
}

function DayStrip({segments,source,selected,onPick}:{segments:Seg[];source:string;selected:string|null;onPick:(id:string)=>void}){
 const start=Date.parse(segments[0].started_at),end=Date.parse(segments[segments.length-1].ended_at);
 // Pacific offsets are whole hours, so UTC hour boundaries are Pacific hour boundaries.
 const ticks:{mins:number;label:string}[]=[];
 for(let t=start,first=true;t<end;first=false){const next=Math.min(end,Math.floor(t/3600000)*3600000+3600000);const onHour=t%3600000===0;const h=clock(t,false);ticks.push({mins:(next-t)/60000,label:first||onHour?(first||h.startsWith('12')?clock(t).replace(':00',''):h.replace(':00','')):''});t=next;}
 const totals=new Map<string,number>();for(const s of segments)totals.set(s.kind,(totals.get(s.kind)||0)+s.minutes);
 return <section className="fd-card fd-day" aria-labelledby="fd-day-h">
  <div className="fd-between"><h2 id="fd-day-h">{clock(start)} – {clock(end)} · {hm((end-start)/60000)} {source==='sample'?'on the sample day':'clocked in'}</h2><span className="fd-muted">Click a block to find it below</span></div>
  <div className="fd-strip">{segments.map(s=>{const k=KIND[s.kind]||KIND.stop;return <button key={s.id} type="button" className={selected===s.id?'is-sel':''} aria-pressed={selected===s.id} aria-label={`${range(s.started_at,s.ended_at)}, ${k.label}${s.kind==='drive'?'':`, ${placeOf(s)}`}, ${hm(s.minutes)}`} onClick={()=>onPick(s.id)} style={{flex:`${Math.max(1,s.minutes)} 1 0px`,background:k.fill,color:k.ink}}>{s.minutes>=45?placeOf(s):''}</button>;})}</div>
  <div className="fd-ticks" aria-hidden="true">{ticks.map((t,i)=><span key={i} className={i%2?'fd-odd':undefined} style={{flex:`${t.mins} 1 0px`}}>{t.label}</span>)}</div>
  <ul className="fd-legend">{KIND_ORDER.filter(k=>totals.has(k)).map(k=><li key={k}><span className="fd-swatch" style={{background:KIND[k].fill}} aria-hidden="true"/>{KIND[k].label}<b>{hm(totals.get(k)!)}</b></li>)}</ul>
 </section>;
}

/** The quick answers for a segment that needs one: its likely jobs, a split, or what a stop was. */
function quickOptions(seg:Seg):{key:string;label:string;sub:string;body:Body|null;preset?:Preset}[]{
 const job=(c:Job)=>({key:c.work_order_id,label:jobLabel(c),sub:`${c.sub}${c.today?' · today':''}`,body:{allocations:[{work_order_id:c.work_order_id,percent:100}]}});
 const top=seg.candidates.slice(0,4).map(job);
 if(seg.kind==='on_site'){
  if(seg.candidates.length===2)top.push({key:'split',label:'Split evenly',sub:'Half to each job; adjust later',body:{allocations:evenSplit(seg.candidates.map(c=>c.work_order_id))}});
  return [...top,{key:'more',label:seg.candidates.length?'Different job or split…':'Choose the job…',sub:'Search the open work orders',body:null}];
 }
 if(TRIP_KINDS.includes(seg.kind))return [...top,{key:'more',label:'Several jobs…',sub:'Split across jobs',body:null},{key:'general',label:seg.kind==='dump_run'?'General / shop':'Van stock / general',sub:'Overhead, not charged to a job',body:{label:'general',allocations:[]}}];
 const labels:[string,string,string][]=seg.kind==='no_data'
  ?[['phone_off','Phone off / no signal','Explain the gap'],['personal','Personal / break','Not work time'],['other_work','Other work…','Add a note']]
  :[['personal','Personal / break','Not work time'],['estimate','Estimate or walkthrough','Not billed to a job'],['general','Shop errand / general','Overhead'],['other_work','Other work…','Add a note']];
 const opts=labels.map(([k,l,s])=>({key:k,label:l,sub:s,body:k==='other_work'?null:{label:k,allocations:[]},preset:k==='other_work'?{label:'other_work'}:undefined}));
 return seg.kind==='stop'?[...opts,{key:'job',label:'It was a job…',sub:'Pick the work order',body:null,preset:{kind:'on_site'}}]:opts;
}
function question(seg:Seg,tech:string){
 if(seg.kind==='on_site')return seg.candidates.length>1?`Which job was this? ${tech} has ${seg.candidates.length} open work orders here.`:seg.candidates.length?'Which job was this?':'Which job was this? No open work order was found at this property.';
 if(seg.kind==='parts_run')return 'Which jobs were these parts for?';
 if(seg.kind==='dump_run')return 'Which job was this load from?';
 if(seg.kind==='no_data')return `No location for ${hm(seg.minutes)}. What happened?`;
 return /\(no work order\)$/.test(seg.property_label)?'There’s no open work order at this property. What was the stop?':'What was this stop?';
}

function NeedCard({seg,tech,canAct,busy,selected,onAnswer,onMore,editor}:{seg:Seg;tech:string;canAct:boolean;busy:boolean;selected:boolean;onAnswer:(b:Body)=>void;onMore:(p:Preset)=>void;editor:React.ReactNode}){
 const k=KIND[seg.kind]||KIND.stop;
 return <article id={`fd-seg-${seg.id}-need`} className={`fd-card fd-need ${selected?'is-sel':''} ${seg.needs_input?'':'is-done'}`}>
  <div className="fd-need-head"><span className="fd-time">{range(seg.started_at,seg.ended_at)}</span><span className="fd-muted">{hm(seg.minutes)}</span><span className="fd-chip" style={{background:k.chip,color:k.chipInk}}>{k.label}</span><b>{placeOf(seg)}</b></div>
  {!seg.needs_input?<div className="fd-done"><span><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>{jobText(seg)}</span>{canAct&&!editor&&<button type="button" className="fd-secondary" onClick={()=>onMore({})}>Change</button>}</div>:<>
  <p>{question(seg,tech)}</p>
  {canAct?<div className="fd-options">{quickOptions(seg).map(o=><button key={o.key} type="button" className="fd-option" disabled={busy} onClick={()=>o.body?onAnswer(o.body):onMore(o.preset||{})}><b>{o.label}</b>{o.sub&&<span>{o.sub}</span>}</button>)}</div>
   :<p className="fd-muted">Waiting for {tech}.</p>}</>}
  {editor}
 </article>;
}

function SegmentEditor({seg,data,busy,preset,onConfirm,onCancel,onSaveLocation}:{seg:Seg;data:Data;busy:boolean;preset:Preset;onConfirm:(b:Body)=>void;onCancel:()=>void;onSaveLocation:()=>void}){
 const [kind,setKind]=useState(preset.kind||seg.kind),[rows,setRows]=useState(seg.allocations.map(({work_order_id,percent})=>({work_order_id,percent}))),[label,setLabel]=useState(preset.label??seg.label??''),[note,setNote]=useState(seg.note);
 const names=new Map<string,string>([...data.jobs.map(j=>[j.id,jobLabel(j)] as [string,string]),...seg.candidates.map(c=>[c.work_order_id,jobLabel(c)] as [string,string]),...seg.allocations.map(a=>[a.work_order_id,jobLabel(a)] as [string,string])]);
 const options=[...seg.candidates.map(c=>({id:c.work_order_id,name:jobLabel(c),hint:c.sub})),...data.jobs.map(j=>({id:j.id,name:jobLabel(j),hint:j.sub}))].filter((o,i,all)=>all.findIndex(x=>x.id===o.id)===i&&!rows.some(r=>r.work_order_id===o.id));
 const isTrip=TRIP_KINDS.includes(kind),isStop=STOP_KINDS.includes(kind),takesJobs=kind==='on_site'||isTrip,takesLabel=kind==='stop'||kind==='no_data';
 const general=isTrip&&label==='general',total=rows.reduce((n,r)=>n+r.percent,0);
 const setJobs=(ids:string[])=>setRows(evenSplit(ids));
 const valid=takesJobs?(general||(rows.length>0&&total===100)):takesLabel?(!!label&&(label!=='other_work'||!!note.trim())):true;
 return <div className="fd-editor">
  {(isStop||isTrip)&&<label>What it was<select value={kind} onChange={e=>{setKind(e.target.value);setLabel('');if(!['on_site',...TRIP_KINDS].includes(e.target.value))setRows([]);}}>{(isStop?STOP_KINDS:TRIP_KINDS).map(k=><option key={k} value={k}>{KIND[k].label}</option>)}</select></label>}
  {takesJobs&&!general&&<>
   {rows.map((r,i)=><div className="fd-split" key={r.work_order_id}><span>{names.get(r.work_order_id)||'Work order'}</span>
    <input type="number" min="1" max="100" aria-label="Percent" value={r.percent} onChange={e=>setRows(rows.map((x,j)=>j===i?{...x,percent:Math.round(Number(e.target.value)||0)}:x))}/>
    <button type="button" className="fd-secondary" onClick={()=>setJobs(rows.filter((_,j)=>j!==i).map(x=>x.work_order_id))}>Remove</button></div>)}
   <label>{rows.length?'Split with another job':'Job'}<select value="" onChange={e=>{if(e.target.value)setJobs([...rows.map(r=>r.work_order_id),e.target.value]);}}><option value="">Choose a work order…</option>{options.map(o=><option key={o.id} value={o.id}>{o.name} — {o.hint}</option>)}</select></label>
   {rows.length>1&&<p className="fd-muted">Split evenly by default; adjust if most of it was for one job. Total {total}%.</p>}
  </>}
  {isTrip&&<label className="fd-check"><input type="checkbox" checked={general} onChange={e=>{setLabel(e.target.checked?'general':'');if(e.target.checked)setRows([]);}}/>Van stock / general (overhead, not charged to a job)</label>}
  {takesLabel&&<label>What it was<select value={label} onChange={e=>setLabel(e.target.value)}><option value="">Choose…</option>{Object.entries(LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>}
  {(takesLabel||kind==='inspection')&&<label>Note<textarea value={note} onChange={e=>setNote(e.target.value)} placeholder={label==='other_work'?'What was the other work?':'Optional'}/></label>}
  <div className="fd-actions">
   <button type="button" className="fd-primary" disabled={busy||!valid} onClick={()=>onConfirm({kind,allocations:takesJobs&&!general?rows:[],label:takesLabel||general?label:'',note})}>Confirm</button>
   <button type="button" className="fd-secondary" onClick={onCancel}>Cancel</button>
   {data.admin&&seg.kind==='stop'&&<button type="button" className="fd-secondary" disabled={busy} onClick={onSaveLocation}>Save as location</button>}
  </div>
 </div>;
}

function BillingPanel({billing,source}:{billing:Bill[];source:string}){
 const verdict=(b:Bill):[string,string]=>{
  if(b.verdict==='waiting')return ['Waiting for answers','neutral'];
  if(b.verdict==='short')return [`About ${hm(b.shortHours*60)} (~$${Math.round(b.shortHours*95)}) not billed`,'bad'];
  if(b.verdict==='dump_missing')return ['Dump run not on the invoice','bad'];
  if(b.verdict==='flat')return ['Covered by flat price','good'];
  if(b.verdict==='no_invoice')return b.done?['Done, no invoice yet','warn']:['Job still open','neutral'];
  return ['Billed','good'];
 };
 return <aside className="fd-card fd-billing" aria-labelledby="fd-bill-h">
  <div><h2 id="fd-bill-h">Field time vs billing</h2><p className="fd-muted">Confirmed time{source==='sample'?' on sample days':''}, against the job’s invoices. Updates as answers come in.</p></div>
  {billing.length?billing.map(b=>{const [text,tone]=verdict(b);const bits=[b.onSite?`on site ${hm(b.onSite)}`:'',b.parts?`parts runs ${hm(b.parts)}`:'',b.dumpRuns?`${b.dumpRuns} dump run${b.dumpRuns>1?'s':''}`:''].filter(Boolean).join(', ');
   return <div className="fd-bill" key={b.work_order_id}>
    <div className="fd-between"><b>{b.property}</b><span className="fd-muted">{b.wo_number}</span></div>
    {b.title&&<span>{b.title}</span>}
    <span>{bits?`Confirmed: ${bits}; expected ${hm(b.expected)}`:'No confirmed time yet'}</span>
    {b.pending>0&&<span className="fd-muted">+ {hm(b.pending)} on this day waiting for an answer</span>}
    <span>{b.invoices.length?`${b.invoices.map(i=>i.code).join(', ')} bill${b.invoices.length>1?'':'s'} ${b.billedHours?`${hm(b.billedHours*60)} hourly`:'no hourly labor'}${b.hasDumpCharge?', plus a dump charge':''}`:'No invoice yet'}</span>
    <span className={`fd-verdict ${tone}`}>{text}</span>
    {b.invoices[0]&&<a href={`/maintenance/invoices?tab=invoices&invoice=${b.invoices[0].id}`}>Open {b.invoices[0].code}</a>}
   </div>;}):<p className="fd-muted">No jobs on this day yet.</p>}
  <p className="fd-fine">Expected = on-site time with the 1-hour minimum, parts runs on top, in 15-minute steps, at $95/h. Dump runs are a flat charge. Flat-priced labor counts as covered.</p>
 </aside>;
}

const addMinutes=(t:string,n:number)=>{const [h,m]=t.split(':').map(Number);const x=Math.min(23*60+59,Math.max(0,h*60+m+n));return `${String(Math.floor(x/60)).padStart(2,'0')}:${String(x%60).padStart(2,'0')}`;};
const placeValue=(p:SampleStop['place'])=>p.type==='point'?'point':`${p.type}:${p.id}`;

function SampleEditor({data,busy,onSave,onDelete,onRebuild}:{data:Data;busy:boolean;onSave:(spec:SampleSpec)=>Promise<void>;onDelete:()=>Promise<void>;onRebuild:()=>Promise<void>}){
 const opts=data.sampleOptions!;
 const shop=opts.places.find(p=>p.kind==='shop');
 const initial:SampleSpec=data.source==='sample'&&data.day?.sample_spec?data.day.sample_spec:{start:'07:00',end:'15:30',stops:shop?[{arrive:'07:00',depart:'07:20',place:{type:'place',id:shop.id}}]:[],breaks:[],phoneOff:[]};
 const [spec,setSpec]=useState<SampleSpec>(initial),[show,setShow]=useState(!data.day);
 const setStop=(i:number,patch:Partial<SampleStop>)=>setSpec({...spec,stops:spec.stops.map((s,j)=>j===i?{...s,...patch}:s)});
 const choose=(i:number,value:string)=>{if(value==='point'){setStop(i,{place:{type:'point',lat:44.2568,lng:-121.1843}});return;}const [type,id]=value.split(':');setStop(i,{place:{type:type as 'place'|'unit',id}});};
 const addStop=()=>{const last=spec.stops[spec.stops.length-1];const arrive=last?addMinutes(last.depart,15):spec.start;setSpec({...spec,stops:[...spec.stops,{arrive,depart:addMinutes(arrive,60),place:shop?{type:'place',id:shop.id}:{type:'point',lat:44.2568,lng:-121.1843}}]});};
 const ranges=(key:'breaks'|'phoneOff',label:string)=><div className="fd-ranges">{(spec[key]||[]).map((r,i)=><div className="fd-range" key={i}>
  <label>{label} from<input type="time" value={r.start} onChange={e=>setSpec({...spec,[key]:(spec[key]||[]).map((x,j)=>j===i?{...x,start:e.target.value}:x)})}/></label>
  <label>to<input type="time" value={r.end} onChange={e=>setSpec({...spec,[key]:(spec[key]||[]).map((x,j)=>j===i?{...x,end:e.target.value}:x)})}/></label>
  <button type="button" className="fd-secondary" onClick={()=>setSpec({...spec,[key]:(spec[key]||[]).filter((_,j)=>j!==i)})}>Remove</button></div>)}</div>;
 return <section className="fd-card fd-tools" aria-labelledby="fd-tools-h">
  <div className="fd-between"><h2 id="fd-tools-h">Sample day</h2><div className="fd-actions">
   {data.source==='sample'&&data.day&&<button type="button" className="fd-secondary" disabled={busy} onClick={()=>void onRebuild()}>Rebuild suggestions</button>}
   <button type="button" className="fd-secondary" aria-expanded={show} onClick={()=>setShow(!show)}>{show?'Hide':data.source==='sample'&&data.day?'Edit sample day':'Type a sample day'}</button></div></div>
  {show&&<>
   <p className="fd-muted">Type the stops as they happened. The server turns them into GPS fixes (every 2 minutes, driving in between) and runs the same matching the iPhone app will use. Admin only; sample days never become payroll or invoices.</p>
   <div className="fd-range"><label>Clocked in<input type="time" value={spec.start} onChange={e=>setSpec({...spec,start:e.target.value})}/></label><label>Clocked out<input type="time" value={spec.end} onChange={e=>setSpec({...spec,end:e.target.value})}/></label></div>
   {spec.stops.map((stop,i)=><div className="fd-stop" key={i}>
    <label>Arrive<input type="time" value={stop.arrive} onChange={e=>setStop(i,{arrive:e.target.value})}/></label>
    <label>Leave<input type="time" value={stop.depart} onChange={e=>setStop(i,{depart:e.target.value})}/></label>
    <label>Where<select value={placeValue(stop.place)} onChange={e=>choose(i,e.target.value)}>
     <optgroup label="Locations">{opts.places.map(p=><option key={`p${p.id}`} value={`place:${p.id}`}>{p.name}</option>)}</optgroup>
     {opts.workOrders.length>0&&<optgroup label="Work orders">{opts.workOrders.map(w=><option key={`w${w.id}`} value={`unit:${w.unitRowId}`}>{w.label}</option>)}</optgroup>}
     {opts.inspectionStops.length>0&&<optgroup label="Inspection route">{opts.inspectionStops.map(s=><option key={`i${s.id}`} value={`unit:${s.unitRowId}`}>{s.label}</option>)}</optgroup>}
     <option value="point">Typed coordinates…</option>
    </select>{stop.place.type==='point'&&<span className="fd-point"><input type="number" step="0.0001" aria-label="Latitude" value={stop.place.lat} onChange={e=>setStop(i,{place:{type:'point',lat:Number(e.target.value),lng:(stop.place as {lng:number}).lng}})}/><input type="number" step="0.0001" aria-label="Longitude" value={stop.place.lng} onChange={e=>setStop(i,{place:{type:'point',lat:(stop.place as {lat:number}).lat,lng:Number(e.target.value)}})}/></span>}</label>
    <button type="button" className="fd-secondary" onClick={()=>setSpec({...spec,stops:spec.stops.filter((_,j)=>j!==i)})}>Remove</button>
   </div>)}
   <div className="fd-actions"><button type="button" className="fd-secondary" onClick={addStop}>+ Stop</button><button type="button" className="fd-secondary" onClick={()=>setSpec({...spec,breaks:[...(spec.breaks||[]),{start:'12:00',end:'12:30'}]})}>+ Break</button><button type="button" className="fd-secondary" onClick={()=>setSpec({...spec,phoneOff:[...(spec.phoneOff||[]),{start:'13:00',end:'14:00'}]})}>+ Phone off</button></div>
   {ranges('breaks','Break')}{ranges('phoneOff','Phone off')}
   <div className="fd-actions"><button type="button" className="fd-primary" disabled={busy} onClick={()=>void onSave(spec)}>{busy?'Building…':'Save and build the day'}</button>
    {data.source==='sample'&&data.day&&<button type="button" className="fd-secondary" disabled={busy} onClick={()=>void onDelete()}>Delete sample day</button>}</div>
  </>}
 </section>;
}
