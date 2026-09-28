import { describe, expect, it } from 'vitest';
import { actionableInspections, inspectionToday, type QueueInspection, type QueueProperty } from '../inspection-queue';
import { buildInspectionOutlook } from '../inspection-outlook';
const today = '2026-09-28';
const prop: QueueProperty = { id: 'p1', appfolio_unit_id: 'unit1', next_due_date: '2027-02-01', last_inspection_date: '2026-08-01' };
const row = (id: string, overrides: Partial<QueueInspection> = {}): QueueInspection => ({ id, property_id: id, status: 'imported', inspection_type: 'routine', due_date: '2026-10-10', target_date: null, assigned_to: null, resident_name: null, inspection_properties: null, ...overrides });
describe('actionable inspection queue', () => {
  it('keeps overdue and next-45-day work and all appointments, excluding history and later unscheduled work', () => {
    const rows = [row('overdue', {due_date:'2026-09-01'}), row('soon'), row('boundary',{due_date:'2026-11-12'}), row('later',{due_date:'2026-11-13'}), row('complete',{status:'completed'}), row('cancel',{status:'canceled'}), row('scheduled',{status:'scheduled',target_date:'2027-01-01'}), row('working',{status:'in_progress'}), row('undated',{due_date:null})];
    expect(actionableInspections(rows, [], today).map(r=>r.id).sort()).toEqual(['boundary','overdue','scheduled','soon','undated','working']);
  });
  it('uses the current cadence to remove stale imports without mutating history', () => {
    const stale=row('stale',{due_date:'2022-10-01',inspection_properties:prop});
    expect(actionableInspections([stale], [prop], today)).toEqual([]);
    expect(stale.due_date).toBe('2022-10-01');
    expect(actionableInspections([stale], [prop], today,366)[0].due_date).toBe('2027-02-01');
  });
  it('keeps future appointments despite a recent completed visit, and retires past appointments superseded by that visit', () => {
    const rows=[row('past',{status:'scheduled',target_date:'2026-07-01',inspection_properties:prop}),row('future',{status:'scheduled',target_date:'2026-10-01',inspection_properties:prop})];
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
