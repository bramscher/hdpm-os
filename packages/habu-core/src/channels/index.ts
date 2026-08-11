/**
 * Channel adapter registry — the seam every outbound agent message goes
 * through (docs/agent-os/00-DRAFT-master-plan.md Part 2: agent_outbox).
 *
 * SendOutcome mirrors the NoticeResult shape from lib/inspection-notify.ts
 * (status/message_id/error) — the proven sender-agnostic contract.
 * All five channels are live: slack (Brief C), email, in_app,
 * outlook_draft (Brief D), and sms_zoom (Brief D.5).
 */

import type { AgentChannel, OutboxMessage } from '../types';
import { emailAdapter } from './email';
import { inAppAdapter } from './in-app';
import { outlookDraftAdapter } from './outlook-draft';
import { slackAdapter } from './slack';
import { smsZoomAdapter } from './sms-zoom';

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
  sms_zoom: smsZoomAdapter,
  outlook_draft: outlookDraftAdapter,
};

export function getAdapter(channel: AgentChannel): ChannelAdapter {
  return REGISTRY[channel] ?? notConfiguredAdapter(channel);
}
