import { describe, it, expect } from 'vitest';
import type { WatcherRule, WatcherSubject } from '../engine';
import { countEpisodes, evaluateRule, evaluateWatchers, watcherSignal } from '../engine';

function rule(overrides: Partial<WatcherRule> = {}): WatcherRule {
  return { id: 'r1', org_id: 'o', name: 'Rule', kind: 'aged', params: {}, severity: 'soon', active: true, ...overrides };
}
function subject(overrides: Partial<WatcherSubject> = {}): WatcherSubject {
  return { jacket_id: 'j1', current_seat_id: 'seat-a', age_days: 0, waiting_external_days: null, episode_dates: [], ...overrides };
}

describe('countEpisodes', () => {
  it('treats a near-consecutive run as one episode', () => {
    expect(countEpisodes(['2026-08-01', '2026-08-02', '2026-08-03'])).toBe(1);
  });
  it('counts a gap beyond the threshold as a new episode', () => {
    expect(countEpisodes(['2026-08-01', '2026-08-10', '2026-08-11'])).toBe(2);
  });
  it('is zero for no dates and dedupes', () => {
    expect(countEpisodes([])).toBe(0);
    expect(countEpisodes(['2026-08-01', '2026-08-01'])).toBe(1);
  });
});

describe('evaluateRule', () => {
  it('aged fires at/above the day threshold', () => {
    expect(evaluateRule(rule({ kind: 'aged', params: { days: 21 } }), subject({ age_days: 21 }))).not.toBeNull();
    expect(evaluateRule(rule({ kind: 'aged', params: { days: 21 } }), subject({ age_days: 20 }))).toBeNull();
  });
  it('recurring fires on enough episodes', () => {
    const r = rule({ kind: 'recurring', params: { episodes: 3 } });
    const dates = ['2026-08-01', '2026-08-10', '2026-08-20'];
    expect(evaluateRule(r, subject({ episode_dates: dates }))).not.toBeNull();
    expect(evaluateRule(r, subject({ episode_dates: ['2026-08-01'] }))).toBeNull();
  });
  it('no_owner fires when no seat holds the jacket', () => {
    expect(evaluateRule(rule({ kind: 'no_owner' }), subject({ current_seat_id: null }))).not.toBeNull();
    expect(evaluateRule(rule({ kind: 'no_owner' }), subject({ current_seat_id: 'seat-a' }))).toBeNull();
  });
  it('waiting_external fires past the day threshold, ignores null waits', () => {
    const r = rule({ kind: 'waiting_external', params: { days: 3 } });
    expect(evaluateRule(r, subject({ waiting_external_days: 3 }))).not.toBeNull();
    expect(evaluateRule(r, subject({ waiting_external_days: 2 }))).toBeNull();
    expect(evaluateRule(r, subject({ waiting_external_days: null }))).toBeNull();
  });
  it('inactive rules never fire', () => {
    expect(evaluateRule(rule({ active: false, params: { days: 0 } }), subject({ age_days: 100 }))).toBeNull();
  });
  it('carries the rule severity onto the hit', () => {
    const hit = evaluateRule(rule({ kind: 'no_owner', severity: 'now' }), subject({ current_seat_id: null }));
    expect(hit?.severity).toBe('now');
  });
});

describe('evaluateWatchers + watcherSignal', () => {
  it('collects hits across rules and subjects', () => {
    const rules = [rule({ id: 'aged', kind: 'aged', params: { days: 10 } }), rule({ id: 'noown', kind: 'no_owner', severity: 'now' })];
    const subjects = [subject({ jacket_id: 'j1', age_days: 15 }), subject({ jacket_id: 'j2', current_seat_id: null })];
    const hits = evaluateWatchers(rules, subjects);
    expect(hits).toHaveLength(2);
    expect(watcherSignal(hits.filter((h) => h.jacket_id === 'j2'))).toEqual({ now: true, soon: false });
    expect(watcherSignal(hits.filter((h) => h.jacket_id === 'j1'))).toEqual({ now: false, soon: true });
  });
});
