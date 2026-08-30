/**
 * Dez Slack-event guards — the loop-prevention logic, extracted pure so it can
 * be unit-tested. The single most important correctness property: Dez must
 * NEVER answer a bot message or its own message, or it talks to itself forever.
 */

export interface SlackEvent {
  type?: string;
  subtype?: string;
  bot_id?: string;
  user?: string;
  text?: string;
  channel?: string;
  channel_type?: string;
  ts?: string;
  thread_ts?: string;
}

/**
 * True → drop the event (ack 200, do nothing). Ignores: bot/self messages,
 * any message subtype (edits, joins, etc.), and event types we don't handle.
 * Only free-text DMs (message + channel_type 'im') and app_mentions pass.
 */
export function shouldIgnoreEvent(event: SlackEvent | undefined, botUserId: string | undefined): boolean {
  if (!event) return true;
  // Loop prevention — bot-authored or Dez's own message.
  if (event.bot_id) return true;
  if (botUserId && event.user === botUserId) return true;
  // Subtypes are edits/joins/system messages — never a fresh human question.
  if (event.subtype) return true;

  if (event.type === 'app_mention') return false;
  if (event.type === 'message' && event.channel_type === 'im') return false;
  return true;
}

/** Strip a leading `<@Uxxx>` mention from app_mention text. Pure. */
export function stripMention(text: string | undefined): string {
  return (text ?? '').replace(/^\s*<@[A-Z0-9]+>\s*/, '').trim();
}
