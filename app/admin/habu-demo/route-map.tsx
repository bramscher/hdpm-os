'use client';
import { useState, type ReactNode } from 'react';
import { Check, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Station = { id:string; title:string; ids:string[]; x:number; y:number; line:string };
export const routes:Record<string,Station[]> = {
 gold:[
  {id:'notice',title:'Notice received',ids:['notice'],x:80,y:190,line:'turn'},
  {id:'keys',title:'Keys received',ids:['keys','key-box'],x:270,y:190,line:'turn'},
  {id:'schedule',title:'Schedule inspection',ids:['inspection-date'],x:460,y:65,line:'schedule'},
  {id:'inspection',title:'Inspect unit',ids:['inspection'],x:650,y:190,line:'turn'},
  {id:'work',title:'Turn work',ids:['blinds','paint','clean'],x:840,y:190,line:'turn'},
  {id:'verify',title:'Verify readiness',ids:['verify'],x:1030,y:190,line:'turn'},
  {id:'close',title:'Close-out',ids:['invoices','final'],x:1030,y:330,line:'turn'},
  {id:'owner',title:'Owner & listing terms',ids:['owner'],x:270,y:330,line:'listing'},
  {id:'ads',title:'Update advertising',ids:['advertise'],x:460,y:330,line:'listing'}
 ],
 green:[
  {id:'welcome',title:'Appointment & welcome',ids:['appointment','welcome'],x:100,y:90,line:'turn'},
  {id:'deposit',title:'Receive deposit',ids:['deposit'],x:400,y:90,line:'turn'},
  {id:'funds',title:'Confirm funds',ids:['funds'],x:720,y:90,line:'turn'},
  {id:'lease',title:'Lease & owner letter',ids:['lease','owner-letter'],x:1020,y:90,line:'turn'},
  {id:'movein',title:'Keys & insurance',ids:['new-keys','insurance'],x:1020,y:300,line:'turn'},
  {id:'payments',title:'Enable payments',ids:['payments'],x:560,y:300,line:'turn'},
  {id:'file',title:'File documents',ids:['file'],x:100,y:300,line:'turn'}
 ]
};
type Task={id:string;label:string;role:string;needs:string[]};
type Props={kind:string;tasks:Task[];people:Record<string,string>;role:string;complete:(id:string)=>boolean;ready:(s:Task)=>boolean;renderStep:(s:Task)=>ReactNode;switchRole:(role:string)=>void};
export function RouteMap({kind,tasks,people,role,complete,ready,renderStep,switchRole}:Props){
 const stations=routes[kind];
 const [selection,setSelection]=useState('');
 const stationTasks=(s:Station)=>tasks.filter(t=>s.ids.includes(t.id));
 const state=(s:Station)=>s.ids.every(complete)?'done':stationTasks(s).some(ready)?'ready':'waiting';
 const selected=stations.find(s=>s.id===selection)||stations.find(s=>state(s)==='ready')||stations[0];
 const selectedTasks=stationTasks(selected);
 const owner=selectedTasks[0].role;
 const blockers=[...new Set(selectedTasks.filter(t=>!complete(t.id)).flatMap(t=>t.needs).filter(id=>!complete(id)&&!selected.ids.includes(id)))];
 const next=stations.filter(s=>s.id!==selected.id&&stationTasks(s).some(t=>t.needs.some(id=>selected.ids.includes(id))));
 const readyStations=stations.filter(s=>state(s)==='ready');
 function stationButton(s:Station,mobile=false){const status=state(s);return <button key={s.id} type="button" className={`station ${status} ${s.line} ${selected.id===s.id?'selected':''}`} style={mobile?undefined:{left:`${s.x/11.2}%`,top:`${s.y/4.3}%`}} aria-pressed={selected.id===s.id} aria-label={`${s.title}, ${people[stationTasks(s)[0].role]}, ${status==='ready'?'ready now':status==='done'?'completed':'waiting'}`} onClick={()=>setSelection(s.id)}><span className="station-dot">{status==='done'?<Check size={16}/>:status==='ready'?<span/>:null}</span><span className="station-label"><strong>{s.title}</strong><span>{people[stationTasks(s)[0].role]} · {stationTasks(s)[0].role}</span><em>{status==='done'?'Completed':status==='ready'?'Ready now':'Coming up'}</em></span></button>}
 return <div className="route-view">
  <div className="route-intro"><div><h3>Follow the folder.</h3><p>Tap a stop to see who has it and what happens next.</p></div><div className="map-key"><span><i className="key-done"/>Done</span><span><i className="key-ready"/>Ready now</span><span><i/>Coming up</span></div></div>
  <div className="route-now"><strong>{readyStations.length?'Ready now:':'Journey complete.'}</strong> {readyStations.map(s=><button key={s.id} onClick={()=>setSelection(s.id)}>{s.title} <ArrowRight size={12}/></button>)}</div>
  <p className="map-scroll-hint">Scroll the map sideways to follow the whole route →</p><div className="subway-viewport"><div className="subway-desktop" role="group" aria-label={`${kind==='gold'?'Vacancy':'New tenant'} route map`}>
   <svg viewBox="0 0 1120 430" aria-hidden="true"><defs><marker id="route-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3" markerHeight="3" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10" fill="#fff"/></marker></defs>
    {kind==='gold'?<><path className="track turn" d="M80 190 H270 H650 H840 H1030 V330"/><path className="track schedule" d="M80 190 V95 Q80 65 110 65 H460 H620 Q650 65 650 95 V190"/><path className="track listing" d="M80 190 V300 Q80 330 110 330 H270 H460"/><path className="direction" d="M340 190 H420" markerEnd="url(#route-arrow)"/><path className="direction" d="M340 330 H390" markerEnd="url(#route-arrow)"/></>:<><path className="track turn" d="M100 90 H1020 V300 H100"/><path className="direction" d="M240 90 H270" markerEnd="url(#route-arrow)"/><path className="direction" d="M820 300 H780" markerEnd="url(#route-arrow)"/></>}
   </svg>{stations.map(s=>stationButton(s))}
  </div></div>
  {kind==='gold'&&<p className="map-caption"><span className="line-swatch turn"/>Unit turn <span className="line-swatch schedule"/>Inspection scheduling <span className="line-swatch listing"/>Listing work <span className="parallel-note">Branches can move at the same time.</span></p>}
  <section className="station-detail" aria-label="Selected stop"><div className="station-detail-heading"><div><p className="eyebrow">SELECTED STOP · {state(selected)==='done'?'COMPLETED':state(selected)==='ready'?'READY NOW':'COMING UP'}</p><h3>{selected.title}</h3><p>{people[owner]} · {owner}</p></div>{owner!==role&&state(selected)!=='done'&&<Button variant="outline" onClick={()=>switchRole(owner)}>Try as {people[owner]}<ArrowRight size={15}/></Button>}</div>
   {blockers.length>0&&<p className="waiting-note">Waiting for: {blockers.map(id=>tasks.find(t=>t.id===id)?.label).join('; ')}.</p>}
   {selectedTasks.map(renderStep)}
   <div className="next-stations"><strong>Next stop{next.length===1?'':'s'}:</strong> {next.length?next.map(s=><button key={s.id} onClick={()=>setSelection(s.id)}>{s.title} · {people[stationTasks(s)[0].role]} <ArrowRight size={13}/></button>):'End of this route.'}</div>
  </section>
  <p className="map-footnote">Each completion records the demo person, date, and time in History. Proposed route for team discussion.</p>
 </div>;
}
