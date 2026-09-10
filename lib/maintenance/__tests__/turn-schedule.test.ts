import { describe, it, expect } from 'vitest';
import {
  buildTurnSchedule,
  deriveTask,
  phaseKeyFor,
  datePct,
  type TurnTaskInput,
} from '../turn-schedule';

const TODAY = '2026-08-15';

function task(o: Partial<TurnTaskInput> = {}): TurnTaskInput {
  return {
    id: o.id ?? 't1',
    wo_number: o.wo_number ?? '100',
    description: o.description ?? 'Repair',
    unit_turn_category: o.unit_turn_category ?? 'Maintenance / Repair',
    stage: o.stage ?? 'SCHEDULED',
    scheduled_start: o.scheduled_start ?? null,
    scheduled_end: o.scheduled_end ?? null,
    completed_date: o.completed_date ?? null,
    next_action_date: o.next_action_date ?? null,
    appfolio_created_at: o.appfolio_created_at ?? null,
    created_at: o.created_at ?? '2026-08-01T00:00:00Z',
    owner_name: o.owner_name ?? null,
    appfolio_link: o.appfolio_link ?? null,
  };
}

describe('phaseKeyFor', () => {
  it('keeps known categories and buckets unknown/blank into Other', () => {
    expect(phaseKeyFor('Paint')).toBe('Paint');
    expect(phaseKeyFor('Frobnicate')).toBe('Other');
    expect(phaseKeyFor(null)).toBe('Other');
  });
});

describe('deriveTask bar span fallback chain', () => {
  it('prefers scheduled_start → scheduled_end', () => {
    const t = deriveTask(task({ scheduled_start: '2026-08-10T18:00:00Z', scheduled_end: '2026-08-12T18:00:00Z' }), TODAY);
    expect(t.start).toBe('2026-08-10');
    expect(t.end).toBe('2026-08-12');
  });

  it('falls back end → completed_date, then next_action_date, then +1 default', () => {
    expect(deriveTask(task({ scheduled_start: '2026-08-10T00:00:00Z', completed_date: '2026-08-11T00:00:00Z', stage: 'CLOSED' }), TODAY).end).toBe('2026-08-11');
    expect(deriveTask(task({ scheduled_start: '2026-08-10T00:00:00Z', next_action_date: '2026-08-14' }), TODAY).end).toBe('2026-08-14');
    expect(deriveTask(task({ scheduled_start: '2026-08-10T00:00:00Z' }), TODAY).end).toBe('2026-08-11');
  });

  it('falls back start → appfolio_created_at → created_at', () => {
    expect(deriveTask(task({ appfolio_created_at: '2026-08-05T00:00:00Z' }), TODAY).start).toBe('2026-08-05');
    expect(deriveTask(task({ created_at: '2026-08-03T00:00:00Z' }), TODAY).start).toBe('2026-08-03');
  });

  it('never lets end fall before start', () => {
    const t = deriveTask(task({ scheduled_start: '2026-08-20T00:00:00Z', next_action_date: '2026-08-10' }), TODAY);
    expect(t.end >= t.start).toBe(true);
  });
});

describe('deriveTask status', () => {
  it('done when CLOSED or completed', () => {
    expect(deriveTask(task({ stage: 'CLOSED' }), TODAY).status).toBe('done');
    expect(deriveTask(task({ completed_date: '2026-08-09T00:00:00Z' }), TODAY).status).toBe('done');
  });
  it('overdue when open and end is before today', () => {
    expect(deriveTask(task({ scheduled_start: '2026-08-01T00:00:00Z', next_action_date: '2026-08-05' }), TODAY).status).toBe('overdue');
  });
  it('in_progress when active now, planned when future', () => {
    expect(deriveTask(task({ scheduled_start: '2026-08-10T00:00:00Z', next_action_date: '2026-08-20' }), TODAY).status).toBe('in_progress');
    expect(deriveTask(task({ scheduled_start: '2026-08-20T00:00:00Z', next_action_date: '2026-08-25' }), TODAY).status).toBe('planned');
  });
});

describe('buildTurnSchedule', () => {
  const turn = { vacated_at: '2026-08-01', target_ready: '2026-08-18', movein_date: '2026-08-25' };

  it('groups by phase in make-ready order, only non-empty', () => {
    const s = buildTurnSchedule(
      turn,
      [
        task({ id: 'a', unit_turn_category: 'Housekeeping' }),
        task({ id: 'b', unit_turn_category: 'Keys / Locks' }),
        task({ id: 'c', unit_turn_category: 'Paint' }),
      ],
      null,
      TODAY
    );
    expect(s.phases.map((p) => p.key)).toEqual(['Keys / Locks', 'Paint', 'Housekeeping']); // PHASES order
  });

  it('rolls up %complete and phase status', () => {
    const s = buildTurnSchedule(
      turn,
      [
        task({ id: 'a', unit_turn_category: 'Paint', stage: 'CLOSED' }),
        task({ id: 'b', unit_turn_category: 'Paint', scheduled_start: '2026-08-20T00:00:00Z', next_action_date: '2026-08-24' }),
      ],
      null,
      TODAY
    );
    const paint = s.phases.find((p) => p.key === 'Paint')!;
    expect(paint.pctComplete).toBe(50);
    expect(paint.status).toBe('in_progress'); // one done, one open
  });

  it('assembles all four milestones, drops nulls, sorts by date', () => {
    const s = buildTurnSchedule(turn, [task()], '2026-08-10', TODAY);
    expect(s.milestones.map((m) => m.kind)).toEqual(['move_out', 'available', 'target_ready', 'move_in']);
    const noMoveIn = buildTurnSchedule({ ...turn, movein_date: null }, [task()], null, TODAY);
    expect(noMoveIn.milestones.map((m) => m.kind)).toEqual(['move_out', 'target_ready']);
  });

  it('domain spans move-out through move-in with padding and keeps today', () => {
    const s = buildTurnSchedule(turn, [task({ scheduled_start: '2026-08-05T00:00:00Z' })], '2026-08-10', TODAY);
    expect(s.domain.start <= '2026-08-01').toBe(true); // padded before move-out
    expect(s.domain.end >= '2026-08-25').toBe(true); // padded past move-in
    expect(datePct(TODAY, s.domain)).toBeGreaterThan(0);
    expect(datePct(TODAY, s.domain)).toBeLessThan(100);
  });
});

describe('datePct', () => {
  it('maps endpoints to 0 and 100, clamps out-of-range', () => {
    const d = { start: '2026-08-01', end: '2026-08-11' };
    expect(datePct('2026-08-01', d)).toBe(0);
    expect(datePct('2026-08-11', d)).toBe(100);
    expect(datePct('2026-08-06', d)).toBe(50);
    expect(datePct('2026-07-01', d)).toBe(0); // clamped
    expect(datePct('2026-12-01', d)).toBe(100); // clamped
  });
});
