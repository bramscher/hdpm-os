import { describe, expect, it } from 'vitest';
import { doorSnapshotProblem } from '../door-snapshot-guard';

describe('doorSnapshotProblem', () => {
  it('accepts normal day-to-day movement and the first snapshot', () => {
    expect(doorSnapshotProblem(1100, 1097)).toBeNull();
    expect(doorSnapshotProblem(1100, 1112)).toBeNull();
    expect(doorSnapshotProblem(null, 1100)).toBeNull();
  });

  it('rejects zero, missing and non-numeric counts', () => {
    expect(doorSnapshotProblem(1100, 0)).toMatch(/not a positive number/);
    expect(doorSnapshotProblem(1100, undefined)).toMatch(/not a positive number/);
    expect(doorSnapshotProblem(null, NaN)).toMatch(/not a positive number/);
  });

  it('rejects a sudden drop over 10% or rise over 25%', () => {
    expect(doorSnapshotProblem(1100, 640)).toMatch(/1100 → 640/);
    expect(doorSnapshotProblem(1100, 1400)).toMatch(/1100 → 1400/);
    expect(doorSnapshotProblem(1100, 990)).toBeNull(); // exactly −10%
  });
});
