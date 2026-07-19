/**
 * Channel adapter registry — the seam every outbound agent message goes
 * through (docs/agent-os/00-DRAFT-master-plan.md Part 2: agent_outbox).
 *
 * SendOutcome mirrors the NoticeResult shape from lib/inspection-notify.ts
 * (status/message_id/error) — the proven sender-agnostic contract.
 * slack / sms_zoom / outlook_draft are registered as not-configured stubs
 * until their briefs land (C, #4, D): they return 'failed' so the rows stay
 * visible and retryable, then park at the attempt cap with the reason.
 */

import type { AgentChannel, OutboxMessage } from '../types';
import { emailAdapter } from './email';
import { inAppAdapter } from './in-app';

export interface SendOutcome {
  status: 'sent' | 'failed' | 'skipped';
  message_id?: string | null;
  error?: string | null;
}

export interface ChannelAdapter {
  channel: AgentChannel;
  send(msg: OutboxMessage): Promise<SendOutcome>;
}

export function notConfiguredAdapter(channel: AgentChannel): ChannelAdapter {
  return {
    channel,
    send: async () => ({ status: 'failed', error: `${channel} adapter not configured` }),
  };
}

const REGISTRY: Record<AgentChannel, ChannelAdapter> = {
  email: emailAdapter,
  in_app: inAppAdapter,
  slack: notConfiguredAdapter('slack'),
  sms_zoom: notConfiguredAdapter('sms_zoom'),
  outlook_draft: notConfiguredAdapter('outlook_draft'),
};

export function getAdapter(channel: AgentChannel): ChannelAdapter {
  return REGISTRY[channel] ?? notConfiguredAdapter(channel);
}
