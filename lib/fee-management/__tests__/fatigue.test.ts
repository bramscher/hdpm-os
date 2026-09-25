import { describe, it, expect } from 'vitest';
import { DEFAULT_FATIGUE, computeFatigue, fatigueFor, parseFatigue } from '../fatigue';

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
    { key: 'a', name: 'A', doors: 10, currentYearly: 10_000, proposedYearly: 12_500 }, // +25% → 50 (+10 new fee) = 60
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
    expect(r.expectedDoorsLost).toBeCloseTo(0.9);
  });

  it('reports revenue per door, doors needed for today’s revenue, and break-even doors', () => {
    const r = computeFatigue(owners, 1, DEFAULT_FATIGUE);
    expect(r.revPerDoorNow).toBeCloseTo(11_000 / 11);
    // after: (13,500 − 1,125) / (11 − 0.9)
    expect(r.revPerDoorAfter).toBeCloseTo(12_375 / 10.1);
    expect(r.doorsForTodaysRevenue).toBeCloseTo(11_000 / (12_375 / 10.1));
    // break-even: 2,500 gain ÷ (13,500 / 11) per door
    expect(r.breakEvenDoors).toBeCloseTo(2_500 / (13_500 / 11));
    expect(r.bands.find((b) => b.label === 'High')!.owners).toBe(1);
  });

  it('never assigns fatigue to owners whose fees do not rise', () => {
    const r = computeFatigue([{ key: 'c', name: 'C', doors: 2, currentYearly: 5_000, proposedYearly: 4_000 }], 3, DEFAULT_FATIGUE);
    expect(r.owners[0].fatigue).toBe(0);
    expect(r.expectedLoss).toBe(0);
  });
});

describe('parseFatigue', () => {
  it('validates ranges', () => {
    expect(parseFatigue(DEFAULT_FATIGUE)).toEqual(DEFAULT_FATIGUE);
    expect(parseFatigue({ ...DEFAULT_FATIGUE, fullFatigueAtPct: 0 })).toBeNull();
    expect(parseFatigue({ ...DEFAULT_FATIGUE, maxAddedChurnPts: -1 })).toBeNull();
  });
});
