/**
 * Referrer SERVER Supabase client (Batch 2) — the JWT-bound, RLS-enforced path.
 *
 * This is the OTHER auth system: referrers log in via Supabase Auth (magic
 * link), NOT Entra. This client carries the referrer's session, so every query
 * runs as `authenticated` with their auth.uid() — the RLS policies from Batch 0
 * restrict them to their own rows. This is the ONLY DB client a referrer route
 * may use; the ESLint guardrail bans getSupabaseAdmin() there.
 *
 * SERVER-ONLY: imports `next/headers`. Client components must import the browser
 * client from supabase-referrer-browser.ts instead (mixing the two into one
 * module pulls next/headers into the client bundle and fails the build).
 *
 * @supabase/ssr handles cookie storage + token refresh. The session cookie
 * (sb-<ref>-auth-token) is distinct from staff's next-auth.session-token, so the
 * two auth systems coexist without collision.
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Server client bound to the referrer's session cookies. Use in referrer server
 * components / route handlers. Queries run under RLS as the logged-in referrer.
 */
export async function createReferrerServerClient(): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;
  if (!url || !anonKey) throw new Error('Missing Supabase URL / publishable key for the referrer client');

  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component where cookies are read-only; the
          // auth callback route (/partners/auth/callback) performs the write.
        }
      },
    },
  });
}
