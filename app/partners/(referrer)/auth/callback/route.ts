import { NextRequest, NextResponse } from 'next/server';
import { createReferrerServerClient } from '@/lib/referrals/supabase-referrer';

/**
 * Supabase magic-link callback (Batch 2). The email link lands here with a
 * `code`; we exchange it for a session (cookies set by @supabase/ssr) and
 * redirect the referrer on. Invalid/expired links go back to login.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') || '/partners';

  if (!code) {
    return NextResponse.redirect(new URL('/partners/login', url.origin));
  }

  const supabase = await createReferrerServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL('/partners/login?error=link', url.origin));
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
