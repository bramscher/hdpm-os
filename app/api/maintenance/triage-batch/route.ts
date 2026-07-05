import { NextRequest, NextResponse } from 'next/server';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { proposalCounts, runTriageBatch } from '@/lib/maintenance/triage-batch';
import type { Stage } from '@/lib/maintenance/types';

export const maxDuration = 300;

const ALLOWED_STAGES: Stage[] = ['NEW', 'TRIAGED', 'SCHEDULED', 'WAITING_ON'];

/** GET /api/maintenance/triage-batch — proposal counts for the review UI. */
export async function GET() {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json(await proposalCounts());
}

/**
 * POST /api/maintenance/triage-batch — generate one chunk of proposals.
 * Body: { stages?: Stage[] } (default NEW+TRIAGED).
 * Resumable: call repeatedly until remaining = 0. Nothing is applied to any
 * work order here — proposals only.
 */
export async function POST(request: NextRequest) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const stages: Stage[] = Array.isArray(body.stages)
      ? body.stages.filter((s: Stage) => ALLOWED_STAGES.includes(s))
      : ['NEW', 'TRIAGED'];
    if (stages.length === 0) {
      return NextResponse.json({ error: 'No valid stages' }, { status: 400 });
    }

    const result = await runTriageBatch(stages);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[Maintenance] Triage batch error:', error);
    const message = error instanceof Error ? error.message : 'Batch failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
