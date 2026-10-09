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

  it('rejects a sudden drop or rise over 5%', () => {
    expect(doorSnapshotProblem(1100, 640)).toMatch(/1100 → 640/);
    expect(doorSnapshotProblem(829, 890)).toMatch(/829 → 890/); // the 2026-08-20 bad read
    expect(doorSnapshotProblem(1000, 950)).toBeNull(); // exactly −5%
    expect(doorSnapshotProblem(1000, 1050)).toBeNull(); // exactly +5%
  });
});
