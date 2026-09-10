import { describe, it, expect } from 'vitest';
import { shouldIgnoreEvent, stripMention } from '@/lib/agents/dez/event-guard';

const BOT = 'UDEZBOT';

describe('shouldIgnoreEvent — loop prevention', () => {
  it('ignores bot-authored and self messages (the critical case)', () => {
    expect(shouldIgnoreEvent({ type: 'message', bot_id: 'B1', channel_type: 'im' }, BOT)).toBe(true);
    expect(shouldIgnoreEvent({ type: 'message', user: BOT, channel_type: 'im' }, BOT)).toBe(true);
    expect(shouldIgnoreEvent({ type: 'app_mention', user: BOT }, BOT)).toBe(true);
  });

  it('ignores message subtypes (edits/joins/system)', () => {
    expect(
      shouldIgnoreEvent({ type: 'message', subtype: 'message_changed', channel_type: 'im', user: 'U9' }, BOT)
    ).toBe(true);
  });

  it('ignores unhandled types and non-DM plain messages', () => {
    expect(shouldIgnoreEvent({ type: 'reaction_added', user: 'U9' }, BOT)).toBe(true);
    expect(shouldIgnoreEvent({ type: 'message', channel_type: 'channel', user: 'U9' }, BOT)).toBe(true);
    expect(shouldIgnoreEvent(undefined, BOT)).toBe(true);
  });

  it('handles real DMs and app_mentions from humans', () => {
    expect(shouldIgnoreEvent({ type: 'message', channel_type: 'im', user: 'U9', text: 'hi' }, BOT)).toBe(false);
    expect(shouldIgnoreEvent({ type: 'app_mention', user: 'U9', text: '<@UDEZBOT> hi' }, BOT)).toBe(false);
  });
});

describe('stripMention', () => {
  it('strips a leading mention', () => {
    expect(stripMention('<@UDEZBOT> what is the deposit timeline?')).toBe('what is the deposit timeline?');
  });
  it('leaves un-mentioned text untouched', () => {
    expect(stripMention('plain question')).toBe('plain question');
    expect(stripMention(undefined)).toBe('');
  });
});
