import { describe, it, expect } from 'vitest';
import {
  weekStartPacific,
  weeksBefore,
  extractMetricValue,
  isOnTrack,
  offTrackStreak,
} from '@/lib/eos/scorecard';

describe('weekStartPacific', () => {
  it('maps any weekday to that week\'s Monday (Pacific)', () => {
    // Fri Aug 7 2026 22:00 UTC = Fri 3 PM PT → Monday Aug 3
    expect(weekStartPacific(new Date('2026-08-07T22:00:00Z'))).toBe('2026-08-03');
    // Monday itself stays put
    expect(weekStartPacific(new Date('2026-08-03T18:00:00Z'))).toBe('2026-08-03');
    // Sunday belongs to the week started the previous Monday
    expect(weekStartPacific(new Date('2026-08-09T20:00:00Z'))).toBe('2026-08-03');
  });

  it('handles the UTC/Pacific date boundary', () => {
    // Mon Aug 3 2026 04:00 UTC = Sun Aug 2 9 PM PT → previous Monday July 27
    expect(weekStartPacific(new Date('2026-08-03T04:00:00Z'))).toBe('2026-07-27');
  });
});

describe('weeksBefore', () => {
  it('steps back whole weeks', () => {
    expect(weeksBefore('2026-08-03', 1)).toBe('2026-07-27');
    expect(weeksBefore('2026-08-03', 4)).toBe('2026-07-06');
  });
});

describe('extractMetricValue', () => {
  const metrics = new Map([
    ['open_exceptions', { value: { total: 187, needsDateCount: 12 } }],
    ['turns', { value: { openTurns: null } }],
  ]);
  it('reads metric.field', () => {
    expect(extractMetricValue(metrics, 'open_exceptions.total')).toBe(187);
  });
  it('returns null for missing metric, field, or non-numeric', () => {
    expect(extractMetricValue(metrics, 'nope.total')).toBeNull();
    expect(extractMetricValue(metrics, 'open_exceptions.nope')).toBeNull();
    expect(extractMetricValue(metrics, 'turns.openTurns')).toBeNull();
    expect(extractMetricValue(metrics, 'noDot')).toBeNull();
  });
});

describe('isOnTrack', () => {
  it('evaluates gte/lte and nulls', () => {
    expect(isOnTrack('lte', 150, 149)).toBe(true);
    expect(isOnTrack('lte', 150, 151)).toBe(false);
    expect(isOnTrack('gte', 25, 25)).toBe(true);
    expect(isOnTrack('gte', 25, 24)).toBe(false);
    expect(isOnTrack('lte', 150, null)).toBeNull();
    expect(isOnTrack('lte', null, 10)).toBeNull();
  });
});

describe('offTrackStreak', () => {
  it('counts consecutive misses from the front, null breaks', () => {
    expect(offTrackStreak([{ on_track: false }, { on_track: false }, { on_track: true }])).toBe(2);
    expect(offTrackStreak([{ on_track: true }, { on_track: false }])).toBe(0);
    expect(offTrackStreak([{ on_track: false }, { on_track: null }, { on_track: false }])).toBe(1);
    expect(offTrackStreak([])).toBe(0);
  });
});
