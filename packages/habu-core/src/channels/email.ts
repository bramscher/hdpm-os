/**
 * Email channel adapter — generic Resend sender.
 *
 * Env:
 *   RESEND_API_KEY   — required to send (skipped when absent)
 *   AGENT_EMAIL_FROM — optional From for agent mail; falls back to
 *                      MAINT_DIGEST_FROM, then the default below
 */

import { Resend } from 'resend';
import type { OutboxMessage } from '../types';
import type { ChannelAdapter, SendOutcome } from './index';

const DEFAULT_FROM = 'HDPM Agents <maintenance@highdesertpm.com>';

export async function sendEmail(input: {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  from?: string;
}): Promise<SendOutcome> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { status: 'skipped', error: 'RESEND_API_KEY not configured' };
  }

  try {
    const resend = new Resend(apiKey);
    const base = {
      from: input.from || process.env.AGENT_EMAIL_FROM || process.env.MAINT_DIGEST_FROM || DEFAULT_FROM,
      to: input.to,
      subject: input.subject,
    };
    const { data, error } = await resend.emails.send(
      input.html !== undefined
        ? { ...base, html: input.html, text: input.text }
        : { ...base, text: input.text ?? '' }
    );
    if (error) return { status: 'failed', error: error.message };
    return { status: 'sent', message_id: data?.id ?? null };
  } catch (err) {
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
}

export const emailAdapter: ChannelAdapter = {
  channel: 'email',
  async send(msg: OutboxMessage): Promise<SendOutcome> {
    if (!msg.recipient_address) {
      return { status: 'skipped', error: 'no recipient_address' };
    }
    return sendEmail({
      to: msg.recipient_address,
      subject: msg.subject ?? '(no subject)',
      html: typeof msg.payload.html === 'string' ? msg.payload.html : undefined,
      text: msg.body ?? undefined,
    });
  },
};
