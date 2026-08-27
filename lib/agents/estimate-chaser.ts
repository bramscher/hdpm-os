/**
 * Estimate Chaser — pure logic. Brief D, Agent #3 in
 * docs/agent-os/00-DRAFT-master-plan.md.
 *
 * Turns the TW11 stuck-estimates pool into ready-to-send Outlook drafts in
 * Cheryl's Drafts folder (L1 — she reviews and sends from the client she
 * already lives in). Two kinds map straight off appfolio_status:
 *   'estimate requested' → vendor_chase   (draft To: the vendor)
 *   'estimated'          → owner_approval (draft To: blank — no reliable
 *                          WO→owner-contact mapping; Cheryl fills it)
 *
 * Hard rules encoded here:
 * - NEVER a dollar amount: the AppFolio v0 API exposes no estimate amounts
 *   (verified 2026-07-05), so the language never claims one.
 * - No appfolio_link in draft bodies — drafts are external-facing and the
 *   link is an internal web-app URL. It stays in proposal payloads and the
 *   (internal) escalation Slack message.
 * - HDMS (HDPM-owned vendor, i.e. Alberto) never gets a vendor-relations
 *   chase draft.
 *
 * Everything here is DB-free and fetch-free so it unit-tests like
 * morning-card.ts. Orchestration lives in estimate-chaser-run.ts.
 */

import type { TripwireException } from '@/lib/maintenance/types';
import { businessDaysBetween } from '@/lib/maintenance/business-days';

export const ESTIMATE_CHASER_AGENT = 'estimate_chaser';
export const VENDOR_CHASE_ACTION = 'vendor_chase';
/**
 * Brief D.5: vendor chase by text, L2 send-on-tap (SMS has no drafts folder,
 * so L1 doesn't map — Cheryl's tap on the Slack queue card is the review).
 */
export const VENDOR_CHASE_SMS_ACTION = 'vendor_chase_sms';
export const OWNER_APPROVAL_ACTION = 'owner_approval';
/** Interim Craig escalation (L3 self-addressed reporting) until Brief E's Ops Brief absorbs it. */
export const ESCALATE_ACTION = 'escalate';

/** Never double-chase the same WO inside this window (either chase kind). */
export const CHASE_COOLDOWN_BUSINESS_DAYS = 3;
/** Chased this many times → roll up to Craig instead of chasing again. */
export const ESCALATE_CHASE_COUNT = 3;
/**
 * Aged past this → roll up to Craig. Calendar days (the spec's ">45d" reads
 * as real time stuck, not ~9 weeks of business days), measured from the WO's
 * entry into its current status — the same clock TW11 uses.
 */
export const ESCALATE_AGE_CALENDAR_DAYS = 45;
/** Re-escalate the same WO at most about weekly. */
export const ESCALATE_COOLDOWN_BUSINESS_DAYS = 5;

export type ChaseKind = typeof VENDOR_CHASE_ACTION | typeof OWNER_APPROVAL_ACTION;

/** The work_orders columns the chaser needs (MaintWorkOrder satisfies this). */
export interface WorkOrderLite {
  id: string;
  wo_number: string | null;
  property_name: string;
  property_address: string | null;
  unit_name: string | null;
  description: string;
  vendor_id: string | null;
  vendor_name: string | null;
  appfolio_status: string | null;
  appfolio_link: string | null;
}

export interface ChaseCandidate {
  workOrderId: string;
  kind: ChaseKind;
  woNumber: string | null;
  propertyName: string | null;
  propertyAddress: string | null;
  unitName: string | null;
  description: string | null;
  vendorId: string | null;
  vendorName: string | null;
  /** Internal-only — never rendered into draft bodies. */
  appfolioLink: string | null;
  /** Business days in status, from the TW11 exception. */
  ageBusinessDays: number;
  /** Calendar days since status entry — drives the 45d escalation rule. */
  ageCalendarDays: number;
}

const INTERNAL_VENDOR_NAME_RE = /high desert maintenance/i;

function isInternalVendor(wo: WorkOrderLite, internalVendorIds: string[]): boolean {
  if (wo.vendor_id && internalVendorIds.includes(wo.vendor_id)) return true;
  return !!wo.vendor_name && INTERNAL_VENDOR_NAME_RE.test(wo.vendor_name);
}

function kindFor(wo: WorkOrderLite): ChaseKind {
  const status = (wo.appfolio_status || '').toLowerCase().trim();
  if (status === 'estimate requested') return VENDOR_CHASE_ACTION;
  // 'estimated' — and source-(a) approval-record WOs in any other status —
  // are waiting on a decision, not a vendor bid.
  return OWNER_APPROVAL_ACTION;
}

/**
 * Classify TW11 exceptions into chase candidates. Dedupes to one candidate
 * per WO; drops exceptions whose WO row is missing (nothing to draft from);
 * routes internal-vendor (HDMS) bid chases to skippedInternal — nudging
 * Alberto is the Vendor Chaser's job, never a vendor-relations email.
 */
export function classifyPool(
  exceptions: TripwireException[],
  wosById: Map<string, WorkOrderLite>,
  internalVendorIds: string[],
  calendarAgeByWo: Map<string, number>
): { candidates: ChaseCandidate[]; skippedInternal: ChaseCandidate[] } {
  const candidates: ChaseCandidate[] = [];
  const skippedInternal: ChaseCandidate[] = [];
  const seen = new Set<string>();

  for (const ex of exceptions) {
    if (ex.tripwire !== 11 || !ex.workOrderId || seen.has(ex.workOrderId)) continue;
    const wo = wosById.get(ex.workOrderId);
    if (!wo) continue;
    seen.add(ex.workOrderId);

    const kind = kindFor(wo);
    const candidate: ChaseCandidate = {
      workOrderId: wo.id,
      kind,
      woNumber: wo.wo_number,
      propertyName: wo.property_name || null,
      propertyAddress: wo.property_address,
      unitName: wo.unit_name,
      description: wo.description || null,
      vendorId: wo.vendor_id,
      vendorName: wo.vendor_name,
      appfolioLink: wo.appfolio_link,
      ageBusinessDays: ex.ageDays ?? 0,
      ageCalendarDays: calendarAgeByWo.get(wo.id) ?? ex.ageDays ?? 0,
    };

    if (kind === VENDOR_CHASE_ACTION && isInternalVendor(wo, internalVendorIds)) {
      skippedInternal.push(candidate);
    } else {
      candidates.push(candidate);
    }
  }

  return { candidates, skippedInternal };
}

// ============================================
// Chase decision
// ============================================

export interface ChaseHistory {
  /** Prior chase proposals of this candidate's kind (non-expired). */
  chaseCount: number;
  /** Most recent chase proposal across BOTH kinds — a status flip must not restart chasing immediately. */
  lastChaseAt: Date | null;
  lastEscalateAt: Date | null;
}

export type ChaseDecision =
  | { action: 'chase' }
  | { action: 'skip'; reason: 'cooldown' | 'escalation_cooldown' }
  | { action: 'escalate'; reason: 'chased_3x' | 'aged_45d' };

/** Precedence: escalate > cooldown > chase. Pure. */
export function decideChase(c: ChaseCandidate, h: ChaseHistory, now: Date): ChaseDecision {
  const shouldEscalate =
    h.chaseCount >= ESCALATE_CHASE_COUNT || c.ageCalendarDays > ESCALATE_AGE_CALENDAR_DAYS;
  if (shouldEscalate) {
    if (
      h.lastEscalateAt &&
      businessDaysBetween(h.lastEscalateAt, now) < ESCALATE_COOLDOWN_BUSINESS_DAYS
    ) {
      return { action: 'skip', reason: 'escalation_cooldown' };
    }
    return {
      action: 'escalate',
      reason: h.chaseCount >= ESCALATE_CHASE_COUNT ? 'chased_3x' : 'aged_45d',
    };
  }
  if (h.lastChaseAt && businessDaysBetween(h.lastChaseAt, now) < CHASE_COOLDOWN_BUSINESS_DAYS) {
    return { action: 'skip', reason: 'cooldown' };
  }
  return { action: 'chase' };
}

// ============================================
// Draft templates
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
const HAIR = '#e5e7eb';
const MUTED = '#6b7280';

function ordinal(n: number): string {
  if (n === 2) return 'second';
  if (n === 3) return 'third';
  return `${n}th`;
}

/** Numeric ordinal for the subject line: 1 → "1st", 2 → "2nd", 3 → "3rd". */
function ordinalNum(n: number): string {
  const suffix = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${suffix[(v - 20) % 10] ?? suffix[v] ?? suffix[0]}`;
}

/** "WO #123 — 456 Main St, Unit 4" (address preferred; falls back to property name). */
function woRef(c: ChaseCandidate): string {
  const where = c.propertyAddress || c.propertyName || 'property';
  const unit = c.unitName ? `, Unit ${c.unitName}` : '';
  return `${c.woNumber ? `WO #${c.woNumber} — ` : ''}${where}${unit}`;
}

function detailBlockHtml(c: ChaseCandidate): string {
  return `
  <table style="border:1px solid ${HAIR};border-left:3px solid ${GR};border-collapse:collapse;width:100%;font-size:14px;margin:12px 0;">
    <tr><td style="padding:10px 12px;">
      <strong>${escapeHtml(woRef(c))}</strong><br/>
      <span style="color:${MUTED};">${escapeHtml(c.description ?? '')}</span>
    </td></tr>
  </table>`;
}

// Signature is per-sender: a draft created in Brody's mailbox must sign as
// Brody, not the default coordinator. Defaults to the production owner
// (Jayme since the 2026-08-26 handoff; ESTIMATE_CHASER_OWNER overrides).
const DEFAULT_SENDER = process.env.ESTIMATE_CHASER_OWNER?.trim() || 'Jayme';
const signatureText = (name: string) =>
  ['Thank you,', name, 'High Desert Property Management'].join('\n');
const signatureHtml = (name: string) =>
  `<p style="margin:16px 0 0;">Thank you,<br/>${escapeHtml(name)}<br/>High Desert Property Management</p>`;

function wrapHtml(paragraphs: string[], senderName: string): string {
  return `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:640px;color:#111827;font-size:14px;line-height:1.5;">
  ${paragraphs.join('\n  ')}
  ${signatureHtml(senderName)}
</div>`;
}

export interface DraftContent {
  subject: string;
  html: string;
  text: string;
  toRecipients: string[];
}

/**
 * Vendor bid chase. To: the vendor when their email is known, else blank for
 * Cheryl to fill. Round ≥ 2 acknowledges the earlier follow-up.
 */
export function buildVendorChaseDraft(
  c: ChaseCandidate,
  vendorEmail: string | null,
  chaseRound: number,
  senderName: string = DEFAULT_SENDER
): DraftContent {
  const subject = `Bid follow-up (${ordinalNum(chaseRound)} request) — ${woRef(c)}`;
  const greeting = `Hi ${c.vendorName || 'there'},`;
  const opener =
    chaseRound >= 2
      ? `Just checking in again — this is our ${ordinal(chaseRound)} follow-up on the estimate we requested for the work order below (${c.ageBusinessDays} business days now).`
      : `Following up on the estimate we requested for the work order below — we haven't received your bid yet (${c.ageBusinessDays} business days).`;
  // Round 3 is the last vendor-facing chase before auto-escalation to the Ops
  // Brief (restart §4), so it carries a firmer close with a hand-filled date.
  // NOTE for the reviewer: [date] must be filled in, and this line should be
  // softened or removed if this is a single-vendor situation with no backup.
  const ask =
    chaseRound >= 3
      ? `Please reply to this email with your bid, or give us a call. If we don't hear back by [date], we'll need to reach out to another vendor to keep this moving.`
      : `Please reply to this email with your bid, or give us a call. If you're not able to take this one, just let us know so we can line up another vendor.`;

  const html = wrapHtml(
    [
      `<p style="margin:0 0 12px;">${escapeHtml(greeting)}</p>`,
      `<p style="margin:0 0 12px;">${escapeHtml(opener)}</p>`,
      detailBlockHtml(c),
      `<p style="margin:0 0 12px;">${escapeHtml(ask)}</p>`,
    ],
    senderName
  );

  const text = [
    greeting,
    '',
    opener,
    '',
    woRef(c),
    c.description ?? '',
    '',
    ask,
    '',
    signatureText(senderName),
  ].join('\n');

  return { subject, html, text, toRecipients: vendorEmail ? [vendorEmail] : [] };
}

/**
 * Owner approval request. To: always blank — Cheryl addresses it to the
 * property owner. Never states an amount (none is available, by design).
 */
export function buildOwnerApprovalDraft(
  c: ChaseCandidate,
  chaseRound: number,
  senderName: string = DEFAULT_SENDER
): DraftContent {
  const subject = `Approval needed — ${woRef(c)}`;
  const greeting = `Hi [owner name],`;
  const opener =
    chaseRound >= 2
      ? `Just checking in again on the repair approval below — it has been pending ${c.ageBusinessDays} business days and we'd love to get it moving.`
      : `We have an estimate in hand for the repair below and are waiting on your go-ahead (pending ${c.ageBusinessDays} business days).`;
  const ask = `Could you reply with your approval — or any questions — so we can get the work scheduled?`;

  const html = wrapHtml(
    [
      `<p style="margin:0 0 12px;">${escapeHtml(greeting)}</p>`,
      `<p style="margin:0 0 12px;">${escapeHtml(opener)}</p>`,
      detailBlockHtml(c),
      `<p style="margin:0 0 12px;">${escapeHtml(ask)}</p>`,
    ],
    senderName
  );

  const text = [
    greeting,
    '',
    opener,
    '',
    woRef(c),
    c.description ?? '',
    '',
    ask,
    '',
    signatureText(senderName),
  ].join('\n');

  return { subject, html, text, toRecipients: [] };
}

// ============================================
// SMS chase (Brief D.5)
// ============================================

const SMS_DESC_MAX = 60;

/**
 * The text the owner's tap sends. Same hard rules as the email templates: no
 * dollar amounts, no links. Kept under ~320 chars (two SMS segments). The
 * vendor-facing sender name defaults to the production owner (Jayme).
 */
export function buildVendorChaseSms(
  c: ChaseCandidate,
  chaseRound: number,
  senderName: string = DEFAULT_SENDER
): string {
  const where = c.propertyAddress || c.propertyName || 'the property';
  const unit = c.unitName ? ` #${c.unitName}` : '';
  const wo = c.woNumber ? `WO #${c.woNumber}` : 'the work order';
  const desc = (c.description ?? '').slice(0, SMS_DESC_MAX).trim();

  if (chaseRound >= 2) {
    return `Hi ${c.vendorName || 'there'}, ${senderName} at High Desert Property Mgmt again — still hoping to get your bid for ${wo} at ${where}${unit}. Can you let me know either way? Thanks!`;
  }
  return `Hi ${c.vendorName || 'there'}, this is ${senderName} at High Desert Property Mgmt. Following up on the bid for ${wo} at ${where}${unit}${desc ? ` (${desc})` : ''} — could you send it over, or let me know if you can't take it? Thanks!`;
}

// ── ec:* action ids (Slack interactivity namespace for the chaser) ──

export type EcActionKind = 'sendsms' | 'skip';
const EC_ACTION_KINDS: EcActionKind[] = ['sendsms', 'skip'];

export function encodeEcActionId(kind: EcActionKind, proposalId: string): string {
  return `ec:${kind}:${proposalId}`;
}

export function parseEcActionId(
  actionId: string
): { kind: EcActionKind; proposalId: string } | null {
  const m = actionId.match(/^ec:([a-z]+):(.+)$/);
  if (!m || !EC_ACTION_KINDS.includes(m[1] as EcActionKind) || !m[2]) return null;
  return { kind: m[1] as EcActionKind, proposalId: m[2] };
}

// ── Text chase queue card (one Slack card per run, buttons per item) ──

export interface SmsQueueItem {
  proposalId: string;
  status: string; // ProposalStatus — buttons render only while 'proposed'
  vendorName: string | null;
  vendorPhone: string;
  woRef: string; // "WO #412 — 123 Main St, Unit 4"
  smsText: string;
  /** e.g. "Text sent by Cheryl 7:02 AM" / "Skipped by Cheryl 7:03 AM" */
  resolution?: string;
  /** Transient render-only error decoration (never persisted). */
  error?: string;
}

export function smsQueueItemFromCandidate(
  c: ChaseCandidate,
  proposalId: string,
  status: string,
  vendorPhone: string,
  smsText: string
): SmsQueueItem {
  return {
    proposalId,
    status,
    vendorName: c.vendorName,
    vendorPhone,
    woRef: woRef(c),
    smsText,
  };
}

export function buildSmsQueueCard(
  items: SmsQueueItem[],
  dateStr: string
): { text: string; blocks: unknown[] } {
  const pending = items.filter((i) => i.status === 'proposed').length;
  const text = `📱 Text chase queue — ${dateStr} (${pending} of ${items.length} to send)`;

  const blocks: unknown[] = [
    { type: 'section', text: { type: 'mrkdwn', text: `*${text}*` } },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: 'Each tap sends the text below from your Zoom line — replies land in your Zoom app. Nothing sends without your tap.',
        },
      ],
    },
    { type: 'divider' },
  ];

  for (const item of items) {
    const state =
      item.status === 'proposed'
        ? ''
        : `\n${item.status === 'rejected' ? '⏭️' : '✅'} ${item.resolution ?? item.status}`;
    const errorLine = item.error ? `\n:warning: ${item.error}` : '';
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${item.vendorName ?? 'Vendor'}* · ${item.vendorPhone}\n${item.woRef}\n> ${item.smsText}${state}${errorLine}`,
      },
    });
    if (item.status === 'proposed') {
      blocks.push({
        type: 'actions',
        block_id: `ec-item:${item.proposalId}`,
        elements: [
          {
            type: 'button',
            action_id: encodeEcActionId('sendsms', item.proposalId),
            text: { type: 'plain_text', text: '📱 Send text' },
            style: 'primary',
            value: item.proposalId,
            confirm: {
              title: { type: 'plain_text', text: 'Send this text?' },
              text: {
                type: 'mrkdwn',
                text: `To *${item.vendorName ?? 'vendor'}* at ${item.vendorPhone}`,
              },
              confirm: { type: 'plain_text', text: 'Send' },
              deny: { type: 'plain_text', text: 'Cancel' },
            },
          },
          {
            type: 'button',
            action_id: encodeEcActionId('skip', item.proposalId),
            text: { type: 'plain_text', text: 'Skip' },
            value: item.proposalId,
          },
        ],
      });
    }
  }

  return { text, blocks };
}

// ============================================
// Escalation (internal — Slack DM to Craig)
// ============================================

export interface EscalationItem {
  candidate: ChaseCandidate;
  reason: 'chased_3x' | 'aged_45d';
  chaseCount: number;
}

function reasonLabel(item: EscalationItem): string {
  return item.reason === 'chased_3x'
    ? `chased ${item.chaseCount}× with no movement`
    : `${item.candidate.ageCalendarDays} days stuck`;
}

/** Internal surface — the AppFolio link IS included here. */
export function buildEscalationSlack(
  items: EscalationItem[],
  dateStr: string
): { text: string; blocks: unknown[] } {
  const text = `🚨 Estimate Chaser — ${items.length} stuck estimate${items.length === 1 ? '' : 's'} need${items.length === 1 ? 's' : ''} your eyes (${dateStr})`;
  const blocks: unknown[] = [
    { type: 'section', text: { type: 'mrkdwn', text: `*${text}*` } },
    ...items.map((item) => {
      const c = item.candidate;
      const kind = c.kind === VENDOR_CHASE_ACTION ? 'vendor bid' : 'owner approval';
      const link = c.appfolioLink ? ` · <${c.appfolioLink}|AppFolio>` : '';
      return {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${woRef(c)}*\n${kind} · ${reasonLabel(item)} · ${c.ageBusinessDays} business days in status${link}`,
        },
      };
    }),
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: 'Escalated by the Estimate Chaser: chased 3× or >45 days stuck. These stop getting auto-chased until they move.',
        },
      ],
    },
  ];
  return { text, blocks };
}
