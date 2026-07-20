import { NextResponse } from 'next/server';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import {
  buildAuthorizeUrl,
  makeOauthState,
  oauthStateSecret,
  isZoomUserOAuthConfigured,
} from '@/lib/zoom-user-oauth';

/**
 * GET /api/agents/zoom-oauth/start — begin the one-time Zoom authorization
 * for the SMS sender (Brief D.5b). The sender (Cheryl) opens this URL in a
 * browser while signed in to hdpmchat; it bounces her to Zoom's consent
 * screen and back to the callback, which stores her tokens.
 */
export async function GET() {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json(
      { error: 'Sign in to hdpmchat first, then open this link again.' },
      { status: 401 }
    );
  }
  if (!isZoomUserOAuthConfigured()) {
    return NextResponse.json(
      { error: 'ZOOM_USER_CLIENT_ID / ZOOM_USER_CLIENT_SECRET not configured in Vercel.' },
      { status: 500 }
    );
  }
  const secret = oauthStateSecret();
  if (!secret) {
    return NextResponse.json({ error: 'No server secret available for OAuth state.' }, { status: 500 });
  }
  const url = buildAuthorizeUrl(makeOauthState(secret));
  return NextResponse.redirect(url!);
}
