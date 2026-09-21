import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({metrics: [] as any[], existing: [] as any[], snapshot: new Map(), writes: [] as any[], from: vi.fn(), enqueue: vi.fn(), audit: vi.fn(), reconcile: vi.fn(async()=>0)}));
vi.mock('@/lib/supabase', () => ({getSupabaseAdmin: () => ({from:mocks.from})}));
vi.mock('../billable-scorecard', () => ({reconcileBillableScorecard:mocks.reconcile}));
vi.mock('@/lib/audit', () => ({logAudit:mocks.audit}));
vi.mock('@/lib/agents/metrics-history', () => ({readLatestMetrics:async()=>mocks.snapshot}));
vi.mock('@/lib/agents/outbox', () => ({enqueueOutbox:mocks.enqueue,dispatchOutbox:vi.fn()}));
vi.mock('@/lib/agents/staff', () => ({resolveStaffByPersonOrEmail:vi.fn()}));
import {runScorecardWeek} from '../scorecard-run';
import {isFreshScorecardSource} from '../scorecard';
const now = new Date('2026-09-21T14:00:00Z');
beforeEach(() => {
 vi.clearAllMocks(); mocks.writes=[]; mocks.existing=[];
 mocks.metrics=[{id:'hours',name:'Alberto',source:'metrics_snapshot',source_ref:'open_exceptions.total',goal_op:'gte',goal_value:30}];
 mocks.snapshot=new Map([['open_exceptions',{captured_at:'2026-09-21T13:30:00Z',value:{weekStart:'2026-09-21',total:2}}]]);
 mocks.from.mockImplementation((table:string)=>{
  const q:any={};let result=table==='scorecard_metric'?mocks.metrics:mocks.existing;
  for(const method of ['select','eq','in','order'])q[method]=()=>q;
  q.upsert=(row:any)=>{mocks.writes.push(row);return Promise.resolve({error:null});};
  q.then=(resolve:any)=>Promise.resolve({data:result,error:null}).then(resolve);
  return q;
 });
});
describe('daily scorecard refresh', () => {
 it('updates only this week, records freshness, and skips Friday communications/issues', async()=>{
  await runScorecardWeek({now,weeklyActions:false});
  expect(mocks.writes).toHaveLength(1);
  expect(mocks.writes[0]).toMatchObject({week_start:'2026-09-21',value:2,updated_at:now.toISOString(),source_captured_at:'2026-09-21T13:30:00Z'});
  expect(mocks.enqueue).not.toHaveBeenCalled();expect(mocks.from).not.toHaveBeenCalledWith('issue');
 });
 it('preserves manual overrides',async()=>{
  mocks.existing=[{metric_id:'hours',source:'manual'}];await runScorecardWeek({now,weeklyActions:false});expect(mocks.writes).toEqual([]);
 });
 it('replaces stale automatic values with unavailable rather than zero',async()=>{
  mocks.snapshot.get('open_exceptions').captured_at='2026-09-18T13:30:00Z';
  await runScorecardWeek({now,weeklyActions:false});expect(mocks.writes[0]).toMatchObject({value:null,on_track:null});
 });
 it('reconciles invoice history during the daily refresh',async()=>{
  await runScorecardWeek({now,weeklyActions:false});expect(mocks.reconcile).toHaveBeenCalledWith(mocks.metrics,now,false);
 });
 it('makes no writes in dry run',async()=>{
  await runScorecardWeek({now,weeklyActions:false,dryRun:true});expect(mocks.writes).toEqual([]);expect(mocks.audit).not.toHaveBeenCalled();
 });
 it('treats invalid, missing, future, and old capture dates as unavailable',()=>{
  for(const value of [null,undefined,'bad','2026-09-25T00:00:00Z','2026-09-18T00:00:00Z'])expect(isFreshScorecardSource(value,now)).toBe(false);
  expect(isFreshScorecardSource('2026-09-21T13:30:00Z',now)).toBe(true);
 });
});
