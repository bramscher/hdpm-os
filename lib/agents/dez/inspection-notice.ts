/**
 * Dez → inspection tenant-notice card.
 *
 * When a schedule of inspections is created (candidates/schedule route), each new
 * inspection already gets notice_email + notice_status='pending' with target_date
 * = the route date. This posts ONE Slack DM to the inspections owner (Brody)
 * listing the notices that need to go out, so a HUMAN reviews and sends them from
 * the existing "Send Notices" flow on the inspections dashboard — which logs the
 * correspondence inside AppFolio via Realm-X "Send Bulk Email". Nothing is sent
 * programmatically here; [Mark all sent] only records the manual send afterward.
 *
 * OFF unless DEZ_INSPECTION_NOTICES=1 (checked at the schedule-route call site).
 * Owner defaults to Brody; override with DEZ_INSPECTION_NOTICE_OWNER.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getDueNotices, type DueNotice } from '@/lib/inspection-notify';
import { buildRealmxRequest } from '@/lib/inspection-realmx-request';
import { createProposal } from '@/lib/agents/proposals';
import { getNotifyRecipients } from '@/lib/agents/config';
import { enqueueOutbox, dispatchOutbox } from '@/lib/agents/outbox';

export const DEZ_NOTICE_AGENT = 'dez_notice';
export const INSPECTION_NOTICE_ACTION = 'inspection_notice';

/** Who gets the notice DM. Brody owns inspections; env can re-point it. */
export function getNoticeOwner(): string {
  return process.env.DEZ_INSPECTION_NOTICE_OWNER || 'Brody';
}

// ── Slack dznotice:* action-id helpers ([Mark all sent] / [Dismiss]) ──
// The [Open dashboard] button is a plain URL link with no action_id, so the
// only tappable actions the interact route handles are 'sent' and 'dismiss'.

export type NoticeAction = { kind: 'sent' | 'dismiss'; proposalId: string };

export function buildNoticeActionId(kind: 'sent' | 'dismiss', proposalId: string): string {
  return `dznotice:${kind}:${proposalId}`;
}

/** Parse a dznotice:* action id. Pure. Returns null if not a notice action. */
export function parseNoticeActionId(actionId: string): NoticeAction | null {
  const m = actionId.match(/^dznotice:(sent|dismiss):(.+)$/);
  if (!m) return null;
  return { kind: m[1] as 'sent' | 'dismiss', proposalId: m[2] };
}

function formatShortDate(dateStr: string | null): string {
  if (!dateStr) return 'an upcoming date';
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** One display row on the card. Stored in the proposal payload so a tap can
 *  rebuild the exact card without re-querying (sent notices leave the due list). */
export interface NoticeCardItem {
  who: string;
  address: string;
  date: string | null;
  hasEmail: boolean;
}

/** Map the notice engine's rows to the card's display items. Pure. */
export function toNoticeCardItems(notices: DueNotice[]): NoticeCardItem[] {
  return notices.map((n) => ({
    who: n.financially_responsible?.length ? n.financially_responsible.join(', ') : n.resident_name || 'Resident',
    address: n.address,
    date: n.target_date,
    hasEmail: Boolean(n.email),
  }));
}

/**
 * The Slack card. Pure. Shows one line per notice (with a ⚠️ on the ones missing
 * an email — those can't be sent until an address is on file). When `resolution`
 * is set the buttons are replaced with the outcome line (post-tap render).
 */
export function buildInspectionNoticeCard(input: {
  proposalId: string;
  routeDate: string | null;
  items: NoticeCardItem[];
  resolution?: string;
  /** Route arrival window, e.g. "between 8:30 AM and 1:00 PM". */
  windowLabel?: string | null;
  /** Paste-ready Realm-X "Send Bulk Email" request for this route. */
  realmxRequest?: string | null;
  /** The route moved after some tenants were told the old date. */
  dateChanged?: boolean;
}): { text: string; blocks: unknown[] } {
  const dateLabel = formatShortDate(input.routeDate);
  const missingEmail = input.items.filter((i) => !i.hasEmail).length;
  const sendable = input.items.length - missingEmail;
  const headline = `${input.dateChanged ? '🔁 *Date changed* — ' : '📬 '}*${input.items.length} inspection notice${
    input.items.length === 1 ? '' : 's'
  } ready* for the *${dateLabel}* route${input.windowLabel ? ` (${input.windowLabel})` : ''}`;

  const lines = input.items
    .slice(0, 20)
    .map((i) => {
      const flag = i.hasEmail ? '' : '  ⚠️ no email on file';
      return `• *${i.who}* — ${i.address} · ${formatShortDate(i.date)}${flag}`;
    })
    .join('\n');
  const overflow =
    input.items.length > 20 ? `\n…and ${input.items.length - 20} more.` : '';

  const blocks: unknown[] = [
    { type: 'section', text: { type: 'mrkdwn', text: headline } },
    { type: 'section', text: { type: 'mrkdwn', text: lines + overflow } },
  ];

  if (missingEmail > 0) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `⚠️ ${missingEmail} of these have no tenant email — add one in AppFolio before they can be sent.`,
        },
      ],
    });
  }

  if (input.realmxRequest && !input.resolution) {
    // Slack caps a section at 3000 chars; the request is well under that for a route.
    blocks.push(
      { type: 'section', text: { type: 'mrkdwn', text: '*Paste this into AppFolio → Realm-X Assistant*, check the draft and recipients, then send:' } },
      { type: 'section', text: { type: 'mrkdwn', text: '```' + input.realmxRequest.slice(0, 2900) + '```' } },
    );
  }

  if (input.resolution) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: input.resolution }] });
  } else {
    const baseUrl = process.env.NEXTAUTH_URL || 'https://hdpmchat.highdesertpm.com';
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          style: 'primary',
          text: { type: 'plain_text', text: 'Review & Send in Realm-X' },
          url: `${baseUrl}/maintenance/inspections`,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: `Mark all sent${sendable > 0 ? ` (${sendable})` : ''}` },
          action_id: buildNoticeActionId('sent', input.proposalId),
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Dismiss' },
          action_id: buildNoticeActionId('dismiss', input.proposalId),
        },
      ],
    });
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: 'Realm-X drafts the email to each unit’s *current* tenants from AppFolio, so check its recipient list before sending. “Review & Send” opens Send Notices for per-unit details and a live tenant re-check. Tap *Mark all sent* only after they’ve actually been sent.',
        },
      ],
    });
  }

  return {
    text: `${input.items.length} inspection notices ready for the ${dateLabel} route`,
    blocks,
  };
}

/**
 * Fire-and-forget after a schedule is created or a route moves: DM the
 * inspections owner one card per route for the notices among `inspectionIds`
 * that still need sending. Never throws — scheduling must succeed regardless.
 */
export async function postInspectionNoticeCard(
  supabase: SupabaseClient,
  inspectionIds: string[]
): Promise<{ posted: boolean; count: number; reason?: string }> {
  try {
    if (!inspectionIds.length) return { posted: false, count: 0, reason: 'no inspections' };
    const due = await getDueNotices(supabase);
    const idSet = new Set(inspectionIds);
    return await postNoticeGroups(supabase, due.notices.filter((n) => idSet.has(n.id)));
  } catch (err) {
    console.error('[dez/inspection-notice] post card failed:', err instanceof Error ? err.message : err);
    return { posted: false, count: 0, reason: 'error' };
  }
}

/** After a route moves: post its card again (titled "Date changed" when re-noticing). */
export async function postRouteNoticeCards(
  supabase: SupabaseClient,
  routeId: string
): Promise<{ posted: boolean; count: number; reason?: string }> {
  try {
    const due = await getDueNotices(supabase);
    return await postNoticeGroups(supabase, due.notices.filter((n) => n.route_plan_id === routeId));
  } catch (err) {
    console.error('[dez/inspection-notice] post route card failed:', err instanceof Error ? err.message : err);
    return { posted: false, count: 0, reason: 'error' };
  }
}

/** Group notices by route (one Realm-X bulk email per route) and post each. */
async function postNoticeGroups(
  supabase: SupabaseClient,
  notices: DueNotice[]
): Promise<{ posted: boolean; count: number; reason?: string }> {
  if (!notices.length) return { posted: false, count: 0, reason: 'no due notices in batch' };
  const groups = new Map<string, DueNotice[]>();
  for (const n of notices) {
    const key = n.route_plan_id || `date:${n.target_date ?? 'none'}`;
    groups.set(key, [...(groups.get(key) || []), n]);
  }
  let posted = false;
  for (const group of groups.values()) {
    const result = await postNoticeGroup(supabase, group);
    posted = posted || result;
  }
  return { posted, count: notices.length };
}

async function postNoticeGroup(supabase: SupabaseClient, notices: DueNotice[]): Promise<boolean> {
  const missingEmail = notices.filter((n) => !n.email).length;
  const routeDate = notices[0].target_date ?? null;
  const windowLabel = notices[0].route_window ?? null;
  const dateChanged = notices.some((n) => n.previous_target_date);
  const items = toNoticeCardItems(notices);
  const realmxRequest = routeDate
    ? buildRealmxRequest({ routeDate, windowLabel, units: notices.map((n) => ({ address: n.address })), dateChanged }).request
    : null;

  // Recipients configurable per-agent (agent_config.slack_recipients for
  // inspections/tenant_notice); defaults to the notice owner (Brody). All
  // recipients get the same card; the proposal is double-tap guarded.
  const recipients = await getNotifyRecipients('inspections', 'tenant_notice', [getNoticeOwner()]);
  if (recipients.length === 0) return false;

  const proposal = await createProposal({
    agent: DEZ_NOTICE_AGENT,
    subject_type: 'inspection_route',
    subject_id: notices[0].route_plan_id ?? null,
    action_type: INSPECTION_NOTICE_ACTION,
    payload: {
      route_date: routeDate,
      route_plan_id: notices[0].route_plan_id ?? null,
      window_label: windowLabel,
      date_changed: dateChanged,
      notice_ids: notices.map((n) => n.id),
      // Only ones with an email are markable-as-sent; the rest wait on data.
      sendable_ids: notices.filter((n) => n.email).map((n) => n.id),
      missing_email: missingEmail,
      count: notices.length,
      items, // stored so a tap can rebuild the exact card
    },
    rationale: `${notices.length} tenant inspection notices due for the ${routeDate ?? 'upcoming'} route`,
  });

  const card = buildInspectionNoticeCard({ proposalId: proposal.id, routeDate, items, windowLabel, realmxRequest, dateChanged });

  const rowIds: string[] = [];
  for (const r of recipients) {
    const row = await enqueueOutbox({
      proposal_id: proposal.id,
      channel: 'slack',
      recipient_person: r.person,
      recipient_address: r.slack_user_id!,
      subject: dateChanged ? 'Inspection date changed — re-notice tenants' : 'Inspection notices ready',
      body: card.text,
      payload: { blocks: card.blocks, route_date: routeDate },
    });
    rowIds.push(row.id);
  }
  await dispatchOutbox({ channel: 'slack' });

  const { data: sentRows } = await supabase
    .from('agent_outbox')
    .select('status, message_id')
    .in('id', rowIds);
  const firstSent = (sentRows ?? []).find((r) => r.status === 'sent');
  if (firstSent?.message_id) {
    await supabase
      .from('agent_proposal')
      .update({ channel_message_id: firstSent.message_id })
      .eq('id', proposal.id);
  }
  return Boolean(firstSent);
}
