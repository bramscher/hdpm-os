import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  bearerFromHeader,
  verifyServiceToken,
  clearServiceTokenCache,
} from '@/lib/service-tokens';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => clearServiceTokenCache());
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  clearServiceTokenCache();
});

describe('bearerFromHeader', () => {
  it('extracts the token', () => {
    expect(bearerFromHeader('Bearer abc123')).toBe('abc123');
  });
  it('rejects non-bearer and empty values', () => {
    expect(bearerFromHeader('Basic abc')).toBeNull();
    expect(bearerFromHeader('Bearer ')).toBeNull();
    expect(bearerFromHeader(null)).toBeNull();
  });
});

describe('verifyServiceToken (legacy fallback path)', () => {
  // Without Supabase env in tests, the table load fails closed → legacy path.
  it('accepts the legacy env token for any scope', async () => {
    process.env.HDPM_SERVICE_TOKEN = 'legacy-secret';
    const id = await verifyServiceToken('legacy-secret', 'agents');
    expect(id).toEqual({ name: 'legacy', scopes: 'all' });
    const id2 = await verifyServiceToken('legacy-secret', 'intake');
    expect(id2?.name).toBe('legacy');
  });

  it('rejects wrong tokens and missing env', async () => {
    process.env.HDPM_SERVICE_TOKEN = 'legacy-secret';
    expect(await verifyServiceToken('wrong', 'agents')).toBeNull();
    delete process.env.HDPM_SERVICE_TOKEN;
    clearServiceTokenCache();
    expect(await verifyServiceToken('legacy-secret', 'agents')).toBeNull();
  });

  it('rejects empty bearer', async () => {
    process.env.HDPM_SERVICE_TOKEN = '';
    expect(await verifyServiceToken('', 'agents')).toBeNull();
    expect(await verifyServiceToken(null, 'agents')).toBeNull();
  });
});
