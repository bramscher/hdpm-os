import { describe, it, expect, vi, afterEach } from 'vitest';
import type { OutboxMessage } from '../types';
import { getAdapter, notConfiguredAdapter } from '../channels';
import { sendEmail } from '../channels/email';
import { inAppAdapter } from '../channels/in-app';

function msg(overrides: Partial<OutboxMessage> = {}): OutboxMessage {
  return {
    id: 'ob-1',
    org_id: 'hdpm',
    proposal_id: null,
    channel: 'in_app',
    recipient_person: 'Cheryl',
    recipient_address: null,
    subject: 'Test',
    body: 'hello',
    payload: {},
    status: 'queued',
    attempts: 0,
    last_attempt_at: null,
    message_id: null,
    error: null,
    created_at: '2026-07-19T00:00:00Z',
    sent_at: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('adapter registry', () => {
  it('returns real adapters for email and in_app', () => {
    expect(getAdapter('email').channel).toBe('email');
    expect(getAdapter('in_app').channel).toBe('in_app');
  });

  it('unwired channels fail cleanly with a reason', async () => {
    for (const channel of ['sms_zoom', 'outlook_draft'] as const) {
      const outcome = await getAdapter(channel).send(msg({ channel }));
      expect(outcome.status).toBe('failed');
      expect(outcome.error).toContain('not configured');
    }
  });

  it('notConfiguredAdapter is inert', async () => {
    const outcome = await notConfiguredAdapter('slack').send(msg());
    expect(outcome).toEqual({ status: 'failed', error: 'slack adapter not configured' });
  });
});

describe('in_app adapter', () => {
  it('always sends (the outbox row is the record)', async () => {
    expect(await inAppAdapter.send(msg())).toEqual({ status: 'sent', message_id: null });
  });
});

describe('sendEmail', () => {
  it('skips without RESEND_API_KEY', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    const outcome = await sendEmail({ to: 'x@example.com', subject: 'hi', text: 'body' });
    expect(outcome.status).toBe('skipped');
    expect(outcome.error).toContain('RESEND_API_KEY');
  });

  it('email adapter skips without a recipient address', async () => {
    const outcome = await getAdapter('email').send(msg({ channel: 'email', recipient_address: null }));
    expect(outcome.status).toBe('skipped');
    expect(outcome.error).toContain('recipient_address');
  });
});

describe('slack adapter', () => {
  it('skips without SLACK_BOT_TOKEN', async () => {
    vi.stubEnv('SLACK_BOT_TOKEN', '');
    const outcome = await getAdapter('slack').send(msg({ channel: 'slack', recipient_address: 'U123' }));
    expect(outcome.status).toBe('skipped');
    expect(outcome.error).toContain('SLACK_BOT_TOKEN');
  });

  it('skips without a recipient address', async () => {
    vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test');
    const outcome = await getAdapter('slack').send(msg({ channel: 'slack', recipient_address: null }));
    expect(outcome.status).toBe('skipped');
    expect(outcome.error).toContain('recipient_address');
  });

  it('sends and returns the composite channel:ts message id, passing blocks through', async () => {
    vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test');
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return {
        json: async () => ({ ok: true, channel: 'D0ABC', ts: '1721.456' }),
      };
    });

    const outcome = await getAdapter('slack').send(
      msg({ channel: 'slack', recipient_address: 'U123', payload: { blocks: [{ type: 'divider' }] } })
    );
    expect(outcome).toEqual({ status: 'sent', message_id: 'D0ABC:1721.456' });
    expect(calls[0].url).toContain('chat.postMessage');
    expect(calls[0].body.channel).toBe('U123');
    expect(calls[0].body.blocks).toEqual([{ type: 'divider' }]);
    vi.unstubAllGlobals();
  });

  it('surfaces slack API errors as failed', async () => {
    vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test');
    vi.stubGlobal('fetch', async () => ({
      json: async () => ({ ok: false, error: 'channel_not_found' }),
    }));
    const outcome = await getAdapter('slack').send(msg({ channel: 'slack', recipient_address: 'U123' }));
    expect(outcome).toEqual({ status: 'failed', error: 'channel_not_found' });
    vi.unstubAllGlobals();
  });

  it('treats a thrown fetch as failed', async () => {
    vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test');
    vi.stubGlobal('fetch', async () => {
      throw new Error('network down');
    });
    const outcome = await getAdapter('slack').send(msg({ channel: 'slack', recipient_address: 'U123' }));
    expect(outcome).toEqual({ status: 'failed', error: 'network down' });
    vi.unstubAllGlobals();
  });
});
