/**
 * Maintenance OS — Resend wrapper for exception digests.
 *
 * Recipients come from the admin-managed maint_digest_recipient table
 * (see lib/maintenance/recipients.ts); the MAINT_DIGEST_RECIPIENTS env var
 * is only a fallback.
 *
 * Env:
 *   RESEND_API_KEY    — required to send (silently skipped when absent)
 *   MAINT_DIGEST_FROM — optional From, default below
 */

import type { Digest } from './digest';
import { getActiveRecipients } from './recipients';
import { sendEmail } from '@/lib/agents/channels/email';

const DEFAULT_FROM = 'HDMS Maintenance <maintenance@highdesertpm.com>';

export interface SendResult {
  owner: string;
  to?: string;
  sent: boolean;
  reason?: string;
}

export async function sendDigestEmail(owner: string, digest: Digest): Promise<SendResult> {
  if (!process.env.RESEND_API_KEY) {
    return { owner, sent: false, reason: 'RESEND_API_KEY not configured' };
  }

  const recipients = await getActiveRecipients();
  const to = recipients[owner];
  if (!to) {
    return { owner, sent: false, reason: `"${owner}" not opted in (Exceptions view → Digest recipients)` };
  }

  const outcome = await sendEmail({
    from: process.env.MAINT_DIGEST_FROM || DEFAULT_FROM,
    to,
    subject: digest.subject,
    html: digest.html,
    text: digest.text,
  });
  if (outcome.status !== 'sent') {
    return { owner, to, sent: false, reason: outcome.error ?? outcome.status };
  }
  return { owner, to, sent: true };
}
