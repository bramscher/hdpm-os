/**
 * Per-user Zoom OAuth (Brief D.5b) — the token path Zoom actually allows
 * for SMS sending: a user-managed marketplace app ("HDPM-OS SMS Sender")
 * that the sending user (Cheryl) authorizes once. We store her
 * access+refresh pair in zoom_user_token and rotate on refresh (Zoom
 * refresh tokens are single-use).
 *
 * Env:
 *   ZOOM_USER_CLIENT_ID / ZOOM_USER_CLIENT_SECRET — the user-managed app
 *   NEXTAUTH_URL — base for the redirect URI (falls back to prod domain)
 *
 * The S2S app (lib/zoom-phone.ts) is unchanged and keeps doing contacts.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase';

const ZOOM_OAUTH_BASE = 'https://zoom.us/oauth';
const REFRESH_EARLY_MS = 120_000;

export const ZOOM_OAUTH_CALLBACK_PATH = '/api/agents/zoom-oauth/callback';

function baseUrl(): string {
  return process.env.NEXTAUTH_URL || 'https://hdpmchat.highdesertpm.com';
}

export function zoomOauthRedirectUri(): string {
  return `${baseUrl()}${ZOOM_OAUTH_CALLBACK_PATH}`;
}

function getUserAppConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.ZOOM_USER_CLIENT_ID;
  const clientSecret = process.env.ZOOM_USER_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function isZoomUserOAuthConfigured(): boolean {
  return getUserAppConfig() !== null;
}

// ============================================
// CSRF state — HMAC(timestamp), no server-side storage (pure, unit-tested)
// ============================================

export function makeOauthState(secret: string, now: Date = new Date()): string {
  const ts = String(now.getTime());
  const mac = createHmac('sha256', secret).update(ts).digest('hex');
  return `${ts}.${mac}`;
}

export function verifyOauthState(
  secret: string,
  state: string | null,
  now: Date = new Date(),
  maxAgeMs = 15 * 60_000
): boolean {
  if (!secret || !state) return false;
  const dot = state.indexOf('.');
  if (dot <= 0) return false;
  const ts = state.slice(0, dot);
  const mac = state.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(ts).digest('hex');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const age = now.getTime() - Number(ts);
  return Number.isFinite(age) && age >= 0 && age <= maxAgeMs;
}

/** Secret for the state HMAC — any stable server-side secret works. */
export function oauthStateSecret(): string {
  return process.env.NEXTAUTH_SECRET || process.env.HDPM_SERVICE_TOKEN || '';
}

export function buildAuthorizeUrl(state: string): string | null {
  const cfg = getUserAppConfig();
  if (!cfg) return null;
  const url = new URL(`${ZOOM_OAUTH_BASE}/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', zoomOauthRedirectUri());
  url.searchParams.set('state', state);
  return url.toString();
}

// ============================================
// Token exchange / storage / refresh
// ============================================

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

async function tokenRequest(params: URLSearchParams): Promise<TokenResponse> {
  const cfg = getUserAppConfig();
  if (!cfg) throw new Error('Zoom user OAuth app not configured (ZOOM_USER_CLIENT_ID/SECRET)');
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
  const res = await fetch(`${ZOOM_OAUTH_BASE}/token?${params.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Zoom user OAuth token error (${res.status}): ${text.substring(0, 300)}`);
  }
  return JSON.parse(text) as TokenResponse;
}

async function saveTokenRow(
  email: string,
  zoomUserId: string | null,
  tokens: TokenResponse
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from('zoom_user_token').upsert(
    {
      email: email.toLowerCase(),
      ...(zoomUserId ? { zoom_user_id: zoomUserId } : {}),
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'email' }
  );
  if (error) throw new Error(`zoom_user_token save failed: ${error.message}`);
}

/**
 * Authorization-code exchange (callback route). Identifies the authorizing
 * user via /users/me with the fresh token, then stores the pair under
 * their email. Returns who connected.
 */
export async function exchangeCodeAndStore(code: string): Promise<{ email: string }> {
  const tokens = await tokenRequest(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: zoomOauthRedirectUri(),
    })
  );

  const meRes = await fetch('https://api.zoom.us/v2/users/me', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const meText = await meRes.text();
  if (!meRes.ok) {
    throw new Error(`Zoom /users/me failed (${meRes.status}): ${meText.substring(0, 200)}`);
  }
  const me = JSON.parse(meText) as { id?: string; email?: string };
  if (!me.email) throw new Error('Zoom /users/me returned no email');

  await saveTokenRow(me.email, me.id ?? null, tokens);
  return { email: me.email.toLowerCase() };
}

export interface ZoomUserAuth {
  accessToken: string;
  zoomUserId: string | null;
}

/**
 * Working access token for a stored user, refreshing (and rotating the
 * refresh token) when within 2 minutes of expiry. Null when the user has
 * never authorized. Throws when refresh fails (token revoked/expired —
 * the user must re-authorize via /api/agents/zoom-oauth/start).
 */
export async function getZoomUserAuth(email: string): Promise<ZoomUserAuth | null> {
  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch {
    return null; // no token store in this environment (e.g. unit tests) → caller falls back
  }
  const { data, error } = await supabase
    .from('zoom_user_token')
    .select('*')
    .eq('email', email.toLowerCase())
    .maybeSingle();
  if (error) throw new Error(`zoom_user_token read failed: ${error.message}`);
  if (!data) return null;

  if (new Date(data.expires_at).getTime() - Date.now() > REFRESH_EARLY_MS) {
    return { accessToken: data.access_token, zoomUserId: data.zoom_user_id ?? null };
  }

  let tokens: TokenResponse;
  try {
    tokens = await tokenRequest(
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token: data.refresh_token })
    );
  } catch (err) {
    throw new Error(
      `Zoom token refresh failed for ${email} — re-authorize via /api/agents/zoom-oauth/start. (${err instanceof Error ? err.message : String(err)})`
    );
  }
  await saveTokenRow(email, data.zoom_user_id ?? null, tokens);
  return { accessToken: tokens.access_token, zoomUserId: data.zoom_user_id ?? null };
}

/** Probe-friendly status without touching/refreshing anything. */
export async function getZoomUserTokenStatus(
  email: string
): Promise<{ authorized: boolean; expiresAt: string | null }> {
  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch {
    return { authorized: false, expiresAt: null };
  }
  const { data } = await supabase
    .from('zoom_user_token')
    .select('expires_at')
    .eq('email', email.toLowerCase())
    .maybeSingle();
  return { authorized: !!data, expiresAt: data?.expires_at ?? null };
}
