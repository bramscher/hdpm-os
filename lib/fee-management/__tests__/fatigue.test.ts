import { describe, it, expect } from 'vitest';
import { DEFAULT_FATIGUE, computeFatigue, fatigueFor, parseFatigue, sizeMultiplier } from '../fatigue';

describe('fatigueFor', () => {
  it('scales with the % increase and adds points per new fee type, capped at 100', () => {
    expect(fatigueFor(25, 0, DEFAULT_FATIGUE)).toBe(50); // half of the 50% full-fatigue point
    expect(fatigueFor(25, 2, DEFAULT_FATIGUE)).toBe(70);
    expect(fatigueFor(80, 3, DEFAULT_FATIGUE)).toBe(100);
    expect(fatigueFor(0, 0, DEFAULT_FATIGUE)).toBe(0);
  });
});

describe('computeFatigue', () => {
  const owners = [
    { key: 'a', name: 'A', doors: 3, currentYearly: 10_000, proposedYearly: 12_500 }, // +25% → 50 (+10 new fee) = 60; 1× size
    { key: 'b', name: 'B', doors: 1, currentYearly: 1_000, proposedYearly: 1_000 }, // unchanged → 0
  ];

  it('offsets the gross gain by expected lost fees', () => {
    const r = computeFatigue(owners, 1, DEFAULT_FATIGUE);
    const a = r.owners.find((o) => o.key === 'a')!;
    expect(a.fatigue).toBe(60);
    expect(a.addedChurn).toBeCloseTo(0.09); // 60% of 15 pts
    expect(a.expectedLoss).toBeCloseTo(1_125); // 9% × 12,500
    expect(r.owners.find((o) => o.key === 'b')!.fatigue).toBe(0);
    expect(r.grossGain).toBe(2_500);
    expect(r.netGain).toBeCloseTo(1_375);
    expect(r.expectedDoorsLost).toBeCloseTo(0.27);
  });

  it('reports revenue per door, doors needed for today’s revenue, and break-even doors', () => {
    const r = computeFatigue(owners, 1, DEFAULT_FATIGUE);
    expect(r.revPerDoorNow).toBeCloseTo(11_000 / 4);
    // after: (13,500 − 1,125) / (4 − 0.27)
    expect(r.revPerDoorAfter).toBeCloseTo(12_375 / 3.73);
    expect(r.doorsForTodaysRevenue).toBeCloseTo(11_000 / (12_375 / 3.73));
    // break-even: 2,500 gain ÷ (13,500 / 4) per door
    expect(r.breakEvenDoors).toBeCloseTo(2_500 / (13_500 / 4));
    expect(r.bands.find((b) => b.label === 'High')!.owners).toBe(1);
  });

  it('never assigns fatigue to owners whose fees do not rise', () => {
    const r = computeFatigue([{ key: 'c', name: 'C', doors: 2, currentYearly: 5_000, proposedYearly: 4_000 }], 3, DEFAULT_FATIGUE);
    expect(r.owners[0].fatigue).toBe(0);
    expect(r.expectedLoss).toBe(0);
  });
});

describe('large owners', () => {
  it('scales churn sensitivity by owner size', () => {
    expect([sizeMultiplier(1, DEFAULT_FATIGUE), sizeMultiplier(4, DEFAULT_FATIGUE), sizeMultiplier(15, DEFAULT_FATIGUE), sizeMultiplier(31, DEFAULT_FATIGUE)]).toEqual([1, 1.25, 1.25, 1.5]);
    const r = computeFatigue(
      [
        { key: 'small', name: 'S', doors: 1, currentYearly: 1_000, proposedYearly: 1_250 },
        { key: 'big', name: 'B', doors: 20, currentYearly: 20_000, proposedYearly: 25_000 },
      ],
      0,
      DEFAULT_FATIGUE
    );
    const by = Object.fromEntries(r.owners.map((o) => [o.key, o]));
    expect(by.small.fatigue).toBe(by.big.fatigue); // same +25%
    expect(by.big.addedChurn).toBeCloseTo(by.small.addedChurn * 1.5);
  });

  it('stress-tests the large owners: all-or-nothing instead of expected value', () => {
    const r = computeFatigue(
      [
        { key: 'small', name: 'S', doors: 1, currentYearly: 1_000, proposedYearly: 1_250 },
        { key: 'big', name: 'B', doors: 20, currentYearly: 20_000, proposedYearly: 25_000 },
      ],
      0,
      DEFAULT_FATIGUE
    );
    const big = r.owners.find((o) => o.key === 'big')!;
    expect(r.large.owners.map((o) => o.key)).toEqual(['big']);
    expect(r.large.feesAtStake).toBe(25_000);
    expect(r.large.doorsAtStake).toBe(20);
    // losing the big owner for certain: net − (full fees − expected already counted)
    expect(r.large.netIfLargestLeaves).toBeCloseTo(r.netGain - (25_000 - big.expectedLoss));
    expect(r.large.netIfLargestLeaves!).toBeLessThan(0);
  });
});

describe('parseFatigue', () => {
  it('validates ranges and fills defaults for older configs', () => {
    expect(parseFatigue(DEFAULT_FATIGUE)).toEqual(DEFAULT_FATIGUE);
    expect(parseFatigue({ fullFatigueAtPct: 50, pointsPerNewFee: 10, maxAddedChurnPts: 15 })).toEqual(DEFAULT_FATIGUE);
    expect(parseFatigue({ ...DEFAULT_FATIGUE, sizeMultipliers: [{ minDoors: 0, multiplier: 1 }] })).toBeNull();
    expect(parseFatigue({ ...DEFAULT_FATIGUE, fullFatigueAtPct: 0 })).toBeNull();
    expect(parseFatigue({ ...DEFAULT_FATIGUE, maxAddedChurnPts: -1 })).toBeNull();
  });
});
