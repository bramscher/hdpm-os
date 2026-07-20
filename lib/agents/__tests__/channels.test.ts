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

  it('all five channels resolve to real adapters', () => {
    for (const ch of ['email', 'in_app', 'slack', 'sms_zoom', 'outlook_draft'] as const) {
      expect(getAdapter(ch).channel).toBe(ch);
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

describe('outlook_draft adapter', () => {
  it('skips without a mailbox (recipient_address)', async () => {
    const outcome = await getAdapter('outlook_draft').send(
      msg({ channel: 'outlook_draft', recipient_address: null })
    );
    expect(outcome.status).toBe('skipped');
    expect(outcome.error).toContain('mailbox');
  });

  it('skips under AGENT_GRAPH_DRYRUN=1 before any network call', async () => {
    vi.stubEnv('AGENT_GRAPH_DRYRUN', '1');
    const outcome = await getAdapter('outlook_draft').send(
      msg({ channel: 'outlook_draft', recipient_address: 'cheryl@highdesertpm.com' })
    );
    expect(outcome).toEqual({ status: 'skipped', error: 'AGENT_GRAPH_DRYRUN=1' });
  });

  it('skips when the Graph app-only env vars are missing', async () => {
    vi.stubEnv('AZURE_TENANT_ID', '');
    vi.stubEnv('AGENT_GRAPH_CLIENT_ID', '');
    vi.stubEnv('AGENT_GRAPH_CLIENT_SECRET', '');
    const outcome = await getAdapter('outlook_draft').send(
      msg({ channel: 'outlook_draft', recipient_address: 'cheryl@highdesertpm.com' })
    );
    expect(outcome.status).toBe('skipped');
    expect(outcome.error).toContain('not configured');
  });

  it('creates a draft via Graph and returns the message id', async () => {
    vi.stubEnv('AZURE_TENANT_ID', 'tenant-1');
    vi.stubEnv('AGENT_GRAPH_CLIENT_ID', 'client-1');
    vi.stubEnv('AGENT_GRAPH_CLIENT_SECRET', 'secret-1');
    const calls: { url: string; body: string }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
      calls.push({ url, body: String(init.body) });
      if (url.includes('login.microsoftonline.com')) {
        return {
          ok: true,
          json: async () => ({ access_token: 'tok', expires_in: 3600 }),
        };
      }
      return { ok: true, json: async () => ({ id: 'AAMkAGraphId' }) };
    });

    const outcome = await getAdapter('outlook_draft').send(
      msg({
        channel: 'outlook_draft',
        recipient_address: 'cheryl@highdesertpm.com',
        subject: 'Bid follow-up',
        payload: { html: '<p>hi</p>', to_recipients: ['bids@firkus.com'] },
      })
    );
    expect(outcome).toEqual({ status: 'sent', message_id: 'AAMkAGraphId' });
    const draftCall = calls.find((c) => c.url.includes('graph.microsoft.com'))!;
    expect(draftCall.url).toContain('/users/cheryl%40highdesertpm.com/messages');
    const body = JSON.parse(draftCall.body);
    expect(body.toRecipients).toEqual([{ emailAddress: { address: 'bids@firkus.com' } }]);
    expect(body.body.contentType).toBe('HTML');
    vi.unstubAllGlobals();
  });

  it('surfaces Graph errors (e.g. ApplicationAccessPolicy 403) as failed', async () => {
    vi.stubEnv('AZURE_TENANT_ID', 'tenant-1');
    vi.stubEnv('AGENT_GRAPH_CLIENT_ID', 'client-1');
    vi.stubEnv('AGENT_GRAPH_CLIENT_SECRET', 'secret-1');
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('login.microsoftonline.com')) {
        return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
      }
      return { ok: false, status: 403, text: async () => 'AccessDenied by policy' };
    });
    const outcome = await getAdapter('outlook_draft').send(
      msg({ channel: 'outlook_draft', recipient_address: 'craig@highdesertpm.com' })
    );
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toContain('graph 403');
    expect(outcome.error).toContain('AccessDenied');
    vi.unstubAllGlobals();
  });
});

describe('sms_zoom adapter', () => {
  const SMS_ENV = {
    ZOOM_ACCOUNT_ID: 'acct-1',
    ZOOM_CLIENT_ID: 'cid-1',
    ZOOM_CLIENT_SECRET: 'sec-1',
    ZOOM_SMS_SENDER_USER_ID: 'cheryl-zoom-id',
    ZOOM_SMS_SENDER_NUMBER: '+15415550199',
  };
  const stubSmsEnv = () => {
    for (const [k, v] of Object.entries(SMS_ENV)) vi.stubEnv(k, v);
  };

  it('skips under AGENT_ZOOM_SMS_DRYRUN=1 before any network call', async () => {
    vi.stubEnv('AGENT_ZOOM_SMS_DRYRUN', '1');
    const outcome = await getAdapter('sms_zoom').send(
      msg({ channel: 'sms_zoom', recipient_address: '+15415550100', body: 'hi' })
    );
    expect(outcome).toEqual({ status: 'skipped', error: 'AGENT_ZOOM_SMS_DRYRUN=1' });
  });

  it('skips without a phone or body', async () => {
    stubSmsEnv();
    const noPhone = await getAdapter('sms_zoom').send(
      msg({ channel: 'sms_zoom', recipient_address: null, body: 'hi' })
    );
    expect(noPhone.status).toBe('skipped');
    const noBody = await getAdapter('sms_zoom').send(
      msg({ channel: 'sms_zoom', recipient_address: '+15415550100', body: null })
    );
    expect(noBody.status).toBe('skipped');
  });

  it('skips when Zoom SMS env is not configured', async () => {
    vi.stubEnv('ZOOM_SMS_SENDER_USER_ID', '');
    vi.stubEnv('ZOOM_SMS_SENDER_NUMBER', '');
    const outcome = await getAdapter('sms_zoom').send(
      msg({ channel: 'sms_zoom', recipient_address: '+15415550100', body: 'hi' })
    );
    expect(outcome.status).toBe('skipped');
    expect(outcome.error).toContain('not configured');
  });

  it('sends via Zoom and returns the message id', async () => {
    stubSmsEnv();
    const calls: { url: string; body?: string }[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: { body?: string }) => {
      calls.push({ url, body: init?.body ? String(init.body) : undefined });
      if (url.includes('zoom.us/oauth/token')) {
        return { ok: true, text: async () => JSON.stringify({ access_token: 'tok', expires_in: 3600 }) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ message_id: 'sms-abc' }) };
    });

    const outcome = await getAdapter('sms_zoom').send(
      msg({ channel: 'sms_zoom', recipient_address: '+15415550100', body: 'Hi Cascade!' })
    );
    expect(outcome).toEqual({ status: 'sent', message_id: 'sms-abc' });
    const smsCall = calls.find((c) => c.url.includes('/phone/sms/messages'))!;
    const body = JSON.parse(smsCall.body!);
    expect(body.message).toBe('Hi Cascade!');
    expect(body.sender).toEqual({ user_id: 'cheryl-zoom-id', phone_number: '+15415550199' });
    expect(body.to_members).toEqual([{ phone_number: '+15415550100' }]);
    vi.unstubAllGlobals();
  });

  it('falls back to the account-level endpoint on user-context rejections (7639)', async () => {
    stubSmsEnv();
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url);
      if (url.includes('zoom.us/oauth/token')) {
        return { ok: true, text: async () => JSON.stringify({ access_token: 'tok', expires_in: 3600 }) };
      }
      if (url.includes('/accounts/')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ message_id: 'sms-acct-1' }) };
      }
      return {
        ok: false,
        status: 400,
        headers: { get: () => null },
        text: async () => '{"code":7639,"message":"The SMS for the number does not belong to the current user."}',
      };
    });
    const outcome = await getAdapter('sms_zoom').send(
      msg({ channel: 'sms_zoom', recipient_address: '+15415550100', body: 'hi' })
    );
    expect(outcome).toEqual({ status: 'sent', message_id: 'sms-acct-1' });
    expect(calls.some((u) => u.includes('/accounts/acct-1/phone/sms/messages'))).toBe(true);
    vi.unstubAllGlobals();
  });

  it('surfaces Zoom API errors as failed', async () => {
    stubSmsEnv();
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('zoom.us/oauth/token')) {
        return { ok: true, text: async () => JSON.stringify({ access_token: 'tok', expires_in: 3600 }) };
      }
      return { ok: false, status: 400, headers: { get: () => null }, text: async () => 'invalid scope' };
    });
    const outcome = await getAdapter('sms_zoom').send(
      msg({ channel: 'sms_zoom', recipient_address: '+15415550100', body: 'hi' })
    );
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toContain('400');
    vi.unstubAllGlobals();
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
