import { describe, it, expect } from 'vitest';
import type { Seat } from '../types';
import { buildSeatTree, validateSeats, resolveEscalationSeat } from '../seat';

function seat(overrides: Partial<Seat> = {}): Seat {
  return {
    id: 's1',
    org_id: 'org1',
    name: 'Seat',
    roles: [],
    reports_to_seat_id: null,
    holder_type: 'open',
    person_id: null,
    agent_id: null,
    escalation_seat_id: null,
    active: true,
    sort: 0,
    ...overrides,
  };
}

describe('buildSeatTree', () => {
  it('nests children under parents, roots-first, ordered by sort', () => {
    const seats = [
      seat({ id: 'child-b', reports_to_seat_id: 'root', sort: 2 }),
      seat({ id: 'child-a', reports_to_seat_id: 'root', sort: 1 }),
      seat({ id: 'root', sort: 0 }),
    ];
    const tree = buildSeatTree(seats);
    expect(tree.map((n) => n.seat.id)).toEqual(['root']);
    expect(tree[0].children.map((n) => n.seat.id)).toEqual(['child-a', 'child-b']);
  });

  it('treats a self-referential parent as a root (no infinite nest)', () => {
    const tree = buildSeatTree([seat({ id: 'x', reports_to_seat_id: 'x' })]);
    expect(tree.map((n) => n.seat.id)).toEqual(['x']);
  });

  it('surfaces both seats of a reports_to cycle as roots (never drops them)', () => {
    const tree = buildSeatTree([
      seat({ id: 'a', reports_to_seat_id: 'b', sort: 0 }),
      seat({ id: 'b', reports_to_seat_id: 'a', sort: 1 }),
    ]);
    expect(tree.map((n) => n.seat.id).sort()).toEqual(['a', 'b']);
  });
});

describe('validateSeats', () => {
  it('accepts a well-formed chart', () => {
    const seats = [
      seat({ id: 'human', holder_type: 'human', person_id: 'p1' }),
      seat({ id: 'agent', holder_type: 'agent', agent_id: 'estimate_chaser', escalation_seat_id: 'human' }),
      seat({ id: 'open', holder_type: 'open' }),
    ];
    expect(validateSeats(seats)).toEqual([]);
  });

  it('flags an agent seat with no escalation path (§3 rule 1)', () => {
    const v = validateSeats([seat({ id: 'a', holder_type: 'agent', agent_id: 'x' })]);
    expect(v.some((x) => x.rule === 'agent_needs_escalation')).toBe(true);
  });

  it('flags holder/field mismatches', () => {
    const v = validateSeats([
      seat({ id: 'h', holder_type: 'human', agent_id: 'x' }), // human w/ agent_id, missing person_id
    ]);
    expect(v.filter((x) => x.rule === 'holder_field_mismatch').length).toBe(2);
  });

  it('flags a dangling escalation target', () => {
    const v = validateSeats([
      seat({ id: 'a', holder_type: 'agent', agent_id: 'x', escalation_seat_id: 'ghost' }),
    ]);
    expect(v.some((x) => x.rule === 'escalation_target_missing')).toBe(true);
  });
});

describe('resolveEscalationSeat', () => {
  it('walks to the first human seat via escalation_seat_id', () => {
    const human = seat({ id: 'human', holder_type: 'human', person_id: 'p1' });
    const agent = seat({ id: 'agent', holder_type: 'agent', agent_id: 'x', escalation_seat_id: 'human' });
    expect(resolveEscalationSeat(agent, [agent, human])?.id).toBe('human');
  });

  it('chains through nested agent seats', () => {
    const human = seat({ id: 'human', holder_type: 'human', person_id: 'p1' });
    const a2 = seat({ id: 'a2', holder_type: 'agent', agent_id: 'y', escalation_seat_id: 'human' });
    const a1 = seat({ id: 'a1', holder_type: 'agent', agent_id: 'x', escalation_seat_id: 'a2' });
    expect(resolveEscalationSeat(a1, [a1, a2, human])?.id).toBe('human');
  });

  it('falls back to reports_to when no escalation_seat_id', () => {
    const human = seat({ id: 'boss', holder_type: 'human', person_id: 'p1' });
    const agent = seat({ id: 'agent', holder_type: 'agent', agent_id: 'x', escalation_seat_id: null, reports_to_seat_id: 'boss' });
    expect(resolveEscalationSeat(agent, [agent, human])?.id).toBe('boss');
  });

  it('returns null on a dead-end / all-agent cycle', () => {
    const a1 = seat({ id: 'a1', holder_type: 'agent', agent_id: 'x', escalation_seat_id: 'a2' });
    const a2 = seat({ id: 'a2', holder_type: 'agent', agent_id: 'y', escalation_seat_id: 'a1' });
    expect(resolveEscalationSeat(a1, [a1, a2])).toBeNull();
  });
});
