/**
 * Accountability chart — pure logic (Phase 2, Brief 2E — doc 06 §3).
 * Seat tree from reports_to_seat_id + the seat→agent attachment map.
 * Agents appear under seats, never as seats.
 */

import type { Seat } from './types';

/**
 * Which agents work for which seat (doc 06 §3: "Cheryl's seat lists
 * Morning Card, Estimate Chaser…"). PROVISIONAL — authored 2026-08-04
 * from actual recipients/owners, reviewed with Craig as the chart gets
 * used. No DB column exists for this; the mapping is deliberately static
 * until it earns one.
 */
export const SEAT_AGENTS: Record<string, string[]> = {
  'Maintenance Coordinator': ['Morning Card', 'Estimate Chaser'],
  'Inspections & Maintenance': ['Ops Brief'],
  Integrator: ['Scorecard', 'Escalation Ladder', 'Meeting Prep'],
};

export interface SeatNode {
  seat: Seat;
  children: SeatNode[];
}

/** Roots-first tree from reports_to_seat_id; children ordered by sort. */
export function buildSeatTree(seats: Seat[]): SeatNode[] {
  const bySort = [...seats].sort((a, b) => a.sort - b.sort);
  const nodes = new Map<string, SeatNode>(bySort.map((s) => [s.id, { seat: s, children: [] }]));
  const roots: SeatNode[] = [];
  for (const s of bySort) {
    const node = nodes.get(s.id)!;
    const parent = s.reports_to_seat_id ? nodes.get(s.reports_to_seat_id) : undefined;
    if (parent && parent.seat.id !== s.id) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}
