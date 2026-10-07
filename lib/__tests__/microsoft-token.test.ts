import { describe, expect, it, vi } from 'vitest';
import { GRAPH_SCOPE, needsRefresh, refreshGraphToken, type GraphTokenState } from '../microsoft-token';

const NOW = 1_800_000_000_000;

describe('Microsoft Graph token refresh', () => {
  it('asks for offline_access so Microsoft returns a refresh token', () => {
    expect(GRAPH_SCOPE.split(' ')).toEqual(expect.arrayContaining(['offline_access', 'Calendars.ReadWrite']));
  });
  it('refreshes only near expiry and only with a refresh token', () => {
    expect(needsRefresh({ refreshToken: 'r', accessTokenExpires: NOW + 60 * 60_000 }, NOW)).toBe(false);
    expect(needsRefresh({ refreshToken: 'r', accessTokenExpires: NOW + 2 * 60_000 }, NOW)).toBe(true);
    expect(needsRefresh({ accessTokenExpires: NOW - 1 }, NOW)).toBe(false);
  });
  it('swaps in the new token and keeps the refresh token when not rotated', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ access_token: 'new', expires_in: 3600 })) as unknown as typeof fetch;
    const t = await refreshGraphToken<GraphTokenState>({ accessToken: 'old', refreshToken: 'r1', accessTokenExpires: NOW }, fetchImpl, NOW);
    expect(t).toMatchObject({ accessToken: 'new', refreshToken: 'r1', accessTokenExpires: NOW + 3_600_000 });
    expect(t.tokenError).toBeUndefined();
    const body = String((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body).toContain('grant_type=refresh_token');
  });
  it('drops the dead token on failure so the app asks for a fresh sign-in', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ error: 'invalid_grant' }, { status: 400 })) as unknown as typeof fetch;
    const t = await refreshGraphToken<GraphTokenState>({ accessToken: 'old', refreshToken: 'r1', accessTokenExpires: NOW }, fetchImpl, NOW);
    expect(t.accessToken).toBeUndefined();
    expect(t.tokenError).toBe('RefreshAccessTokenError');
  });
});
