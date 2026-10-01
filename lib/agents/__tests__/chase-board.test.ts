import {describe,expect,it} from 'vitest';
import {bucketFor,laneFor,heatFor,daysStuck,focusQueue,chaseCounts,weeklySends,groupByVendor,buildVendorBatchDraft,clearedToday,daysUntil,nextStep,ageBucket,agingSnapshot,matchesSnapshot,chasesFor,FOCUS_CAP} from '../chase-board';
import type {FollowupCandidate,FollowupReview} from '../estimate-followups';
const now=new Date('2026-10-01T18:00:00Z');
const ago=(d:number)=>new Date(now.getTime()-d*86400_000).toISOString();
let n=0;
const c=(o:Partial<FollowupCandidate>={}):FollowupCandidate=>({id:`wo-${++n}`,property:'Elm St',unit:'',woNumber:String(n),vendor:'Firkus',description:'',age:5,kind:'vendor',reason:'',email:'bids@firkus.test',phone:'',subject:'',emailBody:'',smsBody:'',statusSince:ago(10),...o});
const r=(o:Partial<FollowupReview>):FollowupReview=>({work_order_id:'x',status:'review',version:1,next_review_at:null,note:'',updated_by:'craig',channel:null,recipient:null,subject:null,body:null,updated_at:ago(1),error:null,...o});
describe('chase board buckets and lanes',()=>{
 it('parks sent work until its review date, then returns it',()=>{
  expect(bucketFor(c(),r({status:'sent',next_review_at:ago(-2)}),now)).toBe('parked');
  expect(bucketFor(c(),r({status:'sent',next_review_at:ago(1)}),now)).toBe('active');
 });
 it('closes dismissed and no-longer-overdue work',()=>{expect(bucketFor(c(),r({status:'dismissed'}),now)).toBe('closed');expect(bucketFor(c({eligible:false}),undefined,now)).toBe('closed');});
 it('keeps delivery checks and new episodes active',()=>{expect(bucketFor(c(),r({status:'uncertain'}),now)).toBe('active');expect(bucketFor(c({newEpisode:true}),r({status:'snoozed',next_review_at:ago(-5)}),now)).toBe('active');});
 it('maps kinds to lanes and help overrides',()=>{
  expect(laneFor(c({kind:'vendor'}))).toBe('vendor');expect(laneFor(c({kind:'owner'}))).toBe('owner');expect(laneFor(c({kind:'decision'}))).toBe('owner');expect(laneFor(c({kind:'schedule'}))).toBe('schedule');
  expect(laneFor(c({kind:'vendor'}),r({status:'help'}))).toBe('help');
 });
});
describe('heat and age',()=>{
 it('uses calendar days with a 45-day escalation line',()=>{expect([3,7,21,44,45].map(heatFor)).toEqual(['fresh','warm','hot','hot','escalate']);});
 it('counts days in status and tolerates missing dates',()=>{expect(daysStuck(c({statusSince:ago(12)}),now)).toBe(12);expect(daysStuck(c({statusSince:undefined}),now)).toBe(0);});
});
describe('focus queue',()=>{
 it('caps at seven, delivery checks first, then P1, then longest stuck',()=>{
  const items=Array.from({length:12},(_,i)=>c({statusSince:ago(i+1)}));
  const p1=c({priority:'P1',statusSince:ago(2)});const check=c({statusSince:ago(1)});
  const reviews=new Map([[check.id,r({work_order_id:check.id,status:'uncertain'})]]);
  const q=focusQueue([...items,p1,check],reviews,now);
  expect(q).toHaveLength(FOCUS_CAP);expect(q[0].id).toBe(check.id);expect(q[1].id).toBe(p1.id);expect(daysStuck(q[2],now)).toBe(12);
 });
 it('lets lanes take turns so one backlog cannot fill the list',()=>{
  const old=Array.from({length:10},(_,i)=>c({kind:'schedule',statusSince:ago(150+i)}));
  const vendor=c({kind:'vendor',statusSince:ago(20)}),owner=c({kind:'owner',statusSince:ago(30)});
  const q=focusQueue([...old,vendor,owner],new Map(),now);
  expect(q).toHaveLength(FOCUS_CAP);expect(q.slice(0,3).map(x=>x.kind).sort()).toEqual(['owner','schedule','vendor']);
 });
 it('leaves out parked, closed and help items',()=>{
  const parked=c(),help=c(),closed=c({eligible:false});
  const reviews=new Map([[parked.id,r({status:'snoozed',next_review_at:ago(-3)})],[help.id,r({status:'help'})]]);
  expect(focusQueue([parked,help,closed],reviews,now)).toEqual([]);
 });
});
describe('send counting',()=>{
 const sent=(wo:string,at:string,id=++n)=>({id,work_order_id:wo,actor:'craig',action:'delivery',created_at:at,details:{status:'sent'}});
 it('counts confirmed deliveries only',()=>{
  const m=chaseCounts([sent('a',ago(1)),sent('a',ago(5)),{...sent('b',ago(1)),details:{status:'failed'}}]);
  expect(m.get('a')).toBe(2);expect(m.get('b')).toBeUndefined();
 });
 it('buckets sends into Pacific Monday weeks, current week last',()=>{
  // now = Thu Oct 1 2026 PT; week starts Mon Sep 28.
  const w=weeklySends([sent('a','2026-09-28T16:00:00Z'),sent('b','2026-09-30T20:00:00Z'),sent('c','2026-09-27T20:00:00Z'),sent('d','2026-06-01T20:00:00Z')],8,now);
  expect(w).toHaveLength(8);expect(w[7]).toEqual({week:'2026-09-28',sends:2});expect(w[6]).toEqual({week:'2026-09-21',sends:1});
 });
 it('counts distinct work orders acted on today, not deliveries',()=>{
  expect(clearedToday([{id:1,work_order_id:'a',actor:'c',action:'snooze',created_at:now.toISOString(),details:{}},{id:2,work_order_id:'a',actor:'c',action:'note',created_at:now.toISOString(),details:{}},sent('b',now.toISOString())],now)).toBe(1);
 });
 it('counts days to the gate',()=>{expect(daysUntil('2026-10-15',now)).toBe(14);});
});
describe('vendor grouping and batch draft',()=>{
 it('groups vendor-lane work, largest backlog first, batchable only when due with one email',()=>{
  const a=[c({vendor:'Firkus'}),c({vendor:'Firkus'}),c({vendor:'Firkus',email:'other@x.test'})];
  const waiting=c({vendor:'Firkus'});const b=c({vendor:'Bend Radiant',email:'br@x.test'});const sched=c({kind:'schedule',vendor:'Firkus'});
  const g=groupByVendor([...a,waiting,b,sched],new Map([[waiting.id,r({status:'sent',next_review_at:ago(-2)})]]),now);
  expect(g.map(x=>x.vendor)).toEqual(['Firkus','Bend Radiant']);
  expect(g[0].items).toHaveLength(3);expect(g[0].batchable.map(x=>x.id)).toEqual([a[0].id,a[1].id]);
 });
 it('lists every work order and never states an amount',()=>{
  const d=buildVendorBatchDraft('Firkus',[c({woNumber:'4471',property:'Wilson',unit:'B'}),c({woNumber:'4480'})],now);
  expect(d.subject).toContain('2 High Desert work orders');expect(d.body).toContain('WO 4471 — Wilson, Unit B');expect(d.body).toContain('WO 4480');expect(d.body).not.toMatch(/\$/);
 });
});
describe('next step',()=>{
 it('names the cleanup before a chase is possible',()=>{
  expect(nextStep(c({kind:'vendor',vendor:''}),undefined,now)).toEqual({kind:'fix',text:'Assign a vendor in AppFolio — no one has been asked for this bid'});
  expect(nextStep(c({kind:'vendor',email:'',phone:''}),undefined,now).kind).toBe('fix');
  expect(nextStep(c({kind:'decision'}),undefined,now).text).toMatch(/Record who approves/);
 });
 it('says who to chase and for how long',()=>{
  expect(nextStep(c({kind:'vendor',vendor:'Yak Landscaping',statusSince:ago(36)}),undefined,now)).toEqual({kind:'chase',text:'Email Yak Landscaping for the bid (36 days waiting)'});
  expect(nextStep(c({kind:'vendor',vendor:'Yak',email:'',phone:'+15415551234'}),undefined,now).text).toMatch(/^Text Yak/);
  expect(nextStep(c({kind:'owner',decisionMaker:'Jane Owner'}),undefined,now).text).toMatch(/^Ask Jane Owner to approve/);
 });
 it('asks whether very old scheduling work is still needed',()=>{
  expect(nextStep(c({kind:'schedule',statusSince:ago(188)}),undefined,now)).toEqual({kind:'decide',text:'188 days with no date — still needed? Close it in AppFolio or set a date'});
  expect(nextStep(c({kind:'schedule',vendor:'',statusSince:ago(10)}),undefined,now).kind).toBe('fix');
  expect(nextStep(c({kind:'schedule',vendor:'High Desert Maintenance',email:'',phone:'',statusSince:ago(10)}),undefined,now).text).toBe('Set a service date with High Desert Maintenance');
 });
 it('puts delivery checks and help ahead of everything',()=>{
  expect(nextStep(c(),r({status:'uncertain'}),now).kind).toBe('check');
  expect(nextStep(c(),r({status:'help',note:'Matt calling vendor'}),now).text).toBe('Waiting on team help: Matt calling vendor');
 });
});
describe('aging snapshot',()=>{
 it('buckets ages at the edges',()=>{expect([0,7,8,21,22,45,46,90,91,400].map(ageBucket)).toEqual(['d7','d7','d21','d21','d45','d45','d90','d90','old','old']);});
 it('counts stage × age with a next-step split, and totals by step',()=>{
  const items=[c({kind:'vendor',vendor:'',statusSince:ago(50)}),c({kind:'vendor',vendor:'Yak',statusSince:ago(50)}),c({kind:'schedule',statusSince:ago(188)}),c({kind:'decision',statusSince:ago(3)})];
  const s=agingSnapshot(items,new Map(),now);
  const vendor=s.rows.find(r=>r.key==='vendor')!;
  expect(vendor.total).toBe(2);expect(vendor.cells.find(x=>x.key==='d90')).toMatchObject({count:2,steps:{fix:1,chase:1}});
  expect(s.rows.find(r=>r.key==='schedule')!.cells.find(x=>x.key==='old')!.count).toBe(1);
  expect(s.steps).toMatchObject({fix:2,chase:1,decide:1});expect(s.columns.find(x=>x.key==='d90')!.total).toBe(2);expect(s.max).toBe(2);
 });
 it('filters by stage, age and step together',()=>{
  const x=c({kind:'vendor',vendor:'',statusSince:ago(50)});
  expect(matchesSnapshot(x,undefined,{lane:'vendor',age:'d90',step:'fix'},now)).toBe(true);
  expect(matchesSnapshot(x,undefined,{step:'chase'},now)).toBe(false);expect(matchesSnapshot(x,undefined,{},now)).toBe(true);
 });
});
describe('parts lane',()=>{
 const line=(o:Record<string,unknown>={})=>({id:'po-1',supplier:'Lowe\'s (Bend Pro desk)',item:'Dishwasher',orderNumber:'884',poNumber:null,status:'ordered' as const,orderedAt:'2026-09-15',expectedAt:'2026-09-25',deliveredAt:null,trackingUrl:null,contacts:0,minutes:0,due:true,dueAt:'2026-09-29',reason:'Expected Sep 25 and not delivered',...o});
 const parts=(o:Record<string,unknown>={},l:Record<string,unknown>={})=>{const ln=line(l);return {orders:[ln],primaryId:ln.id,supplier:ln.supplier,contacts:ln.contacts,minutes:0,due:ln.due,dueAt:ln.dueAt,help:false,reason:ln.reason,...o};};
 const p=(po:Record<string,unknown>={},l:Record<string,unknown>={},o:Partial<FollowupCandidate>={})=>c({kind:'parts',vendor:'Firkus',email:'',phone:'+15415550100',parts:parts(po,l),...o});
 it('maps parts to its own lane and escalates issues or three contacts to help',()=>{
  expect(laneFor(p())).toBe('parts');
  expect(laneFor(p({help:true}))).toBe('help');
  expect(laneFor(p(),r({status:'help'}))).toBe('help');
 });
 it('parks an order that is not due yet, even with no review',()=>{
  expect(bucketFor(p({due:false,dueAt:'2026-10-08'}),undefined,now)).toBe('parked');
  expect(bucketFor(p(),undefined,now)).toBe('active');
  expect(bucketFor(p({due:false}),r({status:'uncertain'}),now)).toBe('active');
 });
 it('says what to do next for each order state',()=>{
  expect(nextStep(p(),undefined,now)).toEqual({kind:'chase',text:'Call Lowe\'s (Bend Pro desk) about order #884 — expected Sep 25 and not delivered'});
  expect(nextStep(p({},{status:'issue'}),undefined,now).kind).toBe('fix');
  expect(nextStep(p({},{status:'delivered',deliveredAt:ago(3)}),undefined,now).text).toBe('Part delivered 3 days ago — schedule the install with Firkus');
  expect(nextStep(p({contacts:3}),undefined,now).kind).toBe('wait');
  expect(nextStep(p({},{},{phone:''}),undefined,now).text).toMatch(/^Add a phone or email/);
 });
 it('shows logged contacts as chase dots',()=>{expect(chasesFor(p({contacts:2}),new Map())).toBe(2);expect(chasesFor(c(),new Map([['x',1]]))).toBe(0);});
 it('gives parts a turn in the focus queue',()=>{
  const vendors=Array.from({length:10},(_,i)=>c({statusSince:ago(i+20)}));const part=p({},{},{statusSince:ago(3)});
  expect(focusQueue([...vendors,part],new Map(),now).map(x=>x.id)).toContain(part.id);
 });
 it('adds a parts row to the aging snapshot',()=>{expect(agingSnapshot([p()],new Map(),now).rows.find(x=>x.key==='parts')?.total).toBe(1);});
});
