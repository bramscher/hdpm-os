/**
 * Maintenance OS — pure sync rules.
 *
 * The AppFolio mirror sync must NEVER write workflow columns (stage,
 * owner_name, next_action_date, …) on existing rows — those are owned by
 * this app. These helpers make the split explicit and unit-testable:
 *
 *  - buildMirrorRow():       the ONLY columns the sync may upsert
 *  - initialWorkflowFor():   workflow defaults for brand-new rows
 *  - stageAutomationFor():   the only two sync-driven stage moves
 */

import type { AppFolioWorkOrder } from '@/lib/appfolio';
import type { PriorityClass, Stage, WaitingReason } from './types';
import { STAGE_ORDER } from './workflow';
import { nextBusinessDay, toDateString } from './business-days';

// ============================================
// Mirror columns (AppFolio-owned)
// ============================================

export interface MirrorRow {
  appfolio_id: string;
  property_id: string | null;
  property_name: string;
  property_address: string | null;
  unit_id: string | null;
  wo_number: string | null;
  description: string;
  status: 'open' | 'closed' | 'done';
  appfolio_status: string;
  priority: string | null;
  assigned_to: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  completed_date: string | null;
  canceled_date: string | null;
  permission_to_enter: boolean;
  appfolio_link: string | null;
  appfolio_created_at: string | null;
  synced_at: string;
}

/**
 * The mirror payload for a sync upsert. Contains ONLY AppFolio-owned columns —
 * upserting this on conflict(appfolio_id) leaves workflow columns untouched.
 */
export function buildMirrorRow(
  wo: AppFolioWorkOrder,
  prop: { name: string; address: string | null } | null | undefined,
  syncedAt: Date
): MirrorRow {
  return {
    appfolio_id: wo.appfolioId,
    property_id: wo.propertyId,
    property_name: prop?.name || 'Unknown Property',
    property_address: prop?.address || null,
    unit_id: wo.unitId,
    wo_number: wo.woNumber,
    description: wo.description || 'No description',
    status: wo.status,
    appfolio_status: wo.appfolioStatus,
    priority: wo.priority,
    assigned_to: wo.assignedTo,
    vendor_id: wo.vendorId,
    vendor_name: wo.vendorName,
    scheduled_start: wo.scheduledStart,
    scheduled_end: wo.scheduledEnd,
    completed_date: wo.completedDate,
    canceled_date: wo.canceledDate,
    permission_to_enter: wo.permissionToEnter,
    appfolio_link: wo.link,
    appfolio_created_at: wo.createdAt,
    synced_at: syncedAt.toISOString(),
  };
}

// ============================================
// Workflow defaults for NEW rows only
// ============================================

/** Seed P1–P4 from AppFolio's free-text priority where recognizable. */
export function seedPriorityClass(priority: string | null): PriorityClass | null {
  const p = (priority || '').toLowerCase().trim();
  if (p === 'urgent' || p === 'emergency') return 'P1';
  if (p === 'high') return 'P2';
  if (p === 'medium' || p === 'normal') return 'P3';
  if (p === 'low') return 'P4';
  return null;
}

/**
 * Map an AppFolio status to our lifecycle stage (HDPM instance vocabulary,
 * confirmed against live data 2026-07-03: New / Assigned / Scheduled /
 * Estimate Requested / Estimated / Waiting / Work Completed / Completed /
 * Canceled).
 *
 *  - Assigned          → TRIAGED (vendor/tech picked; SCHEDULED if a visit date exists)
 *  - Estimate Requested→ WAITING_ON VENDOR (chasing a bid)
 *  - Estimated         → WAITING_ON OWNER (bid in hand, decision pending)
 *  - Waiting           → WAITING_ON INTERNAL (placeholder; Cheryl sets the real reason)
 */
export function mappedStageFor(wo: AppFolioWorkOrder): {
  stage: Stage;
  waiting_reason: WaitingReason | null;
} {
  if (wo.status === 'closed') return { stage: 'CLOSED', waiting_reason: null };
  if (wo.status === 'done') return { stage: 'VERIFY', waiting_reason: null };

  const s = (wo.appfolioStatus || '').toLowerCase().trim();
  if (s === 'estimate requested') return { stage: 'WAITING_ON', waiting_reason: 'VENDOR' };
  if (s === 'estimated') return { stage: 'WAITING_ON', waiting_reason: 'OWNER' };
  if (s === 'waiting') return { stage: 'WAITING_ON', waiting_reason: 'INTERNAL' };
  if (s === 'scheduled') return { stage: 'SCHEDULED', waiting_reason: null };
  if (s === 'assigned') {
    return { stage: wo.scheduledStart ? 'SCHEDULED' : 'TRIAGED', waiting_reason: null };
  }
  // 'new' or anything unrecognized: a concrete visit date beats a coarse status
  return { stage: wo.scheduledStart ? 'SCHEDULED' : 'NEW', waiting_reason: null };
}

export interface InitialWorkflow {
  stage: Stage;
  waiting_reason: WaitingReason | null;
  owner_name: string;
  next_action_date: string | null;
  priority_class: PriorityClass | null;
  origin: 'appfolio';
  closed_at: string | null;
}

/**
 * The Maintenance OS launch date. Work AppFolio completed BEFORE this predates
 * the six-condition closure gate — nobody will retroactively add photos/time/
 * materials — so it lands directly in CLOSED (grandfathered), exactly like the
 * one-time 20260703 backfill. Work completed on/after it goes to VERIFY and
 * must earn CLOSED through the gate.
 */
export const LAUNCH_CUTOFF = '2026-07-01';

/**
 * Workflow defaults for a work order first seen by the sync — stage from
 * mappedStageFor(); CLOSED for AppFolio-closed history and for work completed
 * before LAUNCH_CUTOFF (grandfathered, predates the gate).
 */
export function initialWorkflowFor(wo: AppFolioWorkOrder, today: Date): InitialWorkflow {
  let { stage, waiting_reason } = mappedStageFor(wo);

  // Standing grandfather rule: pre-launch completed history skips the gate.
  if (stage === 'VERIFY' && wo.completedDate && wo.completedDate < LAUNCH_CUTOFF) {
    stage = 'CLOSED';
    waiting_reason = null;
  }

  return {
    stage,
    waiting_reason,
    owner_name: 'Cheryl',
    next_action_date: stage === 'CLOSED' ? null : toDateString(nextBusinessDay(today)),
    priority_class: seedPriorityClass(wo.priority),
    origin: 'appfolio',
    closed_at:
      stage === 'CLOSED' ? wo.completedDate || wo.canceledDate || today.toISOString() : null,
  };
}

// ============================================
// Sync-driven stage automation (existing rows)
// ============================================

export interface StageAutomation {
  stage: Stage;
  waiting_reason?: WaitingReason;
  closed_at?: string;
  reason: string;
}

/**
 * The ONLY stage moves the sync may make on an existing row:
 *
 *  1. Canceled in AppFolio → CLOSED (gate bypassed — there's nothing to
 *     verify or bill on a canceled job).
 *  2. AppFolio reports work completed ("done") or the WO was closed in
 *     AppFolio without cancellation, while our stage is still before
 *     VERIFY → advance to VERIFY. It does NOT close it: CLOSED is only
 *     reachable through the six-condition gate.
 *  3. AppFolio drives the pre-completion pipeline: for any stage AppFolio can
 *     express (NEW / TRIAGED / SCHEDULED / WAITING_ON), an AppFolio status
 *     CHANGE moves our stage to match — in either direction. AppFolio is the
 *     system of record; staff edit those states there (deep link on the card)
 *     and this board follows. Two protections:
 *       - without a detected status change, forward-only catch-up applies
 *         from NEW/TRIAGED (so a locally set WAITING_ON reason isn't clobbered
 *         by an unchanged stale status)
 *       - IN_PROGRESS and VERIFY→BILL→CLOSED are app-owned (AppFolio has no
 *         equivalent); only cancel/complete can move a WO out of them.
 *
 * Returns null when no automation applies.
 */
export function stageAutomationFor(
  currentStage: Stage,
  wo: AppFolioWorkOrder,
  now: Date,
  /** appfolio_status as of the previous sync — enables change detection */
  prevAppfolioStatus?: string | null
): StageAutomation | null {
  if (currentStage === 'CLOSED') return null;

  if (wo.canceledDate) {
    return {
      stage: 'CLOSED',
      closed_at: wo.canceledDate || now.toISOString(),
      reason: 'canceled in AppFolio',
    };
  }

  const appfolioFinished = wo.status === 'done' || wo.status === 'closed';
  if (appfolioFinished && STAGE_ORDER[currentStage] < STAGE_ORDER.VERIFY) {
    return {
      stage: 'VERIFY',
      reason: `AppFolio status "${wo.appfolioStatus}" — awaiting verification + closure gate`,
    };
  }

  // Rule 3 applies only to the AppFolio-expressible stages.
  const appfolioOwnedStages: Stage[] = ['NEW', 'TRIAGED', 'SCHEDULED', 'WAITING_ON'];
  if (!appfolioOwnedStages.includes(currentStage)) return null;

  const mapped = mappedStageFor(wo);
  if (mapped.stage === 'CLOSED' || mapped.stage === 'VERIFY' || mapped.stage === currentStage) {
    return null;
  }

  const statusChanged =
    prevAppfolioStatus !== undefined &&
    prevAppfolioStatus !== null &&
    prevAppfolioStatus !== wo.appfolioStatus;

  // A real AppFolio status change wins in any direction; otherwise only
  // forward catch-up from the untriaged stages.
  const forwardCatchUp =
    (currentStage === 'NEW' || currentStage === 'TRIAGED') &&
    STAGE_ORDER[mapped.stage] > STAGE_ORDER[currentStage];

  if (statusChanged || forwardCatchUp) {
    return {
      stage: mapped.stage,
      ...(mapped.waiting_reason ? { waiting_reason: mapped.waiting_reason } : {}),
      reason: `AppFolio status "${wo.appfolioStatus}"${statusChanged ? ` (was "${prevAppfolioStatus}")` : ''}`,
    };
  }

  return null;
}
