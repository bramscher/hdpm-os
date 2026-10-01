'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import Link from 'next/link';
import {useSession} from 'next-auth/react';
import {useRouter} from 'next/navigation';
import type {FollowupCandidate,FollowupReview} from '@/lib/agents/estimate-followups';
import {LANES,GATE,AGE_BUCKETS,agingSnapshot,matchesSnapshot,chasesFor,type SnapshotFilter,bucketFor,laneFor,focusQueue,chaseCounts,weeklySends,clearedToday,daysUntil,daysStuck,groupByVendor,type ChaseEvent,type LegacyChase} from '@/lib/agents/chase-board';
import ChaseCard,{STEP} from './ChaseCard';
import ChaseDrawer,{button,field,date} from './ChaseDrawer';
import FocusStrip from './FocusStrip';
import AgingSnapshot from './AgingSnapshot';
import VendorView from './VendorView';

type Data={staff:string[];candidates:FollowupCandidate[];reviews:FollowupReview[];events:ChaseEvent[];legacy:LegacyChase[];senders:{email:string;sms:string};available:{email:boolean;sms:boolean};messagingStatus:string;loadedAt:string};
const LANE_PREVIEW=8;
/** When a parked item comes back: its review date, or for a parts order not yet due, its chase date. */
const backOn=(c:FollowupCandidate,reviews:Map<string,FollowupReview>)=>c.parts&&!c.parts.due?c.parts.dueAt||'':reviews.get(c.id)?.next_review_at||'';
const laneLabel=Object.fromEntries(LANES.map(l=>[l.key,l.label]));
const AGE_LABEL=Object.fromEntries(AGE_BUCKETS.map(b=>[b.key,b.key==='d7'?'0–7 days':`${b.label} days`]));

export default function Followups({embedded=false}:{embedded?:boolean}) {
 const {data:session}=useSession();const router=useRouter();
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[view,setView]=useState<'lanes'|'vendors'>('lanes'),[scope,setScope]=useState('all'),[search,setSearch]=useState('');
 const [selected,setSelected]=useState<string|null>(null),[snapFilter,setSnapFilter]=useState<SnapshotFilter>({}),[expanded,setExpanded]=useState<Record<string,boolean>>({});
 const load=useCallback(async()=>{setLoading(true);try{const response=await fetch('/api/maintenance/estimate-followups');const result=await response.json();if(!response.ok)throw new Error(result.error);setData(result);setError('');}catch(e){setError((e as Error).message);}finally{setLoading(false);}},[]);
 useEffect(()=>{void load();},[load]);
 useEffect(()=>{if(selected||busy)return;const timer=setInterval(()=>void load(),30000);return()=>clearInterval(timer);},[load,selected,busy]);
 useEffect(()=>{if(!data)return;const id=new URLSearchParams(window.location.search).get('followup');if(id&&data.candidates.some(c=>c.id===id))setSelected(id);},[!!data]); // Apply the deep link only on initial load.

 async function post(payload:Record<string,unknown>,success:string) {
  setBusy(true);setError('');setNotice('');
  try {
   const response=await fetch('/api/maintenance/estimate-followups',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
   const result=await response.json();if(!response.ok)throw new Error(result.error);
   setSelected(null);await load();router.refresh();setNotice(success);return true;
  }catch(e){setError((e as Error).message);return false;}finally{setBusy(false);}
 }
 const act=(id:string)=>(op:string,payload:Record<string,unknown>)=>post({id,op,...payload},op==='send'?'Follow-up sent. Waiting for a reply; next review in 3 business days.':'Shared review updated.');
 const batch=(payload:Record<string,unknown>)=>post({op:'send_vendor_batch',...payload},'Vendor email sent. Each work order comes back for review in 3 business days.');

 const model=useMemo(()=>{
  const now=new Date(),candidates=data?.candidates||[],events=data?.events||[];
  const reviews=new Map((data?.reviews||[]).map(r=>[r.work_order_id,r]));
  const me=session?.user?.name?.split(' ')[0]?.toLowerCase();
  const q=search.trim().toLowerCase();
  const shown=candidates.filter(c=>(scope==='all'||c.owner?.toLowerCase()===me)&&(!q||`${c.property} ${c.unit} ${c.woNumber} ${c.vendor} ${c.owner} ${c.description}`.toLowerCase().includes(q)));
  const bucket=(c:FollowupCandidate)=>bucketFor(c,reviews.get(c.id),now);
  const active=shown.filter(c=>bucket(c)==='active');
  const focus=focusQueue(active,reviews,now),inFocus=new Set(focus.map(c=>c.id));
  const snap=agingSnapshot(active,reviews,now);
  const filtered=active.filter(c=>matchesSnapshot(c,reviews.get(c.id),snapFilter,now));
  const lanes=LANES.map(l=>{const all=filtered.filter(c=>laneFor(c,reviews.get(c.id))===l.key).sort((a,b)=>daysStuck(b,now)-daysStuck(a,now));return {...l,all,rest:Object.keys(snapFilter).length?all:all.filter(c=>!inFocus.has(c.id)),oldest:all[0]?daysStuck(all[0],now):0};});
  return {reviews,focus,lanes,active,snap,filtered,
   parked:shown.filter(c=>bucket(c)==='parked').sort((a,b)=>backOn(a,reviews).localeCompare(backOn(b,reviews))),
   closed:shown.filter(c=>bucket(c)==='closed'),
   chases:chaseCounts(events),weeks:weeklySends(events,8,now),cleared:clearedToday(events,now),daysToGate:daysUntil(GATE.date,now),
   vendors:groupByVendor(shown,reviews,now)};
 },[data,search,scope,snapFilter,session?.user?.name]);

 const current=data?.candidates.find(c=>c.id===selected);
 const drawer=current&&data&&<ChaseDrawer key={current.id} c={current} r={model.reviews.get(current.id)} legacy={data.legacy.find(p=>p.subject_id===current.id)} events={data.events.filter(e=>e.work_order_id===current.id)} chases={chasesFor(current,model.chases)}
  staff={data.staff} senders={data.senders} available={data.available} busy={busy} onAct={act(current.id)} onClose={()=>setSelected(null)} onPartsChanged={()=>void load()}/>;
 const card=(c:FollowupCandidate,showLane=false)=><ChaseCard key={c.id} c={c} r={model.reviews.get(c.id)} chases={chasesFor(c,model.chases)} onOpen={()=>setSelected(c.id)} showLane={showLane?laneLabel[laneFor(c,model.reviews.get(c.id))]:undefined}/>;
 const alerts=<>{error&&<p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800">{error}</p>}{notice&&<p role="status" className="rounded-lg bg-green-50 p-4 text-sm">{notice}</p>}</>;
 const focusList=<section aria-labelledby="focus-heading" className="space-y-2">
  <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 id="focus-heading" className="text-sm font-semibold">Do these first</h3>
   <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-charcoal-500">Each card says its next step:{(['fix','decide','chase','check'] as const).map(k=><span key={k} className="inline-flex items-center gap-1"><span className={`h-1.5 w-1.5 rounded-full ${STEP[k].dot}`}/>{STEP[k].label}</span>)}</p></div>
  {model.focus.length?<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">{model.focus.map(c=>card(c,true))}</div>
   :<p className="rounded-xl border border-dashed border-sand-200 p-6 text-center text-sm text-charcoal-500">{loading&&!data?'Loading…':'Nothing needs a follow-up right now.'}</p>}
 </section>;

 if(embedded)return <section id="maintenance-followups" className="mb-8 space-y-4 rounded-xl border border-sand-200 bg-white p-5">
  <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">Maintenance follow-ups</h2><Link className={button} href="/maintenance/estimate-followups">Open the chase board</Link></div>
  <FocusStrip cleared={model.cleared} remaining={model.focus.length} weeks={model.weeks} daysToGate={model.daysToGate}/>{alerts}{focusList}{drawer}
 </section>;

 return <section id="maintenance-followups" className="mx-auto max-w-[1400px] space-y-5 p-4 sm:p-6">
  <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">Chase board</h2><p className="mt-1 text-sm text-charcoal-500">{data?.messagingStatus||'Checking trial setup…'} · Source checked {date(data?.loadedAt)} PT</p></div><button className={button} disabled={busy||loading} onClick={()=>void load()}>{loading?'Refreshing…':'Refresh'}</button></div>
  <AgingSnapshot snap={model.snap} filter={snapFilter} onFilter={f=>{setSnapFilter(f);setView('lanes');if(Object.keys(f).length)setTimeout(()=>document.getElementById('chase-lanes')?.scrollIntoView({behavior:'smooth',block:'start'}),50);}}/>
  <FocusStrip cleared={model.cleared} remaining={model.focus.length} weeks={model.weeks} daysToGate={model.daysToGate}/>
  {alerts}{focusList}
  <div id="chase-lanes" className="flex scroll-mt-4 flex-wrap items-center gap-3 border-t border-sand-200 pt-4">
   <div className="inline-flex rounded-lg border border-sand-200 p-1" role="group" aria-label="Board view">{([['lanes','By stage'],['vendors','By vendor']] as const).map(([v,label])=><button key={v} aria-pressed={view===v} className={`rounded-md px-3 py-1.5 text-sm font-medium ${view===v?'bg-charcoal-900 text-white':''}`} onClick={()=>setView(v)}>{label}</button>)}</div>
   <input className={`${field} min-w-[200px] flex-1`} placeholder="Find property, work order, vendor, or owner" aria-label="Search maintenance follow-ups" value={search} onChange={e=>setSearch(e.target.value)}/>
   <select aria-label="Follow-up owner filter" className="rounded-lg border border-sand-200 p-3 text-sm" value={scope} onChange={e=>setScope(e.target.value)}><option value="all">All team</option><option value="mine">My work orders</option></select>
  </div>
  {Object.keys(snapFilter).length>0&&<p className="flex flex-wrap items-center gap-2 text-sm"><span className="rounded-full bg-charcoal-900 px-3 py-1 text-white">Showing {model.filtered.length}: {[snapFilter.lane&&laneLabel[snapFilter.lane],snapFilter.age&&AGE_LABEL[snapFilter.age],snapFilter.step&&STEP[snapFilter.step].label].filter(Boolean).join(' · ')}</span><button className="font-medium text-green-800 underline" onClick={()=>setSnapFilter({})}>Show all</button></p>}
  {view==='lanes'?<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">{model.lanes.filter(l=>!Object.keys(snapFilter).length||l.all.length).map(l=>{
   const more=expanded[l.key],list=more?l.rest:l.rest.slice(0,LANE_PREVIEW);
   return <section key={l.key} aria-labelledby={`lane-${l.key}`} className="flex flex-col rounded-xl bg-sand-50 p-3">
    <header className="mb-2 flex items-baseline justify-between gap-2"><div><h3 id={`lane-${l.key}`} className="text-sm font-semibold">{l.label}</h3><p className="text-xs text-charcoal-500">{l.hint}{l.all.length?` · oldest ${l.oldest}d`:''}</p></div><span className="text-2xl font-semibold tabular-nums">{l.all.length}</span></header>
    {!Object.keys(snapFilter).length&&l.all.length>l.rest.length&&<p className="mb-2 text-xs text-charcoal-500">{l.all.length-l.rest.length} in today’s focus above</p>}
    <div className="space-y-2">{list.map(c=>card(c))}</div>
    {l.rest.length>LANE_PREVIEW&&<button className="mt-2 text-sm font-medium text-green-800 underline" onClick={()=>setExpanded(x=>({...x,[l.key]:!more}))}>{more?'Show fewer':`Show ${l.rest.length-LANE_PREVIEW} more`}</button>}
    {!l.all.length&&<p className="py-4 text-center text-xs text-charcoal-400">Clear</p>}
   </section>;
  })}</div>
  :<VendorView groups={model.vendors} reviews={model.reviews} chases={model.chases} sender={data?.senders.email||''} available={!!data?.available.email} busy={busy} onOpen={setSelected} onBatch={batch}/>}
  <details className="rounded-xl border border-sand-200 bg-white p-4"><summary className="cursor-pointer text-sm font-semibold">Waiting on replies ({model.parked.length})</summary>
   <ul className="mt-3 divide-y divide-sand-100">{model.parked.map(c=>{const r=model.reviews.get(c.id);return <li key={c.id}><button className="flex w-full flex-wrap items-baseline justify-between gap-2 py-2 text-left text-sm hover:bg-sand-50" onClick={()=>setSelected(c.id)}><span>WO {c.woNumber||'—'} · {c.property}{c.unit&&` · ${c.unit}`} · {c.vendor||'No vendor'}</span><span className="text-xs text-charcoal-500">{c.parts&&!c.parts.due?`Parts · due for a check ${new Date(`${c.parts.dueAt}T12:00:00Z`).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'})}`:`${r?.status==='sent'?'Sent':'Snoozed'} · back ${date(r?.next_review_at)}`}</span></button></li>;})}</ul>
  </details>
  <details className="rounded-xl border border-sand-200 bg-white p-4"><summary className="cursor-pointer text-sm font-semibold">No longer chasing ({model.closed.length})</summary>
   <ul className="mt-3 divide-y divide-sand-100">{model.closed.map(c=><li key={c.id}><button className="w-full py-2 text-left text-sm hover:bg-sand-50" onClick={()=>setSelected(c.id)}>WO {c.woNumber||'—'} · {c.property}{c.unit&&` · ${c.unit}`} <span className="text-xs text-charcoal-500">· {model.reviews.get(c.id)?.status==='dismissed'?'Dismissed':'No longer overdue'}</span></button></li>)}</ul>
  </details>
  <p className="text-xs text-charcoal-500">Saving a review does not close a work order. {model.active.length} active · {model.parked.length} waiting · {model.closed.length} closed.</p>
  {drawer}
 </section>;
}
