'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import type {FollowupCandidate,FollowupReview} from '@/lib/agents/estimate-followups';
import {isDue,isLocked,daysStuck,nextStep,type ChaseEvent,type LegacyChase} from '@/lib/agents/chase-board';
import {HeatBar,ChaseDots,STEP} from './ChaseCard';
import PartsOrders from '../board/components/parts-orders';

export const button='inline-flex min-h-11 items-center justify-center rounded-lg border border-sand-200 px-4 py-2 text-sm font-medium disabled:opacity-50';
export const field='w-full rounded-lg border border-sand-200 bg-white p-3 text-sm';
export const date=(value?:string|null)=>value?new Date(value).toLocaleString('en-US',{timeZone:'America/Los_Angeles'}):'Not recorded';

type Props={c:FollowupCandidate;r?:FollowupReview;legacy?:LegacyChase;events:ChaseEvent[];chases:number;staff:string[];senders:{email:string;sms:string};available:{email:boolean;sms:boolean};busy:boolean;
 onAct:(op:string,payload:Record<string,unknown>)=>Promise<boolean>;onClose:()=>void;onPartsChanged:()=>void};

/** The shared review editor for one work order, as a right-hand drawer. */
export default function ChaseDrawer({c,r,legacy,events,chases,staff,senders,available,busy,onAct,onClose,onPartsChanged}:Props) {
 const [channel,setChannel]=useState<'email'|'sms_zoom'>('email');
 const [recipient,setRecipient]=useState(c.email),[subject,setSubject]=useState(c.subject),[body,setBody]=useState(c.emailBody);
 const [note,setNote]=useState(''),[nextDate,setNextDate]=useState(''),[confirmed,setConfirmed]=useState(false),[owner,setOwner]=useState('');
 useEffect(()=>{const esc=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!busy)onClose();};window.addEventListener('keydown',esc);return()=>window.removeEventListener('keydown',esc);},[busy,onClose]);
 const mode=(m:'email'|'sms_zoom')=>{setChannel(m);setRecipient(m==='email'?c.email:c.phone);setBody(m==='email'?c.emailBody:c.smsBody);setConfirmed(false);};
 const locked=isLocked(r),canSend=c.eligible!==false&&c.kind!=='decision'&&isDue(r)&&!locked;
 const sender=channel==='email'?senders.email:senders.sms,ready=available[channel==='email'?'email':'sms'];
 const act=(op:string)=>onAct(op,{version:r?.version||0,contextVersion:c.contextVersion||'',sender,note,owner_person:owner,next_review_date:nextDate||null,channel,recipient,subject,body,confirmed});
 const days=daysStuck(c),step=nextStep(c,r),st=STEP[step.kind],cleanup=step.kind==='fix'||step.kind==='decide';
 return <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="chase-drawer-title">
  <button aria-label="Close review" className="absolute inset-0 bg-charcoal-900/30" onClick={()=>!busy&&onClose()}/>
  <aside className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto bg-white shadow-2xl">
   <header className="sticky top-0 z-10 space-y-2 border-b border-sand-200 bg-white p-5">
    <div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wide text-charcoal-500">{c.vendor||'No vendor'} · {c.sourceStatus}</p><h2 id="chase-drawer-title" className="text-lg font-semibold">WO {c.woNumber||'—'} · {c.property}{c.unit&&` · ${c.unit}`}</h2></div><button className={button} disabled={busy} onClick={onClose}>Close</button></div>
    <div className="flex items-center gap-3 text-sm"><HeatBar days={days}/><span>{days} days in status</span><ChaseDots count={chases}/></div>
    <div className="flex flex-wrap gap-2"><Link className={button} href={`/maintenance/board/wo/${c.id}`}>Work order &amp; owner</Link>{c.appfolioLink&&<a className={button} href={c.appfolioLink} target="_blank" rel="noreferrer">AppFolio</a>}{c.estimate&&<Link className={button} href={`/turn-estimator/estimates/${c.estimate.id}`}>Estimate</Link>}</div>
   </header>
   <div className="space-y-4 p-5">
    <section className="rounded-xl border border-sand-200 bg-sand-50 p-4" aria-label="Next step">
     <p className={`text-xs font-semibold uppercase tracking-wide ${st.text}`}>Next step · {st.label}</p>
     <p className="mt-1 text-base font-semibold">{step.text}</p>
     {cleanup&&<p className="mt-1 text-sm text-charcoal-600">{step.kind==='fix'?'A follow-up can’t go anywhere useful until this is fixed. Fix it in AppFolio or the work order, then add a note here.':'If it’s no longer needed, close it in AppFolio and it will drop off this board. If it is, set a date and record a note.'}</p>}
    </section>
    {c.kind==='parts'?<section aria-labelledby="parts-heading" className="space-y-2"><h3 id="parts-heading" className="text-sm font-semibold">Parts orders · {c.parts?.minutes||0} min spent chasing</h3><PartsOrders workOrderId={c.id} onChanged={onPartsChanged} addOpen={false}/></section>
     :<details className="rounded-xl border border-sand-200 p-4"><summary className="cursor-pointer text-sm font-medium">Waiting on parts? Log the supplier order</summary><div className="mt-3"><PartsOrders workOrderId={c.id} onChanged={onPartsChanged}/></div></details>}
    <p className="text-sm text-charcoal-600">{c.reason}</p>
    <p className="whitespace-pre-wrap text-sm">{c.description}</p>
    <p className="text-sm text-charcoal-500">HDPM owner: {c.owner||'Unassigned'} · Assigned to: {c.assignedTo||'Unassigned'} · Total age: {c.totalAge??'Unknown'} calendar days · Synced {date(c.sourceUpdatedAt)} PT</p>
    {c.decisionMaker&&<p className="text-sm">Decision requested of: {c.decisionMaker} · {date(c.approvalRequestedAt)} PT</p>}
    {c.estimate&&<p className="text-sm">Estimate: {c.estimate.total===null?'Amount unavailable':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(c.estimate.total)} · {c.estimate.status} · version {c.estimate.version??'draft'}</p>}
    {legacy&&<p className="rounded bg-amber-50 p-3 text-sm">Earlier chaser activity: {date(legacy.created_at)} PT ({legacy.action_type}). A prepared draft is not proof of sending. Check the current conversation.</p>}
    {locked?<p role="status" className="rounded bg-amber-50 p-3 text-sm">{r?.error||'Delivery has not been confirmed.'} Check the sending account before any retry.</p>:canSend?<details open={!cleanup} className="rounded-xl border border-sand-200 p-4"><summary className="cursor-pointer text-sm font-medium">{cleanup?'Send a follow-up anyway':'Write the follow-up'}</summary><section className="mt-3 space-y-3">
     <div className="flex gap-2"><button className={`${button} ${channel==='email'?'bg-charcoal-900 text-white':''}`} aria-pressed={channel==='email'} onClick={()=>mode('email')}>Email</button><button className={`${button} ${channel==='sms_zoom'?'bg-charcoal-900 text-white':''}`} aria-pressed={channel==='sms_zoom'} onClick={()=>mode('sms_zoom')}>Text</button></div>
     <p className="text-sm">From: {sender} · {ready?'Ready for your review':'Sending unavailable'}</p>
     <label className="block text-sm">{channel==='email'?'Recipient email':'Recipient phone, including country code'}<input className={field} value={recipient} disabled={busy} onChange={e=>{setRecipient(e.target.value);setConfirmed(false);}}/></label>
     {channel==='email'&&<label className="block text-sm">Subject<input className={field} value={subject} disabled={busy} onChange={e=>{setSubject(e.target.value);setConfirmed(false);}}/></label>}
     <label className="block text-sm">Message<textarea className={field} rows={7} value={body} disabled={busy} onChange={e=>{setBody(e.target.value);setConfirmed(false);}}/></label>
     <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>I checked the conversation, recipient, and message. Send this follow-up.</label>
     <button className={`${button} bg-green-700 text-white`} disabled={busy||!confirmed||!recipient.trim()||!body.trim()||!ready} onClick={()=>void act('send')}>{channel==='email'?'Send email':'Send text'}</button>
    </section></details>:<p className="text-sm">{c.kind==='decision'?'Confirm who needs to decide in the work order before sending a follow-up.':c.eligible===false?'This work is no longer overdue. Its history remains available.':'Waiting for the next review. Reopen with a note if a new follow-up is needed now.'}</p>}
    <label className="block text-sm">Team note / call or reply outcome<textarea className={field} rows={2} value={note} disabled={busy} maxLength={2000} onChange={e=>setNote(e.target.value)}/></label>
    {!locked&&<label className="block text-sm">Next review date (8 AM Pacific; defaults to 3 business days)<input type="date" className={field} value={nextDate} disabled={busy} onChange={e=>setNextDate(e.target.value)}/></label>}
    <div className="flex flex-wrap gap-2">{(locked?[['verified_sent','Checked: sent'],['verified_unsent','Checked: not sent']]:[['note','Record call / reply'],['snooze','Snooze'],['help','Request help'],['dismiss','No follow-up needed'],...(r&&!isDue(r)?[['reopen','Reopen review']]:[])]).map(([op,label])=><button key={op} className={button} disabled={busy||!note.trim()} onClick={()=>void act(op)}>{label}</button>)}</div>
    {!note.trim()&&<p className="text-xs text-charcoal-500">Add a note to snooze, record a call, request help, or dismiss.</p>}
    {!locked&&<label className="block text-sm">Reassign HDPM owner<select className={field} value={owner} onChange={e=>setOwner(e.target.value)}><option value="">Choose owner</option>{staff.map(person=><option key={person} value={person}>{person}</option>)}</select><button className={`${button} mt-2`} disabled={busy||!owner||!note.trim()} onClick={()=>void act('reassign')}>Save owner and next-action date</button></label>}
    <details open={events.length<=3}><summary className="cursor-pointer text-sm font-medium">Message and review history ({events.length})</summary><ol className="mt-2 space-y-2 border-l-2 border-sand-200 pl-4">{events.map(e=><li key={e.id} className="text-sm"><p className="text-charcoal-500">{date(e.created_at)} PT · {e.actor} · {e.action==='delivery'?e.details.status==='sent'?'Sent':'Delivery uncertain':e.action}</p>{e.details.note&&<p>{e.details.note}</p>}{['send','delivery'].includes(e.action)&&e.details.recipient&&<p className="text-xs text-charcoal-500">{e.details.channel} to {e.details.recipient} · {e.details.subject}</p>}{['send','delivery'].includes(e.action)&&e.details.body&&<p className="mt-1 whitespace-pre-wrap rounded bg-sand-50 p-2 text-xs">{e.details.body}</p>}</li>)}</ol></details>
   </div>
  </aside>
 </div>;
}
