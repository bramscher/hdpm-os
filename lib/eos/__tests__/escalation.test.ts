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
  TODO_ROLL_EXTENSION_DAYS,
  PRIORITY_TODO_TWICE_MISSED,
} from '@/lib/eos/escalation';
import type { TodoStatus } from '@/lib/eos/types';
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

describe('rolledDueOn — calendar edges', () => {
  it('adds exactly TODO_ROLL_EXTENSION_DAYS', () => {
    expect(TODO_ROLL_EXTENSION_DAYS).toBe(7);
    expect(rolledDueOn('2026-08-04')).toBe('2026-08-11');
  });
  it('rolls over 30- and 31-day month ends', () => {
    expect(rolledDueOn('2026-04-30')).toBe('2026-05-07'); // 30-day month
    expect(rolledDueOn('2026-07-31')).toBe('2026-08-07'); // 31-day month
    expect(rolledDueOn('2026-04-24')).toBe('2026-05-01'); // lands on the 1st
  });
  it('rolls over the year end', () => {
    expect(rolledDueOn('2026-12-28')).toBe('2027-01-04');
    expect(rolledDueOn('2026-12-31')).toBe('2027-01-07');
  });
  it('handles February in common and leap years', () => {
    expect(rolledDueOn('2027-02-22')).toBe('2027-03-01'); // common year: no Feb 29
    expect(rolledDueOn('2028-02-22')).toBe('2028-02-29'); // leap year: lands on leap day
    expect(rolledDueOn('2028-02-29')).toBe('2028-03-07'); // from leap day
    expect(rolledDueOn('2028-02-25')).toBe('2028-03-03'); // spans leap day
  });
  it('is unaffected by US DST transitions', () => {
    // 2026: DST starts Mar 8, ends Nov 1 — noon-UTC anchor keeps the date stable
    expect(rolledDueOn('2026-03-05')).toBe('2026-03-12');
    expect(rolledDueOn('2026-10-29')).toBe('2026-11-05');
  });
});

describe('decideTodoAction — boundaries and statuses', () => {
  const today = '2026-08-04';
  it('due today is not overdue; due yesterday is', () => {
    expect(decideTodoAction({ status: 'open', due_on: '2026-08-04' }, false, today)).toBe('none');
    expect(decideTodoAction({ status: 'open', due_on: '2026-08-03' }, false, today)).toBe('roll');
    expect(decideTodoAction({ status: 'open', due_on: '2026-08-04' }, true, today)).toBe('none');
    expect(decideTodoAction({ status: 'open', due_on: '2026-08-03' }, true, today)).toBe('file_issue');
  });
  it('compares across month and year boundaries', () => {
    expect(decideTodoAction({ status: 'open', due_on: '2026-07-31' }, false, '2026-08-01')).toBe('roll');
    expect(decideTodoAction({ status: 'open', due_on: '2026-12-31' }, false, '2027-01-01')).toBe('roll');
    expect(decideTodoAction({ status: 'open', due_on: '2027-01-01' }, false, '2026-12-31')).toBe('none');
    expect(decideTodoAction({ status: 'open', due_on: '2028-02-29' }, true, '2028-03-01')).toBe('file_issue');
  });
  it('never acts on a non-open todo, however overdue, roll or not', () => {
    const statuses: TodoStatus[] = ['done', 'missed', 'rolled'];
    for (const status of statuses) {
      for (const isRoll of [false, true]) {
        expect(decideTodoAction({ status, due_on: '2025-01-01' }, isRoll, today)).toBe('none');
      }
    }
  });
});

describe('to-do roll chain', () => {
  const original = {
    id: 't-root',
    title: 'Renew the boiler permit',
    owner_person: 'Cheryl',
    source: 'meeting' as const,
    due_on: '2026-12-29',
  };

  it('first miss rolls across the year end; second miss files an issue on the root', () => {
    // first miss: due Dec 29, cron runs Dec 30
    expect(decideTodoAction({ status: 'open', due_on: original.due_on }, false, '2026-12-30')).toBe('roll');
    const { insert, nudge } = buildTodoRoll(original, '2026-12-30');
    expect(insert.due_on).toBe('2027-01-06');
    expect(insert.source_id).toBe('t-root');
    expect(nudge.body('u')).toContain('was due 2026-12-29');
    expect(nudge.body('u')).toContain('moved it to 2027-01-06');

    // the rolled copy (isRoll = it has a source_id) — due day itself is still fine
    const copy = { status: 'open' as const, due_on: insert.due_on };
    expect(decideTodoAction(copy, true, '2027-01-06')).toBe('none');
    // roll of a roll ⇒ file_issue, never a second roll
    expect(decideTodoAction(copy, true, '2027-01-07')).toBe('file_issue');

    const draft = buildTodoMissedIssue(
      { title: insert.title, owner_person: insert.owner_person, due_on: insert.due_on, source_id: insert.source_id },
      original.due_on,
      null
    );
    expect(draft.source_ref).toBe(todoSourceRef('t-root'));
    expect(draft.priority).toBe(PRIORITY_TODO_TWICE_MISSED);
    expect(draft.detail).toBe(
      'Owner: Cheryl. Due 2026-12-29, rolled to 2027-01-06, missed again. Original: todo:t-root.'
    );
  });

  it('buildTodoRoll carries a null owner and a non-meeting source through unchanged', () => {
    const { insert } = buildTodoRoll(
      { id: 't-2', title: 'x', owner_person: null, source: 'manual', due_on: '2028-02-21' },
      '2028-02-22'
    );
    expect(insert).toEqual({
      title: 'x',
      owner_person: null,
      due_on: '2028-02-29',
      source: 'manual',
      source_id: 't-2',
    });
  });

  it('buildTodoMissedIssue falls back for missing owner and original due date', () => {
    const draft = buildTodoMissedIssue(
      { title: 'x', owner_person: null, due_on: '2026-08-10', source_id: 't-3' },
      null,
      null
    );
    expect(draft.detail).toContain('Owner: unassigned.');
    expect(draft.detail).toContain('Due ?, rolled to 2026-08-10');
    expect(draft.detail).not.toContain('seat:');
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
