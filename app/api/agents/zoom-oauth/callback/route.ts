import { NextRequest, NextResponse } from 'next/server';
import {
  exchangeCodeAndStore,
  verifyOauthState,
  oauthStateSecret,
} from '@/lib/zoom-user-oauth';

/**
 * GET /api/agents/zoom-oauth/callback — Zoom redirects here after consent.
 * Guarded by the HMAC state (15-minute window), not a session — the code
 * exchange itself requires our client secret, and the resulting identity
 * comes from Zoom's /users/me, so a forged callback can't plant a token.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');

  if (!verifyOauthState(oauthStateSecret(), state)) {
    return html(400, 'This authorization link expired or is invalid — start again from /api/agents/zoom-oauth/start.');
  }
  if (!code) {
    return html(400, 'Zoom did not return an authorization code. Try again.');
  }

  try {
    const { email } = await exchangeCodeAndStore(code);
    return html(
      200,
      `✅ Zoom connected for <strong>${escapeHtml(email)}</strong>. Texts can now send from this account's line. You can close this tab.`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Agents] zoom oauth callback failed:', msg);
    return html(500, `Authorization failed: ${escapeHtml(msg)}`);
  }
}

function escapeHtml(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function html(status: number, body: string): NextResponse {
  return new NextResponse(
    `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:80px auto;font-size:16px;line-height:1.5;">
      <h2 style="color:#1f5c22;">HDPM-OS · Zoom SMS</h2>
      <p>${body}</p>
    </body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}
