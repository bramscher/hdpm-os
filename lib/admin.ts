/**
 * Admin identity for hdpm-chat.
 *
 * Admins are an env allowlist: ADMIN_EMAILS = comma/space/newline-separated
 * @highdesertpm.com addresses. Admin status gates the financial dashboards
 * (the whole KPI dashboard + its APIs + config + financials).
 *
 * This is the single source of truth — used by the auth callbacks (to stamp an
 * isAdmin claim on the session/JWT), the middleware, and per-route guards.
 */

let cachedSet: Set<string> | null = null;
let cachedRaw: string | undefined;

function adminSet(): Set<string> {
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

/** True if the email is in the ADMIN_EMAILS allowlist (case-insensitive). */
export function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminSet().has(email.toLowerCase());
}
