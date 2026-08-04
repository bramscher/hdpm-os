/**
 * Bootstrap admin allowlist (Phase 0, Brief A: demoted from source of truth).
 *
 * Authorization now lives in staff.access_role (see lib/roles.ts). The
 * ADMIN_EMAILS env var remains only as a bootstrap/disaster-recovery
 * fallback: it can grant admin when the staff table has no active admin or
 * the lookup fails — and lib/roles.ts logs every fallback use.
 *
 * Do not add new callers of isAdmin(); use getRoleForEmail()/isAdminEmail()
 * from lib/roles.ts or the session's user.role claim instead.
 */

let cachedSet: Set<string> | null = null;
let cachedRaw: string | undefined;

/** The ADMIN_EMAILS env allowlist, parsed (comma/space/newline separated). */
export function envAdminEmails(): Set<string> {
  const raw = process.env.ADMIN_EMAILS ?? '';
  if (cachedSet && cachedRaw === raw) return cachedSet;
  cachedRaw = raw;
  cachedSet = new Set(
    raw
      .split(/[\s,]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
  return cachedSet;
}

/**
 * @deprecated Env-only check kept for back-compat; prefer lib/roles.ts.
 */
export function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return envAdminEmails().has(email.toLowerCase());
}
