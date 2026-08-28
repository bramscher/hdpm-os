/**
 * Per-service scoped token verification (Phase 0, Brief C).
 *
 * Replaces the single shared HDPM_SERVICE_TOKEN with named, scoped,
 * revocable tokens (service_token table; sha256 hashes only). The legacy
 * env token is still accepted — with a console warning — so existing
 * callers (agent-service scripts, hdpm-web) keep working until per-service
 * tokens are minted (scripts/mint-service-token.mjs) and the env var is
 * retired.
 *
 * Verification is cached for 60s per instance; last_used_at updates are
 * best-effort fire-and-forget.
 */

import { createHash } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase';

export type ServiceScope = 'agents' | 'intake' | 'referrals';

export interface ServiceIdentity {
  name: string;          // 'legacy' for the env token
  scopes: ServiceScope[] | 'all';
}

interface TokenRow {
  name: string;
  token_hash: string;
  scopes: string[];
  active: boolean;
}

let cache: { at: number; rows: TokenRow[] } | null = null;
const CACHE_TTL_MS = 60_000;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function loadTokens(): Promise<TokenRow[] | null> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows;
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('service_token')
      .select('name, token_hash, scopes, active')
      .eq('active', true);
    if (error) {
      // Table may not exist until the migration runs — legacy path covers it.
      if (!/service_token/.test(error.message)) {
        console.error('[service-tokens] load failed:', error.message);
      }
      return null;
    }
    cache = { at: Date.now(), rows: (data ?? []) as TokenRow[] };
    return cache.rows;
  } catch {
    return null;
  }
}

function touchLastUsed(name: string): void {
  try {
    const supabase = getSupabaseAdmin();
    void supabase
      .from('service_token')
      .update({ last_used_at: new Date().toISOString() })
      .eq('name', name)
      .then(() => undefined);
  } catch {
    /* best-effort */
  }
}

/**
 * Verify a bearer token for a scope. Returns the service identity or null.
 * Order: per-service table token first, then the legacy env token.
 */
export async function verifyServiceToken(
  bearer: string | null | undefined,
  scope: ServiceScope
): Promise<ServiceIdentity | null> {
  if (!bearer) return null;

  const rows = await loadTokens();
  if (rows) {
    const hash = sha256(bearer);
    const match = rows.find((r) => r.token_hash === hash);
    if (match) {
      if (!match.scopes.includes(scope)) return null;
      touchLastUsed(match.name);
      return { name: match.name, scopes: match.scopes as ServiceScope[] };
    }
  }

  const legacy = process.env.HDPM_SERVICE_TOKEN;
  if (legacy && bearer === legacy) {
    console.warn(`[service-tokens] legacy HDPM_SERVICE_TOKEN used for scope '${scope}' — mint a per-service token`);
    return { name: 'legacy', scopes: 'all' };
  }

  return null;
}

/** Convenience: pull the bearer out of an Authorization header. */
export function bearerFromHeader(header: string | null): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

/** Test hook. */
export function clearServiceTokenCache(): void {
  cache = null;
}
