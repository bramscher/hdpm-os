/**
 * Seat tree + the agent-seat safety invariant (HABU spec §3).
 *
 * Extracted from hdpm-os `lib/eos/org.ts` (buildSeatTree). The static
 * `SEAT_AGENTS` map is dropped: §3 redefines the seat→agent relationship as
 * "a seat is held by exactly one holder (human OR agent)", modelled on the
 * Seat row itself (holder_type/agent_id), not a code-side many-map.
 */

import type { Seat, SeatNode } from './types';

/** Roots-first tree from reports_to_seat_id; children ordered by sort. */
export function buildSeatTree(seats: Seat[]): SeatNode[] {
  const bySort = [...seats].sort((a, b) => a.sort - b.sort);
  const nodes = new Map<string, SeatNode>(bySort.map((s) => [s.id, { seat: s, children: [] }]));
  const roots: SeatNode[] = [];

  // Would linking `seatId` under `parentId` close a reports_to loop? Walk up
  // from the parent; reaching seatId means a cycle (a→b→a). Without this the
  // seats in the cycle nest into each other and vanish from the roots forest.
  const closesCycle = (seatId: string, parentId: string): boolean => {
    const seen = new Set<string>();
    let cur: string | null | undefined = parentId;
    while (cur && !seen.has(cur)) {
      if (cur === seatId) return true;
      seen.add(cur);
      cur = nodes.get(cur)?.seat.reports_to_seat_id ?? null;
    }
    return false;
  };

  for (const s of bySort) {
    const node = nodes.get(s.id)!;
    const parentId = s.reports_to_seat_id;
    const parent = parentId ? nodes.get(parentId) : undefined;
    // A missing parent, a self-parent, or any reports_to cycle → treat as a
    // root rather than silently dropping the seat.
    if (parent && parent.seat.id !== s.id && !closesCycle(s.id, parentId!)) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

export interface SeatViolation {
  seat_id: string;
  rule: 'agent_needs_escalation' | 'holder_field_mismatch' | 'escalation_target_missing';
  detail: string;
}

/**
 * Enforce the §3 invariants across a seat set. Returns all violations (empty =
 * valid). Callers reject writes on any violation.
 *
 * 1. An agent seat MUST name a human escalation seat (§3 rule 1).
 * 2. holder_type and the holder id fields must agree (agent→agent_id,
 *    human→person_id, open→neither).
 * 3. escalation_seat_id, when set, must point at a real seat in the set.
 */
export function validateSeats(seats: Seat[]): SeatViolation[] {
  const ids = new Set(seats.map((s) => s.id));
  const violations: SeatViolation[] = [];
  for (const s of seats) {
    if (s.holder_type === 'agent') {
      if (!s.agent_id) {
        violations.push({ seat_id: s.id, rule: 'holder_field_mismatch', detail: 'agent seat missing agent_id' });
      }
      if (s.person_id) {
        violations.push({ seat_id: s.id, rule: 'holder_field_mismatch', detail: 'agent seat must not set person_id' });
      }
      if (!s.escalation_seat_id) {
        violations.push({ seat_id: s.id, rule: 'agent_needs_escalation', detail: 'agent seat must name an escalation_seat_id' });
      }
    } else if (s.holder_type === 'human') {
      if (!s.person_id) {
        violations.push({ seat_id: s.id, rule: 'holder_field_mismatch', detail: 'human seat missing person_id' });
      }
      if (s.agent_id) {
        violations.push({ seat_id: s.id, rule: 'holder_field_mismatch', detail: 'human seat must not set agent_id' });
      }
    } else {
      // open
      if (s.person_id || s.agent_id) {
        violations.push({ seat_id: s.id, rule: 'holder_field_mismatch', detail: 'open seat must not set a holder' });
      }
    }
    if (s.escalation_seat_id && !ids.has(s.escalation_seat_id)) {
      violations.push({ seat_id: s.id, rule: 'escalation_target_missing', detail: `escalation_seat_id ${s.escalation_seat_id} not found` });
    }
  }
  return violations;
}

/**
 * Resolve the human escalation seat for a (failed/stalled/ceilinged) agent
 * seat by walking escalation_seat_id, then reports_to_seat_id, up to the first
 * human/open seat. Returns null if the chain dead-ends (a config error the
 * validator should have caught). Cycle-safe.
 */
export function resolveEscalationSeat(seat: Seat, all: Seat[]): Seat | null {
  const byId = new Map(all.map((s) => [s.id, s]));
  const seen = new Set<string>();
  let cursor: Seat | undefined = seat;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    const nextId: string | null = cursor.escalation_seat_id ?? cursor.reports_to_seat_id;
    const next: Seat | undefined = nextId ? byId.get(nextId) : undefined;
    if (!next) return null;
    if (next.holder_type !== 'agent') return next;
    cursor = next;
  }
  return null;
}
