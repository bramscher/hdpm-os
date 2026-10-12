/**
 * Unit Turnover Tracker — the pure core (Brody's PRD 2026-10-09, decisions
 * 2026-10-12; see docs/turnover-tracker/01-gap-analysis.md).
 *
 * Everything here is DB-free and date-injectable: which of the 7 sections a
 * work order belongs to, the 11-status tracker model layered over AppFolio's
 * status, how each section rolls up, the checklist, and the dashboard views.
 */

// ── Sections ────────────────────────────────────────────────────────────────

export type SectionNo = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const SECTIONS: { no: SectionNo; title: string; short: string; source: string }[] = [
  { no: 1, title: 'Keys, inspection, lockbox, showing', short: '1. Keys, inspection, lockbox', source: 'Work orders from AppFolio category: Keys / Locks' },
  { no: 2, title: 'Cleaning and carpet cleaning', short: '2. Cleaning, carpet', source: 'Work orders from AppFolio category: Housekeeping' },
  { no: 3, title: 'Maintenance work orders', short: '3. Work orders', source: 'Every other AppFolio category. No category needs a work order.' },
  { no: 4, title: 'Advertising and follow-up inspection', short: '4. Advertising', source: 'Follow-up inspection: AppFolio category Other, title contains "Maintenance Follow Up"' },
  { no: 5, title: 'Ready for showing, updated on Haven', short: '5. Ready, on Haven', source: 'Manual checklist' },
  { no: 6, title: 'Invoices and close-out', short: '6. Invoices, close-out', source: 'Invoice check is calculated from the work order statuses' },
  { no: 7, title: 'Lockbox pulled', short: '7. Lockbox pulled', source: 'Manual checklist' },
];

const FOLLOW_UP = /maintenance\s+follow[\s-]*up/i;

export function isFollowUpInspection(wo: { unit_turn_category: string | null; description: string | null }): boolean {
  return (wo.unit_turn_category ?? '').trim().toLowerCase() === 'other' && FOLLOW_UP.test(wo.description ?? '');
}

/** AppFolio Turn Board category → section. Unknown / manual links (no category) land in 3. */
export function sectionFor(wo: { unit_turn_category: string | null; description: string | null }): SectionNo {
  const cat = (wo.unit_turn_category ?? '').trim().toLowerCase();
  if (cat === 'keys / locks') return 1;
  if (cat === 'housekeeping') return 2;
  if (isFollowUpInspection(wo)) return 4;
  return 3;
}

// ── Work-order status model ─────────────────────────────────────────────────

export const WO_STATUSES = [
  'unassigned',
  'assigned',
  'estimate_requested',
  'estimated',
  'awaiting_owner_approval',
  'awaiting_owner_funds',
  'scheduled',
  'completed_awaiting_invoice',
  'complete_invoice_received',
  'complete_no_bill',
  'cancelled',
] as const;
export type WoStatus = (typeof WO_STATUSES)[number];

export const WO_STATUS_LABEL: Record<WoStatus, string> = {
  unassigned: 'Unassigned',
  assigned: 'Assigned',
  estimate_requested: 'Estimate requested',
  estimated: 'Estimated',
  awaiting_owner_approval: 'Estimated, awaiting owner approval',
  awaiting_owner_funds: 'Estimate, awaiting owner funds',
  scheduled: 'Scheduled',
  completed_awaiting_invoice: 'Completed, awaiting invoice',
  complete_invoice_received: 'Complete, invoice received',
  complete_no_bill: 'Complete, no bill needed',
  cancelled: 'Cancelled',
};

/** Finished work orders: they count as "invoice received" for section 6. */
export const FINAL_STATUSES: ReadonlySet<WoStatus> = new Set(['complete_invoice_received', 'complete_no_bill', 'cancelled']);

export function isWoStatus(s: unknown): s is WoStatus {
  return typeof s === 'string' && (WO_STATUSES as readonly string[]).includes(s);
}

export interface TrackerWo {
  id: string;
  unit_turn_category: string | null;
  description: string | null;
  appfolio_status: string | null;
  /** Coarse mirror status: open | done | closed. */
  status: string | null;
  canceled_date: string | null;
  turn_status: string | null;
  turn_status_af_basis: string | null;
  /** True when one of our own invoices is linked to this work order. */
  has_linked_invoice?: boolean;
}

/** The tracker status AppFolio's status implies, with nobody overriding it. */
export function statusFromAppFolio(wo: TrackerWo): WoStatus {
  const s = (wo.appfolio_status ?? '').trim().toLowerCase();
  const canceled = s === 'canceled' || s === 'cancelled' || (wo.status === 'closed' && !!wo.canceled_date);
  if (canceled) return 'cancelled';
  const done = wo.status === 'done' || wo.status === 'closed' || s === 'completed' || s === 'work completed' || s === 'work done';
  if (done) {
    if (wo.has_linked_invoice) return 'complete_invoice_received';
    // The follow-up inspection defaults to no bill; a user can change it if one arrives.
    if (isFollowUpInspection(wo)) return 'complete_no_bill';
    return 'completed_awaiting_invoice';
  }
  if (s === 'assigned' || s === 'waiting') return 'assigned';
  if (s === 'estimate requested') return 'estimate_requested';
  if (s === 'estimated') return 'estimated';
  if (s === 'scheduled') return 'scheduled';
  return 'unassigned';
}

/**
 * The status to show. The most recent update wins: a hand-set status holds
 * until AppFolio's own status changes (it was set while AppFolio said
 * `turn_status_af_basis`); after that AppFolio's status takes over again.
 */
export function effectiveStatus(wo: TrackerWo): { status: WoStatus; source: 'appfolio' | 'manual' } {
  if (isWoStatus(wo.turn_status) && (wo.turn_status_af_basis ?? '') === (wo.appfolio_status ?? '')) {
    return { status: wo.turn_status, source: 'manual' };
  }
  return { status: statusFromAppFolio(wo), source: 'appfolio' };
}

// ── Checklist ───────────────────────────────────────────────────────────────

export type CheckKind = 'manual' | 'computed';

export interface CheckDef {
  key: string;
  section: SectionNo;
  label: string;
  kind: CheckKind;
  optional?: boolean;
  /** A value captured alongside the tick. */
  value?: { label: string; type: 'text' | 'date' | 'url' };
  hint?: string;
  /** A ticked computed check moves its section to "in progress" unless this is false. */
  showsProgress?: boolean;
}

export const CHECKS: CheckDef[] = [
  { key: 'keys_received', section: 1, label: 'Keys received', kind: 'manual' },
  { key: 'moveout_inspection', section: 1, label: 'Move-out inspection done', kind: 'manual' },
  { key: 'lockbox_assigned', section: 1, label: 'Lockbox assigned', kind: 'manual', value: { label: 'Box number', type: 'text' } },
  { key: 'showing_set', section: 1, label: 'Showing status set', kind: 'manual', value: { label: 'Showing date', type: 'date' } },
  { key: 'listing_photos', section: 4, label: 'Listing photos updated', kind: 'manual', hint: 'Can be checked early' },
  { key: 'listing_details', section: 4, label: 'Listing details updated', kind: 'manual', hint: 'Can be checked early' },
  { key: 'walkthrough_video', section: 4, label: 'Walkthrough video uploaded', kind: 'manual', optional: true, value: { label: 'Video link', type: 'url' }, hint: 'Optional' },
  { key: 'ready_for_showing', section: 5, label: 'Unit marked ready for showing', kind: 'manual' },
  { key: 'haven_updated', section: 5, label: 'Status updated on Haven', kind: 'manual' },
  { key: 'invoices_received', section: 6, label: 'Invoices received for all work orders', kind: 'computed', showsProgress: false, hint: 'Calculated from the work order statuses' },
  { key: 'closed_in_appfolio', section: 6, label: 'Unit turn closed out in AppFolio', kind: 'manual' },
  { key: 'deposit_slip_sent', section: 6, label: 'Deposit return slip sent to tenant', kind: 'manual' },
  { key: 'movein_entered', section: 7, label: 'New tenant move-in date entered', kind: 'computed', hint: 'From AppFolio' },
  // Brody 2026-10-12: may be ticked before move-in (owner close-out and similar).
  { key: 'lockbox_pulled', section: 7, label: 'Lockbox pulled', kind: 'manual' },
];

export const CHECK_BY_KEY = new Map(CHECKS.map((c) => [c.key, c]));

export interface CheckState {
  checked: boolean;
  value: string | null;
  checked_at: string | null;
  checked_by: string | null;
}

// ── Rollup ──────────────────────────────────────────────────────────────────

export type SectionStatus =
  | 'not_started'
  | 'in_progress'
  | 'estimated'
  | 'awaiting_approval'
  | 'awaiting_funds'
  | 'estimate_requested'
  | 'complete';

export const SECTION_STATUS_LABEL: Record<SectionStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  estimated: 'Estimated',
  awaiting_approval: 'Waiting: owner approval',
  awaiting_funds: 'Waiting: funding',
  estimate_requested: 'Estimate requested',
  complete: 'Complete',
};

/** Worst first (Brody 2026-10-12: estimate requested leads). */
const STUCK_ORDER: [WoStatus, SectionStatus][] = [
  ['estimate_requested', 'estimate_requested'],
  ['awaiting_owner_funds', 'awaiting_funds'],
  ['awaiting_owner_approval', 'awaiting_approval'],
  ['estimated', 'estimated'],
];

export interface SectionInput {
  /** Required (non-optional) checks of the section: is each ticked? */
  required: boolean[];
  /** Any check of the section ticked, optional ones included. */
  anyTicked: boolean;
  woStatuses: WoStatus[];
}

/**
 * Complete when every required check is ticked and every work order is
 * final (an empty section is complete). Otherwise the most stuck work order
 * names it; failing that it's in progress once anything has moved.
 */
export function rollupSection(input: SectionInput): SectionStatus {
  const open = input.woStatuses.filter((s) => !FINAL_STATUSES.has(s));
  if (input.required.every(Boolean) && open.length === 0) return 'complete';
  for (const [wo, section] of STUCK_ORDER) if (open.includes(wo)) return section;
  const moved = input.anyTicked || input.woStatuses.some((s) => s !== 'unassigned');
  return moved ? 'in_progress' : 'not_started';
}

// ── A turn, assembled ───────────────────────────────────────────────────────

export interface TurnInput {
  vacated_at: string;
  movein_date: string | null;
  status: string;
  wos: TrackerWo[];
  checks: Record<string, CheckState | undefined>;
}

export interface SectionView {
  no: SectionNo;
  status: SectionStatus;
  checks: { def: CheckDef; checked: boolean; state?: CheckState }[];
  woIds: string[];
  /** Short line under the status pill on the dashboard. */
  detail: string;
}

export const DEPOSIT_SLIP_DAYS = 30;

/** YYYY-MM-DD + n days (UTC date math; inputs are plain dates). */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function depositSlipDue(vacatedAt: string): string {
  return addDays(vacatedAt, DEPOSIT_SLIP_DAYS);
}

/** Whole business days (Mon–Fri) from `from` to `to`, exclusive of `from`. */
export function businessDaysBetween(from: string, to: string): number {
  let n = 0;
  let d = from.slice(0, 10);
  const end = to.slice(0, 10);
  while (d < end) {
    d = addDays(d, 1);
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) n++;
  }
  return n;
}

export function buildSections(turn: TurnInput): SectionView[] {
  const statuses = new Map(turn.wos.map((w) => [w.id, effectiveStatus(w).status]));
  const allFinal = turn.wos.every((w) => FINAL_STATUSES.has(statuses.get(w.id)!));

  const computed = (key: string): boolean => {
    if (key === 'invoices_received') return allFinal;
    if (key === 'movein_entered') return !!turn.movein_date;
    return false;
  };

  return SECTIONS.map(({ no }) => {
    const defs = CHECKS.filter((c) => c.section === no);
    const checks = defs.map((def) => {
      const state = turn.checks[def.key];
      return { def, state, checked: def.kind === 'computed' ? computed(def.key) : !!state?.checked };
    });
    const wos = turn.wos.filter((w) => sectionFor(w) === no);
    const woStatuses = wos.map((w) => statuses.get(w.id)!);
    const status = rollupSection({
      required: checks.filter((c) => !c.def.optional).map((c) => c.checked),
      anyTicked: checks.some((c) => c.checked && c.def.showsProgress !== false),
      woStatuses,
    });
    return { no, status, checks, woIds: wos.map((w) => w.id), detail: sectionDetail(no, checks, woStatuses, turn) };
  });
}

function sectionDetail(
  no: SectionNo,
  checks: { def: CheckDef; checked: boolean; state?: CheckState }[],
  woStatuses: WoStatus[],
  turn: TurnInput
): string {
  if (no === 6) {
    const sent = checks.find((c) => c.def.key === 'deposit_slip_sent')?.checked;
    return sent ? 'Deposit slip sent' : `Deposit slip due ${depositSlipDue(turn.vacated_at)}`;
  }
  if (no === 1) {
    const showing = checks.find((c) => c.def.key === 'showing_set');
    if (showing?.checked && showing.state?.value) return `Showing ${showing.state.value}`;
  }
  if (no === 7 && turn.movein_date && !checks.find((c) => c.def.key === 'lockbox_pulled')?.checked) {
    return `Move-in ${turn.movein_date}`;
  }
  if (woStatuses.length > 0) {
    const done = woStatuses.filter((s) => FINAL_STATUSES.has(s)).length;
    return `${done} of ${woStatuses.length} work orders done`;
  }
  const manual = checks.filter((c) => !c.def.optional);
  if (manual.length > 0) return `${manual.filter((c) => c.checked).length} of ${manual.length} checked`;
  return '';
}

// ── Dashboard views ─────────────────────────────────────────────────────────

export type TurnView = 'active' | 'not_yet_ready' | 'completed' | 'all';

export const VIEW_LABEL: Record<TurnView, string> = {
  active: 'Active',
  not_yet_ready: 'Not yet ready',
  completed: 'Completed',
  all: 'All',
};

/** Active from the AppFolio move-out date until marked complete. */
export function viewOf(turn: { status: string; vacated_at: string }, today: string): Exclude<TurnView, 'all'> {
  if (turn.status === 'closed') return 'completed';
  return turn.vacated_at.slice(0, 10) <= today ? 'active' : 'not_yet_ready';
}

export function inView(turn: { status: string; vacated_at: string }, view: TurnView, today: string): boolean {
  return view === 'all' || viewOf(turn, today) === view;
}

/** Grace before "Completed, awaiting invoice" counts as needing action (Brody: 5 business days). */
export const INVOICE_GRACE_BUSINESS_DAYS = 5;

/** Items overdue or needing action on one turn: an overdue deposit slip, invoices past grace. */
export function needsAction(
  turn: TurnInput,
  sections: SectionView[],
  woStatusSince: Record<string, string | null>,
  today: string
): string[] {
  const out: string[] = [];
  const slip = sections.find((s) => s.no === 6)?.checks.find((c) => c.def.key === 'deposit_slip_sent');
  if (turn.status !== 'closed' && !slip?.checked && depositSlipDue(turn.vacated_at) < today) out.push('Deposit slip overdue');
  for (const wo of turn.wos) {
    if (effectiveStatus(wo).status !== 'completed_awaiting_invoice') continue;
    const since = woStatusSince[wo.id];
    if (since && businessDaysBetween(since, today) > INVOICE_GRACE_BUSINESS_DAYS) out.push('Invoice overdue');
  }
  return out;
}

/** Today as YYYY-MM-DD in Pacific time. */
export function todayPacific(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(now);
}
