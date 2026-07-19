/**
 * outlook_draft channel adapter — "sending" means creating a ready-to-send
 * draft in a staff mailbox via app-only Graph (Brief D, L1 autonomy).
 *
 * Contract: recipient_person / recipient_address are the MAILBOX OWNER the
 * draft is delivered to (Cheryl), not the email's To: line — consistent with
 * "who this outbox row reaches." The draft's own To: recipients live in
 * payload.to_recipients (string[], may be empty — Cheryl fills the address
 * for e.g. owner-approval drafts). payload.html is the HTML body; the body
 * column keeps the plain-text fallback. message_id = the Graph message id.
 */

import type { OutboxMessage } from '../types';
import type { ChannelAdapter, SendOutcome } from './index';
import { createOutlookDraft } from '../graph';

export const outlookDraftAdapter: ChannelAdapter = {
  channel: 'outlook_draft',
  async send(msg: OutboxMessage): Promise<SendOutcome> {
    if (!msg.recipient_address) {
      return { status: 'skipped', error: 'no mailbox (recipient_address)' };
    }
    const toRecipients = Array.isArray(msg.payload.to_recipients)
      ? (msg.payload.to_recipients as unknown[]).filter((r): r is string => typeof r === 'string')
      : [];
    return createOutlookDraft({
      mailbox: msg.recipient_address,
      subject: msg.subject ?? '(no subject)',
      htmlBody: typeof msg.payload.html === 'string' ? msg.payload.html : (msg.body ?? ''),
      toRecipients,
    });
  },
};
