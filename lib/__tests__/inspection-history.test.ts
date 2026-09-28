import { describe, expect, it } from 'vitest';
import { reconcileInspectionHistory, type AppFolioInspectionDetail } from '../inspection-history';
import { classifyCandidate } from '../inspection-candidates';
import type { AppFolioUnit } from '../appfolio';

const unit = (id: string, numericId: string, lastInspectedDate: string | null): AppFolioUnit => ({
  id, link: `https://highdesertpm.appfolio.com/properties/1031/units/${numericId}`,
  propertyId: 'p1', address1: null, address2: null, city: null, state: null,
  zip: null, name: null, status: 'Occupied', lastInspectedDate,
});
const inspection = (unit_id: number, inspected_on: string | null, status = 'DONE', marked_done_on: string | null = null): AppFolioInspectionDetail => ({ unit_id, inspected_on, status, marked_done_on });

describe('completed AppFolio inspection history', () => {
  it('replaces a stale unit date with the actual visit date, not the later completion date', () => {
    const result = reconcileInspectionHistory([unit('uuid', '1377', '2022-10-25')], [inspection(1377, '2026-04-27', 'DONE', '2026-04-28')], '2026-09-28');
    expect(result[0].lastInspectedDate).toBe('2026-04-27');
  });
  it('uses the newest completed date regardless of report order and excludes uncompleted or future visits', () => {
    const result = reconcileInspectionHistory([unit('uuid', '1377', null)], [
      inspection(1377, '2026-08-01'), inspection(1377, '2026-04-27'),
      inspection(1377, '2026-09-20', 'IN PROGRESS'), inspection(1377, '2026-09-25', 'NEW'),
      inspection(1377, '2027-01-01'), inspection(1377, 'bad-date'),
    ], '2026-09-28');
    expect(result[0].lastInspectedDate).toBe('2026-08-01');
    expect(classifyCandidate({ lastInspectedDate: result[0].lastInspectedDate, moveInDate: '2025-01-01', hasActiveTenant: true, today: new Date('2026-09-28') })).toBe('skip_recent');
  });
  it('preserves newer unit dates and never applies another unit or property-level inspection', () => {
    const units = [unit('newer', '1377', '2026-09-01'), unit('neighbor', '1378', '2022-01-01'), { ...unit('unmapped', '1', null), link: null }];
    const result = reconcileInspectionHistory(units, [inspection(1377, '2026-04-27'), { ...inspection(1, '2026-09-01'), unit_id: null }], '2026-09-28');
    expect(result).toEqual(units);
  });
  it('falls back to marked-done date only when the visit date is absent', () => {
    expect(reconcileInspectionHistory([unit('uuid', '1377', null)], [inspection(1377, null, 'DONE', '2026-09-01')], '2026-09-28')[0].lastInspectedDate).toBe('2026-09-01');
  });
});
