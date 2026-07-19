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
    for (const channel of ['slack', 'sms_zoom', 'outlook_draft'] as const) {
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
