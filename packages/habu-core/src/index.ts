/**
 * @habu/core — the agent/seat/brief spine extracted from hdpm-os.
 *
 * v1 primitives: Seats · Jackets · Score · Brief. This barrel exposes the
 * agent-execution spine (proposals, outbox, channels, config, audit) that the
 * other three primitives build on. See docs/habu/00-execution-plan.md.
 */

// Actor convention (humans / agent:<name> / system:<job>)
export * from './actor';

// Shared types (proposals, outbox, config, staff, autonomy levels)
export * from './types';

// Append-only audit log
export * from './audit';

// Per-agent, per-action autonomy + ceilings + quiet hours
export * from './config';

// Proposal lifecycle (the consent model)
export * from './proposals';

// Durable send queue + dispatch
export * from './outbox';

// Channel adapters (Slack default chassis; adapters swappable)
export * from './channels';

// Pluggable SMS transport seam (tenant registers Zoom etc.)
export * from './sms-transport';

// Agent activity metrics (feeds the Score)
export * from './metrics-history';

// Microsoft Graph draft helper (outlook_draft channel)
export * from './graph';

// Core Supabase accessor
export { getSupabaseAdmin } from './db';
