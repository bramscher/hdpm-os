import { describe, it, expect } from 'vitest';
import { computeDoorMovement } from '../door-movement';

describe('computeDoorMovement', () => {
  it('counts a departed property as lost', () => {
    const r = computeDoorMovement({ A: 4, B: 2 }, { A: 4, B: 2, C: 3 });
    expect(r.lost).toBe(3);
    expect(r.gained).toBe(0);
    expect(r.net).toBe(-3);
    expect(r.baselineDoors).toBe(9);
    expect(r.currentDoors).toBe(6);
    expect(r.churnPct).toBe(33.3); // 3/9
  });

  it('counts a new property as gained', () => {
    const r = computeDoorMovement({ A: 4, B: 2, D: 5 }, { A: 4, B: 2 });
    expect(r.gained).toBe(5);
    expect(r.lost).toBe(0);
    expect(r.net).toBe(5);
    expect(r.churnPct).toBe(0);
  });

  it('splits gained and lost when both happen in the same period', () => {
    // C leaves (-3), D joins (+5), A grows by 1 (+1), B shrinks by 1 (-1)
    const r = computeDoorMovement({ A: 5, B: 1, D: 5 }, { A: 4, B: 2, C: 3 });
    expect(r.gained).toBe(6); // +1 (A) +5 (D)
    expect(r.lost).toBe(4); //  -1 (B) -3 (C)
    expect(r.net).toBe(2);
    // invariant: net === currentDoors − baselineDoors
    expect(r.net).toBe(r.currentDoors - r.baselineDoors);
    expect(r.churnPct).toBe(44.4); // 4/9
  });

  it('handles a unit-count change within one property (partial)', () => {
    const r = computeDoorMovement({ A: 6 }, { A: 4 });
    expect(r.gained).toBe(2);
    expect(r.lost).toBe(0);
    expect(r.net).toBe(2);
  });

  it('net always equals currentDoors − baselineDoors (invariant)', () => {
    const cur = { A: 10, B: 0, E: 7 };
    const base = { A: 3, C: 4, D: 9 };
    const r = computeDoorMovement(cur, base);
    expect(r.net).toBe(r.currentDoors - r.baselineDoors);
    expect(r.gained - r.lost).toBe(r.net);
  });

  it('churnPct is null when baseline is empty (no divide-by-zero)', () => {
    const r = computeDoorMovement({ A: 4 }, {});
    expect(r.baselineDoors).toBe(0);
    expect(r.churnPct).toBeNull();
    expect(r.gained).toBe(4);
  });
});
