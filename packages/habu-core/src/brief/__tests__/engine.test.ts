import { describe, it, expect } from 'vitest';
import type { BriefItem, BriefDecision } from '../engine';
import {
  rankBriefItems,
  buildBriefExclusions,
  applyBriefExclusions,
  buildBrief,
  briefHeadline,
  BRIEF_CAP,
} from '../engine';

function item(overrides: Partial<BriefItem> = {}): BriefItem {
  return { id: 'j1', seat_id: 'seat-1', title: 'Jacket', attention: 'now', ...overrides };
}

describe('rankBriefItems', () => {
  it('orders now > soon > none, then severity, then age', () => {
    const items = [
      item({ id: 'a', attention: 'none' }),
      item({ id: 'b', attention: 'now', severity: 5 }),
      item({ id: 'c', attention: 'now', severity: 1 }),
      item({ id: 'd', attention: 'soon' }),
      item({ id: 'e', attention: 'now', severity: 1, age_days: 10 }),
    ];
    expect(rankBriefItems(items).map((i) => i.id)).toEqual(['e', 'c', 'b', 'd', 'a']);
  });
  it('is stable by id on full ties', () => {
    const items = [item({ id: 'z' }), item({ id: 'a' })];
    expect(rankBriefItems(items).map((i) => i.id)).toEqual(['a', 'z']);
  });
});

describe('cool-off exclusions', () => {
  it('suppresses a done item inside its business-day window', () => {
    // 2026-08-11 Tue, decided; +3bd = Fri 2026-08-14.
    const prior: BriefDecision[] = [
      { subject_key: 'j1', status: 'approved', decidedAt: '2026-08-11T17:00:00Z', resolution: 'Done by alice' },
    ];
    const exc = buildBriefExclusions(prior);
    expect(exc.get('j1')?.until).toBe('2026-08-14');
    // inside window: suppressed
    expect(applyBriefExclusions([item()], exc, '2026-08-12')).toEqual([]);
  });

  it('resurfaces a still-open done item after the window, tagged honestly', () => {
    const prior: BriefDecision[] = [
      { subject_key: 'j1', status: 'approved', decidedAt: '2026-08-11T17:00:00Z', resolution: 'Done by alice' },
    ];
    const exc = buildBriefExclusions(prior);
    const out = applyBriefExclusions([item({ title: 'Move-out #4' })], exc, '2026-08-14');
    expect(out).toHaveLength(1);
    expect(out[0].title).toContain('marked done 2026-08-11 — still unresolved');
  });

  it('snooze suppresses until its date', () => {
    const prior: BriefDecision[] = [
      { subject_key: 'j1', status: 'edited', decidedAt: '2026-08-11T17:00:00Z', snoozedTo: '2026-08-20' },
    ];
    const exc = buildBriefExclusions(prior);
    expect(exc.get('j1')?.until).toBe('2026-08-20');
    expect(applyBriefExclusions([item()], exc, '2026-08-19')).toEqual([]);
    expect(applyBriefExclusions([item()], exc, '2026-08-20')).toHaveLength(1);
  });

  it('ignores non-approved/edited decisions', () => {
    const prior: BriefDecision[] = [
      { subject_key: 'j1', status: 'rejected', decidedAt: '2026-08-11T17:00:00Z' },
    ];
    expect(buildBriefExclusions(prior).size).toBe(0);
  });
});

describe('buildBrief', () => {
  it('caps items at 7 but keeps the header totals honest', () => {
    const items = Array.from({ length: 12 }, (_, i) =>
      item({ id: `j${i}`, attention: i < 9 ? 'now' : 'soon', severity: i })
    );
    const brief = buildBrief({
      seat_id: 'seat-1',
      items,
      boardTotals: { total: 54, agent_handled: 47, waiting: 6 },
      today: '2026-08-11',
    });
    expect(brief.items).toHaveLength(BRIEF_CAP);
    expect(brief.header.total).toBe(54);
    expect(brief.header.agent_handled).toBe(47);
    expect(brief.header.needs_you).toBe(12); // actionable count is NOT capped
  });

  it('needs_you counts only actionable items after cool-off', () => {
    const items = [
      item({ id: 'a', attention: 'now' }),
      item({ id: 'b', attention: 'none' }),
    ];
    const brief = buildBrief({
      seat_id: 'seat-1',
      items,
      boardTotals: { total: 2, agent_handled: 0, waiting: 0 },
      today: '2026-08-11',
    });
    expect(brief.header.needs_you).toBe(1);
  });

  it('headline reads clean when nothing needs you', () => {
    expect(briefHeadline({ total: 10, agent_handled: 10, waiting: 0, needs_you: 0 })).toContain('clean board');
    expect(briefHeadline({ total: 10, agent_handled: 8, waiting: 1, needs_you: 1 })).toContain('1 needs you');
  });
});
