import { describe, it, expect } from 'vitest';
import { toWeeklyGuestCards, websiteLeadsInWeek } from '../guest-card-trend';

const pt = (date: string, thisWeek: number, window?: string) => ({
  date,
  value: window ? { thisWeek, window } : { thisWeek },
});

describe('toWeeklyGuestCards', () => {
  it('keeps one weekly backfill row per week', () => {
    const rows = [pt('2026-07-13', 60), pt('2026-07-20', 55), pt('2026-07-27', 58)];
    expect(toWeeklyGuestCards(rows)).toEqual(rows);
  });

  it('uses the Sunday row for a week-to-date week, not the Monday dip', () => {
    // Week of Mon 2026-08-10 .. Sun 2026-08-16, legacy week-to-date rows
    const rows = [
      pt('2026-08-10', 4), pt('2026-08-11', 20), pt('2026-08-14', 61), pt('2026-08-16', 84),
      pt('2026-08-17', 3), // next Monday
    ];
    const weekly = toWeeklyGuestCards(rows);
    expect(weekly.map((p) => p.value.thisWeek)).toEqual([84, 3]);
  });

  it('prefers a trailing backfill row over a partial week-to-date row in the same week', () => {
    // Backfill Monday 2026-07-27 + cron Tuesday 2026-07-28 (week-to-date, 2 days)
    const weekly = toWeeklyGuestCards([pt('2026-07-27', 58), pt('2026-07-28', 9)]);
    expect(weekly.map((p) => p.value.thisWeek)).toEqual([58]);
  });

  it('takes the latest trailing row once snapshots carry the trailing window', () => {
    const weekly = toWeeklyGuestCards([
      pt('2026-10-12', 70, 'trailing_7d'),
      pt('2026-10-14', 75, 'trailing_7d'),
    ]);
    expect(weekly.map((p) => p.value.thisWeek)).toEqual([75]);
  });
});

describe('websiteLeadsInWeek', () => {
  it('sums the 7 days ending on the date', () => {
    const daily = new Map([
      ['2026-10-02', 9], // outside
      ['2026-10-03', 1],
      ['2026-10-06', 2],
      ['2026-10-09', 3],
      ['2026-10-10', 9], // outside
    ]);
    expect(websiteLeadsInWeek('2026-10-09', daily)).toBe(6);
  });
});
