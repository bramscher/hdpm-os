/**
 * Morning Action Card ("Daily Seven") — pure logic. Brief C, Agent #1 in
 * docs/agent-os/00-DRAFT-master-plan.md.
 *
 * Everything here is DB-free and fetch-free so it unit-tests like
 * tripwires.ts. Orchestration (proposals, outbox, Slack) lives in
 * morning-card-run.ts; the interaction endpoint is
 * app/api/agents/slack/interact.
 */

import type { TripwireException } from '@/lib/maintenance/types';
import { PEOPLE } from '@/lib/maintenance/types';
import { nextBusinessDay, toDateString } from '@/lib/maintenance/business-days';

export const MORNING_CARD_AGENT = 'morning_card';
export const MORNING_CARD_ACTION = 'daily_card';

// ============================================
// Ranking
// ============================================

/**
 * Severity tier order, most urgent first. No severity map exists elsewhere in
 * the codebase; this ordering is the card's editorial judgment: same-day
 * fires (#5 failed access), then overdue commitments (#3), vendor stalls
 * (#4), stuck estimates (#11), never-triaged (#2), vacancy bleed (#12),
 * unbilled (#8), then the rest.
 */
export const SEVERITY_TIERS: number[] = [5, 3, 4, 11, 2, 12, 8, 10, 6, 7, 9, 1];

export function severityRank(ex: TripwireException): number {
  const i = SEVERITY_TIERS.indexOf(ex.tripwire);
  return i === -1 ? SEVERITY_TIERS.length : i;
}

/**
 * Cheryl's actionable pool: her exceptions (rules fall back to Cheryl for
 * unowned WOs), each tied to a concrete work order (buttons need a subject),
 * deduped to the most severe exception per WO, most urgent first.
 */
export function rankExceptions(exceptions: TripwireException[]): TripwireException[] {
  const sorted = exceptions
    .filter((ex) => ex.owner === 'Cheryl' && typeof ex.workOrderId === 'string' && ex.workOrderId)
    .sort((a, b) => {
      const tier = severityRank(a) - severityRank(b);
      if (tier !== 0) return tier;
      return (b.ageDays ?? -1) - (a.ageDays ?? -1);
    });

  const seen = new Set<string>();
  const out: TripwireException[] = [];
  for (const ex of sorted) {
    if (seen.has(ex.workOrderId!)) continue;
    seen.add(ex.workOrderId!);
    out.push(ex);
  }
  return out;
}

/** The card caps at seven — finishing is achievable; streaks beat dashboards. */
export function pickDailySeven(exceptions: TripwireException[]): TripwireException[] {
  return rankExceptions(exceptions).slice(0, 7);
}

// ============================================
// Dates
// ============================================

/** YYYY-MM-DD in Pacific time (same expression as the routes API). */
export function todayPacific(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

/** Snooze target: two business days out. */
export function snoozeDate(now: Date): string {
  return toDateString(nextBusinessDay(nextBusinessDay(now)));
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidYmd(s: unknown): s is string {
  return typeof s === 'string' && YMD_RE.test(s);
}

// ============================================
// Actions
// ============================================

export const SNOOZE_REASONS = [
  { value: 'vendor', label: 'Waiting on vendor' },
  { value: 'tenant', label: 'Waiting on tenant' },
  { value: 'parts', label: 'Waiting on parts' },
  { value: 'other', label: 'Other' },
] as const;

export type CardActionKind = 'done' | 'snooze' | 'date' | 'reassign';
const ACTION_KINDS: CardActionKind[] = ['done', 'snooze', 'date', 'reassign'];

export function encodeActionId(kind: CardActionKind, proposalId: string): string {
  return `mc:${kind}:${proposalId}`;
}

export function parseActionId(
  actionId: string
): { kind: CardActionKind; proposalId: string } | null {
  const m = actionId.match(/^mc:([a-z]+):(.+)$/);
  if (!m || !ACTION_KINDS.includes(m[1] as CardActionKind) || !m[2]) return null;
  return { kind: m[1] as CardActionKind, proposalId: m[2] };
}

/** Normalize a Slack block_actions element into what the handler needs. */
export function parseBlockAction(action: unknown): {
  kind: CardActionKind;
  proposalId: string;
  selectedValue?: string;
  selectedDate?: string;
} | null {
  if (!action || typeof action !== 'object') return null;
  const a = action as Record<string, unknown>;
  if (typeof a.action_id !== 'string') return null;
  const parsed = parseActionId(a.action_id);
  if (!parsed) return null;

  const selectedOption = a.selected_option as { value?: unknown } | undefined;
  return {
    ...parsed,
    selectedValue:
      typeof selectedOption?.value === 'string' ? selectedOption.value : undefined,
    selectedDate: typeof a.selected_date === 'string' ? a.selected_date : undefined,
  };
}

// ============================================
// Card model
// ============================================

export interface CardItem {
  proposalId: string;
  workOrderId: string;
  rank: number; // 1-7
  tripwire: number;
  label: string;
  item: string;
  fixRequired: string;
  ageDays?: number;
  status: 'proposed' | 'approved' | 'edited' | 'rejected' | 'expired' | 'auto_applied';
  resolution?: string; // 'Done by Cheryl 9:14am' / 'Snoozed to 2026-07-22 (vendor)'
  error?: string; // transient render-only validation message
  nextActionDate?: string | null; // datepicker initial_date
  /** Deep link into AppFolio — Cheryl's observed flow is AppFolio-first. */
  appfolioLink?: string | null;
}

export interface CardHeader {
  dateStr: string; // Pacific YYYY-MM-DD
  totalExceptions: number;
  needsDateCount: number;
  pendingTriage: number;
  routeSummary: string | null;
}

const TRUNC = 300;
function trunc(s: string): string {
  return s.length > TRUNC ? `${s.slice(0, TRUNC - 1)}…` : s;
}

function mrkdwn(text: string): { type: 'section'; text: { type: 'mrkdwn'; text: string } } {
  return { type: 'section', text: { type: 'mrkdwn', text } };
}

function contextBlock(text: string): {
  type: 'context';
  elements: { type: 'mrkdwn'; text: string }[];
} {
  return { type: 'context', elements: [{ type: 'mrkdwn', text }] };
}

function headerLine(header: CardHeader): string {
  const parts = [
    `*${header.totalExceptions}* exceptions`,
    `*${header.needsDateCount}* need a date`,
    `*${header.pendingTriage}* triage proposals pending`,
  ];
  if (header.routeSummary) parts.push(`Route: ${header.routeSummary}`);
  return parts.join(' · ');
}

function itemSectionText(item: CardItem): string {
  const age = item.ageDays !== undefined ? ` · ${item.ageDays}d old` : '';

  if (item.status !== 'proposed') {
    const suffix = item.resolution ? ` _${item.resolution}_` : '';
    const icon = item.status === 'approved' || item.status === 'edited' ? '✅' : '⏳';
    return `${icon} *${item.rank}. ${item.label}* — ~${trunc(item.item)}~${suffix}`;
  }

  let text = `*${item.rank}. ${item.label}* — ${trunc(item.item)}\n_Fix: ${trunc(item.fixRequired)}_${age}`;
  if (item.error) text += `\n:warning: _${trunc(item.error)}_`;
  return text;
}

function itemActionsBlock(item: CardItem): Record<string, unknown> {
  return {
    type: 'actions',
    block_id: `mc-item:${item.proposalId}`,
    elements: [
      // AppFolio deep link first — Cheryl works AppFolio-first (observed
      // 2026-07-20): open the WO there, do the work, come back, tap Done.
      // 'link' is not an ACTION_KIND, so the interaction it fires no-ops.
      ...(item.appfolioLink
        ? [
            {
              type: 'button',
              action_id: `mc:link:${item.proposalId}`,
              text: { type: 'plain_text', text: 'Open in AppFolio ↗' },
              url: item.appfolioLink,
            },
          ]
        : []),
      {
        type: 'button',
        action_id: encodeActionId('done', item.proposalId),
        text: { type: 'plain_text', text: '✅ Done' },
        style: 'primary',
        value: item.workOrderId,
      },
      {
        type: 'static_select',
        action_id: encodeActionId('snooze', item.proposalId),
        placeholder: { type: 'plain_text', text: 'Snooze 2d ▾' },
        options: SNOOZE_REASONS.map((r) => ({
          text: { type: 'plain_text', text: r.label },
          value: r.value,
        })),
      },
      {
        type: 'datepicker',
        action_id: encodeActionId('date', item.proposalId),
        placeholder: { type: 'plain_text', text: 'Set date' },
        ...(isValidYmd(item.nextActionDate) ? { initial_date: item.nextActionDate } : {}),
      },
      {
        type: 'static_select',
        action_id: encodeActionId('reassign', item.proposalId),
        placeholder: { type: 'plain_text', text: 'Reassign ▾' },
        options: PEOPLE.map((p) => ({
          text: { type: 'plain_text', text: p },
          value: p,
        })),
      },
    ],
  };
}

export function buildCardBlocks(input: {
  header: CardHeader;
  items: CardItem[];
  readOnly: boolean;
}): unknown[] {
  const { header, items, readOnly } = input;
  const blocks: unknown[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `☀️ Morning Action Card — ${header.dateStr}` },
    },
    contextBlock(headerLine(header)),
    { type: 'divider' },
  ];

  if (items.length === 0) {
    blocks.push(mrkdwn('🎉 Zero exceptions — clean board.'));
  }

  for (const item of items) {
    blocks.push(mrkdwn(itemSectionText(item)));
    if (!readOnly && item.status === 'proposed') {
      blocks.push(itemActionsBlock(item));
    }
  }

  blocks.push(
    contextBlock(
      readOnly
        ? "_Read-only copy — Cheryl's card is live._"
        : 'Open in AppFolio, do the work, then *still tap ✅ Done here* — that records it. Deleting the message doesn’t. Untouched items expire tomorrow morning.'
    )
  );
  return blocks;
}

export function buildNudge(
  items: CardItem[],
  header: CardHeader
): { text: string; blocks: unknown[] } {
  const text = `👋 Nudge: all ${items.length} morning-card items are still untouched. Two minutes now keeps the streak alive.`;
  return {
    text,
    blocks: [mrkdwn(text), contextBlock(headerLine(header))],
  };
}

// ============================================
// Email mirror
// ============================================

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// Brand constants matching lib/maintenance/digest.ts.
const GR = '#2f7d32';
const DK = '#1f5c22';
const RED = '#b3261e';
const MUTED = '#6b7280';
const HAIR = '#e5e7eb';

export function buildCardEmailHtml(
  header: CardHeader,
  items: CardItem[],
  baseUrl: string
): { subject: string; html: string; text: string } {
  const subject = `Morning Action Card — ${header.dateStr} (${items.length} items)`;

  const rows = items
    .map(
      (i) => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid ${HAIR};color:${MUTED};">${i.rank}</td>
      <td style="padding:8px 10px;border-bottom:1px solid ${HAIR};color:${RED};white-space:nowrap;">${escapeHtml(i.label)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid ${HAIR};">${escapeHtml(i.item)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid ${HAIR};">${escapeHtml(i.fixRequired)}</td>
    </tr>`
    )
    .join('');

  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:720px;margin:0 auto;color:#111827;">
  <h2 style="color:${DK};margin:16px 0 4px;">☀️ Morning Action Card — ${header.dateStr}</h2>
  <p style="color:${MUTED};margin:0 0 12px;">${header.totalExceptions} exceptions · ${header.needsDateCount} need a date · ${header.pendingTriage} triage proposals pending${header.routeSummary ? ` · Route: ${escapeHtml(header.routeSummary)}` : ''}</p>
  <p style="background:#f0fdf4;border:1px solid ${GR};border-radius:6px;padding:10px 12px;">
    <strong>Act from your Slack DM</strong> — the buttons there update the system directly.
  </p>
  <table style="border-collapse:collapse;width:100%;font-size:14px;">
    <tr>
      <th style="text-align:left;padding:8px 10px;border-bottom:2px solid ${GR};">#</th>
      <th style="text-align:left;padding:8px 10px;border-bottom:2px solid ${GR};">Tripwire</th>
      <th style="text-align:left;padding:8px 10px;border-bottom:2px solid ${GR};">Item</th>
      <th style="text-align:left;padding:8px 10px;border-bottom:2px solid ${GR};">Fix required today</th>
    </tr>
    ${rows}
  </table>
  <p style="margin:16px 0;">
    <a href="${baseUrl}/maintenance/board?view=exceptions"
       style="background:${GR};color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;display:inline-block;">
      Open the exceptions board
    </a>
  </p>
</div>`;

  const text = [
    `Morning Action Card — ${header.dateStr}`,
    headerTextLine(header),
    '',
    ...items.map((i) => `${i.rank}. ${i.label} — ${i.item}\n   Fix: ${i.fixRequired}`),
    '',
    'Act from your Slack DM — the buttons there update the system directly.',
    `${baseUrl}/maintenance/board?view=exceptions`,
  ].join('\n');

  return { subject, html, text };
}

function headerTextLine(header: CardHeader): string {
  return `${header.totalExceptions} exceptions · ${header.needsDateCount} need a date · ${header.pendingTriage} triage pending${header.routeSummary ? ` · Route: ${header.routeSummary}` : ''}`;
}
