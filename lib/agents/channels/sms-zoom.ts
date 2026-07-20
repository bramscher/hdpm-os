/**
 * sms_zoom channel adapter — outbound vendor/field texts via Zoom Phone
 * (Brief D.5). The sender identity is fixed by env (Cheryl's Zoom line, see
 * lib/zoom-phone.ts); recipient_address is the destination phone in E.164;
 * body is the message text. message_id = Zoom's SMS message id.
 *
 * AGENT_ZOOM_SMS_DRYRUN=1 short-circuits before any network call ('skipped'
 * is terminal in the outbox — no retry churn), mirroring AGENT_GRAPH_DRYRUN.
 */

import { isZoomSmsConfigured, sendSms } from '@/lib/zoom-phone';
import type { OutboxMessage } from '../types';
import type { ChannelAdapter, SendOutcome } from './index';

export const smsZoomAdapter: ChannelAdapter = {
  channel: 'sms_zoom',
  async send(msg: OutboxMessage): Promise<SendOutcome> {
    if (process.env.AGENT_ZOOM_SMS_DRYRUN === '1') {
      return { status: 'skipped', error: 'AGENT_ZOOM_SMS_DRYRUN=1' };
    }
    if (!msg.recipient_address) {
      return { status: 'skipped', error: 'no phone (recipient_address)' };
    }
    if (!msg.body) {
      return { status: 'skipped', error: 'no message body' };
    }
    if (!isZoomSmsConfigured()) {
      return { status: 'skipped', error: 'Zoom SMS env not configured' };
    }
    try {
      const { messageId } = await sendSms({
        toPhoneNumber: msg.recipient_address,
        message: msg.body,
      });
      return { status: 'sent', message_id: messageId };
    } catch (err) {
      return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
    }
  },
};
