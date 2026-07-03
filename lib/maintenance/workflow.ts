/**
 * Maintenance OS — workflow state machine + closure gate (pure logic).
 *
 * Behavioral contract: docs/maintenance-os/02-functional-spec.md.
 * Everything here is pure and unit-tested; DB access (context gathering and
 * the single write path `updateWorkOrderWorkflow`) lives in workflow-db.ts.
 */

import type {
  ClosureGateContext,
  ClosureGateResult,
  Stage,
  WaitingReason,
} from './types';
import { WAITING_REASONS } from './types';

// ============================================
// Stage transitions
// ============================================

export const STAGE_ORDER: Record<Stage, number> = {
  NEW: 0,
  TRIAGED: 1,
  SCHEDULED: 2,
  IN_PROGRESS: 3,
  WAITING_ON: 4,
  VERIFY: 5,
  BILL: 6,
  CLOSED: 7,
};

/**
 * Allowed user-driven transitions. Backward moves model real life:
 * failed access returns IN_PROGRESS → SCHEDULED, a failed verify returns
 * VERIFY → IN_PROGRESS. CLOSED is terminal — negative tenant replies spawn
 * a follow-up WO, they don't reopen this one.
 *
 * System overrides (sync automation) may additionally jump any stage to
 * VERIFY (AppFolio reports completed) or CLOSED (canceled in AppFolio).
 */
export const ALLOWED_TRANSITIONS: Record<Stage, Stage[]> = {
  NEW: ['TRIAGED', 'WAITING_ON'],
  TRIAGED: ['SCHEDULED', 'WAITING_ON'],
  SCHEDULED: ['IN_PROGRESS', 'WAITING_ON', 'TRIAGED'],
  IN_PROGRESS: ['VERIFY', 'WAITING_ON', 'SCHEDULED'],
  WAITING_ON: ['TRIAGED', 'SCHEDULED', 'IN_PROGRESS', 'VERIFY'],
  VERIFY: ['BILL', 'IN_PROGRESS'],
  BILL: ['CLOSED', 'VERIFY'],
  CLOSED: [],
};

/** The workflow fields a transition can touch. */
export interface WorkflowState {
  stage: Stage;
  waiting_reason: WaitingReason | null;
  owner_name: string | null;
  next_action_date: string | null;
  priority_class: string | null;
  assigned_tech: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
}

export type WorkflowPatch = Partial<WorkflowState> & {
  verified_by?: string | null;
  verified_at?: string | null;
  tenant_ping_sent?: boolean;
  preventive_scheduled?: boolean | null;
  aging_reason?: string | null;
  is_turn?: boolean;
  origin?: string;
  closed_at?: string | null;
};

/** Extra context needed only when moving into BILL or CLOSED. */
export interface TransitionContext {
  /** Rule 7: docs required before BILL — photos + time + materials. */
  docs?: { photoCount: number; hasTime: boolean; hasMaterials: boolean };
  /** Rule 6: scope-change events without a matching approved approval. */
  unapprovedScopeChanges?: number;
  /** Closure gate result — required for → CLOSED. */
  gate?: ClosureGateResult;
}

export interface TransitionOptions {
  /**
   * Sync automation: transitions follow the AppFolio status mapping rather
   * than the user-facing stage graph, and skip the gate/doc/soft rules.
   * Hard invariants (WAITING_ON reason, owner + date on open WOs) still apply.
   */
  systemOverride?: boolean;
}

/**
 * Validate a workflow patch against the current state. Returns a list of
 * human-readable errors; empty = allowed. Pure.
 */
export function validateTransition(
  current: WorkflowState,
  patch: WorkflowPatch,
  ctx: TransitionContext = {},
  opts: TransitionOptions = {}
): string[] {
  const errors: string[] = [];
  const next: WorkflowState = { ...current, ...patch } as WorkflowState;
  const targetStage = next.stage;
  const stageChanging = patch.stage !== undefined && patch.stage !== current.stage;

  // ── Stage graph (system moves follow the AppFolio mapping instead) ──
  if (stageChanging && !opts.systemOverride) {
    const allowed = ALLOWED_TRANSITIONS[current.stage] ?? [];
    if (!allowed.includes(targetStage)) {
      errors.push(`Transition ${current.stage} → ${targetStage} is not allowed`);
    }
  }

  // ── WAITING_ON requires a reason (hard invariant, mirrors DB constraint) ──
  if (targetStage === 'WAITING_ON') {
    if (!next.waiting_reason) {
      errors.push('WAITING_ON requires a waiting_reason (TENANT/VENDOR/PARTS/OWNER/WEATHER/INTERNAL)');
    } else if (!WAITING_REASONS.includes(next.waiting_reason)) {
      errors.push(`Invalid waiting_reason: ${next.waiting_reason}`);
    }
  }

  // ── Open WOs always have ONE named owner and a next-action date ──
  if (targetStage !== 'CLOSED') {
    if (!next.owner_name) {
      errors.push('Every open work order needs a named HDPM owner (accountable team member)');
    }
    if (!next.next_action_date) {
      errors.push('Every open work order needs a next_action_date');
    }
  }

  // ── Priority required once TRIAGED (soft rule → enforced here, not in DB) ──
  if (
    stageChanging &&
    STAGE_ORDER[targetStage] >= STAGE_ORDER.TRIAGED &&
    targetStage !== 'CLOSED' &&
    !next.priority_class &&
    !opts.systemOverride
  ) {
    errors.push('priority_class (P1–P4) is required from TRIAGED onward');
  }

  // ── Vendor or tech required from SCHEDULED onward ──
  if (
    stageChanging &&
    STAGE_ORDER[targetStage] >= STAGE_ORDER.SCHEDULED &&
    targetStage !== 'CLOSED' &&
    targetStage !== 'WAITING_ON' &&
    !next.assigned_tech &&
    !next.vendor_id &&
    !next.vendor_name &&
    !opts.systemOverride
  ) {
    errors.push('A vendor or tech must be assigned from SCHEDULED onward');
  }

  // ── Rule 7: VERIFY → BILL blocked without photos + time + materials ──
  if (stageChanging && targetStage === 'BILL' && !opts.systemOverride) {
    const docs = ctx.docs;
    if (!docs) {
      errors.push('Cannot move to BILL: documentation status unknown');
    } else {
      if (docs.photoCount === 0) errors.push('Cannot move to BILL: no photos recorded (tripwire #7)');
      if (!docs.hasTime) errors.push('Cannot move to BILL: no time logged (tripwire #7)');
      if (!docs.hasMaterials) errors.push('Cannot move to BILL: materials not logged (tripwire #7)');
    }
    // ── Rule 6: no bill without matching approval for scope changes ──
    if ((ctx.unapprovedScopeChanges ?? 0) > 0) {
      errors.push(
        `Cannot move to BILL: ${ctx.unapprovedScopeChanges} scope change(s) without matching approval (tripwire #6)`
      );
    }
  }

  // ── Closure gate: all six conditions or no CLOSED ──
  if (stageChanging && targetStage === 'CLOSED' && !opts.systemOverride) {
    if (!ctx.gate) {
      errors.push('Cannot close: closure gate not evaluated');
    } else if (!ctx.gate.passed) {
      for (const f of ctx.gate.failures) {
        errors.push(`Closure gate condition ${f.condition} failed: ${f.label}`);
      }
    }
  }

  return errors;
}

/**
 * Fields that should be auto-adjusted alongside a stage change.
 * Pure — returns additional patch fields.
 */
export function autoPatchForTransition(
  current: WorkflowState,
  patch: WorkflowPatch
): Partial<WorkflowPatch> {
  const auto: Partial<WorkflowPatch> = {};
  const targetStage = patch.stage ?? current.stage;

  // Leaving WAITING_ON clears the reason unless explicitly re-set.
  if (
    current.stage === 'WAITING_ON' &&
    targetStage !== 'WAITING_ON' &&
    patch.waiting_reason === undefined
  ) {
    auto.waiting_reason = null;
  }

  return auto;
}

// ============================================
// Closure gate (02-functional-spec.md §3) — all six or no CLOSED
// ============================================

export const CLOSURE_CONDITION_LABELS: Record<1 | 2 | 3 | 4 | 5 | 6, string> = {
  1: 'Verification recorded (verified_by + verified_at)',
  2: 'Invoice generated and linked to the work order',
  3: 'Follow-up recommendations resolved (new WO or written dismissal)',
  4: 'Tenant confirmation ping sent',
  5: 'Failed-access / scope-change events documented',
  6: 'Next preventive item scheduled (where applicable)',
};

export function evaluateClosureGate(ctx: ClosureGateContext): ClosureGateResult {
  const failures: ClosureGateResult['failures'] = [];

  if (!ctx.verifiedAt || !ctx.verifiedBy) {
    failures.push({ condition: 1, label: CLOSURE_CONDITION_LABELS[1] });
  }
  if (!ctx.hasInvoice) {
    failures.push({ condition: 2, label: CLOSURE_CONDITION_LABELS[2] });
  }
  if (ctx.openRecommendations > 0) {
    failures.push({ condition: 3, label: CLOSURE_CONDITION_LABELS[3] });
  }
  if (!ctx.tenantPingSent) {
    failures.push({ condition: 4, label: CLOSURE_CONDITION_LABELS[4] });
  }
  if (ctx.undocumentedIncidents > 0) {
    failures.push({ condition: 5, label: CLOSURE_CONDITION_LABELS[5] });
  }
  // Tri-state: null = not applicable (passes), false = applicable and unscheduled.
  if (ctx.preventiveScheduled === false) {
    failures.push({ condition: 6, label: CLOSURE_CONDITION_LABELS[6] });
  }

  return { passed: failures.length === 0, failures };
}
