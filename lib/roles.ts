/**
 * Access-role resolution for HDPM-OS (Phase 0, Brief A).
 *
 * Single source of truth: staff.access_role in the database. The old
 * ADMIN_EMAILS env allowlist survives only as a bootstrap fallback — it can
 * grant admin when the staff table has no active admin at all (fresh
 * environment, disaster recovery) or when the lookup fails; every fallback
 * use is logged.
 *
 * Distinct from staff.role, which is the human job title (display/routing).
 *
 * Consumed by the NextAuth jwt callback (stamps token.role / token.isAdmin)
 * and by lib/require-role.ts. Results are cached in-memory for 60s per
 * serverless instance, so role changes take effect within a minute of the
 * next token refresh (JWTs themselves refresh on request; sessions max 8h).
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import { envAdminEmails } from '@/lib/admin';

export const ACCESS_ROLES = [
  'admin',
  'manager',
  'pm',
  'maintenance',
  'finance',
  'front_desk',
  'inspector',
  'field',
  'staff',
  'read_only',
] as const;

export type AccessRole = (typeof ACCESS_ROLES)[number];

function isAccessRole(value: unknown): value is AccessRole {
  return typeof value === 'string' && (ACCESS_ROLES as readonly string[]).includes(value);
}

interface RoleRow {
  email: string | null;
  access_role: string | null;
}

/**
 * Pure resolution logic, separated for testability.
 * `rows` is the active-staff email→access_role set (null = load failed).
 */
export function roleFromRows(
  rows: RoleRow[] | null,
  email: string,
  envAdmins: Set<string>
): AccessRole {
  const lower = email.toLowerCase();

  if (rows) {
    const hasAnyAdmin = rows.some((r) => r.access_role === 'admin');
    const match = rows.find((r) => r.email?.toLowerCase() === lower);
    if (match && isAccessRole(match.access_role)) return match.access_role;
    // Bootstrap: only when the table defines no admin at all may the env
    // allowlist elevate — otherwise the DB is authoritative.
    if (!hasAnyAdmin && envAdmins.has(lower)) {
      console.warn(`[roles] bootstrap fallback: ${lower} granted admin via ADMIN_EMAILS (no active admin in staff table)`);
      return 'admin';
    }
    return 'staff';
  }

  // Lookup failed entirely — env fallback keeps the lights on, logged.
  if (envAdmins.has(lower)) {
    console.warn(`[roles] staff lookup unavailable: ${lower} granted admin via ADMIN_EMAILS fallback`);
    return 'admin';
  }
  return 'staff';
}

let cache: { at: number; rows: RoleRow[] } | null = null;
const CACHE_TTL_MS = 60_000;

async function loadActiveStaffRoles(): Promise<RoleRow[] | null> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows;
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('staff')
      .select('email, access_role')
      .eq('active', true);
    if (error) {
      console.error('[roles] staff role load failed:', error.message);
      return null;
    }
    cache = { at: Date.now(), rows: (data ?? []) as RoleRow[] };
    return cache.rows;
  } catch (err) {
    console.error('[roles] staff role load threw:', err);
    return null;
  }
}

/** Resolve the access role for a company email. Unknown active email → 'staff'. */
export async function getRoleForEmail(email: string | null | undefined): Promise<AccessRole> {
  if (!email) return 'staff';
  const rows = await loadActiveStaffRoles();
  return roleFromRows(rows, email, envAdminEmails());
}

export async function isAdminEmail(email: string | null | undefined): Promise<boolean> {
  return (await getRoleForEmail(email)) === 'admin';
}

/** Test hook. */
export function clearRoleCache(): void {
  cache = null;
}
