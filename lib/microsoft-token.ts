/**
 * Keeps the Microsoft Graph access token (used to publish route events to
 * Outlook) alive for the whole 8-hour session. Graph tokens last ~1 hour; with
 * the offline_access scope Microsoft also returns a refresh token, which we use
 * to get a new access token shortly before the old one expires.
 */

export const GRAPH_SCOPE =
  'openid profile email offline_access User.Read Calendars.ReadWrite Calendars.ReadWrite.Shared';

export interface GraphTokenState {
  accessToken?: string;
  refreshToken?: string;
  /** Epoch ms when accessToken stops working. */
  accessTokenExpires?: number;
  tokenError?: string;
}

/** Refresh this long before expiry so a publish never races the deadline. */
const EARLY_MS = 5 * 60 * 1000;

export function needsRefresh(t: GraphTokenState, now = Date.now()): boolean {
  return !!t.refreshToken && !!t.accessTokenExpires && now >= t.accessTokenExpires - EARLY_MS;
}

/**
 * Exchange the refresh token for a new access token. On failure the access
 * token is dropped and `tokenError` set, so callers show "sign in again"
 * instead of sending a dead token to Graph.
 */
export async function refreshGraphToken<T extends GraphTokenState>(
  t: T,
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
): Promise<T> {
  try {
    const res = await fetchImpl(
      `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.AZURE_AD_CLIENT_ID ?? '',
          client_secret: process.env.AZURE_AD_CLIENT_SECRET ?? '',
          grant_type: 'refresh_token',
          refresh_token: t.refreshToken ?? '',
          scope: GRAPH_SCOPE,
        }),
      },
    );
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string; refresh_token?: string; expires_in?: number; error?: string;
    };
    if (!res.ok || !body.access_token) throw new Error(body.error || `HTTP ${res.status}`);
    return {
      ...t,
      accessToken: body.access_token,
      // Microsoft may rotate the refresh token; keep the old one if it doesn't.
      refreshToken: body.refresh_token ?? t.refreshToken,
      accessTokenExpires: now + (body.expires_in ?? 3600) * 1000,
      tokenError: undefined,
    };
  } catch (err) {
    console.error('[auth] Microsoft token refresh failed:', err instanceof Error ? err.message : err);
    return { ...t, accessToken: undefined, tokenError: 'RefreshAccessTokenError' };
  }
}
