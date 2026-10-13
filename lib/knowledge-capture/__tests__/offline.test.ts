import { describe, expect, it } from 'vitest';
import { PUBLIC_PREFIXES } from '@/proxy';
import { MAX_RECORDED_AGE_MS, failureKind, isTakeId, recordedAtFrom } from '../offline';

const now = Date.parse('2026-10-13T18:00:00Z');

describe('device take ids', () => {
  it('accepts the UUIDs crypto.randomUUID makes', () => {
    expect(isTakeId('3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c')).toBe(true);
  });
  it('rejects anything else (it becomes a storage path)', () => {
    for (const v of ['', 'abc', '../owner/1', 42, null, undefined, '3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c/x']) {
      expect(isTakeId(v), String(v)).toBe(false);
    }
  });
});

describe('recording time from the device', () => {
  it('keeps the time a take was recorded offline', () => {
    expect(recordedAtFrom('2026-10-11T15:30:00.000Z', now)).toBe('2026-10-11T15:30:00.000Z');
  });
  it('clamps a slightly fast phone clock to now', () => {
    expect(recordedAtFrom('2026-10-13T18:02:00Z', now)).toBe(new Date(now).toISOString());
  });
  it('ignores a clock far in the future, too-old times, and junk', () => {
    expect(recordedAtFrom('2026-10-14T18:00:00Z', now)).toBeNull();
    expect(recordedAtFrom(new Date(now - MAX_RECORDED_AGE_MS - 1000).toISOString(), now)).toBeNull();
    expect(recordedAtFrom('yesterday', now)).toBeNull();
    expect(recordedAtFrom(undefined, now)).toBeNull();
    expect(recordedAtFrom(1760000000000, now)).toBeNull();
  });
});

describe('what the outbox does after a failed request', () => {
  it('asks to sign in when the session expired', () => {
    expect(failureKind(401)).toBe('signin');
  });
  it('tries again later on server trouble', () => {
    for (const s of [408, 429, 500, 502, 503, 504]) expect(failureKind(s), String(s)).toBe('retry');
  });
  it('waits for a person when the server refuses the take', () => {
    for (const s of [400, 403, 404, 409, 413]) expect(failureKind(s), String(s)).toBe('stuck');
  });
});

describe('offline app files', () => {
  const isPublic = (p: string) => PUBLIC_PREFIXES.some((x) => p.startsWith(x));
  it('serves the service worker and manifest without a session', () => {
    expect(isPublic('/kc-sw.js')).toBe(true);
    expect(isPublic('/kc.webmanifest')).toBe(true);
  });
  it('keeps the capture page and its APIs behind sign-in', () => {
    for (const p of ['/knowledge-capture', '/api/knowledge-capture', '/api/knowledge-capture/recordings']) {
      expect(isPublic(p), p).toBe(false);
    }
  });
});
