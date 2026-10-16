import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { requireCompanySession, requireRole } from '@/lib/require-role';
import type { Session } from './route-server';

/** Scheduling a route (publish, re-send, cancel) is office work: managers, PMs, maintenance, finance; admins always. */
export async function requireScheduler(request: NextRequest): Promise<{ ok: true; session: Session } | { ok: false; response: NextResponse }> {
  const guard = await requireRole('manager', 'pm', 'maintenance', 'finance');
  if (!guard.ok) return guard;
  const s = await auth();
  return { ok: true, session: { email: guard.email, actor: guard.name || guard.email, accessToken: (s as { accessToken?: string } | null)?.accessToken ?? null, baseUrl: baseUrl(request) } };
}
export const requireViewer = requireCompanySession;
export const baseUrl = (request: NextRequest) => (process.env.NEXTAUTH_URL || request.nextUrl.origin).replace(/\/$/, '');
export const noStore = { 'Cache-Control': 'private, no-store' };
