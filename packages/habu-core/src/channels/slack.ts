/**
 * Slack channel adapter — raw fetch to the Slack Web API (no SDK dependency).
 *
 * Env:
 *   SLACK_BOT_TOKEN — xoxb- bot token (missing → skipped)
 *
 * message_id convention: '<channel>:<ts>'. chat.postMessage to a user id
 * (U…) returns the resolved DM channel (D…) — and chat.update requires that
 * D… id, never the U… id — so both halves are kept in one string, which fits
 * the existing agent_outbox.message_id / agent_proposal.channel_message_id
 * columns. Slack ts values contain '.' never ':'; channel ids never
 * contain ':'.
 */

import type { OutboxMessage } from '../types';
import type { ChannelAdapter, SendOutcome } from './index';

const SLACK_API = 'https://slack.com/api';

export async function slackApi(
  method: 'chat.postMessage' | 'chat.update',
  body: Record<string, unknown>
): Promise<SendOutcome> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    return { status: 'skipped', error: 'SLACK_BOT_TOKEN not configured' };
  }

  try {
    const res = await fetch(`${SLACK_API}/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as {
      ok: boolean;
      error?: string;
      channel?: string;
      ts?: string;
    };
    if (!data.ok) {
      return { status: 'failed', error: data.error ?? `slack ${method} failed` };
    }
    return { status: 'sent', message_id: `${data.channel ?? ''}:${data.ts ?? ''}` };
  } catch (err) {
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
}

/** Per-agent sender identity (chat.postMessage with chat:write.customize). */
export interface SlackSenderIdentity {
  username?: string;
  icon_emoji?: string;
  icon_url?: string;
}

export async function sendSlackMessage(input: {
  channel: string; // Slack user id (U…) → DM, or a channel/D… id
  text: string; // notification fallback
  blocks?: unknown[];
  as?: SlackSenderIdentity; // agent identity; omitted → the bot's default name/avatar
}): Promise<SendOutcome> {
  return slackApi('chat.postMessage', {
    channel: input.channel,
    text: input.text,
    ...(input.blocks ? { blocks: input.blocks } : {}),
    ...(input.as?.username ? { username: input.as.username } : {}),
    ...(input.as?.icon_emoji ? { icon_emoji: input.as.icon_emoji } : {}),
    ...(input.as?.icon_url ? { icon_url: input.as.icon_url } : {}),
  });
}

export async function updateSlackMessage(input: {
  channel: string; // MUST be the D… channel id from the original send
  ts: string;
  text: string;
  blocks?: unknown[];
}): Promise<SendOutcome> {
  return slackApi('chat.update', {
    channel: input.channel,
    ts: input.ts,
    text: input.text,
    ...(input.blocks ? { blocks: input.blocks } : {}),
  });
}

/** Split a stored '<channel>:<ts>' message id. Pure. */
export function splitSlackMessageId(id: string): { channel: string; ts: string } | null {
  const i = id.indexOf(':');
  if (i <= 0 || i === id.length - 1) return null;
  return { channel: id.slice(0, i), ts: id.slice(i + 1) };
}

export const slackAdapter: ChannelAdapter = {
  channel: 'slack',
  async send(msg: OutboxMessage): Promise<SendOutcome> {
    if (!msg.recipient_address) {
      return { status: 'skipped', error: 'no recipient_address' };
    }
    return sendSlackMessage({
      channel: msg.recipient_address,
      text: msg.body ?? msg.subject ?? '',
      blocks: Array.isArray(msg.payload.blocks) ? (msg.payload.blocks as unknown[]) : undefined,
      as: (msg.payload.as as SlackSenderIdentity | undefined) ?? undefined,
    });
  },
};
