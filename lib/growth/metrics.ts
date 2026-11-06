/**
 * Growth dashboard math. Pure functions: no I/O, unit-tested.
 */
import { BOARD_STAGES, GROWTH_SETTINGS, STAGE_WEIGHTS, type BoardStage } from './config';
import type { BoardLead } from './lead-api';
import { daysInStage } from './board';

const DAY_MS = 86_400_000;

/** Doors a month needed to hit the target on time (150 / 12 = 12.5). */
export function monthlyPace(target = GROWTH_SETTINGS.targetNetDoors, months = GROWTH_SETTINGS.months): number {
  return months > 0 ? target / months : 0;
}

/** Add whole months to a YYYY-MM-DD date (UTC), clamping to the month's last day. */
export function addMonths(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  const firstOfTarget = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth() + 1, 0)).getUTCDate();
  firstOfTarget.setUTCDate(Math.min(d, lastDay));
  return firstOfTarget.toISOString().slice(0, 10);
}

/**
 * Net doors the pace line expects by a date: linear from 0 at the start date
 * to the target at start + months. Clamped to [0, target].
 */
export function paceAt(
  date: string,
  start: string = GROWTH_SETTINGS.startDate,
  target: number = GROWTH_SETTINGS.targetNetDoors,
  months: number = GROWTH_SETTINGS.months
): number {
  const t0 = Date.parse(`${start.slice(0, 10)}T00:00:00Z`);
  const t1 = Date.parse(`${addMonths(start, months)}T00:00:00Z`);
  const t = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  if (!(t1 > t0) || !Number.isFinite(t)) return 0;
  const frac = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  return Math.round(target * frac * 10) / 10;
}

export interface NetDoorsPoint {
  date: string;
  /** Net doors since the baseline (null on days with no snapshot). */
  actual: number | null;
  pace: number;
}

/**
 * The goal chart: one point per month boundary from the start date through the
 * end of the goal, plus every snapshot day. `doorsByDay` is total doors per day
 * (YYYY-MM-DD → doors), already reduced to one value per day.
 */
export function netDoorsSeries(
  doorsByDay: Record<string, number>,
  baselineDoors: number | null,
  start: string = GROWTH_SETTINGS.startDate,
  months: number = GROWTH_SETTINGS.months,
  target: number = GROWTH_SETTINGS.targetNetDoors
): NetDoorsPoint[] {
  const dates = new Set<string>();
  for (let i = 0; i <= months; i++) dates.add(addMonths(start, i));
  const end = addMonths(start, months);
  for (const day of Object.keys(doorsByDay)) if (day >= start && day <= end) dates.add(day);
  return [...dates].sort().map((date) => ({
    date,
    actual: baselineDoors != null && doorsByDay[date] != null ? doorsByDay[date] - baselineDoors : null,
    pace: paceAt(date, start, target, months),
  }));
}

/** Keep the latest value per day from time-ordered snapshot rows. */
export function latestPerDay<T>(rows: { captured_at: string; value: T }[]): Record<string, T> {
  const out: Record<string, T> = {};
  const sorted = [...rows].sort((a, b) => a.captured_at.localeCompare(b.captured_at));
  for (const r of sorted) out[r.captured_at.slice(0, 10)] = r.value;
  return out;
}

/** Earliest snapshot row on or after a day; the baseline for the goal. */
export function firstOnOrAfter<T>(rows: { captured_at: string; value: T }[], day: string): { captured_at: string; value: T } | null {
  const after = rows.filter((r) => r.captured_at.slice(0, 10) >= day).sort((a, b) => a.captured_at.localeCompare(b.captured_at));
  return after[0] ?? null;
}

export interface StageDoors {
  key: BoardStage;
  label: string;
  leads: number;
  doors: number;
  weight: number;
  weightedDoors: number;
}

/** Expected doors per stage, raw and weighted by STAGE_WEIGHTS. */
export function pipelineByStage(leads: BoardLead[], weights: Record<BoardStage, number> = STAGE_WEIGHTS): StageDoors[] {
  return BOARD_STAGES.map(({ key, label }) => {
    const inStage = leads.filter((l) => l.status === key);
    const doors = inStage.reduce((s, l) => s + (l.expectedDoors ?? 0), 0);
    const weight = weights[key] ?? 0;
    return { key, label, leads: inStage.length, doors, weight, weightedDoors: Math.round(doors * weight * 10) / 10 };
  });
}

/** Total weighted doors still open (not signed, not lost). */
export function openWeightedDoors(stages: StageDoors[]): number {
  const total = stages.filter((s) => s.key !== 'signed' && s.key !== 'lost').reduce((s, x) => s + x.weightedDoors, 0);
  return Math.round(total * 10) / 10;
}

export interface FunnelStep {
  key: BoardStage;
  label: string;
  /** Leads now at this stage or a later one (lost leads count only toward New). */
  reached: number;
  /** reached ÷ the previous step's reached, as a percent; null for the first step. */
  conversionPct: number | null;
  /** Median days current leads have sat in this stage (null when none). */
  medianDaysInStage: number | null;
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * Funnel from the board's current stages. The feed has each lead's current
 * stage only, so "reached" means at that stage or past it; a lost lead's last
 * stage is unknown, so it counts only toward New.
 */
export function funnel(leads: BoardLead[], now: Date = new Date()): FunnelStep[] {
  const order = BOARD_STAGES.filter((s) => s.key !== 'lost');
  const rank = (status: string) => order.findIndex((s) => s.key === status);
  const steps: FunnelStep[] = [];
  order.forEach(({ key, label }, i) => {
    const reached = leads.filter((l) => (l.status === 'lost' ? i === 0 : rank(l.status) >= i)).length;
    const prev = steps[i - 1]?.reached;
    steps.push({
      key,
      label,
      reached,
      conversionPct: i === 0 ? null : prev ? Math.round((reached / prev) * 1000) / 10 : null,
      medianDaysInStage: median(leads.filter((l) => l.status === key).map((l) => daysInStage(l, now))),
    });
  });
  return steps;
}

/** Lead counts by month (YYYY-MM of createdAt) and source, oldest month first. */
export function leadsBySourceByMonth(leads: Pick<BoardLead, 'createdAt' | 'source'>[]): {
  months: string[];
  sources: string[];
  rows: Record<string, string | number>[];
} {
  const counts = new Map<string, Map<string, number>>();
  const sources = new Set<string>();
  for (const l of leads) {
    const month = l.createdAt?.slice(0, 7);
    if (!month) continue;
    const source = l.source ?? 'other';
    sources.add(source);
    const m = counts.get(month) ?? new Map<string, number>();
    m.set(source, (m.get(source) ?? 0) + 1);
    counts.set(month, m);
  }
  const months = [...counts.keys()].sort();
  const sourceList = [...sources].sort();
  return {
    months,
    sources: sourceList,
    rows: months.map((month) => {
      const row: Record<string, string | number> = { month };
      for (const s of sourceList) row[s] = counts.get(month)?.get(s) ?? 0;
      return row;
    }),
  };
}

export interface MonthMovement {
  month: string;
  gained: number;
  lost: number;
  net: number;
}

/**
 * Doors gained and lost per calendar month, from the first door roster of each
 * month to the first roster of the next (the last month runs to `latest`).
 * `rosters` maps YYYY-MM-DD → roster; months without a roster are skipped.
 */
export function monthlyMovement(
  rosters: Record<string, Record<string, number>>,
  diff: (current: Record<string, number>, baseline: Record<string, number>) => { gained: number; lost: number; net: number }
): MonthMovement[] {
  const days = Object.keys(rosters).sort();
  if (days.length < 2) return [];
  const firstOfMonth = new Map<string, string>();
  for (const d of days) if (!firstOfMonth.has(d.slice(0, 7))) firstOfMonth.set(d.slice(0, 7), d);
  const months = [...firstOfMonth.keys()].sort();
  const latest = days[days.length - 1];
  const out: MonthMovement[] = [];
  months.forEach((month, i) => {
    const from = firstOfMonth.get(month)!;
    const to = i + 1 < months.length ? firstOfMonth.get(months[i + 1])! : latest;
    if (to === from) return;
    const m = diff(rosters[to], rosters[from]);
    out.push({ month, gained: m.gained, lost: m.lost, net: m.net });
  });
  return out;
}

export interface ChurnPoint {
  date: string;
  /** Owner cancellations in the trailing 30 days × 12 ÷ owners, as a yearly percent. */
  annualizedPct: number | null;
  target: number;
}

/**
 * Owner churn from owner_retention snapshots, annualized. The KPI gives
 * cancellations in the last 30 days and current owners; ×12 makes it yearly.
 */
export function ownerChurnSeries(
  byDay: Record<string, { cancellationsLast30Days?: number; totalOwners?: number }>,
  target: number = GROWTH_SETTINGS.churnTargetPct
): ChurnPoint[] {
  return Object.keys(byDay)
    .sort()
    .map((date) => {
      const v = byDay[date];
      const owners = v.totalOwners ?? 0;
      const cancels = v.cancellationsLast30Days ?? 0;
      return { date, annualizedPct: owners > 0 ? Math.round(((cancels * 12) / owners) * 1000) / 10 : null, target };
    });
}

/** Reduce a daily series to one point a week (the last day of each 7-day block), keeping the final day. */
export function thinDaily<T extends { date: string }>(points: T[], everyDays = 7): T[] {
  if (points.length <= 60) return points;
  const out: T[] = [];
  let last = -Infinity;
  for (const p of points) {
    const t = Date.parse(`${p.date}T00:00:00Z`);
    if (t - last >= everyDays * DAY_MS) {
      out.push(p);
      last = t;
    }
  }
  if (out[out.length - 1] !== points[points.length - 1]) out.push(points[points.length - 1]);
  return out;
}

export interface PartnerRow {
  partnerId: string;
  name: string;
  leads: number;
  signedLeads: number;
  doors: number;
}

/**
 * Partner leaderboard from referral leads: leads, signed leads (agreement
 * signed or later) and doors (signed doors under management, else unit count).
 */
export function partnerLeaderboard(
  leads: { partner_id: string | null; stage: string; doors_under_mgmt: number | null; unit_count: number | null }[],
  partners: { id: string; display_name: string; company: string | null }[]
): PartnerRow[] {
  const SIGNED = new Set(['agreement_signed', 'onboarding', 'active']);
  const names = new Map(partners.map((p) => [p.id, p.company ? `${p.display_name} (${p.company})` : p.display_name]));
  const rows = new Map<string, PartnerRow>();
  for (const l of leads) {
    if (!l.partner_id) continue;
    const row = rows.get(l.partner_id) ?? { partnerId: l.partner_id, name: names.get(l.partner_id) ?? 'Unknown partner', leads: 0, signedLeads: 0, doors: 0 };
    row.leads += 1;
    if (SIGNED.has(l.stage)) {
      row.signedLeads += 1;
      row.doors += l.doors_under_mgmt ?? l.unit_count ?? 0;
    }
    rows.set(l.partner_id, row);
  }
  return [...rows.values()].sort((a, b) => b.doors - a.doors || b.signedLeads - a.signedLeads || b.leads - a.leads || a.name.localeCompare(b.name));
}
