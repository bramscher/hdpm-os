/**
 * Jackets — HABU primitive 2 (§4 + Appendix A). Types mirror migration 0005.
 *
 * A jacket is a piece of work with a COLOR (process identity, from its
 * template), a LOCATION (current seat), and a CHECKLIST (steps) — and it moves.
 * Color is NOT derived (Appendix A.0 supersedes the §4 draft); the derived
 * signal is `attention` — the traffic-light dot on the card.
 */

export type JacketColor = 'green' | 'yellow' | 'red' | 'black' | 'blue';
export type JacketAttention = 'none' | 'soon' | 'now';
export type JacketStatus = 'open' | 'done' | 'cancelled';

export type StepRequires = 'tap' | 'external_event' | 'agent_run';
export type StepState = 'pending' | 'active' | 'done' | 'skipped' | 'blocked';

/** How a step's loop closes itself (§7): a tenant event matches and auto-completes it. */
export interface ExternalMatch {
  source: string; // 'twilio' | 'appfolio' | 'email' | 'webhook' | ...
  event_type: string;
  subject_key: string;
}

export interface JacketStep {
  id: string;
  jacket_id: string;
  ordinal: number;
  track: string | null; // parallel track name (App A.1); null = the implicit 'main' track
  label: string;
  seat_id: string | null;
  requires: StepRequires;
  external_match: ExternalMatch | null;
  due_rule: string | null; // e.g. 'created+3bd'
  due_on: string | null; // YYYY-MM-DD, computed from due_rule
  state: StepState;
  done_at: string | null;
  done_by: string | null; // actor convention
}

export interface Jacket {
  id: string;
  org_id: string;
  template_id: string | null;
  title: string; // '{anchor date} · {address}'
  color: JacketColor; // process identity (from template)
  attention: JacketAttention; // derived (§7 status dot)
  current_seat_id: string | null; // whose desk it's on = lead active step's seat
  subject_type: string | null;
  subject_id: string | null;
  status: JacketStatus;
  created_at: string;
  closed_at: string | null;
}

/** A step as defined ON A TEMPLATE (data, not code). seat_role resolves to a seat at instantiation. */
export interface TemplateStep {
  label: string;
  track?: string | null;
  seat_role?: string | null;
  requires?: StepRequires;
  external_match?: ExternalMatch | null;
  due_rule?: string | null;
}

export interface JacketTemplate {
  id: string;
  org_id: string;
  key: string; // 'move-out'
  title: string;
  color: JacketColor;
  steps: TemplateStep[];
  active: boolean;
}
