import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  makeOauthState,
  verifyOauthState,
  buildAuthorizeUrl,
  zoomOauthRedirectUri,
} from '../zoom-user-oauth';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('oauth state', () => {
  const secret = 'test-secret';
  const now = new Date('2026-07-20T12:00:00Z');

  it('round-trips within the freshness window', () => {
    const state = makeOauthState(secret, now);
    expect(verifyOauthState(secret, state, new Date(now.getTime() + 60_000))).toBe(true);
  });

  it('rejects expired, tampered, and malformed states', () => {
    const state = makeOauthState(secret, now);
    expect(verifyOauthState(secret, state, new Date(now.getTime() + 16 * 60_000))).toBe(false);
    expect(verifyOauthState(secret, state.replace(/.$/, '0'), now)).toBe(false);
    expect(verifyOauthState('wrong-secret', state, now)).toBe(false);
    expect(verifyOauthState(secret, 'garbage', now)).toBe(false);
    expect(verifyOauthState(secret, null, now)).toBe(false);
    expect(verifyOauthState('', state, now)).toBe(false);
  });

  it('rejects states from the future', () => {
    const state = makeOauthState(secret, new Date(now.getTime() + 60_000));
    expect(verifyOauthState(secret, state, now)).toBe(false);
  });
});

describe('authorize url', () => {
  it('is null without the user app env', () => {
    vi.stubEnv('ZOOM_USER_CLIENT_ID', '');
    vi.stubEnv('ZOOM_USER_CLIENT_SECRET', '');
    expect(buildAuthorizeUrl('s')).toBeNull();
  });

  it('carries client id, redirect uri, and state', () => {
    vi.stubEnv('ZOOM_USER_CLIENT_ID', 'user-app-1');
    vi.stubEnv('ZOOM_USER_CLIENT_SECRET', 'sec');
    vi.stubEnv('NEXTAUTH_URL', 'https://hdpmchat.highdesertpm.com');
    const url = new URL(buildAuthorizeUrl('the-state')!);
    expect(url.origin + url.pathname).toBe('https://zoom.us/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('user-app-1');
    expect(url.searchParams.get('state')).toBe('the-state');
    expect(url.searchParams.get('redirect_uri')).toBe(zoomOauthRedirectUri());
    expect(zoomOauthRedirectUri()).toBe(
      'https://hdpmchat.highdesertpm.com/api/agents/zoom-oauth/callback'
    );
  });
});
