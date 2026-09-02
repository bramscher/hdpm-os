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
import { createProposal } from '@/lib/agents/proposals';
import { resolveStaffByPersonOrEmail } from '@/lib/agents/staff';
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
    who: n.resident_name || 'Resident',
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
}): { text: string; blocks: unknown[] } {
  const dateLabel = formatShortDate(input.routeDate);
  const missingEmail = input.items.filter((i) => !i.hasEmail).length;
  const sendable = input.items.length - missingEmail;
  const headline = `📬 *${input.items.length} inspection notice${
    input.items.length === 1 ? '' : 's'
  } ready* for the *${dateLabel}* route`;

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
          text: '“Review & Send” opens the inspections dashboard, where the ready-to-paste letters go out through AppFolio (Realm-X bulk email). Tap *Mark all sent* only after they’ve actually been sent.',
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
 * Fire-and-forget after a schedule is created: DM the inspections owner a card
 * of the notices among `inspectionIds` that still need sending. Never throws —
 * scheduling must succeed regardless. Returns a small result for logging/tests.
 */
export async function postInspectionNoticeCard(
  supabase: SupabaseClient,
  inspectionIds: string[]
): Promise<{ posted: boolean; count: number; reason?: string }> {
  try {
    if (!inspectionIds.length) return { posted: false, count: 0, reason: 'no inspections' };

    // Reuse the manual-bridge query, then narrow to just the ones we scheduled.
    const due = await getDueNotices(supabase);
    const idSet = new Set(inspectionIds);
    const notices = due.notices.filter((n) => idSet.has(n.id));
    if (!notices.length) return { posted: false, count: 0, reason: 'no due notices in batch' };

    const missingEmail = notices.filter((n) => !n.email).length;
    // All these were scheduled together, so they share one route date.
    const routeDate = notices[0].target_date ?? null;
    const items = toNoticeCardItems(notices);

    const owner = await resolveStaffByPersonOrEmail(getNoticeOwner());
    if (!owner?.slack_user_id) {
      return { posted: false, count: notices.length, reason: `no slack_user_id for ${getNoticeOwner()}` };
    }

    const proposal = await createProposal({
      agent: DEZ_NOTICE_AGENT,
      subject_type: 'inspection_route',
      subject_id: null,
      action_type: INSPECTION_NOTICE_ACTION,
      payload: {
        route_date: routeDate,
        notice_ids: notices.map((n) => n.id),
        // Only ones with an email are markable-as-sent; the rest wait on data.
        sendable_ids: notices.filter((n) => n.email).map((n) => n.id),
        missing_email: missingEmail,
        count: notices.length,
        items, // stored so a tap can rebuild the exact card
      },
      rationale: `${notices.length} tenant inspection notices due for the ${routeDate ?? 'upcoming'} route`,
    });

    const card = buildInspectionNoticeCard({
      proposalId: proposal.id,
      routeDate,
      items,
    });

    const row = await enqueueOutbox({
      proposal_id: proposal.id,
      channel: 'slack',
      recipient_person: owner.person,
      recipient_address: owner.slack_user_id,
      subject: 'Inspection notices ready',
      body: card.text,
      payload: { blocks: card.blocks, route_date: routeDate },
    });
    await dispatchOutbox({ channel: 'slack' });

    const { data: sent } = await supabase
      .from('agent_outbox')
      .select('status, message_id')
      .eq('id', row.id)
      .maybeSingle();
    if (sent?.message_id) {
      await supabase
        .from('agent_proposal')
        .update({ channel_message_id: sent.message_id })
        .eq('id', proposal.id);
    }

    return { posted: sent?.status === 'sent', count: notices.length };
  } catch (err) {
    console.error('[dez/inspection-notice] post card failed:', err instanceof Error ? err.message : err);
    return { posted: false, count: 0, reason: 'error' };
  }
}
