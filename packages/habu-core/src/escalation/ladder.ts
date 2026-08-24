/**
 * Escalation ladder (§3) — the safety answer for agent seats: aged/recurring
 * exceptions and twice-missed to-dos become filed Issues, routed UP a human
 * escalation path. Agents file, never solve.
 *
 * Generic ladder logic extracted from hdpm-os lib/eos/escalation.ts, MINUS the
 * tripwire-specific parts (`decideTripwireIssues`, the estimate-chaser
 * `buildEscalationIssue`, tripwire #11, TripwireException) — those stay tenant
 * side. Pure/DB-free; the run wrapper (tenant) persists and dispatches.
 */

import { resolveEscalationSeat } from '../eos/seat';
import type { Seat } from '../eos/types';
import type { WatcherHit } from '../watcher/engine';

export const ESCALATION_ACTOR = 'system:escalation';

// Generic default priorities (lower = more urgent). Tenants may override.
// Watcher hits are prioritized by SEVERITY, not by watcher kind.
export const PRIORITY_WATCHER_NOW = 2;
export const PRIORITY_WATCHER_SOON = 3;
export const PRIORITY_TODO_TWICE_MISSED = 3;

/** A rolled to-do that slips again is filed as an issue this many days out. */
export const TODO_ROLL_EXTENSION_DAYS = 7;

export interface IssueDraft {
  title: string;
  detail: string;
  raised_by: string; // actor: 'system:escalation' | 'agent:<name>' | 'watcher:<rule>'
  source_ref: string; // stable dedupe key
  priority: number;
  /** The human seat the issue routes to (agents file up their escalation path). */
  escalation_seat_id: string | null;
}

export function watcherSourceRef(jacketId: string, ruleId: string): string {
  return `watcher:${ruleId}:${jacketId}`;
}
export function todoSourceRef(rootTodoId: string): string {
  return `todo:${rootTodoId}`;
}

/**
 * File a watcher hit as an Issue routed up the human escalation path of the
 * seat that currently holds the jacket. `seatOf(jacketId)` returns that seat
 * (or null); `allSeats` is the org chart for the escalation walk. Dedupes by
 * source_ref; worst-first (now before soon). Only 'now'/'soon' hits file — the
 * caller decides which watcher kinds escalate (the aged/recurring rungs).
 */
export function escalateWatcherHits(
  hits: WatcherHit[],
  ctx: {
    seatOf: (jacketId: string) => Seat | null;
    allSeats: Seat[];
  }
): IssueDraft[] {
  const drafts = new Map<string, IssueDraft & { _now: boolean }>();
  for (const h of hits) {
    const ref = watcherSourceRef(h.jacket_id, h.rule_id);
    if (drafts.has(ref)) continue;
    const holder = ctx.seatOf(h.jacket_id);
    // Agents file UP their human escalation path; a human/open holder already
    // owns the jacket, so the issue routes to the holder itself (not the
    // holder's manager). Null only when nobody holds it.
    const escalationSeat = holder
      ? holder.holder_type === 'agent'
        ? resolveEscalationSeat(holder, ctx.allSeats)
        : holder
      : null;
    drafts.set(ref, {
      title: h.detail.slice(0, 300),
      detail: `${h.detail}\nJacket: ${h.jacket_id}. Holder seat: ${holder?.name ?? 'none'}.`,
      raised_by: `watcher:${h.rule_id}`,
      source_ref: ref,
      priority: h.severity === 'now' ? PRIORITY_WATCHER_NOW : PRIORITY_WATCHER_SOON,
      escalation_seat_id: escalationSeat?.id ?? null,
      _now: h.severity === 'now',
    });
  }
  return [...drafts.values()]
    .sort((a, b) => Number(b._now) - Number(a._now))
    .map(({ _now, ...d }) => d);
}

// ── to-do lifecycle ─────────────────────────────────────────────────────
// open → done (human) | open → rolled (first miss: a copy is created due +7,
// owner nudged once) | open → missed (second miss: files an issue on the root).

export interface TodoLike {
  id: string;
  title: string;
  owner_person: string | null;
  source: string;
  due_on: string; // YYYY-MM-DD
  status: string;
  source_id: string | null;
}

export type TodoAction = 'none' | 'roll' | 'file_issue';

/** `isRoll` = this to-do's source_id points at another to-do (it IS the rolled copy). */
export function decideTodoAction(
  todo: Pick<TodoLike, 'status' | 'due_on'>,
  isRoll: boolean,
  today: string
): TodoAction {
  if (todo.status !== 'open') return 'none';
  if (todo.due_on >= today) return 'none';
  return isRoll ? 'file_issue' : 'roll';
}

/** Due date of the rolled copy: today + TODO_ROLL_EXTENSION_DAYS. */
export function rolledDueOn(today: string): string {
  const anchor = new Date(`${today}T12:00:00Z`);
  anchor.setUTCDate(anchor.getUTCDate() + TODO_ROLL_EXTENSION_DAYS);
  return anchor.toISOString().slice(0, 10);
}

export function buildTodoRoll(
  todo: Pick<TodoLike, 'id' | 'title' | 'owner_person' | 'source' | 'due_on'>,
  today: string
): {
  insert: { title: string; owner_person: string | null; due_on: string; source: string; source_id: string };
  nudge: { subject: string; body: (screenUrl: string) => string };
} {
  const dueOn = rolledDueOn(today);
  return {
    insert: { title: todo.title, owner_person: todo.owner_person, due_on: dueOn, source: todo.source, source_id: todo.id },
    nudge: {
      subject: 'To-do rolled forward',
      body: (screenUrl: string) =>
        `📋 Your to-do *${todo.title}* was due ${todo.due_on} — I've moved it to ${dueOn}. ` +
        `If it slips again it goes on the Issues list for the weekly meeting.\n${screenUrl}`,
    },
  };
}

export function buildTodoMissedIssue(
  todo: Pick<TodoLike, 'title' | 'owner_person' | 'due_on' | 'source_id'>,
  originalDueOn: string | null,
  opts: { seatName?: string | null; escalation_seat_id?: string | null }
): IssueDraft {
  const rootId = todo.source_id as string; // second miss ⇒ this IS a rolled copy
  const owner = todo.owner_person ?? 'unassigned';
  return {
    title: `To-do missed twice: ${todo.title}`.slice(0, 300),
    detail:
      `Owner: ${owner}${opts.seatName ? ` (seat: ${opts.seatName})` : ''}. ` +
      `Due ${originalDueOn ?? '?'}, rolled to ${todo.due_on}, missed again. Original: todo:${rootId}.`,
    raised_by: ESCALATION_ACTOR,
    source_ref: todoSourceRef(rootId),
    priority: PRIORITY_TODO_TWICE_MISSED,
    escalation_seat_id: opts.escalation_seat_id ?? null,
  };
}
