import { describe, it, expect } from 'vitest';
import {
  todayPacific,
  parseSourceRef,
  tripwireSourceRef,
  escalationSourceRef,
  todoSourceRef,
  countEpisodes,
  decideTripwireIssues,
  buildEscalationIssue,
  decideTodoAction,
  rolledDueOn,
  buildTodoRoll,
  buildTodoMissedIssue,
  TRIPWIRE_AGED_DAYS,
  TRIPWIRE_RECUR_EPISODES,
  PRIORITY_TRIPWIRE_RECURRING,
  PRIORITY_TRIPWIRE_AGED,
  ESCALATION_ACTOR,
} from '@/lib/eos/escalation';
import type { TripwireException } from '@/lib/maintenance/types';

describe('todayPacific', () => {
  it('handles the UTC/Pacific date boundary', () => {
    // Mon Aug 3 2026 04:00 UTC = Sun Aug 2 9 PM PT
    expect(todayPacific(new Date('2026-08-03T04:00:00Z'))).toBe('2026-08-02');
    expect(todayPacific(new Date('2026-08-03T18:00:00Z'))).toBe('2026-08-03');
  });
});

describe('parseSourceRef', () => {
  it('round-trips every ref format', () => {
    expect(parseSourceRef('scorecard_metric:abc')).toEqual({ kind: 'scorecard_metric', id: 'abc' });
    expect(parseSourceRef(tripwireSourceRef('wo-1', 11))).toEqual({
      kind: 'wo_tripwire',
      id: 'wo-1',
      tripwire: 11,
    });
    expect(parseSourceRef(escalationSourceRef('wo-2'))).toEqual({
      kind: 'wo_escalation',
      id: 'wo-2',
    });
    expect(parseSourceRef(todoSourceRef('t-1'))).toEqual({ kind: 'todo', id: 't-1' });
  });
  it('falls back to unknown', () => {
    expect(parseSourceRef(null)).toEqual({ kind: 'unknown', raw: '' });
    expect(parseSourceRef('garbage')).toEqual({ kind: 'unknown', raw: 'garbage' });
    expect(parseSourceRef('wo:x:twelve')).toEqual({ kind: 'unknown', raw: 'wo:x:twelve' });
  });
});

function ex(overrides: Partial<TripwireException>): TripwireException {
  return {
    tripwire: 3,
    label: '#3 Past-due next action',
    item: '[WAIT-OWNER] Window replacement — due 6/26',
    fixRequired: 'Set a new next-action date',
    owner: 'Cheryl',
    workOrderId: 'wo-1',
    ageDays: 0,
    ...overrides,
  } as TripwireException;
}

describe('countEpisodes', () => {
  it('treats consecutive weekdays (weekend gaps included) as one episode', () => {
    // Thu, Fri, Mon, Tue — one run
    expect(countEpisodes(['2026-07-30', '2026-07-31', '2026-08-03', '2026-08-04'])).toBe(1);
  });
  it('counts a flag → clear → flag pattern as separate episodes', () => {
    expect(countEpisodes(['2026-07-06', '2026-07-14', '2026-07-15', '2026-07-28'])).toBe(3);
  });
  it('handles empty and duplicate dates', () => {
    expect(countEpisodes([])).toBe(0);
    expect(countEpisodes(['2026-07-06', '2026-07-06'])).toBe(1);
  });
});

describe('decideTripwireIssues', () => {
  it('files on aged at/over threshold only', () => {
    const episodes = new Map<string, number>();
    expect(decideTripwireIssues([ex({ ageDays: TRIPWIRE_AGED_DAYS - 1 })], episodes)).toHaveLength(0);
    const drafts = decideTripwireIssues([ex({ ageDays: TRIPWIRE_AGED_DAYS })], episodes);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].priority).toBe(PRIORITY_TRIPWIRE_AGED);
    expect(drafts[0].source_ref).toBe('wo:wo-1:tw3');
    expect(drafts[0].raised_by).toBe('tripwire:3');
  });

  it('files on recurrence at the episode count, not below', () => {
    const below = new Map([['wo-1:3', TRIPWIRE_RECUR_EPISODES - 1]]);
    expect(decideTripwireIssues([ex({})], below)).toHaveLength(0);
    const at = new Map([['wo-1:3', TRIPWIRE_RECUR_EPISODES]]);
    const drafts = decideTripwireIssues([ex({})], at);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].priority).toBe(PRIORITY_TRIPWIRE_RECURRING);
    expect(drafts[0].title).toContain('recurring');
  });

  it('dedupes aged+recurring into one draft, recurring wins', () => {
    const episodes = new Map([['wo-1:3', 5]]);
    const drafts = decideTripwireIssues(
      [ex({ ageDays: 30 }), ex({ ageDays: 30 })], // duplicate exception too
      episodes
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0].priority).toBe(PRIORITY_TRIPWIRE_RECURRING);
  });

  it('returns drafts worst-first: recurring before aged, then oldest', () => {
    const episodes = new Map([['wo-3:3', 4]]);
    const drafts = decideTripwireIssues(
      [
        ex({ workOrderId: 'wo-1', ageDays: 25 }),
        ex({ workOrderId: 'wo-2', ageDays: 60 }),
        ex({ workOrderId: 'wo-3', ageDays: 5 }),
      ],
      episodes
    );
    expect(drafts.map((d) => d.source_ref)).toEqual(['wo:wo-3:tw3', 'wo:wo-2:tw3', 'wo:wo-1:tw3']);
  });

  it('skips exceptions without a work order and agent-owned tripwires', () => {
    expect(
      decideTripwireIssues([ex({ workOrderId: undefined, ageDays: 99 })], new Map())
    ).toHaveLength(0);
    expect(
      decideTripwireIssues([ex({ tripwire: 11, ageDays: 99 })], new Map())
    ).toHaveLength(0);
  });
});

describe('buildEscalationIssue', () => {
  it('builds the draft from the proposal payload', () => {
    const draft = buildEscalationIssue({
      id: 'p-1',
      subject_id: 'wo-9',
      rationale: 'Chased 3× with no movement — needs escalation',
      payload: {
        wo_number: '512',
        property_name: 'Aspen Court',
        unit_name: '4B',
        vendor_name: 'Firkus',
        chase_count: 3,
        age_calendar_days: 50,
        appfolio_link: 'https://x.appfolio.com/wo/512',
      },
    });
    expect(draft).not.toBeNull();
    expect(draft!.source_ref).toBe('wo:wo-9:escalation');
    expect(draft!.raised_by).toBe('agent:estimate_chaser');
    expect(draft!.title).toBe('Estimate escalation: WO 512 — Aspen Court 4B');
    expect(draft!.detail).toContain('proposal:p-1');
    expect(draft!.detail).toContain('Firkus');
  });

  it('returns null without a subject work order', () => {
    expect(
      buildEscalationIssue({ id: 'p-2', subject_id: null, rationale: null, payload: {} })
    ).toBeNull();
  });
});

describe('decideTodoAction', () => {
  const today = '2026-08-04';
  it('leaves future/current and non-open todos alone', () => {
    expect(decideTodoAction({ status: 'open', due_on: today }, false, today)).toBe('none');
    expect(decideTodoAction({ status: 'open', due_on: '2026-08-10' }, false, today)).toBe('none');
    expect(decideTodoAction({ status: 'done', due_on: '2026-08-01' }, false, today)).toBe('none');
    expect(decideTodoAction({ status: 'rolled', due_on: '2026-08-01' }, true, today)).toBe('none');
  });
  it('rolls a first miss, files on a second (weekend gap included)', () => {
    // due Friday, cron runs Monday
    expect(decideTodoAction({ status: 'open', due_on: '2026-07-31' }, false, '2026-08-03')).toBe('roll');
    expect(decideTodoAction({ status: 'open', due_on: '2026-07-31' }, true, '2026-08-03')).toBe('file_issue');
  });
});

describe('buildTodoRoll', () => {
  it('creates the copy due +7 linked by source_id, and a link-bearing nudge', () => {
    const { insert, nudge } = buildTodoRoll(
      { id: 't-1', title: 'Call the owner', owner_person: 'Brody', source: 'meeting', due_on: '2026-07-31' },
      '2026-08-03'
    );
    expect(insert).toEqual({
      title: 'Call the owner',
      owner_person: 'Brody',
      due_on: '2026-08-10',
      source: 'meeting',
      source_id: 't-1',
    });
    const body = nudge.body('https://x/company/issues');
    expect(body).toContain('https://x/company/issues');
    expect(body).toContain('2026-08-10');
  });
  it('rolledDueOn does plain calendar math', () => {
    expect(rolledDueOn('2026-08-28')).toBe('2026-09-04');
  });
});

describe('buildTodoMissedIssue', () => {
  it('anchors the dedupe ref on the ROOT todo and carries owner+seat', () => {
    const draft = buildTodoMissedIssue(
      { title: 'Call the owner', owner_person: 'Brody', due_on: '2026-08-10', source_id: 't-1' },
      '2026-07-31',
      'Maintenance Lead'
    );
    expect(draft.source_ref).toBe('todo:t-1');
    expect(draft.raised_by).toBe(ESCALATION_ACTOR);
    expect(draft.detail).toContain('Brody');
    expect(draft.detail).toContain('Maintenance Lead');
    expect(draft.detail).toContain('Due 2026-07-31, rolled to 2026-08-10');
  });
});
