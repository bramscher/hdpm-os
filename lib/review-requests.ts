/**
 * Review requests — pure logic (unit-tested). IO lives in review-requests-run.ts.
 *
 * Who gets asked for a Google review, by email, after Craig approves the
 * daily Slack batch:
 *   tenant · repair    — 2–9 days after a work order on their unit completes
 *   tenant · move_in   — 30–37 days after move-in
 *   tenant · renewal   — within 14 days of signing a renewal lease
 *   owner  · owner_90d — 90–104 days after a property's management start
 * Windows are a week or more wide so a missed or weekend day still catches
 * everyone; the review_request unique key stops a second ask for the same
 * event. One ask per email per year, one per household.
 *
 * Every email carries the same Google review link — no sentiment gating
 * (Google's policy). The "reply if something isn't right" line goes to
 * everyone alongside the link.
 */

export type ReviewAudience = 'tenant' | 'owner';
export type ReviewReason = 'repair' | 'move_in' | 'renewal' | 'owner_90d';

export const REASON_LABELS: Record<ReviewReason, string> = {
  repair: 'Repair done',
  move_in: '30 days in',
  renewal: 'Renewed',
  owner_90d: '90 days managed',
};

/** Same-email priority within one batch: the freshest, most specific moment wins. */
const REASON_PRIORITY: ReviewReason[] = ['repair', 'renewal', 'move_in', 'owner_90d'];

/**
 * Only Craig sends. The batch card goes to his DM alone, and a Send/Skip tap
 * from anyone else (a forwarded or shared card) is refused.
 */
export const REVIEW_APPROVER = 'Craig';

export function canDecideReviewRequests(staff: { person: string; email: string | null }): boolean {
  return staff.person === REVIEW_APPROVER || staff.email?.toLowerCase() === 'craig@highdesertpm.com';
}

export const ASK_COOLDOWN_DAYS = 365;
/** A proposal nobody acted on stops being sendable after this. */
export const PROPOSAL_TTL_DAYS = 14;

export interface ReviewCandidate {
  audience: ReviewAudience;
  reason: ReviewReason;
  contactId: string;
  name: string;
  firstName: string | null;
  email: string;
  property: string | null;
  detail: string | null;
  subjectRef: string;
}

export interface TenantFact {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  propertyId: string | null;
  unitId: string | null;
  status: string | null;
  primary: boolean;
  moveInOn: string | null;
  leaseStartDate: string | null;
  leaseSignedDate: string | null;
  address: string | null;
}

export interface CompletedWorkOrder {
  id: string;
  wo_number: string | null;
  property_id: string | null;
  unit_id: string | null;
  property_name: string | null;
  property_address: string | null;
  description: string | null;
  completed_date: string | null;
  canceled_date: string | null;
  is_turn: boolean | null;
  appfolio_recurring: boolean | null;
}

export interface OwnerProperty {
  id: string;
  address: string | null;
  managementStartDate: string | null;
  owners: Array<{ id: string; name: string; firstName: string | null; email: string | null }>;
}

/** YYYY-MM-DD for `now` in Pacific time. */
export function pacificDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(now);
}

/** Whole days from date `from` to date `to` (both YYYY-MM-DD, or ISO with a time). */
export function daysBetween(from: string, to: string): number {
  const d = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((d(to) - d(from)) / 86_400_000);
}

function within(date: string | null, today: string, min: number, max: number): boolean {
  if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return false;
  const ago = daysBetween(date, today);
  return ago >= min && ago <= max;
}

function fullName(t: { firstName: string | null; lastName: string | null }): string {
  return [t.firstName, t.lastName].filter(Boolean).join(' ').trim();
}

/** Current, not-on-notice tenants with an email, grouped into households by unit (primary first). */
function households(tenants: TenantFact[]): Map<string, TenantFact[]> {
  const byUnit = new Map<string, TenantFact[]>();
  for (const t of tenants) {
    if ((t.status ?? '').toLowerCase() !== 'current' || !t.email || !t.unitId) continue;
    const list = byUnit.get(t.unitId) ?? [];
    list.push(t);
    byUnit.set(t.unitId, list);
  }
  for (const list of byUnit.values()) list.sort((a, b) => Number(b.primary) - Number(a.primary));
  return byUnit;
}

function tenantCandidate(
  t: TenantFact,
  reason: ReviewReason,
  subjectRef: string,
  property: string | null,
  detail: string | null
): ReviewCandidate {
  return {
    audience: 'tenant',
    reason,
    contactId: t.id,
    name: fullName(t) || t.email!,
    firstName: t.firstName?.trim() || null,
    email: t.email!.trim(),
    property: property ?? t.address,
    detail,
    subjectRef,
  };
}

export function pickTenantCandidates(input: {
  tenants: TenantFact[];
  workOrders: CompletedWorkOrder[];
  today: string;
}): ReviewCandidate[] {
  const homes = households(input.tenants);
  const unitsByProperty = new Map<string, Set<string>>();
  for (const [unitId, list] of homes) {
    const pid = list[0].propertyId;
    if (!pid) continue;
    unitsByProperty.set(pid, (unitsByProperty.get(pid) ?? new Set()).add(unitId));
  }
  const out: ReviewCandidate[] = [];

  // Repairs: newest completed WO per household. Turn work happens in an empty
  // unit and recurring/preventive work is rarely noticed, so neither asks.
  const repairs = input.workOrders
    .filter((w) => !w.canceled_date && !w.is_turn && !w.appfolio_recurring)
    .filter((w) => within(w.completed_date, input.today, 2, 9))
    .sort((a, b) => (b.completed_date ?? '').localeCompare(a.completed_date ?? ''));
  const repairedUnits = new Set<string>();
  for (const w of repairs) {
    // No unit on the WO: use the property's only occupied unit, if it has exactly one.
    const only = w.property_id ? unitsByProperty.get(w.property_id) : undefined;
    const unitId = w.unit_id ?? (only?.size === 1 ? [...only][0] : null);
    const home = unitId ? homes.get(unitId) : undefined;
    if (!unitId || !home || repairedUnits.has(unitId)) continue;
    repairedUnits.add(unitId);
    const detail = (w.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 90) || null;
    out.push(tenantCandidate(home[0], 'repair', `wo:${w.wo_number || w.id}`, w.property_address || w.property_name, detail));
  }

  for (const home of homes.values()) {
    const head = home[0];
    // Move-in: whoever moved in 30–37 days ago (the household shares the date).
    const mover = home.find((t) => within(t.moveInOn, input.today, 30, 37));
    if (mover) out.push(tenantCandidate(mover, 'move_in', `move_in:${mover.moveInOn!.slice(0, 10)}`, null, null));

    // Renewal: a lease signed in the last 14 days that starts well after move-in.
    const renewed = home.find((t) => {
      const signed = t.leaseSignedDate ?? t.leaseStartDate;
      return (
        within(signed, input.today, 0, 14) &&
        !!t.moveInOn &&
        !!t.leaseStartDate &&
        daysBetween(t.moveInOn, t.leaseStartDate) >= 60
      );
    });
    if (renewed) {
      const who = renewed.email ? renewed : head;
      out.push(tenantCandidate(who, 'renewal', `renewal:${renewed.leaseStartDate!.slice(0, 10)}`, null, null));
    }
  }
  return out;
}

export function pickOwnerCandidates(input: { properties: OwnerProperty[]; today: string }): ReviewCandidate[] {
  const out: ReviewCandidate[] = [];
  for (const p of input.properties) {
    if (!within(p.managementStartDate, input.today, 90, 104)) continue;
    for (const o of p.owners) {
      if (!o.email) continue;
      out.push({
        audience: 'owner',
        reason: 'owner_90d',
        contactId: o.id,
        name: o.name,
        firstName: o.firstName,
        email: o.email.trim(),
        property: p.address,
        detail: null,
        subjectRef: `owner_90d:${p.id}`,
      });
    }
  }
  return out;
}

/** One ask per email: drop anyone asked recently, then keep the highest-priority reason. */
export function finalizeCandidates(candidates: ReviewCandidate[], recentlyAsked: Set<string>): ReviewCandidate[] {
  const best = new Map<string, ReviewCandidate>();
  for (const c of candidates) {
    const key = c.email.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(key) || recentlyAsked.has(key)) continue;
    const cur = best.get(key);
    if (!cur || REASON_PRIORITY.indexOf(c.reason) < REASON_PRIORITY.indexOf(cur.reason)) best.set(key, c);
  }
  return [...best.values()];
}

// ── Email ──────────────────────────────────────────────────────────────

export function reviewUrl(): string | null {
  const explicit = process.env.GOOGLE_REVIEW_URL?.trim();
  if (explicit) return explicit;
  const placeId = process.env.GOOGLE_PLACE_ID?.trim();
  return placeId ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}` : null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export interface ReviewEmailInput {
  reason: ReviewReason;
  firstName: string | null;
  property: string | null;
  detail: string | null;
}

export function buildReviewEmail(r: ReviewEmailInput, url: string): { subject: string; text: string; html: string } {
  const hi = r.firstName ? `Hi ${r.firstName},` : 'Hi there,';
  const at = r.property ? ` at ${r.property}` : '';
  const copy: Record<ReviewReason, { subject: string; lead: string; fix: string }> = {
    repair: {
      subject: 'How did we do on your repair?',
      lead: `We recently wrapped up a work order${at}${r.detail ? ` (${r.detail})` : ''}. If you have a minute, a quick Google review helps other renters in Central Oregon find us, and our maintenance team reads every one.`,
      fix: 'If anything about the repair still isn’t right, just reply to this email and we’ll get on it.',
    },
    move_in: {
      subject: 'How’s the new place?',
      lead: `You’ve been in your home${at} for about a month now. If you have a minute, a quick Google review of your move-in experience helps other renters in Central Oregon find us.`,
      fix: 'If anything in the home needs attention, just reply to this email and we’ll take care of it.',
    },
    renewal: {
      subject: 'Thanks for staying with us',
      lead: `Thanks for renewing your lease${at}. If you have a minute, a quick Google review helps other renters in Central Oregon find us.`,
      fix: 'If there’s anything we can do better, just reply to this email.',
    },
    owner_90d: {
      subject: 'How are we doing?',
      lead: `It’s been about three months since we started managing${r.property ? ` ${r.property}` : ' your property'}. If you’re happy with how things are going, a quick Google review helps other owners in Central Oregon find us.`,
      fix: 'If anything isn’t working the way you’d like, just reply to this email. It comes straight to us.',
    },
  };
  const c = copy[r.reason];
  const sign = 'Thank you,\nHigh Desert Property Management';
  const text = `${hi}\n\n${c.lead}\n\nLeave a Google review: ${url}\n\n${c.fix}\n\n${sign}`;
  const p = (s: string) => `<p style="margin:0 0 16px">${escapeHtml(s)}</p>`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1f2933;max-width:560px">
${p(hi)}${p(c.lead)}
<p style="margin:0 0 20px"><a href="${escapeHtml(url)}" style="display:inline-block;background:#1a1a1a;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600">Leave a Google review</a></p>
${p(c.fix)}<p style="margin:0">Thank you,<br>High Desert Property Management</p>
</div>`;
  return { subject: c.subject, text, html };
}

// ── Slack batch card ───────────────────────────────────────────────────

export interface ReviewRequestRow {
  id: string;
  audience: ReviewAudience;
  reason: ReviewReason;
  name: string;
  email: string;
  property: string | null;
  detail: string | null;
}

export type RrAction = { kind: 'one'; id: string; op: 'send' | 'skip' } | { kind: 'batch'; batchDate: string };

export function rrActionId(id: string, op: 'send' | 'skip'): string {
  return `rr:${id}:${op}`;
}

export function rrBatchActionId(batchDate: string): string {
  return `rr:batch:${batchDate}`;
}

/** Row ids carried in a Send-all button's value. */
export function parseRrBatchValue(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value.split(',').map((v) => v.trim().toLowerCase()).filter((v) => /^[0-9a-f-]{36}$/.test(v));
}

export function parseRrActionId(actionId: string): RrAction | null {
  const batch = /^rr:batch:(\d{4}-\d{2}-\d{2})$/.exec(actionId);
  if (batch) return { kind: 'batch', batchDate: batch[1] };
  const one = /^rr:([0-9a-f-]{36}):(send|skip)$/i.exec(actionId);
  return one ? { kind: 'one', id: one[1].toLowerCase(), op: one[2] as 'send' | 'skip' } : null;
}

/** Rows per Slack message: 2 blocks each, well under Slack's 50-block cap. */
export const CARD_ROWS = 20;

export function rowBlockId(id: string): string {
  return `rr-row:${id}`;
}

export function buildReviewBatchCard(
  rows: ReviewRequestRow[],
  batchDate: string,
  part?: { index: number; total: number }
): { text: string; blocks: Array<Record<string, unknown>> } {
  const title = `${rows.length} review request${rows.length === 1 ? '' : 's'} ready${part && part.total > 1 ? ` (${part.index}/${part.total})` : ''}`;
  const blocks: Array<Record<string, unknown>> = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:star: *${title}*\nEach person gets one email with the Google review link. Skip anyone with an open issue.`,
      },
    },
    {
      type: 'actions',
      block_id: 'rr-all',
      elements: [
        {
          type: 'button',
          action_id: rrBatchActionId(batchDate),
          // The rows on this message only — a big day splits across several.
          value: rows.map((r) => r.id).join(','),
          style: 'primary',
          text: { type: 'plain_text', text: 'Send all not skipped' },
          confirm: {
            title: { type: 'plain_text', text: 'Send review requests?' },
            text: { type: 'plain_text', text: 'Emails everyone on this card who hasn’t been sent or skipped.' },
            confirm: { type: 'plain_text', text: 'Send' },
            deny: { type: 'plain_text', text: 'Cancel' },
          },
        },
      ],
    },
  ];
  for (const r of rows) {
    const what = [REASON_LABELS[r.reason], r.property, r.detail].filter(Boolean).join(' · ');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*${r.name}* (${r.audience}) — ${r.email}\n${what}` },
    });
    blocks.push({
      type: 'actions',
      block_id: rowBlockId(r.id),
      elements: [
        { type: 'button', action_id: rrActionId(r.id, 'send'), text: { type: 'plain_text', text: 'Send' } },
        { type: 'button', action_id: rrActionId(r.id, 'skip'), text: { type: 'plain_text', text: 'Skip' } },
      ],
    });
  }
  return { text: title, blocks };
}

/**
 * Redraw after taps: each decided row's buttons become a note. Once no row
 * buttons remain, the Send-all button goes too.
 */
export function redrawReviewBatchCard(
  blocks: Array<Record<string, unknown>>,
  notes: Map<string, string>
): Array<Record<string, unknown>> {
  const next = blocks.map((b) => {
    const id = typeof b.block_id === 'string' && b.block_id.startsWith('rr-row:') ? b.block_id.slice(7) : null;
    const note = id ? notes.get(id) : undefined;
    return note ? { type: 'context', block_id: b.block_id, elements: [{ type: 'mrkdwn', text: note }] } : b;
  });
  const open = next.some((b) => b.type === 'actions' && String(b.block_id ?? '').startsWith('rr-row:'));
  return open ? next : next.filter((b) => b.block_id !== 'rr-all');
}
