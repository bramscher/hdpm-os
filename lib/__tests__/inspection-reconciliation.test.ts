import { describe, expect, it } from 'vitest';
import { reconcileInspectionProperties, type QueueInspection, type QueueProperty } from '../inspection-queue';
import { inspectionSchedulingAlert } from '../inspection-scheduling-alert';
const today = '2026-09-28';
const candidate: QueueProperty = { id:'synced', appfolio_unit_id:'unit1', name:'Home', address_1:'100 Main Street', city:'Bend', zip:'97701', candidate_status:'eligible', next_due_date:'2026-09-01', last_inspection_date:'2026-03-01' };
const row = (overrides: Partial<QueueInspection> = {}): QueueInspection => ({id:'inspection',property_id:'legacy',status:'queued',inspection_type:'routine',due_date:'2026-09-01',target_date:null,assigned_to:null,resident_name:null,inspection_properties:{...candidate,id:'legacy',appfolio_unit_id:null},...overrides});
const appointment = (date:string, status='pending') => [{status,route_plans:{id:'route',status:'optimized',route_date:date}}];

describe('inspection candidate reconciliation', () => {
  it('removes a scheduled legacy import from scheduling alerts and the eligible pool', () => {
    const result = reconcileInspectionProperties([row({route_stops:appointment('2026-09-29')})],[candidate],today);
    expect(result[0].candidate_status).toBe('scheduled');
    expect(inspectionSchedulingAlert(result,today).total).toBe(0);
    expect(candidate.candidate_status).toBe('eligible');
  });
  it('uses a completed legacy visit to advance the due date without altering history', () => {
    const completed = row({status:'completed',completed_at:'2026-09-29T02:00:00Z'});
    const result = reconcileInspectionProperties([completed],[candidate],today);
    expect(result[0]).toMatchObject({candidate_status:'skip_recent',last_inspection_date:today,next_due_date:'2027-03-28'});
    expect(inspectionSchedulingAlert(result,today).total).toBe(0);
    expect(completed.due_date).toBe('2026-09-01');
  });
  it('keeps a new cycle eligible when the matched completion is old', () => {
    const result = reconcileInspectionProperties([row({status:'completed',completed_at:'2025-09-28T19:00:00Z'})],[candidate],today);
    expect(inspectionSchedulingAlert(result,today).overdue).toBe(1);
  });
  it('does not suppress an eligible unit because another unit at the same address is scheduled', () => {
    const neighbor = {...candidate,id:'neighbor',appfolio_unit_id:'unit2'};
    const result = reconcileInspectionProperties([row({route_stops:appointment('2026-09-29')})],[candidate,neighbor],today);
    expect(result.map(p=>p.candidate_status)).toEqual(['eligible','eligible']);
  });
  it('uses exact unit identifiers even when addresses have changed', () => {
    const result = reconcileInspectionProperties([row({inspection_properties:{...candidate,id:'legacy',address_1:'Old address'},route_stops:appointment('2026-09-29')})],[candidate],today);
    expect(result[0].candidate_status).toBe('scheduled');
  });
  it('keeps skipped visits eligible and past unfinished appointments out of automatic scheduling', () => {
    expect(reconcileInspectionProperties([row({route_stops:appointment('2026-09-29','skipped')})],[candidate],today)[0].candidate_status).toBe('eligible');
    expect(reconcileInspectionProperties([row({route_stops:appointment('2026-09-20')})],[candidate],today)[0].candidate_status).toBe('scheduled');
  });
  it('retires missed appointments superseded by a completion and preserves exclusions', () => {
    const rows=[row({route_stops:appointment('2026-09-20')}),row({status:'completed',completed_at:'2026-09-28T19:00:00Z'})];
    expect(reconcileInspectionProperties(rows,[candidate],today)[0].candidate_status).toBe('skip_recent');
    for(const property of [{...candidate,candidate_status:'dismissed'},{...candidate,active:false},{...candidate,routine_inspections_enabled:false}]) {
      expect(inspectionSchedulingAlert(reconcileInspectionProperties(rows,[property],today),today).total).toBe(0);
    }
  });
  it('does not treat unrelated inspection types as a routine completion', () => {
    expect(reconcileInspectionProperties([row({inspection_type:'move_out',status:'completed',completed_at:'2026-09-28T19:00:00Z'})],[candidate],today)[0].candidate_status).toBe('eligible');
  });
  it('counts candidates with no inspection record and continues enforcing 21 days', () => {
    const result = reconcileInspectionProperties([], [candidate,{...candidate,id:'later',next_due_date:'2026-10-20'}],today);
    expect(inspectionSchedulingAlert(result,today)).toEqual({total:1,overdue:1,upcoming:0,undated:0});
  });
});
