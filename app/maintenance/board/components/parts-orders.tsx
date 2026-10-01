'use client';
import {useCallback,useEffect,useState} from 'react';
import {PARTS_STATUSES,type PartsOrderView,type PartsStatus,type Supplier} from '@/lib/maintenance/parts';

const button='inline-flex min-h-10 items-center justify-center rounded-lg border border-sand-200 px-3 py-1.5 text-sm font-medium disabled:opacity-50';
const field='w-full rounded-lg border border-sand-200 bg-white p-2 text-sm';
const STATUS:Record<PartsStatus,string>={ordered:'bg-sky-50 text-sky-800',shipped:'bg-indigo-50 text-indigo-800',delivered:'bg-emerald-50 text-emerald-800',installed:'bg-charcoal-100 text-charcoal-600',issue:'bg-red-50 text-red-700',cancelled:'bg-charcoal-100 text-charcoal-500'};
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles'}).format(new Date());
const when=(v?:string|null)=>v?new Date(v.length===10?`${v}T12:00:00Z`:v).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:v.length===10?'UTC':'America/Los_Angeles'}):'—';

async function send(url:string,method:string,body:unknown){
 const res=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const json=await res.json().catch(()=>({}));if(!res.ok)throw new Error(json.error||`Request failed (${res.status})`);return json;
}

/** Supplier orders on one work order: list, status and contact logging, and the add form. Used on the work order page and in the chase drawer. */
export default function PartsOrders({workOrderId,onChanged,addOpen=true}:{workOrderId:string;onChanged?:()=>void;addOpen?:boolean}) {
 const [orders,setOrders]=useState<PartsOrderView[]|null>(null),[suppliers,setSuppliers]=useState<Supplier[]>([]);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const load=useCallback(async()=>{try{const res=await fetch(`/api/maintenance/parts-orders?work_order_id=${workOrderId}`);const json=await res.json();if(!res.ok)throw new Error(json.error);setOrders(json.orders);setSuppliers(json.suppliers);setError('');}catch(e){setError((e as Error).message);}},[workOrderId]);
 useEffect(()=>{void load();},[load]);
 async function run(fn:()=>Promise<{warning?:string|null}|unknown>,success:string){
  setBusy(true);setError('');setNotice('');
  try{const r=await fn() as {warning?:string|null};await load();setNotice(r?.warning||success);onChanged?.();return true;}
  catch(e){setError((e as Error).message);return false;}finally{setBusy(false);}
 }
 const open=(orders||[]).filter(o=>!['installed','cancelled'].includes(o.status));
 const closed=(orders||[]).filter(o=>['installed','cancelled'].includes(o.status));
 return <div className="space-y-3">
  {error&&<p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-800">{error}</p>}
  {notice&&<p role="status" className="rounded bg-green-50 p-2 text-sm">{notice}</p>}
  {orders===null?!error&&<p className="text-sm text-charcoal-500">Loading parts orders…</p>
   :!orders.length?<p className="text-sm text-charcoal-500">No parts orders on this work order.</p>
   :<ul className="space-y-3">{[...open,...closed].map(o=><OrderRow key={o.id} o={o} busy={busy} run={run}/>)}</ul>}
  <details open={addOpen&&orders!==null&&!orders.length} className="rounded-lg border border-sand-200 p-3"><summary className="cursor-pointer text-sm font-medium">Add parts order</summary>
   <AddForm suppliers={suppliers} busy={busy} onSave={input=>run(()=>send('/api/maintenance/parts-orders','POST',{...input,work_order_id:workOrderId}),'Parts order saved. The work order is now waiting on parts.')}/>
  </details>
 </div>;
}

function OrderRow({o,busy,run}:{o:PartsOrderView;busy:boolean;run:(fn:()=>Promise<unknown>,success:string)=>Promise<boolean>}) {
 const [kind,setKind]=useState<'call'|'email'|'text'|'note'>('call'),[minutes,setMinutes]=useState(''),[note,setNote]=useState('');
 const [expected,setExpected]=useState(o.expected_at||''),[tracking,setTracking]=useState(o.tracking_url||'');
 const patch=(body:Record<string,unknown>,msg:string)=>run(()=>send(`/api/maintenance/parts-orders/${o.id}`,'PATCH',body),msg);
 return <li className="rounded-lg border border-sand-200 bg-white p-3 text-sm">
  <div className="flex flex-wrap items-baseline justify-between gap-2">
   <p className="font-semibold">{o.item}</p>
   <span className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${STATUS[o.status]}`}>{o.status}</span>
  </div>
  <p className="mt-0.5 text-charcoal-600">{o.supplier?.name}{o.order_number&&` · Order #${o.order_number}`}{o.po_number&&` · PO ${o.po_number}`}</p>
  <p className="text-xs text-charcoal-500">Ordered {when(o.ordered_at)} · Expected {when(o.expected_at)}{o.delivered_at&&` · Delivered ${when(o.delivered_at)}`} · Last contact {when(o.last_contact_at)} · {o.contacts} contact{o.contacts===1?'':'s'}, {o.minutes} min spent</p>
  {(o.supplier?.phone||o.supplier?.email)&&<p className="text-xs text-charcoal-500">{o.supplier.phone&&<a className="underline" href={`tel:${o.supplier.phone}`}>{o.supplier.phone}</a>}{o.supplier.phone&&o.supplier.email&&' · '}{o.supplier.email}</p>}
  {o.supplier?.pro_desk_notes&&<p className="text-xs text-charcoal-500">{o.supplier.pro_desk_notes}</p>}
  {o.tracking_url&&<a className="text-xs font-medium text-green-800 underline" href={o.tracking_url} target="_blank" rel="noreferrer">Tracking</a>}
  {o.notes&&<p className="mt-1 whitespace-pre-wrap text-xs">{o.notes}</p>}
  <div className="mt-2 grid gap-2 sm:grid-cols-3">
   <label className="text-xs">Status<select className={field} value={o.status} disabled={busy} onChange={e=>void patch({status:e.target.value},'Status updated.')}>{PARTS_STATUSES.map(s=><option key={s} value={s}>{s}</option>)}</select></label>
   <label className="text-xs">Expected<span className="flex gap-1"><input type="date" className={field} value={expected} disabled={busy} onChange={e=>setExpected(e.target.value)}/>{expected!==(o.expected_at||'')&&<button className={button} disabled={busy} onClick={()=>void patch({expected_at:expected||null},'Expected date updated.')}>Save</button>}</span></label>
   <label className="text-xs">Tracking link<span className="flex gap-1"><input className={field} value={tracking} disabled={busy} placeholder="https://" onChange={e=>setTracking(e.target.value)}/>{tracking!==(o.tracking_url||'')&&<button className={button} disabled={busy} onClick={()=>void patch({tracking_url:tracking},'Tracking updated.')}>Save</button>}</span></label>
  </div>
  <div className="mt-2 grid gap-2 sm:grid-cols-[auto_6rem_1fr_auto] sm:items-end">
   <label className="text-xs">Contact<select className={field} value={kind} disabled={busy} onChange={e=>setKind(e.target.value as typeof kind)}><option value="call">Call</option><option value="email">Email</option><option value="text">Text</option><option value="note">Note</option></select></label>
   <label className="text-xs">Minutes<input type="number" min={0} max={480} inputMode="numeric" className={field} value={minutes} disabled={busy} onChange={e=>setMinutes(e.target.value)}/></label>
   <label className="text-xs">What you learned<input className={field} value={note} maxLength={2000} disabled={busy} onChange={e=>setNote(e.target.value)}/></label>
   <button className={`${button} bg-charcoal-900 text-white`} disabled={busy||!note.trim()} onClick={async()=>{if(await run(()=>send(`/api/maintenance/parts-orders/${o.id}/events`,'POST',{kind,minutes:minutes===''?null:Number(minutes),note}),kind==='note'?'Note saved.':'Contact recorded.')){setNote('');setMinutes('');}}}>{kind==='call'?'Record call':'Save'}</button>
  </div>
  {o.events.length>0&&<details className="mt-2"><summary className="cursor-pointer text-xs font-medium">History ({o.events.length})</summary><ol className="mt-1 space-y-1 border-l-2 border-sand-200 pl-3">{o.events.map(e=><li key={e.id} className="text-xs"><span className="text-charcoal-500">{new Date(e.at).toLocaleString('en-US',{timeZone:'America/Los_Angeles'})} · {e.actor} · {e.kind}{e.minutes_spent!=null&&` · ${e.minutes_spent} min`}</span>{e.note&&<span className="block">{e.note}</span>}</li>)}</ol></details>}
 </li>;
}

type AddInput={supplier_id:string;supplier_name:string;item:string;order_number:string;po_number:string;ordered_at:string;expected_at:string;tracking_url:string;notes:string};
function AddForm({suppliers,busy,onSave}:{suppliers:Supplier[];busy:boolean;onSave:(i:AddInput)=>Promise<boolean>}) {
 const blank=():AddInput=>({supplier_id:'',supplier_name:'',item:'',order_number:'',po_number:'',ordered_at:today(),expected_at:'',tracking_url:'',notes:''});
 const [v,setV]=useState<AddInput>(blank);
 const set=(k:keyof AddInput)=>(e:{target:{value:string}})=>setV(x=>({...x,[k]:e.target.value}));
 const other=v.supplier_id==='other';
 return <div className="mt-3 grid gap-2 sm:grid-cols-2">
  <label className="text-xs">Supplier<select className={field} value={v.supplier_id} disabled={busy} onChange={set('supplier_id')}><option value="">Choose supplier</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}<option value="other">Other…</option></select></label>
  {other?<label className="text-xs">New supplier name<input className={field} value={v.supplier_name} maxLength={120} disabled={busy} onChange={set('supplier_name')}/></label>:<span className="hidden sm:block"/>}
  <label className="text-xs sm:col-span-2">Item<input className={field} value={v.item} maxLength={300} placeholder="e.g. Whirlpool dishwasher WDT730" disabled={busy} onChange={set('item')}/></label>
  <label className="text-xs">Order #<input className={field} value={v.order_number} maxLength={80} disabled={busy} onChange={set('order_number')}/></label>
  <label className="text-xs">PO #<input className={field} value={v.po_number} maxLength={80} disabled={busy} onChange={set('po_number')}/></label>
  <label className="text-xs">Ordered<input type="date" className={field} value={v.ordered_at} max={today()} disabled={busy} onChange={set('ordered_at')}/></label>
  <label className="text-xs">Expected delivery<input type="date" className={field} value={v.expected_at} min={v.ordered_at} disabled={busy} onChange={set('expected_at')}/></label>
  <label className="text-xs sm:col-span-2">Tracking link<input className={field} value={v.tracking_url} placeholder="https://" disabled={busy} onChange={set('tracking_url')}/></label>
  <label className="text-xs sm:col-span-2">Notes<textarea className={field} rows={2} value={v.notes} maxLength={2000} disabled={busy} onChange={set('notes')}/></label>
  <div className="sm:col-span-2"><button className={`${button} bg-green-700 text-white`} disabled={busy||!v.item.trim()||!v.ordered_at||!(other?v.supplier_name.trim():v.supplier_id)}
   onClick={async()=>{if(await onSave({...v,supplier_id:other?'':v.supplier_id,supplier_name:other?v.supplier_name:''}))setV(blank());}}>Save parts order</button>
   <p className="mt-1 text-xs text-charcoal-500">Saving sets this work order to Waiting on: Parts in HDPM (not AppFolio).</p></div>
 </div>;
}
