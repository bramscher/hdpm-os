'use client';
import {useState} from 'react';
import type {FollowupReview} from '@/lib/agents/estimate-followups';
import {buildVendorBatchDraft,daysStuck,type VendorGroup} from '@/lib/agents/chase-board';
import ChaseCard,{HeatBar} from './ChaseCard';
import {button,field} from './ChaseDrawer';

type Props={groups:VendorGroup[];reviews:Map<string,FollowupReview>;chases:Map<string,number>;sender:string;available:boolean;busy:boolean;
 onOpen:(id:string)=>void;onBatch:(payload:Record<string,unknown>)=>Promise<boolean>};

/** Vendor-lane work by vendor: one row each, and one email for every overdue bid. */
export default function VendorView({groups,reviews,chases,sender,available,busy,onOpen,onBatch}:Props) {
 const [open,setOpen]=useState<string|null>(null),[composing,setComposing]=useState<string|null>(null);
 const [recipient,setRecipient]=useState(''),[subject,setSubject]=useState(''),[body,setBody]=useState(''),[note,setNote]=useState(''),[confirmed,setConfirmed]=useState(false);
 const compose=(g:VendorGroup)=>{const d=buildVendorBatchDraft(g.vendor,g.batchable);setComposing(g.vendor);setOpen(g.vendor);setRecipient(g.email);setSubject(d.subject);setBody(d.body);setNote('');setConfirmed(false);};
 if(!groups.length)return <p className="rounded-xl border border-dashed border-sand-200 p-8 text-center text-sm text-charcoal-500">No vendor estimates need a follow-up right now.</p>;
 return <div className="divide-y divide-sand-200 rounded-xl border border-sand-200 bg-white">
  {groups.map(g=>{
   const expanded=open===g.vendor,writing=composing===g.vendor;
   return <section key={g.vendor} className="p-4">
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
     <button className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-expanded={expanded} onClick={()=>setOpen(expanded?null:g.vendor)}>
      <span className="text-2xl font-semibold tabular-nums">{g.items.length}</span>
      <span className="min-w-0"><span className="block truncate font-semibold">{g.vendor}</span><span className="block text-xs text-charcoal-500">oldest {g.oldest}d · median {g.median}d{g.email?` · ${g.email}`:' · no email on file'}</span></span>
     </button>
     <HeatBar days={g.oldest}/>
     {g.batchable.length>=2?<button className={`${button} bg-charcoal-900 text-white`} disabled={busy} onClick={()=>writing?setComposing(null):compose(g)}>{writing?'Cancel':`Chase all ${g.batchable.length} in one email`}</button>
      :<span className="text-xs text-charcoal-500">{g.email?'Open items individually':'Add a vendor email to batch'}</span>}
    </div>
    {writing&&<div className="mt-4 space-y-3 rounded-lg bg-sand-50 p-4">
     <p className="text-sm">One email covering {g.batchable.length} work orders. Each one is recorded in its own history and comes back for review in 3 business days. From: {sender}</p>
     <label className="block text-sm">Recipient email<input className={field} value={recipient} disabled={busy} onChange={e=>{setRecipient(e.target.value);setConfirmed(false);}}/></label>
     <label className="block text-sm">Subject<input className={field} value={subject} disabled={busy} onChange={e=>{setSubject(e.target.value);setConfirmed(false);}}/></label>
     <label className="block text-sm">Message<textarea className={field} rows={10} value={body} disabled={busy} onChange={e=>{setBody(e.target.value);setConfirmed(false);}}/></label>
     <label className="block text-sm">Team note (optional)<input className={field} value={note} disabled={busy} maxLength={1500} onChange={e=>setNote(e.target.value)}/></label>
     <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>I checked the recipient and every work order listed. Send one email.</label>
     <button className={`${button} bg-green-700 text-white`} disabled={busy||!confirmed||!recipient.trim()||!body.trim()||!available} onClick={async()=>{
      const ok=await onBatch({items:g.batchable.map(c=>({id:c.id,version:reviews.get(c.id)?.version||0,contextVersion:c.contextVersion||''})),sender,recipient,subject,body,note,confirmed});
      if(ok)setComposing(null);
     }}>{available?`Send to ${g.vendor}`:'Sending unavailable'}</button>
    </div>}
    {expanded&&<div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{[...g.items].sort((a,b)=>daysStuck(b)-daysStuck(a)).map(c=><ChaseCard key={c.id} c={c} r={reviews.get(c.id)} chases={chases.get(c.id)||0} onOpen={()=>onOpen(c.id)}/>)}</div>}
   </section>;
  })}
 </div>;
}
