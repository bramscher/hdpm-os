import { describe, expect, it } from 'vitest';
import { inspectionSchedulingAlert } from '../inspection-scheduling-alert';
import type { QueueProperty } from '../inspection-queue';
const candidate = (id:string, overrides:Partial<QueueProperty> = {}):QueueProperty => ({id, candidate_status:'eligible', next_due_date:'2026-10-10', ...overrides});
describe('inspection scheduling alert', () => {
  it('includes candidates without inspection records and splits overdue, upcoming, and unknown dates', () => {
    expect(inspectionSchedulingAlert([
      candidate('old',{next_due_date:'2026-09-27'}), candidate('today',{next_due_date:'2026-09-28'}), candidate('soon'), candidate('unknown',{next_due_date:null}),
    ],'2026-09-28')).toEqual({total:4, overdue:1, upcoming:2, undated:1});
  });
  it('excludes scheduled, dismissed, deferred, recently inspected, inactive and routine-exempt units', () => {
    const rows = ['scheduled','dismissed','defer','skip_recent'].map(status => candidate(status,{candidate_status:status}));
    rows.push(candidate('inactive',{active:false}), candidate('exempt',{routine_inspections_enabled:false}));
    expect(inspectionSchedulingAlert(rows,'2026-09-28')).toEqual({total:0, overdue:0, upcoming:0, undated:0});
  });
});
