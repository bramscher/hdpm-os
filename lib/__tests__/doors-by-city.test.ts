import { describe, it, expect } from 'vitest';
import { tallyDoorsByCity } from '../doors-by-city';

describe('tallyDoorsByCity', () => {
  it('counts one door per unit and merges whitespace/case variants', () => {
    const rows = tallyDoorsByCity([
      { city: 'Bend' },
      { city: 'Bend ' },
      { city: 'bend' },
      { city: 'Redmond' },
    ]);
    expect(rows).toEqual([
      { city: 'Bend', doors: 3, leaving: 0 },
      { city: 'Redmond', doors: 1, leaving: 0 },
    ]);
  });

  it('weights by door count and keeps leaving doors separate', () => {
    const rows = tallyDoorsByCity([
      { city: 'Madras', doors: 4 },
      { city: 'Madras', doors: 2, leaving: true },
      { city: 'Sisters', doors: 5 },
    ]);
    expect(rows).toEqual([
      { city: 'Madras', doors: 4, leaving: 2 },
      { city: 'Sisters', doors: 5, leaving: 0 },
    ]);
  });

  it('labels blank cities Unknown and breaks ties by name', () => {
    const rows = tallyDoorsByCity([{ city: 'Culver' }, { city: '  ' }, { city: null }, { city: 'Alfalfa' }]);
    expect(rows.map((r) => r.city)).toEqual(['Unknown', 'Alfalfa', 'Culver']);
    expect(rows[0].doors).toBe(2);
  });
});
