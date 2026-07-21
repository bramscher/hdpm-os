import { NextRequest, NextResponse } from 'next/server';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import {
  assignKey,
  markKeyVacant,
  reissueKey,
  releaseKey,
  reinstateKey,
  retireKey,
  type AssignInput,
  type MarkVacantInput,
  type ReissueInput,
  type ReleaseInput,
  type TransitionResult,
} from '@/lib/keys';
import type { KeyTransitionAction } from '@/types/keys';

/**
 * POST /api/keys/:id/transition — the single door for the key state machine.
 *
 * Body: { action, ...actionPayload }. Warning-style refusals come back as
 * 409 with a code the UI understands (unit_has_active_key, outstanding_copies,
 * conflict); illegal transitions are 422.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = (await request.json()) as { action?: KeyTransitionAction } & Record<
      string,
      unknown
    >;

    let result: TransitionResult;
    switch (body.action) {
      case 'assign':
        result = await assignKey(id, body as unknown as AssignInput, session.actor);
        break;
      case 'mark_vacant':
        result = await markKeyVacant(
          id,
          { copyOutcomes: (body.copyOutcomes as MarkVacantInput['copyOutcomes']) ?? [] },
          session.actor
        );
        break;
      case 'reissue':
        result = await reissueKey(
          id,
          {
            tenantNames: (body.tenantNames as string[]) ?? [],
            copies: (body.copies as ReissueInput['copies']) ?? [],
          },
          session.actor
        );
        break;
      case 'release':
        result = await releaseKey(
          id,
          { acknowledgeOutstanding: Boolean((body as ReleaseInput).acknowledgeOutstanding) },
          session.actor
        );
        break;
      case 'retire':
        result = await retireKey(id, session.actor);
        break;
      case 'reinstate':
        result = await reinstateKey(id, session.actor);
        break;
      default:
        return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 422 });
    }

    if (!result.ok) {
      const status = result.code === 'illegal_transition' ? 422 : 409;
      return NextResponse.json(result, { status });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error('[api/keys/:id/transition] error:', error);
    const message = error instanceof Error ? error.message : 'Transition failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
