'use client';
import { useState } from 'react';
import { RouteMap } from './route-map';
import { ArrowRight, Check, ClipboardList, FileText, FolderOpen, Mail, MessageSquare, Monitor, RotateCcw, Clock3 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
type Role = 'Office' | 'Property manager' | 'Maintenance' | 'Accounting' | 'Marketing';
type Kind = 'gold' | 'green';
type Step = { id:string; section:string; label:string; role:Role; needs:string[]; date?:boolean; back?:boolean };
type Entry = {id:string;kind:Kind;label:string;who:string;time:string;date?:string};
const people:Record<Role,string>={Office:'Alex','Property manager':'Sam',Maintenance:'Taylor',Accounting:'Morgan',Marketing:'Jordan'};
const roles=Object.keys(people) as Role[];
const steps:Record<Kind,Step[]>={
 gold:[
 {id:'notice',section:'Tenant',label:'Move-out confirmation shared on tenant page',role:'Office',needs:[]},
 {id:'inspection-date',section:'Tenant',label:'Schedule move-out inspection',role:'Property manager',needs:['notice'],date:true},
 {id:'owner',section:'Owner',label:'Owner notified and new listing terms confirmed',role:'Property manager',needs:['notice']},
 {id:'advertise',section:'Advertising',label:'AppFolio / website listing updated',role:'Marketing',needs:['owner']},
 {id:'keys',section:'Vacancy',label:'Keys returned and received',role:'Office',needs:['notice']},
 {id:'key-box',section:'Vacancy',label:'Keys placed in PM inspection box',role:'Office',needs:['keys']},
 {id:'inspection',section:'Vacancy',label:'Move-out inspection completed',role:'Property manager',needs:['key-box','inspection-date']},
 {id:'blinds',section:'Turn work orders',label:'WO-101 · Replace damaged blinds',role:'Maintenance',needs:['inspection'],back:true},
 {id:'paint',section:'Turn work orders',label:'WO-102 · Touch up bedroom paint',role:'Maintenance',needs:['inspection'],back:true},
 {id:'clean',section:'Turn work orders',label:'WO-103 · Turnover clean',role:'Maintenance',needs:['blinds','paint'],back:true},
 {id:'verify',section:'Vacancy',label:'Verify turn work and unit readiness',role:'Property manager',needs:['clean']},
 {id:'invoices',section:'Close out tenants',label:'Vendor invoices entered in AppFolio',role:'Accounting',needs:['verify']},
 {id:'final',section:'Close out tenants',label:'Final accounting completed and documents filed',role:'Accounting',needs:['invoices']}],
 green:[
 {id:'appointment',section:'Set-up checklist',label:'Schedule move-in appointment',role:'Office',needs:[],date:true},
 {id:'welcome',section:'Set-up checklist',label:'Welcome email and information form sent',role:'Office',needs:['appointment']},
 {id:'deposit',section:'Set-up checklist',label:'Deposit to hold / information form received',role:'Office',needs:['welcome']},
 {id:'funds',section:'Set-up checklist',label:'Deposit to hold funds received by accounting',role:'Accounting',needs:['deposit']},
 {id:'lease',section:'Set-up checklist',label:'Rental agreement prepared and sent',role:'Property manager',needs:['funds']},
 {id:'owner-letter',section:'Set-up checklist',label:'Owner move-in date letter sent',role:'Property manager',needs:['lease']},
 {id:'new-keys',section:'Move-in',label:'New keys received',role:'Office',needs:['owner-letter']},
 {id:'insurance',section:'Move-in',label:'Tenant insurance information entered',role:'Office',needs:['new-keys']},
 {id:'payments',section:'After move-in',label:'Allow online payments enabled in AppFolio',role:'Accounting',needs:['insurance']},
 {id:'file',section:'After move-in',label:'All documents attached to tenant page',role:'Office',needs:['payments']}]
};
const titles:Record<Kind,string>={gold:'Vacancy tracking',green:'New tenant set-up'};
const properties:Record<Kind,string>={gold:'123 Example Lane · Unit 4',green:'456 Sample Street · Unit 2'};
const initial:Entry[]=[{id:'notice',kind:'gold',label:steps.gold[0].label,who:'Alex · Office',time:'Starting example · already completed'}];
export default function HabuOfficeDemo(){
 const [mapReset,setMapReset]=useState(0);
 const [kind,setKind]=useState<Kind>('gold');const [role,setRole]=useState<Role>('Office');const [entries,setEntries]=useState<Entry[]>(initial);
 const [dates,setDates]=useState<Record<string,string>>({});const [view,setView]=useState('route');const [channel,setChannel]=useState('Slack');
 const [announcement,setAnnouncement]=useState('Tap Keys received to try the first handoff.');const [guide,setGuide]=useState(false);const [focused,setFocused]=useState('');
 const current=steps[kind];const complete=(id:string)=>entries.some(e=>e.kind===kind&&e.id===id);
 const ready=(s:Step)=>!complete(s.id)&&s.needs.every(complete);const active=current.filter(ready);const mine=active.filter(s=>s.role===role);
 const count=current.filter(s=>complete(s.id)).length;const history=entries.filter(e=>e.kind===kind);const sections=[...new Set(current.filter(s=>!s.back).map(s=>s.section))];const nextStep=mine.find(s=>s.id===focused)||mine[0];
 function finish(s:Step){if(!ready(s)||s.role!==role||(s.date&&!dates[kind+s.id]))return;
  const time=new Date().toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit'});
  const updated=[...entries,{id:s.id,kind,label:s.label,who:people[role]+' · '+role,time,date:dates[kind+s.id]}];setEntries(updated);
  const ids=new Set(updated.filter(e=>e.kind===kind).map(e=>e.id));const next=current.filter(t=>!ids.has(t.id)&&t.needs.includes(s.id)&&t.needs.every(n=>ids.has(n)));
  setAnnouncement(next.length?`Recorded for ${people[role]}. Next: ${[...new Set(next.map(t=>t.role))].join(' and ')}.`:`Recorded for ${people[role]}. Other assigned work continues.`);
 }
 function openTask(s:Step){setRole(s.role);setFocused(s.id);setView(s.back?'back':'front');setAnnouncement(`Demo switched to ${people[s.role]}'s desk. The same jacket stays in view.`);window.scrollTo({top:0,behavior:'smooth'});}
 function reset(){setMapReset(n=>n+1);setEntries(initial);setDates({});setKind('gold');setRole('Office');setView('route');setAnnouncement('Demo reset. Tap Keys received to begin.');}
 function stepRow(s:Step){const entry=history.find(e=>e.id===s.id);const available=ready(s);const own=s.role===role;
  return <div className={'step '+(entry?'finished':available&&own?'your-step':'')} key={s.id}><span className={'step-mark '+(entry?'checked':'')}>{entry?<Check size={16}/>:<span/>}</span><div className="step-body"><div className="step-title">{s.label}</div><div className="step-meta">{entry?`${entry.who} · ${entry.time}`:s.role+(available?' · Ready':' · Waiting on earlier steps')}{entry?.date&&` · Scheduled: ${entry.date}`}</div>{available&&own&&s.date&&<label className="date-field">Appointment date<input type="date" value={dates[kind+s.id]||''} onChange={e=>setDates({...dates,[kind+s.id]:e.target.value})}/></label>}</div>{!entry&&available&&own&&<Button className="complete-button" disabled={!!s.date&&!dates[kind+s.id]} onClick={()=>finish(s)}>{s.date?'Set date & complete':'Mark completed'}</Button>}{!entry&&available&&!own&&<span className="owner-chip">{people[s.role]}</span>}</div>;
 }
 return <div className="habu-app">
 <header className="app-header"><div className="brand"><FolderOpen size={25}/><strong>HABU</strong><span>Office jackets</span></div><div className="demo-tag">TEAM DEMO · SAMPLE DATA</div></header>
 <div className="demo-toolbar"><div className="person-control"><label id="person-label">Viewing the desk of</label><select aria-labelledby="person-label" value={role} onChange={e=>setRole(e.target.value as Role)}>{roles.map(r=><option key={r} value={r}>{people[r]} · {r}</option>)}</select></div><div className="toolbar-actions"><Button variant="ghost" onClick={()=>setGuide(!guide)}>5-minute walkthrough</Button><Button variant="outline" onClick={reset}><RotateCcw size={15}/>Reset demo</Button></div></div>
 {guide&&<div className="walkthrough"><strong>Show the team</strong><ol><li>Tap Keys received. As Alex, complete both key steps.</li><li>Tap Schedule inspection, then Try as Sam. Set the date. Tap Inspect unit to complete the inspection once the keys are ready.</li><li>Tap Turn work, then Try as Taylor. Complete blinds, paint, and cleaning. Tap Verify readiness and Try as Sam.</li><li>Tap Close-out and Try as Morgan. The owner and advertising branch can progress independently.</li><li>Review the history. Switch to the green jacket to try the move-in flow.</li></ol><p>Proposed routing and selected form steps for discussion. Names, addresses, work orders, and messages are fictional. Changes last only in this open page.</p></div>}
 <div className={view==='route'?'workspace map-workspace':'workspace'}><section className="main-column"><div className="desk-title"><div><p className="eyebrow">{view==='route'?'THE FOLDER’S JOURNEY':'MY DESK'}</p><h1>{view==='route'?'Who gets it next?':mine.length?`${mine.length} ${mine.length===1?'step needs':'steps need'} you`:'Your steps are clear'}</h1></div><span className="desk-total">{active.length} ready across the team</span></div>
 <Tabs value={kind} onValueChange={v=>{setKind(v as Kind);setView('route');setAnnouncement('Switched jackets. Each has its own checklist and history.')}} className="jacket-picker"><TabsList data-slot="tabs-list"><TabsTrigger data-slot="tabs-trigger" value="gold"><span className="color-dot gold"/>Vacancy tracking</TabsTrigger><TabsTrigger data-slot="tabs-trigger" value="green"><span className="color-dot green"/>New tenant set-up</TabsTrigger></TabsList></Tabs>
 {view!=='route'&&nextStep&&<div className="next-action"><p className="eyebrow">YOUR NEXT STEP</p>{stepRow(nextStep)}</div>}
 <article className={'jacket '+kind}><div className="jacket-heading"><div><p className="eyebrow">{kind==='gold'?'GOLD':'GREEN'} JACKET</p><h2>{titles[kind]}</h2><p>{properties[kind]}</p></div><div className="progress-label"><strong>{count}/{current.length}</strong><span>steps complete</span></div></div><div className="jacket-status">{count===current.length?<><Check size={17}/>All demo steps complete</>:<><Clock3 size={17}/>Open · accountable role: {kind==='gold'?'Property manager':'Office'}</>}</div>
 <Tabs value={view} onValueChange={v=>setView(String(v))}><TabsList data-slot="tabs-list" className="folder-tabs"><TabsTrigger data-slot="tabs-trigger" value="route"><ArrowRight/>Route map</TabsTrigger><TabsTrigger data-slot="tabs-trigger" value="front"><ClipboardList/>Front</TabsTrigger><TabsTrigger data-slot="tabs-trigger" value="back"><FolderOpen/>Back</TabsTrigger><TabsTrigger data-slot="tabs-trigger" value="docs"><FileText/>Documents</TabsTrigger><TabsTrigger data-slot="tabs-trigger" value="history"><Clock3/>History</TabsTrigger></TabsList>
 <TabsContent value="route"><RouteMap key={kind+mapReset} kind={kind} tasks={current} people={people} role={role} complete={complete} ready={s=>ready(s as Step)} renderStep={s=>stepRow(s as Step)} switchRole={r=>{setRole(r as Role);setAnnouncement(`Demo switched to ${people[r as Role]}’s desk.`)}}/></TabsContent>
 <TabsContent value="front"><div className="form-content">{sections.map(section=><section className="form-section" key={section}><h3>{section}</h3>{current.filter(s=>s.section===section&&!s.back).map(stepRow)}</section>)}</div></TabsContent>
 <TabsContent value="back"><div className="form-content"><h3>{kind==='gold'?'Unit turn work orders':'Notes and supporting work'}</h3><p className="content-note">{kind==='gold'?'The work that used to be written on the back stays with this jacket. These example work orders become ready after inspection.':'A place for the notes and supporting records that travel with the setup form.'}</p>{kind==='gold'?current.filter(s=>s.back).map(stepRow):<div className="document-row"><FileText/><div><strong>Appointment preparation</strong><p>Confirm the key packet and bring the move-in documents.</p></div></div>}</div></TabsContent>
 <TabsContent value="docs"><div className="form-content"><h3>Documents stay connected</h3><div className="document-row"><FileText/><div><strong>Original {kind==='gold'?'vacancy tracking':'tenant setup'} form</strong><p>Reference copy supplied for this demo.</p><a href={kind==='gold'?'/admin/habu-demo/forms/vacancy-tracking':'/admin/habu-demo/forms/tenant-setup'} target="_blank" rel="noreferrer">Open original form ↗</a></div></div><div className="document-row"><FileText/><div><strong>{kind==='gold'?'Move-out confirmation letter':'Rental agreement and welcome letter'}</strong><p>In the working product, this opens the relevant document in AppFolio. AppFolio is not connected in this demo.</p></div></div><div className="document-row"><FolderOpen/><div><strong>One jacket, one set of references</strong><p>Staff use links to the same records as the work moves between desks.</p></div></div></div></TabsContent>
 <TabsContent value="history"><div className="form-content"><h3>Who completed what, and when</h3><p className="content-note">Demo actions are staff confirmations. Appointment dates are recorded separately.</p>{history.length?<ol className="history-list">{[...history].reverse().map((e,i)=><li key={e.id+i}><Check size={17}/><div><strong>{e.label}</strong><p>{e.who} · {e.time}{e.date&&` · Appointment: ${e.date}`}</p></div></li>)}</ol>:<p>No steps completed yet.</p>}</div></TabsContent></Tabs></article></section>
 {view!=='route'&&<aside className="notification-column"><p className="eyebrow">HOW THE NEXT PERSON HEARS</p><h2>The handoff</h2><p className="aside-intro">Choose a notification style. Each opens the same assigned step.</p><Tabs value={channel} onValueChange={v=>setChannel(String(v))}><TabsList data-slot="tabs-list" className="channel-tabs"><TabsTrigger data-slot="tabs-trigger" value="Slack"><MessageSquare/>Slack</TabsTrigger><TabsTrigger data-slot="tabs-trigger" value="Email"><Mail/>Email</TabsTrigger><TabsTrigger data-slot="tabs-trigger" value="App"><Monitor/>App</TabsTrigger></TabsList></Tabs><div className={'inbox '+channel.toLowerCase()}><div className="inbox-label">{channel==='Slack'?'HABU · direct messages':channel==='Email'?'Inbox · HABU handoffs':'My desk · assigned steps'}<span>SIMULATED</span></div>{active.length?active.map(s=><div className="message" key={s.id}><div className="message-recipient">To {people[s.role]} · {s.role}</div><strong>{s.label}</strong><p>{properties[kind]}</p><Button variant="outline" onClick={()=>openTask(s)}>Open assigned step<ArrowRight size={14}/></Button></div>):<div className="message"><Check/><strong>All demo steps complete</strong><p>No further handoffs for this jacket.</p></div>}</div><div className="routing-note"><strong>The folder stays in HABU.</strong><p>Slack or email brings the next person to it. Ready sections can move in parallel.</p></div></aside>}</div>
 <div className="status-bar" role="status" aria-live="polite">{announcement}</div><footer>Proposed workflow for team review · Selected steps from your forms · No real messages, payments, or AppFolio changes</footer></div>;
}
