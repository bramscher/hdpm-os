/**
 * Agent-OS Brief B — shared types for the agent layer spine.
 *
 * Tables: agent_proposal / agent_outbox / agent_config / staff
 * (migrations 20260719_*). Conventions in docs/agent-os/02-brief-b-conventions.md.
 */

import { PEOPLE } from '@/lib/maintenance/types';

export const AGENT_CHANNELS = ['slack', 'sms_zoom', 'outlook_draft', 'email', 'in_app'] as const;
export type AgentChannel = (typeof AGENT_CHANNELS)[number];

export const PROPOSAL_STATUSES = [
  'proposed',
  'approved',
  'edited',
  'rejected',
  'expired',
  'auto_applied',
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const OUTBOX_STATUSES = ['queued', 'sent', 'failed', 'skipped'] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

/** L0 observe → L1 draft → L2 act-on-tap → L3 act-then-notify → L4 silent. */
export type AutonomyLevel = 0 | 1 | 2 | 3 | 4;

/** Terminal-failure cap: a queued row is retried until attempts reaches this. */
export const MAX_SEND_ATTEMPTS = 3;

/**
 * All real staff — the maintenance PEOPLE const plus the rest of the team
 * (roster corrected 2026-07-18; PEOPLE itself types maintenance owner routing
 * and stays untouched).
 */
export const STAFF_PEOPLE = [...PEOPLE, 'Matt', 'Ashley', 'Bianca', 'Kennedy'] as const;
export type StaffPerson = (typeof STAFF_PEOPLE)[number];

export interface AgentProposal {
  id: string;
  org_id: string;
  agent: string;
  subject_type: string;
  subject_id: string | null;
  action_type: string;
  payload: Record<string, unknown>;
  rationale: string | null;
  status: ProposalStatus;
  decided_by: string | null;
  decided_at: string | null;
  channel_message_id: string | null;
  created_at: string;
}

export interface OutboxMessage {
  id: string;
  org_id: string;
  proposal_id: string | null;
  channel: AgentChannel;
  recipient_person: string | null;
  recipient_address: string | null;
  subject: string | null;
  body: string | null;
  payload: Record<string, unknown>;
  status: OutboxStatus;
  attempts: number;
  last_attempt_at: string | null;
  message_id: string | null;
  error: string | null;
  created_at: string;
  sent_at: string | null;
}

export interface AgentConfigRow {
  agent: string;
  action_type: string;
  autonomy_level: AutonomyLevel;
  ceiling_level: AutonomyLevel;
  max_per_day: number | null;
  quiet_hours: string | null;
  owner_role: string | null;
  enabled: boolean;
  /** staff.person names to DM in Slack for this action; [0] is the primary
   *  (interactive) recipient, the rest are read-only copies. Null/empty →
   *  the agent falls back to its built-in default recipient list. */
  slack_recipients: string[] | null;
  updated_at: string;
}

export interface StaffRow {
  person: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  slack_user_id: string | null;
  role: string | null;
  active: boolean;
  updated_at: string;
}
