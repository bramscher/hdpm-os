/**
 * Core Supabase accessor.
 *
 * habu-core is DB-backed but tenant-agnostic: it reads its connection from the
 * environment (same vars hdpm-os uses today) and never imports the tenant app's
 * client. A tenant embedding core shares one Supabase project; a standalone
 * deployment supplies its own. Lazy init avoids build-time env errors.
 *
 * Extracted from hdpm-os `lib/supabase.ts` (getSupabaseAdmin).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _admin: SupabaseClient | null = null;

/** Service-role client for server-side/core writes. Throws if env is missing. */
export function getSupabaseAdmin(): SupabaseClient {
  if (!_admin) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      throw new Error('Missing Supabase environment variables');
    }
    _admin = createClient(url, serviceKey);
  }
  return _admin;
}
