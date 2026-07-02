/**
 * Maintenance OS — Resend wrapper for exception digests.
 *
 * Env:
 *   RESEND_API_KEY           — required to send (silently skipped when absent)
 *   MAINT_DIGEST_RECIPIENTS  — JSON map of owner name → email, e.g.
 *                              {"Cheryl":"cheryl@highdesertpm.com", ...}
 *   MAINT_DIGEST_FROM        — optional From, default below
 */

import { Resend } from 'resend';
import type { Digest } from './digest';

const DEFAULT_FROM = 'HDMS Maintenance <maintenance@highdesertpm.com>';

export function getDigestRecipients(): Record<string, string> {
  const raw = process.env.MAINT_DIGEST_RECIPIENTS;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    console.error('[Digest] MAINT_DIGEST_RECIPIENTS is not valid JSON');
    return {};
  }
}

export interface SendResult {
  owner: string;
  to?: string;
  sent: boolean;
  reason?: string;
}

export async function sendDigestEmail(owner: string, digest: Digest): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { owner, sent: false, reason: 'RESEND_API_KEY not configured' };
  }

  const recipients = getDigestRecipients();
  const to = recipients[owner];
  if (!to) {
    return { owner, sent: false, reason: `No recipient configured for "${owner}"` };
  }

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: process.env.MAINT_DIGEST_FROM || DEFAULT_FROM,
      to,
      subject: digest.subject,
      html: digest.html,
      text: digest.text,
    });
    if (error) {
      return { owner, to, sent: false, reason: error.message };
    }
    return { owner, to, sent: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { owner, to, sent: false, reason: message };
  }
}
