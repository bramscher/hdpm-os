import { NextRequest, NextResponse } from 'next/server';
import { requireStaffOrService } from '@/lib/maintenance/api-auth';
import { createProposal, listProposals } from '@/lib/agents/proposals';

/**
 * GET  /api/agents/proposals — list (filters: status, agent, subject_type,
 *      subject_id, limit; default status=proposed)
 * POST /api/agents/proposals — create; rows always start status='proposed'
 *
 * Auth: staff session or HDPM_SERVICE_TOKEN + X-Agent-Actor
 * (requireStaffOrService — this route is exempt from session middleware).
 */
export async function GET(request: NextRequest) {
  const caller = await requireStaffOrService(request);
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const q = request.nextUrl.searchParams;
    const proposals = await listProposals({
      status: q.get('status') ?? 'proposed',
      agent: q.get('agent') ?? undefined,
      subject_type: q.get('subject_type') ?? undefined,
      subject_id: q.get('subject_id') ?? undefined,
      limit: q.get('limit') ? Number(q.get('limit')) : undefined,
    });
    return NextResponse.json({ proposals });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Agents] proposals list failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const caller = await requireStaffOrService(request);
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    for (const field of ['agent', 'subject_type', 'action_type'] as const) {
      if (!body[field] || typeof body[field] !== 'string') {
        return NextResponse.json({ error: `Missing required field: ${field}` }, { status: 400 });
      }
    }
    const proposal = await createProposal({
      agent: body.agent,
      subject_type: body.subject_type,
      subject_id: body.subject_id ?? null,
      action_type: body.action_type,
      payload: body.payload ?? {},
      rationale: body.rationale ?? null,
    });
    return NextResponse.json({ proposal });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Agents] proposal create failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
