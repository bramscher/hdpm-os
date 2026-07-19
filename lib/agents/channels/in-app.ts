/**
 * In-app channel adapter — the outbox row itself is the in-app record, so
 * "sending" is a no-op success. In-app surfaces read agent_outbox directly.
 */

import type { ChannelAdapter, SendOutcome } from './index';

export const inAppAdapter: ChannelAdapter = {
  channel: 'in_app',
  async send(): Promise<SendOutcome> {
    return { status: 'sent', message_id: null };
  },
};
