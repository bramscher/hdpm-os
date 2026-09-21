'use client';
import {useCallback,useEffect,useState} from 'react';
import Link from 'next/link';
import {useSession} from 'next-auth/react';
import {useRouter} from 'next/navigation';
import type {FollowupCandidate,FollowupReview} from '@/lib/agents/estimate-followups';

type Event={id:number;work_order_id:string;actor:string;action:string;created_at:string;details:FollowupReview};
type Data={staff:string[];candidates:FollowupCandidate[];reviews:FollowupReview[];events:Event[];legacy:{subject_id:string;created_at:string;action_type:string;status:string}[];senders:{email:string;sms:string};available:{email:boolean;sms:boolean};messagingStatus:string;loadedAt:string};
const button='inline-flex min-h-11 items-center justify-center rounded-lg border border-sand-200 px-4 py-2 text-sm font-medium disabled:opacity-50';
const field='w-full rounded-lg border border-sand-200 bg-white p-3 text-sm';
const date=(value?:string|null)=>value?new Date(value).toLocaleString('en-US',{timeZone:'America/Los_Angeles'}):'Not recorded';
const due=(r?:FollowupReview)=>!r||r.status==='review'||(['snoozed','sent'].includes(r.status)&&!!r.next_review_at&&new Date(r.next_review_at)<=new Date());
export default function Followups({embedded=false}:{embedded?:boolean}) {
 const {data:session}=useSession();const router=useRouter();
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[filter,setFilter]=useState('review'),[scope,setScope]=useState('all'),[search,setSearch]=useState('');
 const [selected,setSelected]=useState<string|null>(null),[version,setVersion]=useState(0),[contextVersion,setContextVersion]=useState(''),[sender,setSender]=useState('');
 const [channel,setChannel]=useState<'email'|'sms_zoom'>('email'),[recipient,setRecipient]=useState(''),[subject,setSubject]=useState(''),[body,setBody]=useState(''),[note,setNote]=useState(''),[nextDate,setNextDate]=useState(''),[confirmed,setConfirmed]=useState(false),[owner,setOwner]=useState('');
 const load=useCallback(async()=>{setLoading(true);try{const response=await fetch('/api/maintenance/estimate-followups');const result=await response.json();if(!response.ok)throw new Error(result.error);setData(result);setError('');}catch(e){setError((e as Error).message);}finally{setLoading(false);}},[]);
 useEffect(()=>{void load();},[load]);
 useEffect(()=>{if(selected||busy)return;const timer=setInterval(()=>void load(),30000);return()=>clearInterval(timer);},[load,selected,busy]);
 const open=useCallback((c:FollowupCandidate,mode:'email'|'sms_zoom'='email')=>{
  setSelected(c.id);setChannel(mode);setVersion(data?.reviews.find(r=>r.work_order_id===c.id)?.version||0);setContextVersion(c.contextVersion||'');setSender(mode==='email'?data?.senders.email||'':data?.senders.sms||'');
  setRecipient(mode==='email'?c.email:c.phone);setSubject(c.subject);setBody(mode==='email'?c.emailBody:c.smsBody);setNote('');setOwner('');setNextDate('');setConfirmed(false);setNotice('');
 },[data]);
 useEffect(()=>{if(!data)return;const id=new URLSearchParams(window.location.search).get('followup');const c=data.candidates.find(c=>c.id===id);if(c){setFilter('all');open(c);}},[!!data]); // Apply the deep link only on initial load.
 async function act(c:FollowupCandidate,op:string) {
  setBusy(true);setError('');setNotice('');
  try {
   const response=await fetch('/api/maintenance/estimate-followups',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:c.id,version,contextVersion,sender,op,note,owner_person:owner,next_review_date:nextDate||null,channel,recipient,subject,body,confirmed})});
   const result=await response.json();if(!response.ok)throw new Error(result.error);
   setSelected(null);await load();router.refresh();setNotice(op==='send'?'Follow-up sent. Waiting for a reply; next review in 3 business days.':'Shared review updated.');
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 const candidates=data?.candidates||[];
 const shown=candidates.filter(c=>{
  const r=data?.reviews.find(r=>r.work_order_id===c.id);
  const owned=scope==='all'||c.owner?.toLowerCase()===session?.user?.name?.split(' ')[0]?.toLowerCase();
  return owned&&(filter==='all'||(filter==='review'?c.eligible!==false&&(c.newEpisode||due(r)):filter==='help'?r&&['help','uncertain','sending'].includes(r.status):filter==='waiting'?c.eligible!==false&&r&&!due(r)&&['sent','snoozed'].includes(r.status):r?.status==='dismissed'||c.eligible===false))&&`${c.property} ${c.unit} ${c.woNumber} ${c.vendor} ${c.owner} ${c.description}`.toLowerCase().includes(search.toLowerCase());
 });
 return <section id="maintenance-followups" className={embedded?'mb-8 space-y-4 rounded-xl border border-sand-200 bg-white p-5':'mx-auto max-w-5xl space-y-5 p-6'}>
  <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">Maintenance follow-ups</h2><p className="mt-1 text-sm text-charcoal-500">Penny and Craig review estimates and work needing a scheduling date.</p></div><button className={button} disabled={busy||loading} onClick={()=>void load()}>{loading?'Refreshing…':'Refresh'}</button></div>
  <p className="text-sm">{data?.messagingStatus||'Checking trial setup…'} · Source checked {date(data?.loadedAt)} PT</p>
  <div className="flex flex-wrap gap-2">{[['review','Needs action'],['waiting','Waiting'],['help','Needs help / delivery check'],['closed','No longer chasing'],['all','All']].map(([value,label])=><button key={value} className={`${button} ${filter===value?'bg-charcoal-900 text-white':''}`} aria-pressed={filter===value} onClick={()=>{setFilter(value);setSelected(null);}}>{label}</button>)}</div>
  <div className="flex flex-wrap gap-3"><input className={`${field} flex-1`} placeholder="Find property, work order, vendor, or owner" aria-label="Search maintenance follow-ups" value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label="Follow-up owner filter" className="rounded-lg border p-3 text-sm" value={scope} onChange={e=>setScope(e.target.value)}><option value="all">All team</option><option value="mine">My work orders</option></select></div>
  <p className="text-sm text-charcoal-500">{shown.length} shown · {candidates.filter(c=>c.eligible!==false).length} currently eligible · Saving a review does not close a work order.</p>
  {error&&<p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800">{error}</p>}{notice&&<p role="status" className="rounded-lg bg-green-50 p-4 text-sm">{notice}</p>}
  {!loading&&!shown.length&&<p className="p-5 text-center text-sm">No follow-ups in this view.</p>}
  {shown.map(c=>{
   const r=data?.reviews.find(r=>r.work_order_id===c.id),editing=selected===c.id,locked=!!r&&['sending','uncertain'].includes(r.status);
   const legacy=data?.legacy.find(p=>p.subject_id===c.id);
   const canSend=c.eligible!==false&&c.kind!=='decision'&&due(r)&&!locked;
   return <article key={c.id} className="rounded-xl border border-sand-200 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">WO {c.woNumber||'—'} · {c.property}{c.unit&&` · ${c.unit}`}</h3><p className="mt-1 text-sm">{c.description.slice(0,180)}{c.description.length>180?'…':''}</p></div><span className="rounded-full bg-sand-100 px-3 py-1 text-xs">{c.newEpisode?'New episode — reopen review':r?.status||'Needs review'}</span></div>
    <p className="mt-3 text-sm font-medium">{c.reason}</p><p className="mt-1 text-sm text-charcoal-500">HDPM owner: {c.owner||'Unassigned'} · Vendor: {c.vendor||'Unassigned'} · {c.sourceStatus||'Unknown source status'}</p>
    <p className="mt-1 text-xs text-charcoal-500">Next work action: {c.nextActionDate||'Not set'} · Follow-up review: {date(r?.next_review_at)} · Source synced: {date(c.sourceUpdatedAt)} PT</p>
    {r&&<p className="mt-2 text-sm">Last activity: {r.updated_by} · {date(r.updated_at)} PT · {r.note||r.status}</p>}
    {c.estimate&&<p className="mt-2 text-sm"><Link className="text-green-800 underline" href={`/turn-estimator/estimates/${c.estimate.id}`}>Estimate</Link>: {c.estimate.total===null?'Amount unavailable':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(c.estimate.total)} · {c.estimate.status} · version {c.estimate.version??'draft'}</p>}
    <div className="mt-3 flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={()=>editing?setSelected(null):open(c)}>{editing?'Close review':'Review / update'}</button><Link className={button} href={`/maintenance/board/wo/${c.id}`}>Work order & owner</Link>{c.appfolioLink&&<a className={button} href={c.appfolioLink} target="_blank" rel="noreferrer">AppFolio</a>}</div>
    {editing&&<div className="mt-4 space-y-4 border-t pt-4">
     <p className="whitespace-pre-wrap text-sm">{c.description}</p><p className="text-sm">Total work-order age: {c.totalAge??'Unknown'} calendar days · Assigned to: {c.assignedTo||'Unassigned'}</p>{c.decisionMaker&&<p className="text-sm">Decision requested of: {c.decisionMaker} · {date(c.approvalRequestedAt)} PT</p>}
     {legacy&&<p className="rounded bg-amber-50 p-3 text-sm">Earlier chaser activity: {date(legacy.created_at)} PT ({legacy.action_type}). A prepared draft is not proof of sending. Check the current conversation.</p>}
     {locked?<p role="status" className="rounded bg-amber-50 p-3 text-sm">{r?.error||'Delivery has not been confirmed.'} Check the sending account before any retry.</p>:canSend?<>
      <div className="flex gap-2"><button className={button} aria-pressed={channel==='email'} onClick={()=>open(c,'email')}>Email</button><button className={button} aria-pressed={channel==='sms_zoom'} onClick={()=>open(c,'sms_zoom')}>Text</button></div>
      <p className="text-sm">From: {sender} · {data?.available[channel==='email'?'email':'sms']?'Ready for your review':'Sending unavailable'}</p>
      <label className="block text-sm">{channel==='email'?'Recipient email':'Recipient phone, including country code'}<input className={field} value={recipient} disabled={busy} onChange={e=>{setRecipient(e.target.value);setConfirmed(false);}}/></label>
      {channel==='email'&&<label className="block text-sm">Subject<input className={field} value={subject} disabled={busy} onChange={e=>{setSubject(e.target.value);setConfirmed(false);}}/></label>}
      <label className="block text-sm">Message<textarea className={field} rows={7} value={body} disabled={busy} onChange={e=>{setBody(e.target.value);setConfirmed(false);}}/></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>I checked the conversation, recipient, and message. Send this follow-up.</label>
      <button className={`${button} bg-green-700 text-white`} disabled={busy||!confirmed||!recipient.trim()||!body.trim()||!data?.available[channel==='email'?'email':'sms']} onClick={()=>void act(c,'send')}>{channel==='email'?'Send email':'Send text'}</button>
     </>:<p className="text-sm">{c.kind==='decision'?'Confirm who needs to decide in the work order before sending a follow-up.':c.eligible===false?'This work is no longer overdue. Its history remains available.':'Waiting for the next review. Reopen with a note if a new follow-up is needed now.'}</p>}
     <label className="block text-sm">Team note / call or reply outcome<textarea className={field} rows={2} value={note} disabled={busy} maxLength={2000} onChange={e=>setNote(e.target.value)}/></label>
     {!locked&&<label className="block text-sm">Next review date (8 AM Pacific; defaults to 3 business days)<input type="date" className={field} value={nextDate} disabled={busy} onChange={e=>setNextDate(e.target.value)}/></label>}
     {!locked&&<label className="block text-sm">Reassign HDPM owner<select className={field} value={owner} onChange={e=>setOwner(e.target.value)}><option value="">Choose owner</option>{data?.staff.map(person=><option key={person} value={person}>{person}</option>)}</select><button className={button} disabled={busy||!owner||!note.trim()} onClick={()=>void act(c,'reassign')}>Save owner and next-action date</button></label>}
     <div className="flex flex-wrap gap-2">{(locked?[['verified_sent','Checked: sent'],['verified_unsent','Checked: not sent']]:[['note','Record call / reply'],['snooze','Snooze'],['help','Request help'],['dismiss','No follow-up needed'],...(r&&!due(r)?[['reopen','Reopen review']]:[])]).map(([op,label])=><button key={op} className={button} disabled={busy||!note.trim()} onClick={()=>void act(c,op)}>{label}</button>)}</div>
     <details><summary className="cursor-pointer text-sm font-medium">Message and review history</summary><ul className="mt-2 space-y-2">{data?.events.filter(e=>e.work_order_id===c.id).map(e=><li key={e.id} className="rounded bg-sand-50 p-3 text-sm"><p>{date(e.created_at)} PT · {e.actor} · {e.action==='delivery'?e.details.status==='sent'?'Sent':'Delivery uncertain':e.action}</p><p>{e.details.note}</p>{['send','delivery'].includes(e.action)&&<><p>{e.details.channel} to {e.details.recipient}</p><p>{e.details.subject}</p><p className="whitespace-pre-wrap">{e.details.body}</p></>}</li>)}</ul></details>
    </div>}
   </article>;
  })}
 </section>;
}
