import { describe, it, expect } from 'vitest';
import type { Seat } from '../../eos/types';
import type { WatcherHit } from '../../watcher/engine';
import {
  escalateWatcherHits,
  decideTodoAction,
  rolledDueOn,
  buildTodoRoll,
  buildTodoMissedIssue,
} from '../ladder';

function seat(overrides: Partial<Seat> = {}): Seat {
  return {
    id: 's', org_id: 'o', name: 'Seat', roles: [], reports_to_seat_id: null,
    holder_type: 'open', person_id: null, agent_id: null, escalation_seat_id: null,
    active: true, sort: 0, ...overrides,
  };
}

describe('escalateWatcherHits', () => {
  const human = seat({ id: 'human', name: 'Coordinator', holder_type: 'human', person_id: 'p1' });
  const agentSeat = seat({ id: 'agent', name: 'Chaser', holder_type: 'agent', agent_id: 'chaser', escalation_seat_id: 'human' });
  const all = [human, agentSeat];

  it('routes an agent-seat jacket up its human escalation path', () => {
    const hits: WatcherHit[] = [{ rule_id: 'aged', jacket_id: 'j1', severity: 'now', detail: 'aged 30d' }];
    const drafts = escalateWatcherHits(hits, { seatOf: () => agentSeat, allSeats: all });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].escalation_seat_id).toBe('human');
    expect(drafts[0].raised_by).toBe('watcher:aged');
    expect(drafts[0].source_ref).toBe('watcher:aged:j1');
  });

  it('dedupes by source_ref and sorts now before soon', () => {
    const hits: WatcherHit[] = [
      { rule_id: 'r1', jacket_id: 'j1', severity: 'soon', detail: 'soon' },
      { rule_id: 'r1', jacket_id: 'j1', severity: 'soon', detail: 'dup' },
      { rule_id: 'r2', jacket_id: 'j2', severity: 'now', detail: 'now' },
    ];
    const drafts = escalateWatcherHits(hits, { seatOf: () => human, allSeats: all });
    expect(drafts).toHaveLength(2);
    expect(drafts[0].raised_by).toBe('watcher:r2'); // now first
  });

  it('routes a human-held jacket to the human holder itself (not their manager)', () => {
    const hits: WatcherHit[] = [{ rule_id: 'aged', jacket_id: 'j1', severity: 'now', detail: 'aged 30d' }];
    const drafts = escalateWatcherHits(hits, { seatOf: () => human, allSeats: all });
    expect(drafts[0].escalation_seat_id).toBe('human');
  });

  it('maps now→priority 2, soon→priority 3 (severity, not watcher kind)', () => {
    const hits: WatcherHit[] = [
      { rule_id: 'r1', jacket_id: 'j1', severity: 'now', detail: 'now' },
      { rule_id: 'r2', jacket_id: 'j2', severity: 'soon', detail: 'soon' },
    ];
    const drafts = escalateWatcherHits(hits, { seatOf: () => human, allSeats: all });
    expect(drafts.find((d) => d.source_ref === 'watcher:r1:j1')!.priority).toBe(2);
    expect(drafts.find((d) => d.source_ref === 'watcher:r2:j2')!.priority).toBe(3);
  });

  it('files with null escalation seat when the jacket has no holder', () => {
    const hits: WatcherHit[] = [{ rule_id: 'noown', jacket_id: 'j9', severity: 'now', detail: 'no owner' }];
    const drafts = escalateWatcherHits(hits, { seatOf: () => null, allSeats: all });
    expect(drafts[0].escalation_seat_id).toBeNull();
  });
});

describe('to-do lifecycle', () => {
  it('does nothing for on-time or non-open todos', () => {
    expect(decideTodoAction({ status: 'open', due_on: '2026-08-20' }, false, '2026-08-11')).toBe('none');
    expect(decideTodoAction({ status: 'done', due_on: '2026-08-01' }, false, '2026-08-11')).toBe('none');
  });
  it('rolls a first miss, files an issue on a second miss', () => {
    expect(decideTodoAction({ status: 'open', due_on: '2026-08-01' }, false, '2026-08-11')).toBe('roll');
    expect(decideTodoAction({ status: 'open', due_on: '2026-08-01' }, true, '2026-08-11')).toBe('file_issue');
  });
  it('rolls forward 7 days and points the copy at the original', () => {
    expect(rolledDueOn('2026-08-11')).toBe('2026-08-18');
    const roll = buildTodoRoll(
      { id: 'todo-1', title: 'Call owner', owner_person: 'alice', source: 'meeting', due_on: '2026-08-01' },
      '2026-08-11'
    );
    expect(roll.insert).toMatchObject({ due_on: '2026-08-18', source_id: 'todo-1', owner_person: 'alice' });
    expect(roll.nudge.body('http://x')).toContain('moved it to 2026-08-18');
  });
  it('files a twice-missed issue on the root with the escalation seat', () => {
    const issue = buildTodoMissedIssue(
      { title: 'Call owner', owner_person: 'alice', due_on: '2026-08-18', source_id: 'todo-1' },
      '2026-08-01',
      { seatName: 'Coordinator', escalation_seat_id: 'human' }
    );
    expect(issue.title).toContain('missed twice');
    expect(issue.source_ref).toBe('todo:todo-1');
    expect(issue.escalation_seat_id).toBe('human');
  });
});
