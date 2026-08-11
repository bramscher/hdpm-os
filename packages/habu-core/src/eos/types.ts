/**
 * Seats — HABU primitive 1.
 *
 * A seat is a box on the accountability chart that work routes to. Nothing
 * routes to a person; everything routes to a seat. Extracted from hdpm-os
 * `lib/eos/types.ts` (Seat) and generalized per the HABU spec §3:
 *
 * - HABU allows agents *as* seat-holders, not only under seats (`holder_type`).
 * - An agent seat MUST name a human escalation seat (`escalation_seat_id`) —
 *   the safety answer: every agent seat has a human escalation path.
 * - `person` (string key) → `person_id` (staff row id); add `agent_id`.
 */

export type SeatHolderType = 'human' | 'agent' | 'open';

export interface Seat {
  id: string;
  org_id: string;
  name: string; // "Maintenance Coordinator"
  roles: string[];
  reports_to_seat_id: string | null;
  holder_type: SeatHolderType;
  person_id: string | null; // when holder_type = 'human'
  agent_id: string | null; // when holder_type = 'agent'
  escalation_seat_id: string | null; // REQUIRED when holder_type = 'agent'
  active: boolean;
  sort: number;
}

export interface SeatNode {
  seat: Seat;
  children: SeatNode[];
}
