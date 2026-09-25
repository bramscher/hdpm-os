import { describe, it, expect } from 'vitest';
import { buildOwnerRows, DEFAULT_DOOR_SCHEDULE, DEFAULT_RAISE_FLOOR, DEFAULT_WEIGHTS, type FeeFacts } from '../model';
import { DEFAULT_FEE_SCHEDULE } from '../fee-schedule';
import { mgmtScenarios, portfolioFatigue, volumeContext } from '../portfolio';

const facts: FeeFacts = {
  properties: [
    { id: 'a', name: 'A', address: '', feeType: 'percent', feePct: 6, flatMonthly: null, feeStartDate: null, mgmtStartDate: '2026-03-01', doors: 1, occupiedDoors: 1, occupiedRentMonthly: 2000, ownerSetKey: 'x' },
    { id: 'b', name: 'B', address: '', feeType: 'percent', feePct: 10, flatMonthly: null, feeStartDate: null, mgmtStartDate: '2019-03-01', doors: 1, occupiedDoors: 1, occupiedRentMonthly: 2000, ownerSetKey: 'y' },
  ],
  ownerSets: [
    { key: 'x', name: 'X', owners: [] },
    { key: 'y', name: 'Y', owners: [] },
  ],
};
const vols = { newLeases: 10, renewals: 5, vendorSpend: 1000, endedProperties: 0, activeProperties: 2, windowStart: '', windowEnd: '' };
const rows = buildOwnerRows({ facts, schedule: DEFAULT_DOOR_SCHEDULE, raiseFloor: DEFAULT_RAISE_FLOOR, weights: DEFAULT_WEIGHTS, agreements: [], campaign: [], today: '2026-09-25' });

describe('portfolio glue', () => {
  it('builds the volume context from facts + volumes', () => {
    const ctx = volumeContext(facts, vols, '2026-09-25');
    expect(ctx).toMatchObject({ newLeases: 10, renewals: 5, newProperties: 1, newOwners: 1, properties: 2, doors: 2, avgMonthlyRent: 2000 });
  });

  it('computes management scenarios', () => {
    const m = mgmtScenarios(rows);
    expect(m.current).toBeCloseTo(24000 * 0.06 + 24000 * 0.1);
    // x: 1 door → 10% schedule; first raise 6 → 7.5 (1.5 step)
    expect(m.firstRaise - m.current).toBeCloseTo(24000 * 0.015);
    expect(m.schedule - m.current).toBeCloseTo(24000 * 0.04);
  });

  it('gives fatigue only to owners whose fees rise', () => {
    const { fatigue } = portfolioFatigue(rows, DEFAULT_FEE_SCHEDULE, volumeContext(facts, vols, '2026-09-25'));
    const byKey = Object.fromEntries(fatigue.owners.map((o) => [o.key, o.fatigue]));
    expect(byKey.x).toBeGreaterThan(0);
    expect(byKey.y).toBe(0);
  });
});
