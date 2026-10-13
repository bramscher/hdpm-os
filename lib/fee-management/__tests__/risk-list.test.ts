import { describe, it, expect } from 'vitest';
import { buildOwnerRows, DEFAULT_DOOR_SCHEDULE, DEFAULT_RAISE_FLOOR, DEFAULT_WEIGHTS, type FeeFacts } from '../model';
import { DEFAULT_FEE_SCHEDULE } from '../fee-schedule';
import { portfolioFatigue, volumeContext } from '../portfolio';
import { feeRiskList } from '../risk-list';
import type { FeeInputs } from '../inputs';

const prop = (id: string, set: string, doors: number, feePct: number) => ({
  id, name: id, address: '', feeType: 'percent' as const, feePct, flatMonthly: null, feeStartDate: null,
  mgmtStartDate: '2019-03-01', doors, occupiedDoors: doors, occupiedRentMonthly: 2000 * doors, ownerSetKey: set,
});
const owner = (id: string) => ({ id, name: `Owner ${id}`, email: null, phone: null, percentOwned: null });

// A large low-fee owner (20 doors at 5%), a small low-fee co-owned set, and one already at schedule.
const facts: FeeFacts = {
  properties: [prop('a', 'big', 20, 5), prop('b', '1+2', 1, 6), prop('c', 'ok', 1, 10)],
  ownerSets: [
    { key: 'big', name: 'Big Holdings', owners: [owner('big')] },
    { key: '1+2', name: 'Pat & Sam', owners: [owner('1'), owner('2')] },
    { key: 'ok', name: 'At Schedule', owners: [owner('ok')] },
  ],
};
const vols = { newLeases: 10, renewals: 5, vendorSpend: 1000, endedProperties: 0, activeProperties: 3, windowStart: '', windowEnd: '' };
const today = '2026-10-13';
const inputs: FeeInputs = {
  facts, capturedAt: '', schedule: DEFAULT_DOOR_SCHEDULE, raiseFloor: DEFAULT_RAISE_FLOOR, feeSchedule: DEFAULT_FEE_SCHEDULE,
  weights: DEFAULT_WEIGHTS, agreements: [], campaign: [],
};

describe('fee change risk list', () => {
  const list = feeRiskList(inputs, vols, today);
  const rows = buildOwnerRows({ ...inputs, today });
  const { fatigue } = portfolioFatigue(rows, DEFAULT_FEE_SCHEDULE, volumeContext(facts, vols, today));

  it('matches the Fee Schedule tab: same large owners and most-at-risk order', () => {
    expect(list.large.owners.map((o) => o.key)).toEqual(fatigue.large.owners.map((o) => o.key));
    expect(list.mostAtRisk.map((o) => o.key)).toEqual(fatigue.owners.slice(0, 10).map((o) => o.key));
    expect(list.large.feesAtStake).toBeCloseTo(fatigue.large.feesAtStake);
  });

  it('flags the 20-door owner as large-owner exposure', () => {
    expect(list.threshold).toBe(16);
    expect(list.large.owners.map((o) => o.key)).toEqual(['big']);
  });

  it('carries the AppFolio owner ids so Knowledge Capture can link each person', () => {
    expect(list.mostAtRisk.find((o) => o.key === '1+2')?.ownerIds).toEqual(['1', '2']);
  });
});
