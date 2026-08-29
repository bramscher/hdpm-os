/**
 * Referral notifications (Batch 4) — send + log. Best-effort: a failure is
 * recorded in referral_notification_log and logged, but NEVER blocks the action
 * that triggered it (lead submit, stage change).
 *
 * ⚠️ Referrers are EXTERNAL recipients. Resend will only deliver to them if the
 * From domain (RESEND/AGENT_EMAIL_FROM) has verified DKIM/SPF — verify that
 * before relying on referrer email. Every attempt is logged sent|skipped|failed
 * so deliverability gaps are visible, not silent.
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/agents/channels/email';
import {
  buildInviteEmail,
  buildLeadSubmittedEmail,
  buildStatusChangeEmail,
  buildW9MissingEmail,
  shouldNotifyStatusChange,
  type EmailContent,
} from './notify-templates';
import type { LeadStage } from './types';

type NotifyEvent = 'invite' | 'lead_submitted' | 'status_change' | 'accrual' | 'payout' | 'w9_missing';

export interface SendResult {
  status: 'sent' | 'skipped' | 'failed';
  detail: string | null;
}

/** Send one email and record the outcome. Never throws. Returns the outcome. */
async function recordSend(params: {
  event: NotifyEvent;
  recipient: string | null;
  content: EmailContent;
  partnerId?: string | null;
  leadId?: string | null;
}): Promise<SendResult> {
  const supabase = getSupabaseAdmin();
  let status: 'sent' | 'skipped' | 'failed' = 'skipped';
  let detail: string | null = null;

  try {
    if (!params.recipient) {
      detail = 'no recipient';
    } else {
      const res = await sendEmail({
        to: params.recipient,
        subject: params.content.subject,
        html: params.content.html,
        text: params.content.text,
      });
      status = res.status === 'sent' ? 'sent' : res.status === 'skipped' ? 'skipped' : 'failed';
      detail = res.error ?? null;
    }
  } catch (err) {
    status = 'failed';
    detail = err instanceof Error ? err.message : String(err);
  }

  try {
    await supabase.from('referral_notification_log').insert({
      partner_id: params.partnerId ?? null,
      lead_id: params.leadId ?? null,
      event: params.event,
      channel: 'email',
      recipient: params.recipient,
      status,
      detail,
    });
  } catch (err) {
    console.error('[referrals] notification_log write failed:', err instanceof Error ? err.message : err);
  }

  return { status, detail };
}

/**
 * Email a referrer their invite link. Returns the send outcome so the admin UI
 * can confirm delivery (or fall back to copy-link when email isn't deliverable).
 */
export async function notifyInvite(
  partner: { id: string; display_name: string; email: string | null },
  url: string
): Promise<SendResult> {
  return recordSend({
    event: 'invite',
    recipient: partner.email,
    partnerId: partner.id,
    content: buildInviteEmail({ partner_name: partner.display_name, url }),
  });
}

/** New lead → notify the referral ops admin (REFERRAL_ADMIN_EMAIL). */
export async function notifyLeadSubmitted(lead: {
  id: string;
  prospect_name: string;
  source: string;
  partner_id: string | null;
}): Promise<void> {
  const admin = process.env.REFERRAL_ADMIN_EMAIL || null;
  let partnerName: string | null = null;
  if (lead.partner_id) {
    const { data } = await getSupabaseAdmin()
      .from('referral_partner')
      .select('display_name')
      .eq('id', lead.partner_id)
      .maybeSingle();
    partnerName = data?.display_name ?? null;
  }
  await recordSend({
    event: 'lead_submitted',
    recipient: admin,
    partnerId: lead.partner_id,
    leadId: lead.id,
    content: buildLeadSubmittedEmail({ prospect_name: lead.prospect_name, source: lead.source, partner_name: partnerName }),
  });
}

/** Stage change → notify the referrer (if a referral lead, opted in, with email). */
export async function notifyStatusChange(
  lead: { id: string; prospect_name: string; partner_id: string | null },
  from: LeadStage | null,
  to: LeadStage
): Promise<void> {
  if (!lead.partner_id || !shouldNotifyStatusChange(from, to)) return;
  const { data: partner } = await getSupabaseAdmin()
    .from('referral_partner')
    .select('email, notify_email')
    .eq('id', lead.partner_id)
    .maybeSingle();
  if (!partner) return;
  if (partner.notify_email === false) {
    // Respect opt-out: record the skip for auditability, send nothing.
    try {
      await getSupabaseAdmin().from('referral_notification_log').insert({
        partner_id: lead.partner_id,
        lead_id: lead.id,
        event: 'status_change',
        channel: 'email',
        recipient: partner.email ?? null,
        status: 'skipped',
        detail: 'referrer opted out',
      });
    } catch (err) {
      console.error('[referrals] opt-out log write failed:', err instanceof Error ? err.message : err);
    }
    return;
  }
  await recordSend({
    event: 'status_change',
    recipient: partner.email ?? null,
    partnerId: lead.partner_id,
    leadId: lead.id,
    content: buildStatusChangeEmail({ prospect_name: lead.prospect_name, to }),
  });
}

/** W-9 reminder → the referrer (admin-triggered or a future cron). */
export async function notifyW9Missing(partner: {
  id: string;
  display_name: string;
  email: string | null;
}): Promise<void> {
  await recordSend({
    event: 'w9_missing',
    recipient: partner.email,
    partnerId: partner.id,
    content: buildW9MissingEmail({ partner_name: partner.display_name }),
  });
}
