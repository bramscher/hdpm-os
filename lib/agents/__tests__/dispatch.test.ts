import { describe, it, expect } from 'vitest';
import { outboxUpdateFor } from '../outbox';
import { MAX_SEND_ATTEMPTS } from '../types';

const NOW = new Date('2026-07-19T12:00:00Z');

describe('outboxUpdateFor', () => {
  it('sent → terminal with sent_at + message_id, error cleared', () => {
    const patch = outboxUpdateFor({ attempts: 0 }, { status: 'sent', message_id: 're_123' }, NOW);
    expect(patch).toEqual({
      attempts: 1,
      last_attempt_at: NOW.toISOString(),
      status: 'sent',
      sent_at: NOW.toISOString(),
      message_id: 're_123',
      error: null,
    });
  });

  it('skipped → terminal with reason', () => {
    const patch = outboxUpdateFor({ attempts: 1 }, { status: 'skipped', error: 'no address' }, NOW);
    expect(patch.status).toBe('skipped');
    expect(patch.attempts).toBe(2);
    expect(patch.error).toBe('no address');
  });

  it('failed below the cap → stays queued for retry with error recorded', () => {
    const patch = outboxUpdateFor({ attempts: 0 }, { status: 'failed', error: 'boom' }, NOW);
    expect(patch.status).toBe('queued');
    expect(patch.attempts).toBe(1);
    expect(patch.error).toBe('boom');
  });

  it('failed at the cap → parks as failed', () => {
    const patch = outboxUpdateFor(
      { attempts: MAX_SEND_ATTEMPTS - 1 },
      { status: 'failed', error: 'still down' },
      NOW
    );
    expect(patch.status).toBe('failed');
    expect(patch.attempts).toBe(MAX_SEND_ATTEMPTS);
  });
});
