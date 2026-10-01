/**
 * Chase board view model — pure and client-safe (no Supabase imports).
 * Turns the follow-up queue into lanes, a capped "today" focus list, heat by
 * days stuck, chase counts, and weekly send totals for the Loop 1 gate.
 */
import type { FollowupCandidate, FollowupReview } from './estimate-followups';

export type Lane = 'vendor' | 'owner' | 'schedule' | 'help';
export type Heat = 'fresh' | 'warm' | 'hot' | 'escalate';
export type ChaseEvent = { id: number; work_order_id: string; actor: string; action: string; created_at: string; details: Partial<Omit<FollowupReview, 'status'>> & { status?: string } };
export type LegacyChase = { subject_id: string; created_at: string; action_type: string; status: string };

export const FOCUS_CAP = 7;
export const GATE = { date: '2026-10-15', sendsPerWeek: 15 };
export const BATCH_MAX = 25;
export const LANES: { key: Lane; label: string; hint: string }[] = [
  { key: 'vendor', label: 'Vendor estimate', hint: 'Bid outstanding' },
  { key: 'owner', label: 'Owner approval', hint: 'Decision pending' },
  { key: 'schedule', label: 'Needs scheduling', hint: 'No service date' },
  { key: 'help', label: 'Needs help', hint: 'Escalated to the team' },
];

export function isDue(r?: FollowupReview, now = new Date()) {
  return !r || r.status === 'review' || (['snoozed', 'sent'].includes(r.status) && !!r.next_review_at && new Date(r.next_review_at) <= now);
}
export const isLocked = (r?: FollowupReview) => !!r && ['sending', 'uncertain'].includes(r.status);

/** active: on the board · parked: waiting for its review date · closed: dismissed or no longer overdue. */
export function bucketFor(c: FollowupCandidate, r?: FollowupReview, now = new Date()): 'active' | 'parked' | 'closed' {
  if (c.eligible === false || r?.status === 'dismissed') return 'closed';
  if (r?.status === 'help' || isLocked(r) || c.newEpisode || isDue(r, now)) return 'active';
  return 'parked';
}
export function laneFor(c: FollowupCandidate, r?: FollowupReview): Lane {
  if (r?.status === 'help') return 'help';
  return c.kind === 'vendor' ? 'vendor' : c.kind === 'schedule' ? 'schedule' : 'owner';
}

/** Calendar days in the current status; 45+ is the chaser's escalation line. */
export function daysStuck(c: Pick<FollowupCandidate, 'statusSince'>, now = new Date()) {
  const since = c.statusSince ? Date.parse(c.statusSince) : NaN;
  return Number.isFinite(since) ? Math.max(0, Math.floor((now.getTime() - since) / 86400_000)) : 0;
}
export function heatFor(days: number): Heat {
  return days >= 45 ? 'escalate' : days >= 21 ? 'hot' : days >= 7 ? 'warm' : 'fresh';
}

const confirmedSend = (e: ChaseEvent) => e.action === 'delivery' && e.details?.status === 'sent';
/** Confirmed sends per work order. Earlier chaser proposals are drafts, not proof of sending, so they don't count. */
export function chaseCounts(events: ChaseEvent[]) {
  const counts = new Map<string, number>();
  for (const e of events) if (confirmedSend(e)) counts.set(e.work_order_id, (counts.get(e.work_order_id) || 0) + 1);
  return counts;
}

/**
 * Up to FOCUS_CAP items worth doing now. Delivery checks come first, then lanes take
 * turns (each lane ordered P1, then longest stuck) so one lane's backlog can't fill the list.
 */
export function focusQueue(items: FollowupCandidate[], reviews: Map<string, FollowupReview>, now = new Date()) {
  const rank = (a: FollowupCandidate, b: FollowupCandidate) => Number(b.priority === 'P1') - Number(a.priority === 'P1') || daysStuck(b, now) - daysStuck(a, now);
  const open = items.filter(c => bucketFor(c, reviews.get(c.id), now) === 'active' && laneFor(c, reviews.get(c.id)) !== 'help');
  const queue = open.filter(c => isLocked(reviews.get(c.id))).sort(rank);
  const lanes = LANES.map(l => open.filter(c => !isLocked(reviews.get(c.id)) && laneFor(c, reviews.get(c.id)) === l.key).sort(rank)).filter(l => l.length);
  for (let i = 0; queue.length < FOCUS_CAP && lanes.some(l => i < l.length); i++) for (const l of lanes) if (i < l.length && queue.length < FOCUS_CAP) queue.push(l[i]);
  return queue;
}

const ptDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(d);
function weekStart(day: string) {
  const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10);
}
/** Confirmed sends per Pacific week (Monday start), oldest first; last entry is this week. */
export function weeklySends(events: ChaseEvent[], weeks = 8, now = new Date()) {
  const current = weekStart(ptDay(now));
  const starts = Array.from({ length: weeks }, (_, i) => { const d = new Date(`${current}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 7 * (weeks - 1 - i)); return d.toISOString().slice(0, 10); });
  const totals = new Map(starts.map(s => [s, 0]));
  for (const e of events) if (confirmedSend(e)) { const w = weekStart(ptDay(new Date(e.created_at))); if (totals.has(w)) totals.set(w, totals.get(w)! + 1); }
  return starts.map(week => ({ week, sends: totals.get(week)! }));
}
/** Distinct work orders someone acted on today (Pacific). */
export function clearedToday(events: ChaseEvent[], now = new Date()) {
  const today = ptDay(now);
  return new Set(events.filter(e => ptDay(new Date(e.created_at)) === today && e.action !== 'delivery').map(e => e.work_order_id)).size;
}
export function daysUntil(day: string, now = new Date()) {
  return Math.ceil((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${ptDay(now)}T12:00:00Z`)) / 86400_000);
}

export type VendorGroup = { vendor: string; email: string; items: FollowupCandidate[]; oldest: number; median: number; batchable: FollowupCandidate[] };
/** Vendor-lane work grouped by vendor, biggest backlog first. Batchable = due, unlocked, same email on file. */
export function groupByVendor(items: FollowupCandidate[], reviews: Map<string, FollowupReview>, now = new Date()): VendorGroup[] {
  const groups = new Map<string, FollowupCandidate[]>();
  for (const c of items) {
    if (c.kind !== 'vendor' || bucketFor(c, reviews.get(c.id), now) !== 'active') continue;
    const key = c.vendor || 'Unassigned vendor'; groups.set(key, [...(groups.get(key) || []), c]);
  }
  return [...groups].map(([vendor, list]) => {
    const days = list.map(c => daysStuck(c, now)).sort((a, b) => a - b);
    const email = list.find(c => c.email)?.email || '';
    const batchable = list.filter(c => !!email && c.email === email && c.eligible !== false && isDue(reviews.get(c.id), now) && !isLocked(reviews.get(c.id)) && reviews.get(c.id)?.status !== 'help');
    return { vendor, email, items: list, oldest: days[days.length - 1] || 0, median: days[Math.floor(days.length / 2)] || 0, batchable: batchable.slice(0, BATCH_MAX) };
  }).sort((a, b) => b.items.length - a.items.length || b.oldest - a.oldest);
}

/** One email asking a vendor for every outstanding bid. Never states dollar amounts. */
export function buildVendorBatchDraft(vendor: string, items: FollowupCandidate[], now = new Date()) {
  const lines = items.map(c => `• WO ${c.woNumber || c.id.slice(0, 8)} — ${c.property}${c.unit ? `, Unit ${c.unit}` : ''} (waiting ${daysStuck(c, now)} days)`);
  return {
    subject: `Outstanding estimates — ${items.length} High Desert work order${items.length === 1 ? '' : 's'}`,
    body: `Hello${vendor ? ` ${vendor}` : ''},\n\nWe're following up on estimates we requested and haven't received yet:\n\n${lines.join('\n')}\n\nCould you reply with an estimate or an expected date for each? If any of these are no longer something you can take on, let us know so we can reassign it.\n\nThank you,\nHigh Desert Property Management`,
  };
}
