'use client';
import {useCallback,useEffect,useState} from 'react';
import Link from 'next/link';
import {useSearchParams} from 'next/navigation';
import '../review.css';
import '../field-time.css';

type Kind='store'|'dump'|'shop'|'other';
type Place={id:string;kind:Kind;supplier_id:string|null;name:string;address:string;latitude:number;longitude:number;radius_m:number;active:boolean;version:number};
type Supplier={id:string;name:string;phone:string|null;email:string|null;account_number:string|null;pro_desk_notes:string;active:boolean;version:number};
type Data={admin:boolean;office:boolean;places:Place[];suppliers:Supplier[];radiusByKind:Record<Kind,number>};
type Editor={kind:'place';place:Partial<Place>&{coords?:string}}|{kind:'supplier';supplier:Partial<Supplier>};
const KINDS:Record<Kind,string>={store:'Store (parts runs)',dump:'Dump / transfer station',shop:'Shop / office',other:'Other'};
const mapLink=(p:Place)=>`https://www.google.com/maps/search/?api=1&query=${p.latitude},${p.longitude}`;
/** "44.2656, -121.1775" as pasted from Google Maps; blank means look the address up. */
function parseCoords(text:string){const t=text.trim();if(!t)return {latitude:null,longitude:null};const m=t.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);if(!m)throw new Error('Paste coordinates like 44.2656, -121.1775, or leave them blank to look up the address');return {latitude:Number(m[1]),longitude:Number(m[2])};}

export default function Locations(){
 const params=useSearchParams();
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[editor,setEditor]=useState<Editor|null>(null);
 const load=useCallback(async()=>{setError('');try{const r=await fetch('/api/maintenance/field-time/locations',{cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.error);setData(d);}catch(e){setError((e as Error).message);}},[]);
 useEffect(()=>{void load();},[load]);
 // "Save as location" on the field day page lands here with the stop's centre filled in.
 useEffect(()=>{const lat=params.get('lat'),lng=params.get('lng');if(params.get('add')&&lat&&lng)setEditor({kind:'place',place:{kind:'store',name:params.get('name')||'',coords:`${lat}, ${lng}`,active:true}});},[params]);
 async function post(body:Record<string,unknown>){setBusy(true);setError('');setNotice('');try{const r=await fetch('/api/maintenance/field-time/locations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error);return d;}finally{setBusy(false);}}
 async function save(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();if(!editor)return;const f=new FormData(event.currentTarget);const v=(k:string)=>String(f.get(k)??'');
  try{
   if(editor.kind==='place'){const coords=parseCoords(v('coords'));setData(await post({op:'place_save',id:editor.place.id,version:editor.place.version,kind:v('kind'),name:v('name'),address:v('address'),supplier_id:v('supplier_id'),radius_m:v('radius_m'),active:f.get('active')==='on',...coords}));}
   else setData(await post({op:'supplier_save',id:editor.supplier.id,version:editor.supplier.version,name:v('name'),phone:v('phone'),email:v('email'),account_number:v('account_number'),pro_desk_notes:v('pro_desk_notes'),active:f.get('active')==='on'}));
   setEditor(null);
  }catch(e){setError((e as Error).message);}
 }
 async function rematch(){try{const d=await post({op:'rematch'});setNotice(d.rebuilt?`Re-matched ${d.rebuilt} recent day${d.rebuilt===1?'':'s'}. Confirmed time was not changed.`:'No recent days had unconfirmed time to re-match.');}catch(e){setError((e as Error).message);}}
 const supplierName=(id:string|null)=>data?.suppliers.find(s=>s.id===id)?.name||'';
 return <main className="db-review">
  <header><div><Link href="/maintenance/daily-billing">← Daily Billing Review</Link><h1>Stop locations</h1><p>Stores, dump sites and the shop that field time recognizes. A stop inside a location&apos;s radius is matched to it; stores and dumps become parts and dump runs.</p></div>
   <div className="db-actions"><Link href="/maintenance/daily-billing/field">Field days</Link>{data?.admin&&<button disabled={busy} onClick={()=>void rematch()}>Re-match recent days</button>}{data?.admin&&<button className="db-primary" onClick={()=>{setError('');setEditor({kind:'place',place:{kind:'store',active:true}});}}>Add location</button>}</div></header>
  {error&&<div role="alert" className="db-error">{error}</div>}
  {notice&&<div role="status" className="db-warning">{notice}</div>}
  {data&&<>
   <section><h2>Locations</h2>{!data.admin&&<p className="db-note">Only an admin can change locations, because they decide what counts as a billable run.</p>}
    <div className="db-table-wrap ft-places"><table><thead><tr><th>Name</th><th>Kind</th><th>Provider</th><th>Address</th><th>Radius</th><th>Status</th><th></th></tr></thead><tbody>
     {data.places.map(p=><tr key={p.id}><td><b>{p.name}</b></td><td>{KINDS[p.kind]}</td><td>{supplierName(p.supplier_id)||'—'}</td><td>{p.address||'—'}</td><td>{p.radius_m} m</td><td>{p.active?'Active':'Off'}</td>
      <td><div className="db-actions"><a href={mapLink(p)} target="_blank" rel="noreferrer">View on map</a>{data.admin&&<button disabled={busy} onClick={()=>{setError('');setEditor({kind:'place',place:{...p,coords:`${p.latitude}, ${p.longitude}`}});}}>Edit</button>}</div></td></tr>)}
    </tbody></table></div>
   </section>
   <section><div className="db-between"><h2>Providers</h2>{data.office&&<button onClick={()=>{setError('');setEditor({kind:'supplier',supplier:{active:true}});}}>Add provider</button>}</div>
    <p className="db-note">The same list parts orders use. A location can belong to a provider (both Lowe&apos;s stores belong to Lowe&apos;s).</p>
    <div className="db-table-wrap ft-places"><table><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Account</th><th>Pro desk notes</th><th>Status</th><th></th></tr></thead><tbody>
     {data.suppliers.map(s=><tr key={s.id}><td><b>{s.name}</b></td><td>{s.phone||'—'}</td><td>{s.email||'—'}</td><td>{s.account_number||'—'}</td><td>{s.pro_desk_notes||'—'}</td><td>{s.active?'Active':'Off'}</td>
      <td>{data.office&&<button disabled={busy} onClick={()=>{setError('');setEditor({kind:'supplier',supplier:s});}}>Edit</button>}</td></tr>)}
    </tbody></table></div>
   </section>
  </>}
  {editor&&data&&<div className="db-overlay"><section className="db-dialog" role="dialog" aria-modal="true" aria-labelledby="loc-title"><div className="db-between"><h2 id="loc-title">{editor.kind==='place'?(editor.place.id?'Edit location':'Add location'):(editor.supplier.id?'Edit provider':'Add provider')}</h2><button disabled={busy} onClick={()=>setEditor(null)}>Close</button></div>
   {error&&<p role="alert" className="db-error">{error}</p>}
   <form onSubmit={save}>{editor.kind==='place'?<>
    <label>Kind<select name="kind" defaultValue={editor.place.kind||'store'}>{Object.entries(KINDS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
    <label>Name<input name="name" required defaultValue={editor.place.name} placeholder="e.g. Lowe's Redmond"/></label>
    <label>Provider<select name="supplier_id" defaultValue={editor.place.supplier_id||''}><option value="">None</option>{data.suppliers.filter(s=>s.active||s.id===editor.place.supplier_id).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <label>Address<input name="address" defaultValue={editor.place.address} placeholder="Street, city, OR zip"/></label>
    <label>Coordinates<input name="coords" defaultValue={editor.place.coords} placeholder="Blank = look up the address · or paste 44.2656, -121.1775"/></label>
    <label>Radius (metres)<input name="radius_m" type="number" min="30" max="1000" step="10" defaultValue={editor.place.radius_m} placeholder={`Default by kind: store ${data.radiusByKind.store}, dump ${data.radiusByKind.dump}, shop ${data.radiusByKind.shop}`}/></label>
    <label className="db-check"><input type="checkbox" name="active" defaultChecked={editor.place.active!==false}/>Active</label>
    <p className="db-note">Big-box store pins often land on the road. If a store&apos;s stops don&apos;t match, paste the coordinates of the building from Google Maps. Turning a location off keeps past days as they are; use Re-match recent days to rebuild unconfirmed time.</p>
   </>:<>
    <label>Name<input name="name" required defaultValue={editor.supplier.name}/></label>
    <label>Phone<input name="phone" defaultValue={editor.supplier.phone||''}/></label>
    <label>Email<input name="email" type="email" defaultValue={editor.supplier.email||''}/></label>
    <label>Account number<input name="account_number" defaultValue={editor.supplier.account_number||''}/></label>
    <label>Pro desk notes<textarea name="pro_desk_notes" defaultValue={editor.supplier.pro_desk_notes||''}/></label>
    <label className="db-check"><input type="checkbox" name="active" defaultChecked={editor.supplier.active!==false}/>Active</label>
   </>}<button className="db-primary" disabled={busy}>{busy?'Saving…':'Save'}</button></form>
  </section></div>}
 </main>;
}
