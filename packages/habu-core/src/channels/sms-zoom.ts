/**
 * sms_zoom channel adapter — outbound texts via the registered SMS transport.
 *
 * The `sms_zoom` channel name is the DB/wire value (outbox rows carry it); the
 * *backend* is pluggable per the HABU swappable-adapter rule. hdpm-os registers
 * a Zoom Phone transport (`lib/zoom-phone.ts`) at boot via registerSmsTransport;
 * with no transport registered the adapter reports 'skipped', never throws.
 * recipient_address is the destination phone in E.164; body is the message.
 *
 * AGENT_SMS_DRYRUN=1 short-circuits before any network call ('skipped' is
 * terminal in the outbox — no retry churn), mirroring AGENT_GRAPH_DRYRUN.
 */

import type { OutboxMessage } from '../types';
import type { ChannelAdapter, SendOutcome } from './index';
import { getSmsTransport } from '../sms-transport';

export const smsZoomAdapter: ChannelAdapter = {
  channel: 'sms_zoom',
  async send(msg: OutboxMessage): Promise<SendOutcome> {
    if (process.env.AGENT_SMS_DRYRUN === '1') {
      return { status: 'skipped', error: 'AGENT_SMS_DRYRUN=1' };
    }
    if (!msg.recipient_address) {
      return { status: 'skipped', error: 'no phone (recipient_address)' };
    }
    if (!msg.body) {
      return { status: 'skipped', error: 'no message body' };
    }
    const transport = getSmsTransport();
    if (!transport.isConfigured()) {
      return { status: 'skipped', error: 'SMS transport not configured' };
    }
    try {
      const { messageId } = await transport.send({
        toPhoneNumber: msg.recipient_address,
        message: msg.body,
      });
      return { status: 'sent', message_id: messageId };
    } catch (err) {
      return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
    }
  },
};
