/**
 * Turn Estimator — turn lifecycle state machine (Slice 1). Pure, unit-tested.
 *
 * The spec's controlled 15-state chain plus exception states. Modeled on the
 * work-order workflow (lib/maintenance/workflow.ts): a transition table + guards,
 * no I/O. This drives a new unit_turn.lifecycle_status column; the legacy 3-state
 * unit_turn.status (active/ready/closed) is derived from it so the existing
 * turnover board keeps working untouched.
 */

/** The main lifecycle chain, in order (spec §4). */
export const TURN_STATES = [
  'NOTICE_RECEIVED',
  'INSPECTION_SCHEDULED',
  'INSPECTED',
  'SCOPE_DRAFT',
  'ESTIMATE_READY',
  'APPROVAL_PENDING',
  'APPROVED',
  'SCHEDULED',
  'IN_PROGRESS',
  'QC_PENDING',
  'TURN_READY',
  'INVOICE_REVIEW',
  'INVOICED',
  'POSTED',
  'CLOSED',
] as const;

/** Exception states that branch off the main chain (spec §4). */
export const TURN_EXCEPTION_STATES = [
  'ON_HOLD_OWNER',
  'ON_HOLD_PARTS',
  'ON_HOLD_VENDOR',
  'CHANGE_ORDER_PENDING',
  'DISPUTED',
  'CANCELLED',
] as const;

export type TurnState = (typeof TURN_STATES)[number];
export type TurnExceptionState = (typeof TURN_EXCEPTION_STATES)[number];
export type TurnLifecycleStatus = TurnState | TurnExceptionState;

export const ALL_TURN_STATUSES: readonly TurnLifecycleStatus[] = [
  ...TURN_STATES,
  ...TURN_EXCEPTION_STATES,
];

export function isTurnStatus(s: string): s is TurnLifecycleStatus {
  return (ALL_TURN_STATUSES as readonly string[]).includes(s);
}
export function isMainState(s: string): s is TurnState {
  return (TURN_STATES as readonly string[]).includes(s);
}
export function isExceptionState(s: string): s is TurnExceptionState {
  return (TURN_EXCEPTION_STATES as readonly string[]).includes(s);
}
/** Terminal states — no transitions out. */
export function isTerminalState(s: string): boolean {
  return s === 'CLOSED' || s === 'CANCELLED';
}

/**
 * Whether `to` is a permitted transition from `from`.
 *
 * Rules:
 *  - No self-transition; nothing leaves a terminal state.
 *  - CANCELLED is reachable from any non-terminal state.
 *  - An exception state (hold/change-order/disputed) is entered only from a main
 *    state; leaving an exception resumes to any main state (coordinator picks).
 *  - Main→main is the immediate next step, plus two explicit edges:
 *    ESTIMATE_READY→APPROVED (auto-approval skips APPROVAL_PENDING) and
 *    APPROVAL_PENDING→SCOPE_DRAFT (changes requested / declined → redraft).
 */
export function canTransition(from: string, to: string): boolean {
  if (!isTurnStatus(from) || !isTurnStatus(to)) return false;
  if (from === to) return false;
  if (isTerminalState(from)) return false;
  if (to === 'CANCELLED') return true;
  if (isExceptionState(to)) return !isExceptionState(from);
  // `to` is a main state:
  if (isExceptionState(from)) return true; // resume from an exception
  const i = TURN_STATES.indexOf(from as TurnState);
  const j = TURN_STATES.indexOf(to as TurnState);
  if (j === i + 1) return true; // linear next
  if (from === 'ESTIMATE_READY' && to === 'APPROVED') return true;
  if (from === 'APPROVAL_PENDING' && to === 'SCOPE_DRAFT') return true;
  return false;
}

/** Permitted next statuses from a given state (for UI buttons). */
export function allowedNext(from: string): TurnLifecycleStatus[] {
  return ALL_TURN_STATUSES.filter((s) => canTransition(from, s));
}

/**
 * Derive the legacy 3-state unit_turn.status from the lifecycle status, so the
 * existing turnover board/tripwires keep reading a value they understand.
 */
export function deriveLegacyStatus(lifecycle: string): 'active' | 'ready' | 'closed' {
  if (lifecycle === 'CLOSED' || lifecycle === 'CANCELLED') return 'closed';
  if (['TURN_READY', 'INVOICE_REVIEW', 'INVOICED', 'POSTED'].includes(lifecycle)) return 'ready';
  return 'active';
}

/** Human label for a status. */
export function turnStatusLabel(s: string): string {
  return s
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
