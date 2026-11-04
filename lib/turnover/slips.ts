/**
 * Unit turn slips — which step of a turn is late today. Pure and date-injectable.
 *
 * Starting numbers for the two-week trial with Brody (from 2026-11-04). Deadlines count
 * business days from the move-out date, or from the first weekday if it fell on a weekend.
 */
import {
  FINAL_STATUSES,
  addDays,
  businessDaysBetween,
  effectiveStatus,
  type CheckState,
  type TrackerWo,
  type WoStatus,
} from './model';

export const SLIP_RULES = {
  /** Checklist slips only apply from here on: older turns never used the checklist. */
  checklistFrom: '2026-11-04',
  keysDays: 0,
  inspectionDays: 1,
  noWorkOrdersDays: 2,
  ownerAndDateDays: 3,
  readyDays: 1,
};

/** Already chased on the Chase board, so linked there and not reminded twice. */
export const CHASE_BOARD_STATUSES: ReadonlySet<WoStatus> = new Set(['estimate_requested', 'estimated', 'awaiting_owner_approval']);
const WORK_DONE: ReadonlySet<WoStatus> = new Set([...FINAL_STATUSES, 'completed_awaiting_invoice']);

/** Slip key → the checklist item its Done button ticks. */
export const SLIP_DONE_KEYS: Record<string, string> = {
  keys: 'keys_received',
  inspection: 'moveout_inspection',
  ready: 'ready_for_showing',
};

export type SlipKind = 'keys' | 'inspection' | 'no_work_orders' | 'wo_owner' | 'wo_date' | 'wo_vendor_date' | 'ready';

export interface SlipWo extends TrackerWo {
  wo_number: string | null;
  scheduled_start: string | null;
  completed_date: string | null;
  assigned_to: string | null;
  vendor_name: string | null;
  created_at: string;
  turn_snoozed_until: string | null;
}

export interface SlipTurn {
  id: string;
  unit: string;
  vacated_at: string;
  coordinator: string | null;
  status: string;
  wos: SlipWo[];
  checks: Record<string, CheckState | undefined>;
}

export interface Slip {
  key: string;
  kind: SlipKind;
  turnId: string;
  unit: string;
  coordinator: string | null;
  woId?: string;
  text: string;
  daysLate: number;
  /** The checklist item Done ticks. Work order slips have none: that fact lives in AppFolio. */
  doneKey?: string;
}

function firstWeekday(date: string): string {
  let d = date.slice(0, 10);
  for (let dow = new Date(`${d}T00:00:00Z`).getUTCDay(); dow === 0 || dow === 6; dow = new Date(`${d}T00:00:00Z`).getUTCDay()) d = addDays(d, 1);
  return d;
}

/** Business days past the deadline, 0 when not late. */
function late(from: string, allowed: number, today: string): number {
  return Math.max(0, businessDaysBetween(firstWeekday(from), today) - allowed);
}

const woName = (w: SlipWo) => `WO ${w.wo_number || w.id.slice(0, 8)}`;

/** Every work order finished, at least one of them real. */
export function workDone(wos: Pick<SlipWo, keyof TrackerWo>[]): boolean {
  const statuses = wos.map((w) => effectiveStatus(w).status);
  return statuses.some((s) => s !== 'cancelled') && statuses.every((s) => WORK_DONE.has(s));
}

/** All the work is done and the move-in date has passed, but nobody closed the turn. */
export function looksFinished(turn: { status: string; movein_date: string | null; wos: Pick<SlipWo, keyof TrackerWo>[] }, today: string): boolean {
  return turn.status !== 'closed' && !!turn.movein_date && turn.movein_date.slice(0, 10) < today && workDone(turn.wos);
}

export function computeSlips(turn: SlipTurn, today: string, snoozedUntil: Record<string, string | undefined> = {}): Slip[] {
  if (turn.status === 'closed' || turn.vacated_at.slice(0, 10) > today) return [];
  const out: Slip[] = [];
  const base = { turnId: turn.id, unit: turn.unit, coordinator: turn.coordinator };
  const checked = (key: string) => !!turn.checks[key]?.checked;
  const vacated = turn.vacated_at.slice(0, 10);
  const inChecklist = vacated >= SLIP_RULES.checklistFrom;

  if (inChecklist) {
    const keys = late(vacated, SLIP_RULES.keysDays, today);
    if (keys > 0 && !checked('keys_received')) out.push({ ...base, key: 'keys', kind: 'keys', text: 'Keys not marked received', daysLate: keys, doneKey: SLIP_DONE_KEYS.keys });
    const inspection = late(vacated, SLIP_RULES.inspectionDays, today);
    if (inspection > 0 && !checked('moveout_inspection')) out.push({ ...base, key: 'inspection', kind: 'inspection', text: 'Move-out inspection not marked done', daysLate: inspection, doneKey: SLIP_DONE_KEYS.inspection });
  }

  if (turn.wos.length === 0) {
    const none = late(vacated, SLIP_RULES.noWorkOrdersDays, today);
    if (none > 0) out.push({ ...base, key: 'no_work_orders', kind: 'no_work_orders', text: 'No work orders yet', daysLate: none });
  }

  for (const w of turn.wos) {
    if (w.turn_snoozed_until && w.turn_snoozed_until >= today) continue;
    const status = effectiveStatus(w).status;
    if (WORK_DONE.has(status) || CHASE_BOARD_STATUSES.has(status)) continue;
    const date = w.scheduled_start?.slice(0, 10) ?? null;
    if (date && date < today) {
      out.push({ ...base, key: `wo_vendor_date:${w.id}`, kind: 'wo_vendor_date', woId: w.id, text: `${woName(w)} was scheduled ${date} and is still open`, daysLate: businessDaysBetween(date, today) });
      continue;
    }
    // A work order added late to an old turn still gets its full time.
    const from = w.created_at.slice(0, 10) > vacated ? w.created_at.slice(0, 10) : vacated;
    const days = late(from, SLIP_RULES.ownerAndDateDays, today);
    if (days === 0) continue;
    if (!w.assigned_to && !w.vendor_name) out.push({ ...base, key: `wo_owner:${w.id}`, kind: 'wo_owner', woId: w.id, text: `${woName(w)} has no owner or vendor`, daysLate: days });
    else if (!date) out.push({ ...base, key: `wo_date:${w.id}`, kind: 'wo_date', woId: w.id, text: `${woName(w)} has no scheduled date`, daysLate: days });
  }

  if (inChecklist && !checked('ready_for_showing') && workDone(turn.wos)) {
    const finished = turn.wos.map((w) => w.completed_date?.slice(0, 10)).filter((d): d is string => !!d).sort().pop();
    const ready = finished ? late(finished, SLIP_RULES.readyDays, today) : 0;
    if (ready > 0) out.push({ ...base, key: 'ready', kind: 'ready', text: 'Work is done but the unit is not marked ready for showing', daysLate: ready, doneKey: SLIP_DONE_KEYS.ready });
  }

  return out.filter((s) => (snoozedUntil[s.key] ?? '') < today);
}

/** Longest late first. */
export function sortSlips(slips: Slip[]): Slip[] {
  return [...slips].sort((a, b) => b.daysLate - a.daysLate || a.unit.localeCompare(b.unit));
}
