import { describe, expect, it } from 'vitest';
import { exceptionCracks, proposalCracks, rankCracks, todoCracks } from '../cracks';

const NOW = new Date('2026-08-05T19:00:00Z');

describe('rankCracks', () => {
  it('orders by kind severity, then oldest first', () => {
    const ranked = rankCracks([
      { kind: 'needs_date', label: '', detail: 'c', action: null, owner: null, ageDays: 30, href: null },
      { kind: 'exception', label: '', detail: 'a', action: null, owner: null, ageDays: 2, href: null },
      { kind: 'exception', label: '', detail: 'b', action: null, owner: null, ageDays: 9, href: null },
      { kind: 'overdue_todo', label: '', detail: 'd', action: null, owner: null, ageDays: 1, href: null },
    ]);
    expect(ranked.map((c) => c.detail)).toEqual(['b', 'a', 'd', 'c']);
  });
});

describe('proposalCracks', () => {
  it('only counts proposals older than the stale threshold, with recipient as owner', () => {
    const proposals = [
      { id: 'p1', agent: 'triage', subject_type: 'work_order', subject_id: 'wo1', action_type: 'set_priority', created_at: '2026-08-01T00:00:00Z' },
      { id: 'p2', agent: 'triage', subject_type: 'work_order', subject_id: 'wo2', action_type: 'set_priority', created_at: '2026-08-05T00:00:00Z' },
    ];
    const cracks = proposalCracks(proposals, new Map([['p1', 'Cheryl']]), NOW);
    expect(cracks).toHaveLength(1);
    expect(cracks[0]).toMatchObject({
      kind: 'stale_nudge',
      owner: 'Cheryl',
      ageDays: 4,
      href: '/maintenance/board/wo/wo1',
    });
  });
});

describe('todoCracks', () => {
  it('classifies overdue-open vs missed and computes age from due_on', () => {
    const cracks = todoCracks(
      [
        { title: 'Call owner', owner_person: 'Jen', due_on: '2026-08-01', status: 'open' },
        { title: 'Send W-9', owner_person: 'Penny', due_on: '2026-07-30', status: 'missed' },
        { title: 'Future', owner_person: 'Jen', due_on: '2026-08-09', status: 'open' },
        { title: 'Done', owner_person: 'Jen', due_on: '2026-08-01', status: 'done' },
      ],
      '2026-08-05'
    );
    expect(cracks).toHaveLength(2);
    expect(cracks[0]).toMatchObject({ kind: 'overdue_todo', owner: 'Jen', ageDays: 4 });
    expect(cracks[1]).toMatchObject({ kind: 'missed_todo', owner: 'Penny', ageDays: 6 });
  });
});

describe('exceptionCracks', () => {
  it('maps tripwire exceptions with deep links, keeping the fix as a separate action', () => {
    const cracks = exceptionCracks(
      [
        {
          tripwire: 3,
          label: '#3 Past-due next action',
          item: '[WAIT-OWNER] Window replacement',
          fixRequired: 'Set a new next action',
          owner: 'Cheryl',
          workOrderId: 'abc',
          ageDays: 5,
        } as never,
      ],
      'exception'
    );
    expect(cracks[0]).toMatchObject({
      kind: 'exception',
      label: '#3 Past-due next action',
      detail: '[WAIT-OWNER] Window replacement',
      action: 'Set a new next action',
      owner: 'Cheryl',
      ageDays: 5,
      href: '/maintenance/board/wo/abc',
    });
  });
});
