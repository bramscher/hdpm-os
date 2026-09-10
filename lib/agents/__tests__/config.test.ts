import { describe, it, expect } from 'vitest';
import type { AgentConfigRow } from '../types';
import { effectiveLevel, maxPromotableLevel, isWithinQuietHours } from '../config';

function row(overrides: Partial<AgentConfigRow> = {}): AgentConfigRow {
  return {
    agent: 'estimate_chaser',
    action_type: 'vendor_chase',
    autonomy_level: 1,
    ceiling_level: 3,
    max_per_day: 10,
    quiet_hours: null,
    owner_role: 'Cheryl',
    enabled: true,
    slack_recipients: null,
    updated_at: '2026-07-19T00:00:00Z',
    ...overrides,
  };
}

describe('effectiveLevel', () => {
  it('missing config → L0 (observe only)', () => {
    expect(effectiveLevel(null)).toBe(0);
  });

  it('disabled row → L0', () => {
    expect(effectiveLevel(row({ enabled: false, autonomy_level: 3 }))).toBe(0);
  });

  it('enabled row → its level', () => {
    expect(effectiveLevel(row({ autonomy_level: 2 }))).toBe(2);
  });
});

describe('maxPromotableLevel', () => {
  it('promotes one level when under the ceiling', () => {
    expect(maxPromotableLevel(row({ autonomy_level: 1, ceiling_level: 3 }))).toBe(2);
  });

  it('never exceeds the ceiling', () => {
    expect(maxPromotableLevel(row({ autonomy_level: 2, ceiling_level: 2 }))).toBe(2);
    expect(maxPromotableLevel(row({ autonomy_level: 3, ceiling_level: 3 }))).toBe(3);
  });
});

describe('isWithinQuietHours', () => {
  const at = (h: number, m = 0) => {
    const d = new Date(2026, 6, 19);
    d.setHours(h, m, 0, 0);
    return d;
  };

  it('null quiet_hours → never quiet', () => {
    expect(isWithinQuietHours(row(), at(3))).toBe(false);
  });

  it('same-day range', () => {
    const r = row({ quiet_hours: '12:00-13:00' });
    expect(isWithinQuietHours(r, at(12, 30))).toBe(true);
    expect(isWithinQuietHours(r, at(13, 0))).toBe(false);
    expect(isWithinQuietHours(r, at(11, 59))).toBe(false);
  });

  it('midnight-wrapping range', () => {
    const r = row({ quiet_hours: '21:00-07:00' });
    expect(isWithinQuietHours(r, at(23))).toBe(true);
    expect(isWithinQuietHours(r, at(3))).toBe(true);
    expect(isWithinQuietHours(r, at(12))).toBe(false);
  });

  it('unparseable → never quiet', () => {
    expect(isWithinQuietHours(row({ quiet_hours: 'night' }), at(3))).toBe(false);
  });
});
