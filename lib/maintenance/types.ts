/**
 * Maintenance OS — shared types
 *
 * Behavioral contract: docs/maintenance-os/02-functional-spec.md
 * The 8-stage lifecycle, waiting reasons, P1–P4 classes, and the 12 tripwires.
 */

import type { WorkOrder } from '@/lib/work-orders';

// ============================================
// Workflow enums
// ============================================

export const STAGES = [
  'NEW',
  'TRIAGED',
  'SCHEDULED',
  'IN_PROGRESS',
  'WAITING_ON',
  'VERIFY',
  'BILL',
  'CLOSED',
] as const;
export type Stage = (typeof STAGES)[number];

export const WAITING_REASONS = [
  'TENANT',
  'VENDOR',
  'PARTS',
  'OWNER',
  'WEATHER',
  'INTERNAL',
] as const;
export type WaitingReason = (typeof WAITING_REASONS)[number];

export const PRIORITY_CLASSES = ['P1', 'P2', 'P3', 'P4'] as const;
export type PriorityClass = (typeof PRIORITY_CLASSES)[number];

export const ORIGINS = [
  'appfolio',
  'haven',
  'inspection',
  'turn',
  'owner',
  'staff',
  'preventive',
] as const;
export type Origin = (typeof ORIGINS)[number];

/** Named accountable people (01-product-brief.md §People). */
export const PEOPLE = [
  'Cheryl',
  'Brody',
  'Alberto',
  'Bryce',
  'Penny',
  'Jen',
  'Craig',
] as const;
export type Person = (typeof PEOPLE)[number];

export const EVENT_TYPES = [
  'created',
  'stage_change',
  'assign',
  'schedule',
  'note',
  'photo',
  'scope_change',
  'approval_request',
  'approval_decision',
  'failed_access',
  'recommendation',
  'tenant_ping',
  'tenant_reply',
  'invoice',
  'exception',
  'sync_update',
  'ai_triage',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

// ============================================
// Row types (new columns / tables from 20260702_maintenance_os.sql)
// ============================================

/** work_orders with the Maintenance OS workflow columns. */
export interface MaintWorkOrder extends WorkOrder {
  stage: Stage;
  waiting_reason: WaitingReason | null;
  owner_name: string;
  next_action_date: string | null; // DATE as ISO string
  priority_class: PriorityClass | null;
  assigned_tech: string | null;
  origin: Origin;
  is_turn: boolean;
  verified_by: string | null;
  verified_at: string | null;
  tenant_ping_sent: boolean;
  tenant_ping_sent_at: string | null;
  preventive_scheduled: boolean | null; // null = N/A, false = blocks CLOSED
  closed_at: string | null;
  aging_reason: string | null;
}

export interface WoEvent {
  id: number;
  work_order_id: string;
  event_type: EventType;
  payload: Record<string, unknown>;
  actor: string;
  created_at: string;
}

export interface Vendor {
  id: string;
  appfolio_vendor_id: string | null;
  name: string;
  trades: string[] | null;
  service_area: string | null;
  license_number: string | null;
  license_expiry: string | null;
  license_required_trades: string[] | null;
  insurance_carrier: string | null;
  insurance_expiry: string | null;
  w9_on_file: boolean;
  hourly_rate: number | null;
  minimum_charge: number | null;
  emergency_available: boolean;
  preferred: boolean;
  demoted: boolean;
  property_restrictions: string[] | null;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface VendorAssignment {
  id: string;
  work_order_id: string;
  vendor_id: string;
  sent_at: string;
  accepted_at: string | null;
  declined_at: string | null;
  scheduled_at: string | null;
  completed_at: string | null;
  callback: boolean;
  created_by: string | null;
  created_at: string;
}

export interface Approval {
  id: string;
  work_order_id: string;
  kind: 'OWNER' | 'PM';
  requested_of: string;
  estimate: number | null;
  photos: Record<string, unknown> | null;
  requested_at: string;
  decided_at: string | null;
  decision: 'APPROVED' | 'DECLINED' | null;
  approved_amount: number | null;
  conditions: string | null;
  created_at: string;
}

export interface Recommendation {
  id: string;
  work_order_id: string | null;
  tech: string;
  body: string;
  created_at: string;
  resolved_wo_id: string | null;
  dismissed_reason: string | null;
}

export interface Turn {
  work_order_id: string;
  vacated_at: string;
  target_ready: string | null;
  current_blocker: string | null;
  budget: number | null;
  actual: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * Unit-level turnover cycle (20260723). Groups MANY work_orders via
 * work_orders.unit_turn_id. Supersedes the per-WO `turn` table, which is
 * kept for tripwire #12 compatibility and bridged by the legacy endpoint.
 */
export interface UnitTurn {
  id: string;
  property_id: string | null;
  property_name: string;
  unit_id: string | null;
  unit_name: string | null;
  vacated_at: string;
  target_ready: string | null;
  movein_date: string | null;
  status: 'active' | 'ready' | 'closed';
  current_blocker: string | null;
  budget: number | null;
  actual: number | null;
  notes: string | null;
  /** AppFolio service-request UUID for Turn-Board-synced turns; NULL for manual turns (20260724) */
  af_service_request_id: string | null;
  created_at: string;
  updated_at: string;
}

/** ai_triage_proposal row (Session B — batch triage proposals). */
export interface TriageProposal {
  work_order_id: string;
  triage: Record<string, unknown>;
  proposed_priority_class: PriorityClass | null;
  proposed_next_action_date: string | null;
  proposed_owner_name: string | null;
  proposed_stage: Stage | null;
  status: 'pending' | 'applied' | 'skipped';
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

// ============================================
// Tripwires
// ============================================

export type TripwireNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

/** One exception row on the Exceptions view — a fix required today, with an owner. */
export interface TripwireException {
  tripwire: TripwireNumber;
  /** Short tripwire label, e.g. "#3 Past-due next action" */
  label: string;
  /** The offending item, e.g. "[WAIT-OWNER] Window replacement — due 6/26" */
  item: string;
  /** What has to happen today */
  fixRequired: string;
  /** Who is obligated to act */
  owner: string;
  workOrderId?: string;
  ageDays?: number;
}

/** Rule-7 documentation status per work order. */
export interface WoDocs {
  photoCount: number;
  hasTime: boolean;
  hasMaterials: boolean;
  scopeChanges: number;
  approvedDecisions: number;
}

/**
 * All data the 12 tripwire rules need, loaded once per run.
 * Rules themselves are pure: (snapshot) => TripwireException[].
 */
export interface TripwireSnapshot {
  now: Date;
  openWorkOrders: MaintWorkOrder[];
  assignments: VendorAssignment[];
  vendors: Vendor[];
  approvals: Approval[];
  recommendations: Recommendation[];
  /** ACTIVE unit turns (rule 12 — 20260724: reads unit_turn, not legacy turn). */
  unitTurns: UnitTurn[];
  /** work_order_id values that have at least one non-void invoice linked */
  invoicedWorkOrderIds: Set<string>;
  /** Rule 6/7 inputs, keyed by work_order_id (open WOs only) */
  docsByWorkOrder: Map<string, WoDocs>;
  /** work_order_ids with a failed_access event in the last 24h (rule 5) */
  recentFailedAccessWoIds: Set<string>;
  /**
   * When each open WO entered its CURRENT appfolio_status (rule 11 estimate
   * clocks): latest sync_update event matching the current status; callers
   * fall back to appfolio_last_updated_at, then appfolio_created_at.
   */
  statusSince: Map<string, string>;
}

// ============================================
// Closure gate (02-functional-spec.md §3)
// ============================================

export interface ClosureGateContext {
  /** 1. Verification recorded */
  verifiedAt: string | null;
  verifiedBy: string | null;
  /** 2. Invoice generated + linked (non-void) */
  hasInvoice: boolean;
  /** 3. Open recommendations (no WO, no written dismissal) */
  openRecommendations: number;
  /** 4. Tenant confirmation ping sent (manual until Haven) */
  tenantPingSent: boolean;
  /** 5. failed_access / scope_change events lacking documentation payload */
  undocumentedIncidents: number;
  /** 6. preventive_scheduled tri-state: null = N/A */
  preventiveScheduled: boolean | null;
}

export interface ClosureGateResult {
  passed: boolean;
  failures: { condition: 1 | 2 | 3 | 4 | 5 | 6; label: string }[];
}
