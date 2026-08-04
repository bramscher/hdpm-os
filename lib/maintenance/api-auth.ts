/**
 * Shared session guard for /api/maintenance routes.
 * Middleware already requires a session for these paths; this adds the
 * defense-in-depth company-domain check used across the app's API routes
 * and resolves the actor string for audit events.
 */

import { auth } from '@/lib/auth';
import { isCompanyEmail } from '@/lib/require-role';
import type { NextRequest } from 'next/server';
import { isAgentActor, parseAgentActor } from '@/lib/agents/actor';
import { resolveStaffByPersonOrEmail } from '@/lib/agents/staff';
import { verifyServiceToken, bearerFromHeader } from '@/lib/service-tokens';

export interface StaffSession {
  email: string;
  /** Display name if present, else email — used as the wo_event actor. */
  actor: string;
}

export async function requireStaffSession(): Promise<StaffSession | null> {
  const session = await auth();
  const email = session?.user?.email;
  if (!isCompanyEmail(email)) return null;
  return { email: email!, actor: session?.user?.name || email! };
}

// ============================================
// Agent-layer auth (Brief B): staff session OR service token
// ============================================

export type AgentCaller =
  | { kind: 'staff'; actor: string; email: string }
  | { kind: 'service'; actor: string; agent?: string };

/**
 * Guard for /api/agents routes (exempted from session middleware — this is
 * the only gate). Two caller classes:
 *
 * 1. Service (agent-service, scripts): `Authorization: Bearer HDPM_SERVICE_TOKEN`
 *    (same pattern as /api/intake/rental-analysis-request) + `X-Agent-Actor`:
 *    either 'agent:<name>' or a staff person/email resolved via the staff
 *    table (that's how a Slack tap relayed by the service carries the human).
 *    Missing/unresolvable actor → null (401). Unset token env → token path
 *    always fails (never match empty === empty).
 * 2. Browser staff: falls back to requireStaffSession().
 */
export async function requireStaffOrService(request: NextRequest): Promise<AgentCaller | null> {
  const authHeader = request.headers.get('authorization');

  if (authHeader?.startsWith('Bearer ')) {
    // Per-service scoped tokens (service_token table), legacy env token
    // accepted as fallback — see lib/service-tokens.ts (Brief C).
    const identity = await verifyServiceToken(bearerFromHeader(authHeader), 'agents');
    if (!identity) return null;
    const actorHeader = request.headers.get('x-agent-actor')?.trim();
    if (!actorHeader) return null;
    if (isAgentActor(actorHeader)) {
      return { kind: 'service', actor: actorHeader, agent: parseAgentActor(actorHeader) ?? undefined };
    }
    const staff = await resolveStaffByPersonOrEmail(actorHeader);
    if (!staff) return null;
    return { kind: 'service', actor: staff.name || staff.email || staff.person };
  }

  const session = await requireStaffSession();
  if (!session) return null;
  return { kind: 'staff', actor: session.actor, email: session.email };
}
