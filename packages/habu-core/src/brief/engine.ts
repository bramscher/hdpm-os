/**
 * Brief — HABU primitive 4 (§6). The generalization of hdpm-os morning-card.ts.
 *
 * Per human seat, per morning: "12 jackets moving — 9 green, 2 yellow handled
 * by agents, 1 needs you." The soul rules from morning-card, kept verbatim in
 * spirit and generalized off tripwires onto jackets:
 *
 *   1. Cap at 7 actionable items — but always show TRUE totals in the header,
 *      so the cap never fakes a caught-up feeling.
 *   2. Decision cool-off: a "done" that didn't stick resurfaces after
 *      DONE_COOLOFF business days, tagged "(marked done <date> — still
 *      unresolved)". Honest, not amnesiac.
 *   3. Severity ordering is org config (per-item severity), not a code const.
 *   4. One brief per HUMAN seat — agents don't get briefs, they get dispatched.
 *
 * Pure/DB-free and clock-free: `today` is passed as a tenant-tz YYYY-MM-DD
 * string (string compares are safe on YMD).
 */

import { nextBusinessDay, toDateString } from '../business-days';
import type { JacketAttention } from '../jacket/types';

export const BRIEF_CAP = 7;
export const DONE_COOLOFF_BUSINESS_DAYS = 3;

const ATTENTION_ORDER: Record<JacketAttention, number> = { now: 0, soon: 1, none: 2 };

export interface BriefItem {
  /** Stable subject key (the jacket id). */
  id: string;
  /** The human seat this item sits on. */
  seat_id: string;
  title: string;
  attention: JacketAttention;
  /** Org-config severity WITHIN an attention tier; lower = more urgent. Default 0. */
  severity?: number;
  /** Tiebreak: older first. Default 0. */
  age_days?: number;
  /** The active step's action label, for the card. */
  label?: string;
}

/**
 * Rank by attention (now > soon > none), then org severity (asc), then age
 * (older first), then id for stability. Returns a new array.
 */
export function rankBriefItems(items: BriefItem[]): BriefItem[] {
  return [...items].sort((a, b) => {
    const at = ATTENTION_ORDER[a.attention] - ATTENTION_ORDER[b.attention];
    if (at) return at;
    const sev = (a.severity ?? 0) - (b.severity ?? 0);
    if (sev) return sev;
    const age = (b.age_days ?? 0) - (a.age_days ?? 0);
    if (age) return age;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// ---- Decision cool-off (generalized from morning-card) ----

export interface BriefDecision {
  subject_key: string; // the jacket id
  status: string; // only 'approved' | 'edited' suppress
  decidedAt: string; // ISO timestamp
  snoozedTo?: string | null; // YYYY-MM-DD when the decision was a snooze
  resolution?: string | null; // 'Done ...' triggers the honest resurface note
}

export interface BriefExclusion {
  until: string; // YYYY-MM-DD; suppressed while today < until
  doneNote?: string; // resurface tag once the window expires after a Done
}

function isValidYmd(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** YYYY-MM-DD of an ISO timestamp, UTC (display date for the resurface note). */
function ymdOf(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/**
 * Build the suppression window per decided subject. Snoozes suppress until
 * their date; everything else for DONE_COOLOFF business days. A "Done" that may
 * not have stuck carries a resurface note for when its window expires.
 */
export function buildBriefExclusions(prior: BriefDecision[]): Map<string, BriefExclusion> {
  const map = new Map<string, BriefExclusion>();
  for (const d of prior) {
    if (d.status !== 'approved' && d.status !== 'edited') continue;
    if (!d.subject_key) continue;

    let until: string;
    let doneNote: string | undefined;
    if (d.snoozedTo && isValidYmd(d.snoozedTo)) {
      until = d.snoozedTo;
    } else {
      let dt = new Date(d.decidedAt);
      for (let i = 0; i < DONE_COOLOFF_BUSINESS_DAYS; i++) dt = nextBusinessDay(dt);
      until = toDateString(dt);
      if (d.resolution?.startsWith('Done')) {
        doneNote = `marked done ${ymdOf(d.decidedAt)} — still unresolved`;
      }
    }

    const existing = map.get(d.subject_key);
    if (!existing || until > existing.until) map.set(d.subject_key, { until, doneNote });
  }
  return map;
}

/** Drop items inside their cool-off window; tag survivors whose Done window expired. */
export function applyBriefExclusions(
  items: BriefItem[],
  exclusions: Map<string, BriefExclusion>,
  today: string
): BriefItem[] {
  const out: BriefItem[] = [];
  for (const it of items) {
    const exc = exclusions.get(it.id);
    if (!exc) out.push(it);
    else if (today < exc.until) continue; // suppressed
    else if (exc.doneNote) out.push({ ...it, title: `${it.title} (${exc.doneNote})` });
    else out.push(it);
  }
  return out;
}

// ---- Assembly ----

export interface BriefHeader {
  /** Full board across the org (honest total, never the capped count). */
  total: number;
  /** Jackets currently held by agent seats (not in any human brief). */
  agent_handled: number;
  /** Waiting on an external event / due-soon (attention = 'soon'). */
  waiting: number;
  /** Actionable items for THIS human after cool-off, before the cap. */
  needs_you: number;
}

export interface Brief {
  seat_id: string;
  header: BriefHeader;
  /** Ranked, cool-off-filtered, capped at BRIEF_CAP. */
  items: BriefItem[];
}

/**
 * Build one human seat's brief. `items` are that seat's candidate jackets;
 * `boardTotals` are the honest org-wide counts the header must show regardless
 * of the cap. `prior` are recent decisions for cool-off.
 */
export function buildBrief(input: {
  seat_id: string;
  items: BriefItem[];
  boardTotals: { total: number; agent_handled: number; waiting: number };
  prior?: BriefDecision[];
  today: string;
}): Brief {
  const exclusions = buildBriefExclusions(input.prior ?? []);
  const filtered = applyBriefExclusions(input.items, exclusions, input.today);
  const ranked = rankBriefItems(filtered);
  const needs_you = ranked.filter((i) => i.attention !== 'none').length;
  return {
    seat_id: input.seat_id,
    header: {
      total: input.boardTotals.total,
      agent_handled: input.boardTotals.agent_handled,
      waiting: input.boardTotals.waiting,
      needs_you,
    },
    items: ranked.slice(0, BRIEF_CAP),
  };
}

/** The one-line brief header sentence (§6). */
export function briefHeadline(h: BriefHeader): string {
  const you = h.needs_you === 0 ? 'clean board 🎉' : `${h.needs_you} need${h.needs_you === 1 ? 's' : ''} you`;
  return `${h.total} open · ${h.agent_handled} agent-handled · ${h.waiting} waiting · ${you}`;
}
