/**
 * Role-based API guards (Phase 0, Brief A).
 *
 * Usage:
 *   const guard = await requireRole('finance');
 *   if (!guard.ok) return guard.response;
 *
 * Semantics:
 * - The caller must have one of the listed roles; 'admin' implicitly
 *   satisfies every check.
 * - Roles come from the session JWT claim (stamped by the auth callbacks
 *   from staff.access_role); tokens minted before the rollout lack the
 *   claim, so we fall back to a live lookup by email.
 * - requireCompanySession() is the plain "signed-in company user" guard —
 *   the one place the @highdesertpm.com domain check lives for API routes.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getRoleForEmail, type AccessRole } from '@/lib/roles';

export const COMPANY_EMAIL_DOMAIN = '@highdesertpm.com';

export function isCompanyEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(COMPANY_EMAIL_DOMAIN);
}

type Guard =
  | { ok: true; email: string; role: AccessRole; name: string | null }
  | { ok: false; response: NextResponse };

function deny(status: number, error: string): Guard {
  return { ok: false, response: NextResponse.json({ error }, { status }) };
}

export async function requireCompanySession(): Promise<Guard> {
  const session = await auth();
  const email = session?.user?.email;
  if (!isCompanyEmail(email)) {
    return deny(401, 'Unauthorized. Please sign in with your company Microsoft account.');
  }
  const role =
    (session?.user?.role as AccessRole | undefined) ?? (await getRoleForEmail(email));
  return { ok: true, email: email!, role, name: session?.user?.name ?? null };
}

export async function requireRole(...roles: AccessRole[]): Promise<Guard> {
  const guard = await requireCompanySession();
  if (!guard.ok) return guard;
  if (guard.role === 'admin' || roles.includes(guard.role)) return guard;
  return deny(403, 'Insufficient permissions');
}

/**
 * Section guard for areas an admin can delegate to one person (see `delegable`
 * in lib/access/sections.ts). Admins always pass; anyone else needs the section
 * switched on for them. Checked live (60s cache), not from the session token.
 */
export async function requireSection(sectionKey: string): Promise<Guard> {
  const guard = await requireCompanySession();
  if (!guard.ok) return guard;
  if (guard.role === 'admin') return guard;
  const { getDeniedSections } = await import('@/lib/access/section-access');
  const denied = await getDeniedSections(guard.email, guard.role);
  if (denied.includes(sectionKey)) return deny(403, 'Insufficient permissions');
  return guard;
}

/** Server pages: may this signed-in person open a (possibly delegated) section? */
export async function hasSection(sectionKey: string): Promise<{ ok: boolean; isAdmin: boolean }> {
  const guard = await requireSection(sectionKey);
  return { ok: guard.ok, isAdmin: guard.ok && guard.role === 'admin' };
}
