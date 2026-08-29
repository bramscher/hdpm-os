/**
 * Referrer BROWSER Supabase client (Batch 2) — client-component safe.
 *
 * Split out from supabase-referrer.ts on purpose: that module imports
 * `next/headers` (server-only) for the SSR client, and bundling it into a client
 * component fails the build. Client components (login, sign-out) import from
 * here; server code imports the SSR client from supabase-referrer.ts.
 */

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Browser client for referrer client components (login, forms, sign-out). */
export function createReferrerBrowserClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;
  if (!url || !anonKey) throw new Error('Missing Supabase URL / publishable key for the referrer client');
  return createBrowserClient(url, anonKey);
}
