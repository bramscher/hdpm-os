import { describe, it, expect } from 'vitest';
import { DEFAULT_DOOR_SCHEDULE, DEFAULT_RAISE_FLOOR, DEFAULT_WEIGHTS, buildOwnerRows, type FeeFacts, type PropertyFact } from '../model';
import { bandImpacts, scheduleError } from '../proposed-structure';

const prop = (over: Partial<PropertyFact>): PropertyFact => ({
  id: 'p', name: 'P', address: '', feeType: 'percent', feePct: 8, flatMonthly: null,
  feeStartDate: null, mgmtStartDate: '2020-03-15', doors: 1, occupiedDoors: 1,
  occupiedRentMonthly: 2000, ownerSetKey: 'o1', ...over,
});
const facts = (properties: PropertyFact[]): FeeFacts => ({
  properties,
  ownerSets: [...new Set(properties.map((p) => p.ownerSetKey))].map((key) => ({
    key, name: key.toUpperCase(), owners: [{ id: key, name: key, email: `${key}@x.com`, phone: null, percentOwned: 100 }],
  })),
});
const rows = (properties: PropertyFact[]) =>
  buildOwnerRows({ facts: facts(properties), schedule: DEFAULT_DOOR_SCHEDULE, raiseFloor: DEFAULT_RAISE_FLOOR, weights: DEFAULT_WEIGHTS, agreements: [], campaign: [], today: '2026-10-06' });

describe('proposed structure, fully implemented', () => {
  it('moves every owner to their band rate and never lowers a fee', () => {
    const r = rows([
      prop({ id: 'a', ownerSetKey: 'below', feePct: 8 }), // 1 door, band 10% → +2 pts of $24k
      prop({ id: 'b', ownerSetKey: 'above', feePct: 12 }), // 1 door, above 10% → unchanged
    ]);
    const { bands, total } = bandImpacts(r, DEFAULT_DOOR_SCHEDULE);
    const one = bands.find((b) => b.band?.minDoors === 1)!;
    expect(one.owners).toBe(2);
    expect(one.ownersRaised).toBe(1);
    expect(one.currentYearly).toBeCloseTo(24_000 * 0.08 + 24_000 * 0.12);
    expect(one.deltaYearly).toBeCloseTo(24_000 * 0.02);
    expect(one.fullYearly).toBeCloseTo(one.currentYearly + one.deltaYearly);
    expect(one.targetPct).toBe(10);
    expect(total.deltaYearly).toBeCloseTo(one.deltaYearly);
    expect(bands).toHaveLength(DEFAULT_DOOR_SCHEDULE.length);
  });
  it('validates edited bands', () => {
    expect(scheduleError(DEFAULT_DOOR_SCHEDULE)).toBeNull();
    expect(scheduleError([{ minDoors: 2, maxDoors: null, targetPct: 9, maxRaisePts: 1 }])).toMatch(/start at 1/);
    expect(scheduleError([{ minDoors: 1, maxDoors: 3, targetPct: 9, maxRaisePts: 1 }, { minDoors: 5, maxDoors: null, targetPct: 8, maxRaisePts: 1 }])).toMatch(/Gap or overlap/);
    expect(scheduleError([{ minDoors: 1, maxDoors: null, targetPct: 9, maxRaisePts: 1 }, { minDoors: 2, maxDoors: null, targetPct: 8, maxRaisePts: 1 }])).toMatch(/open-ended/);
    expect(scheduleError([{ minDoors: 1, maxDoors: null, targetPct: 0, maxRaisePts: 1 }])).toMatch(/Fee %/);
  });
});
