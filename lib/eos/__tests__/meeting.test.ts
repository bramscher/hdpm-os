import { describe, it, expect } from 'vitest';
import {
  buildAgenda,
  defaultL10StartsAt,
  isConcluded,
  validateSolveOutcome,
  decisionSourceKey,
  minutesSourceKey,
  buildPrepPacket,
  L10_AGENDA,
  HUDDLE_AGENDA,
} from '@/lib/eos/meeting';

describe('buildAgenda', () => {
  it('maps kinds to agendas; L10 is the 90-minute default', () => {
    expect(buildAgenda('L10')).toBe(L10_AGENDA);
    expect(buildAgenda('huddle')).toBe(HUDDLE_AGENDA);
    expect(buildAgenda('quarterly')).toBe(L10_AGENDA);
    expect(L10_AGENDA.reduce((s, x) => s + x.minutes, 0)).toBe(90);
    expect(L10_AGENDA.map((s) => s.kind)).toEqual([
      'segue', 'scorecard', 'rock_review', 'headline', 'todo_review', 'ids', 'conclude',
    ]);
  });
});

describe('defaultL10StartsAt / isConcluded', () => {
  it('anchors the meeting on Monday 17:00 UTC', () => {
    expect(defaultL10StartsAt('2026-08-10')).toBe('2026-08-10T17:00:00Z');
  });
  it('concluded = minutes or rating recorded', () => {
    expect(isConcluded({ minutes_md: null, rating: null })).toBe(false);
    expect(isConcluded({ minutes_md: '## Notes', rating: null })).toBe(true);
    expect(isConcluded({ minutes_md: null, rating: 8 })).toBe(true);
  });
});

describe('validateSolveOutcome', () => {
  it('rejects empty outcomes', () => {
    expect(validateSolveOutcome({})).toMatch(/requires an outcome/);
    expect(validateSolveOutcome({ todos: [{ title: '  ' }] })).toMatch(/requires an outcome/);
  });
  it('rejects a half-filled decision', () => {
    expect(validateSolveOutcome({ decision: { title: 'X', statementMd: ' ' } })).toMatch(/title and a statement/);
  });
  it('accepts a decision, a todo, or both', () => {
    expect(validateSolveOutcome({ decision: { title: 'X', statementMd: 'We will…' } })).toBeNull();
    expect(validateSolveOutcome({ todos: [{ title: 'Call the owner' }] })).toBeNull();
    expect(
      validateSolveOutcome({
        decision: { title: 'X', statementMd: 'Y' },
        todos: [{ title: 'Z' }],
      })
    ).toBeNull();
  });
});

describe('source keys', () => {
  it('are stable and prefixed', () => {
    expect(decisionSourceKey('abc')).toBe('decision:abc');
    expect(minutesSourceKey('m1', 2)).toBe('meeting:m1#2');
  });
});

describe('buildPrepPacket', () => {
  it('renders all sections with deltas, flags, and streaks', () => {
    const md = buildPrepPacket({
      weekStart: '2026-08-10',
      metrics: [
        { name: 'Open exceptions', unit: null, goalOp: 'lte', goalValue: 150, ownerPerson: 'Brody', current: 187, prior: 190, onTrack: false, offTrackStreak: 3 },
        { name: 'Move-ins', unit: 'units', goalOp: 'gte', goalValue: 4, ownerPerson: null, current: 5, prior: 5, onTrack: true, offTrackStreak: 0 },
      ],
      issues: [{ title: 'Firkus estimates stuck', priority: 2, ageDays: 12, raisedBy: 'agent:estimate_chaser' }],
      openIssueCount: 7,
      todoStats: { due: 10, done: 9 },
      recentDecisions: [{ title: 'Vendor SMS via Twilio', effectiveOn: '2026-08-01' }],
      memory: { answer: 'We discussed Firkus 3 weeks ago [1].', links: [{ title: 'decision', url: '/x' }] },
    });
    expect(md).toContain('week of 2026-08-10');
    expect(md).toContain('**Open exceptions**: 187  (↓ from 190) · goal ≤ 150 ⚠️ (3 wks off)');
    expect(md).toContain('**Move-ins**: 5 units (→ from 5) · goal ≥ 4');
    expect(md).toContain('[P2] Firkus estimates stuck — 12d old, raised by agent:estimate_chaser');
    expect(md).toContain('9/10 done (90% — target ≥90%)');
    expect(md).toContain('Vendor SMS via Twilio');
    expect(md).toContain('From the company brain');
  });
  it('handles empty data without breaking', () => {
    const md = buildPrepPacket({
      weekStart: '2026-08-10',
      metrics: [],
      issues: [],
      openIssueCount: 0,
      todoStats: { due: 0, done: 0 },
      recentDecisions: [],
      memory: null,
    });
    expect(md).toContain('_No weekly metrics yet._');
    expect(md).toContain('_The list is clear._');
    expect(md).toContain('(— — target ≥90%)');
    expect(md).not.toContain('company brain');
  });
});
