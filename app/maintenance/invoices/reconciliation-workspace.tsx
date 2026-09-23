"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { HdmsInvoice } from '@/lib/invoices';
import { newReconciliationDraft, type ReconciliationDraft, type ReconciliationListState, type ReconciliationPaymentState } from '@/lib/reconciliation-draft';
import { InvoiceList } from './invoice-list';
import { PaymentReconcileModal } from './payment-reconcile-modal';

export function ReconciliationWorkspace({invoices,isLoading,onEdit,onRefresh,onRecorded}: {
  invoices:HdmsInvoice[];isLoading:boolean;onEdit:(invoice:HdmsInvoice)=>void;onRefresh:()=>void;onRecorded:()=>void;
}) {
  const [draft,setDraft] = useState<ReconciliationDraft|null>(null);
  const current = useRef<ReconciliationDraft|null>(null);
  const revision = useRef<string|null>(null);
  const queue = useRef<Promise<boolean>>(Promise.resolve(true));
  const generation = useRef(0);
  const [loaded,setLoaded] = useState(false);
  const [open,setOpen] = useState(false);
  const [paymentOpen,setPaymentOpen] = useState(false);
  const [status,setStatus] = useState('Loading saved reconciliation…');
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const [pending,setPending] = useState(false);
  const [conflict,setConflict] = useState(false);
  const conflictRef = useRef(false);
  useEffect(()=>{let cancelled=false;fetch('/api/reconciliation-draft').then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.error);return data;}).then(data=>{
    if(cancelled)return; current.current=data.draft;revision.current=data.revision;setDraft(data.draft);setLoaded(true);setStatus(data.savedAt?`Saved ${new Date(data.savedAt).toLocaleString()}`:'No saved reconciliation');
  }).catch(e=>{if(!cancelled)setError(e.message);});return()=>{cancelled=true;};},[]);
  const save = useCallback((next:ReconciliationDraft)=>{
    current.current=next;setDraft(next);setPending(true);setStatus('Saving…');
    const sequence=++generation.current;
    queue.current=queue.current.then(async()=>{
      if(conflictRef.current)return false;
      try {
        const response=await fetch('/api/reconciliation-draft',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({draft:next,revision:revision.current}),keepalive:true});
        const data=await response.json();
        if(!response.ok){if(response.status===409){conflictRef.current=true;setConflict(true);}throw new Error(data.error||'Save failed');}
        revision.current=data.revision;
        if(sequence===generation.current){setStatus(`Saved ${new Date(data.savedAt).toLocaleString()}`);setError('');setPending(false);}
        return true;
      } catch(e) {setError(e instanceof Error?e.message:'Save failed');setStatus('Not saved');if(sequence===generation.current)setPending(false);return false;}
    });
    return queue.current;
  },[]);
  useEffect(()=>{
    const warn=(event:BeforeUnloadEvent)=>{if(pending||error){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
  },[pending,error]);
  const updateList=useCallback((list:ReconciliationListState)=>{
    const d=current.current;if(d&&!d.recordedAt&&JSON.stringify(d.list)!==JSON.stringify(list))void save({...d,list});
  },[save]);
  const updatePayment=useCallback((payment:ReconciliationPaymentState)=>{
    const d=current.current;if(d&&!d.recordedAt&&JSON.stringify(d.payment)!==JSON.stringify(payment))void save({...d,payment});
  },[save]);
  async function start(){
    if(current.current&&!window.confirm('Start a new reconciliation? This replaces your saved reconciliation draft. Recorded payments are unchanged.'))return;
    setBusy(true);const next=newReconciliationDraft();const ok=await save(next);setBusy(false);if(ok)setOpen(true);
  }
  async function remove(){
    if(!window.confirm('Delete this saved reconciliation draft? Recorded payments and invoices are unchanged.'))return;
    setBusy(true);await queue.current;
    try{const r=await fetch(`/api/reconciliation-draft?revision=${encodeURIComponent(revision.current||'')}`,{method:'DELETE'});const data=await r.json();if(!r.ok)throw new Error(data.error);
      revision.current=null;current.current=null;setDraft(null);setOpen(false);setError('');setStatus('No saved reconciliation');
    }catch(e){setError(e instanceof Error?e.message:'Delete failed');}finally{setBusy(false);}
  }
  const title=draft?`Reconciliation — ${new Date(draft.createdAt).toLocaleString('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit',timeZoneName:'short'})}`:'Saved reconciliation';
  return <section className="space-y-3 rounded-xl border border-sand-200 bg-white p-4 mb-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">{title}</h2>
      <p className="text-xs text-charcoal-500" role="status">{status}{draft?.recordedAt?' · Payment recorded':''}</p>
      {draft&&<p className="text-sm">{draft.list.dateFrom||'Any start date'} to {draft.list.dateTo||'Any end date'} · {draft.list.invoiceIds.length} invoices selected</p>}
    </div><div className="flex flex-wrap gap-2">
      {draft&&!open&&<Button variant="outline" disabled={busy||conflict} onClick={()=>setOpen(true)}>{draft.recordedAt?'View saved reconciliation':'Resume reconciliation'}</Button>}
      {draft&&<Button variant="outline" disabled={busy||conflict} onClick={async()=>{setBusy(true);const ok=await save(current.current!);setBusy(false);if(ok){setOpen(false);setPaymentOpen(false);}}}>Save and close</Button>}
      <Button disabled={!loaded||busy||pending||conflict} onClick={start}>New reconciliation</Button>
      {draft&&<Button variant="outline" disabled={busy||pending||conflict} onClick={remove}>Delete draft</Button>}
    </div></div>
    <p className="text-xs text-charcoal-500">Your date range, invoice selections, filters, and payment details are saved to your account. This draft stays until you delete it or start a new reconciliation. Saving a draft does not record a payment.</p>
    {error&&<div role="alert" className="text-sm text-red-700">{error} {loaded&&!conflict&&draft&&<button className="underline" onClick={()=>void save(current.current!)}>Retry save</button>} {(!loaded||conflict)&&<button className="underline" onClick={()=>window.location.reload()}>Reload saved draft</button>}</div>}
    {open&&draft&&<>
      {draft.recordedAt&&<p className="text-sm">Payment recorded {new Date(draft.recordedAt).toLocaleString()}. This saved selection is retained for reference. Start a new reconciliation to record another payment.</p>}
      <InvoiceList key={draft.id} invoices={invoices} isLoading={isLoading} onRefresh={onRefresh}
        onEdit={async invoice=>{if(await save(current.current!))onEdit(invoice);}}
        reconciliationState={draft.list} onReconciliationStateChange={draft.recordedAt||conflict?undefined:updateList}
        onReconcile={draft.recordedAt||conflict?undefined:()=>setPaymentOpen(true)} />
    </>}
    {paymentOpen&&draft&&!draft.recordedAt&&<PaymentReconcileModal invoices={invoices.filter(i=>draft.list.invoiceIds.includes(i.id))}
      savedPayment={draft.payment} onPaymentChange={updatePayment}
      draftSaveStatus={error||status} onClose={()=>setPaymentOpen(false)}
      onRecorded={()=>{const d=current.current;if(d)void save({...d,recordedAt:new Date().toISOString()});setPaymentOpen(false);onRecorded();}} />}
  </section>;
}
