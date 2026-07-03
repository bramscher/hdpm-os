/**
 * Shared session guard for /api/maintenance routes.
 * Middleware already requires a session for these paths; this adds the
 * defense-in-depth company-domain check used across the app's API routes
 * and resolves the actor string for audit events.
 */

import { getServerSession } from 'next-auth';

export interface StaffSession {
  email: string;
  /** Display name if present, else email — used as the wo_event actor. */
  actor: string;
}

export async function requireStaffSession(): Promise<StaffSession | null> {
  const session = await getServerSession();
  const email = session?.user?.email;
  if (!email || !email.endsWith('@highdesertpm.com')) return null;
  return { email, actor: session?.user?.name || email };
}
