/**
 * Channel adapter registry — the seam every outbound agent message goes
 * through (docs/agent-os/00-DRAFT-master-plan.md Part 2: agent_outbox).
 *
 * SendOutcome mirrors the NoticeResult shape from lib/inspection-notify.ts
 * (status/message_id/error) — the proven sender-agnostic contract.
 * slack (Brief C), email, in_app, and outlook_draft (Brief D) are live;
 * sms_zoom is registered as a not-configured stub until its brief lands: it
 * returns 'failed' so the rows stay visible and retryable, then park at the
 * attempt cap with the reason.
 */

import type { AgentChannel, OutboxMessage } from '../types';
import { emailAdapter } from './email';
import { inAppAdapter } from './in-app';
import { outlookDraftAdapter } from './outlook-draft';
import { slackAdapter } from './slack';

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
  slack: slackAdapter,
  sms_zoom: notConfiguredAdapter('sms_zoom'),
  outlook_draft: outlookDraftAdapter,
};

export function getAdapter(channel: AgentChannel): ChannelAdapter {
  return REGISTRY[channel] ?? notConfiguredAdapter(channel);
}
