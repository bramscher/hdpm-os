import {describe,expect,it} from 'vitest';
import {bucketFor,laneFor,heatFor,daysStuck,focusQueue,chaseCounts,weeklySends,groupByVendor,buildVendorBatchDraft,clearedToday,daysUntil,FOCUS_CAP} from '../chase-board';
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
 it('leaves out parked, closed and help items',()=>{
  const parked=c(),help=c(),closed=c({eligible:false});
  const reviews=new Map([[parked.id,r({status:'snoozed',next_review_at:ago(-3)})],[help.id,r({status:'help'})]]);
  expect(focusQueue([parked,help,closed],reviews,now)).toEqual([]);
 });
});
describe('send counting',()=>{
 const sent=(wo:string,at:string,id=++n)=>({id,work_order_id:wo,actor:'craig',action:'delivery',created_at:at,details:{status:'sent'}});
 it('counts confirmed deliveries and legacy proposals per work order',()=>{
  const m=chaseCounts([sent('a',ago(1)),sent('a',ago(5)),{...sent('b',ago(1)),details:{status:'failed'}}],[{subject_id:'a',created_at:ago(30),action_type:'vendor_chase',status:'approved'}]);
  expect(m.get('a')).toBe(3);expect(m.get('b')).toBeUndefined();
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
