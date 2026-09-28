import { describe, expect, it } from 'vitest';
import { actionableInspections, inspectionWorkflow, inspectionToday, type QueueInspection, type QueueProperty } from '../inspection-queue';
import { buildInspectionOutlook } from '../inspection-outlook';
const today = '2026-09-28';
const prop: QueueProperty = { id: 'p1', appfolio_unit_id: 'unit1', next_due_date: '2027-02-01', last_inspection_date: '2026-08-01' };
const appointment = (date: string, status = 'pending', actual_arrival: string | null = null) => [{status, actual_arrival, route_plans:{id:'route',route_date:date,status:'optimized'}}];
const row = (id: string, overrides: Partial<QueueInspection> = {}): QueueInspection => ({ id, property_id: id, status: 'imported', inspection_type: 'routine', due_date: '2026-10-10', target_date: null, assigned_to: null, resident_name: null, inspection_properties: null, ...overrides });
describe('actionable inspection queue', () => {
  it('keeps overdue and next-45-day work and all appointments, excluding history and later unscheduled work', () => {
    const rows = [row('overdue', {due_date:'2026-09-01'}), row('soon'), row('boundary',{due_date:'2026-11-12'}), row('later',{due_date:'2026-11-13'}), row('complete',{status:'completed'}), row('cancel',{status:'canceled'}), row('scheduled',{status:'scheduled',target_date:'2027-01-01',route_stops:appointment('2027-01-01')}), row('working',{status:'in_progress'}), row('undated',{due_date:null})];
    expect(actionableInspections(rows, [], today).map(r=>r.id).sort()).toEqual(['boundary','overdue','scheduled','soon','undated','working']);
  });
  it('uses the current cadence to remove stale imports without mutating history', () => {
    const stale=row('stale',{due_date:'2022-10-01',inspection_properties:prop});
    expect(actionableInspections([stale], [prop], today)).toEqual([]);
    expect(stale.due_date).toBe('2022-10-01');
    expect(actionableInspections([stale], [prop], today,366)[0].due_date).toBe('2027-02-01');
  });
  it('keeps future appointments despite a recent completed visit, and retires past appointments superseded by that visit', () => {
    const rows=[row('past',{status:'scheduled',target_date:'2026-07-01',route_stops:appointment('2026-07-01'),inspection_properties:prop}),row('future',{status:'scheduled',target_date:'2026-10-01',route_stops:appointment('2026-10-01'),inspection_properties:prop})];
    expect(actionableInspections(rows,[prop],today).map(r=>r.id)).toEqual(['future']);
  });
  it('honors routes attached through route_stops even when the inspection foreign key is blank', () => {
    const result=actionableInspections([row('linked',{due_date:'2027-06-01',route_stops:[{route_plans:{route_date:'2026-09-29',status:'optimized'}}]})],[],today);
    expect(result[0].target_date).toBe('2026-09-29');
  });
  it('prefers the linked route date over older reused route stops', () => {
    const result = actionableInspections([row('reused', {route_plan_id:'current', route_stops:[{route_plans:{id:'old',route_date:'2026-09-22',status:'optimized'}},{route_plans:{id:'current',route_date:'2026-09-29',status:'optimized'}}]})], [], today);
    expect(result[0].target_date).toBe('2026-09-29');
  });
  it('deduplicates a routine cycle while preserving distinct future cycles', () => {
    const rows=[row('a',{property_id:'same'}),row('b',{property_id:'same'}),row('next',{property_id:'same',due_date:'2027-04-10'})];
    expect(actionableInspections(rows,[],today,366).map(r=>r.id)).toEqual(['a','next']);
  });
  it('uses Pacific calendar dates near midnight UTC',()=>{expect(inspectionToday(new Date('2026-09-29T02:00:00Z'))).toBe(today);});
});
describe('12-month inspection outlook',()=>{
 it('buckets appointments by target date and excludes completed records',()=>{
   const summary=buildInspectionOutlook([row('scheduled',{status:'scheduled',due_date:'2022-01-01',target_date:'2026-09-29'}),row('pending',{due_date:'2026-10-01'}),row('old',{due_date:'2026-09-01'}),row('done',{status:'completed'}),row('none',{due_date:null})],today);
   expect(summary.months[0]).toMatchObject({total:1,scheduled:1,pending:0});
   expect(summary.months[1]).toMatchObject({total:1,pending:1});
   expect(summary).toMatchObject({total:4,overdue:1,undated:1});
 });
});

describe('inspection workflow status', () => {
 it('requires a real route, not a stored status or target date', () => {
  for (const status of ['imported','validated','queued','scheduled','planned','dispatched','in_progress']) {
   expect(inspectionWorkflow(row(status,{status,target_date:today}),today)).toMatchObject({status:'queued',target_date:null});
  }
 });
 it('shows imported inspections on dated routes as scheduled and links the route', () => {
  expect(inspectionWorkflow(row('i',{route_stops:appointment('2026-09-29')}),today)).toMatchObject({status:'scheduled',target_date:'2026-09-29',scheduled_route_id:'route',stored_status:'imported'});
 });
 it('shows in progress only for a stop actually started today on today’s route', () => {
  expect(inspectionWorkflow(row('i',{route_stops:appointment(today,'in_progress','2026-09-28T17:00:00Z')}),today).status).toBe('in_progress');
  expect(inspectionWorkflow(row('i',{route_stops:appointment(today)}),today).status).toBe('scheduled');
  expect(inspectionWorkflow(row('i',{route_stops:appointment(today,'in_progress','2026-09-28T02:00:00Z')}),today).status).toBe('scheduled');
  expect(inspectionWorkflow(row('i',{route_stops:appointment('2026-09-27','in_progress','2026-09-27T17:00:00Z')}),today).status).toBe('needs_review');
 });
 it('ignores skipped stops and completed or canceled routes', () => {
  expect(inspectionWorkflow(row('i',{route_stops:appointment(today,'skipped')}),today).status).toBe('queued');
  for(const status of ['completed','canceled']) {
   expect(inspectionWorkflow(row('i',{route_stops:[{route_plans:{id:'r',route_date:today,status}}]}),today).status).toBe('queued');
  }
 });
 it('preserves completed inspection history even if an old route still has a pending stop', () => {
  expect(inspectionWorkflow(row('i',{status:'completed',route_stops:appointment(today)}),today).status).toBe('completed');
 });
});

describe('past route appointments', () => {
 it('keeps past unfinished appointments for review without presenting them as upcoming', () => {
  const original = row('past',{status:'scheduled',due_date:'2026-09-01',route_stops:appointment('2026-09-09')});
  const result = actionableInspections([original,row('today',{route_stops:appointment(today)}),row('future',{route_stops:appointment('2026-09-29')})],[],today);
  expect(result.find(r=>r.id==='past')).toMatchObject({status:'needs_review',target_date:'2026-09-09',scheduled_route_id:'route',due_date:'2026-09-01'});
  expect(result.filter(r=>r.status==='scheduled').map(r=>r.id).sort()).toEqual(['future','today']);
  expect(original.status).toBe('scheduled');
  const outlook=buildInspectionOutlook(result,today);
  expect(outlook.overdue).toBe(1);
  expect(outlook.months[0].scheduled).toBe(2);
 });
});
