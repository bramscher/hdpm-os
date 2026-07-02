import { NextRequest, NextResponse } from 'next/server';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { recordEvent } from '@/lib/maintenance/events';
import {
  recordFailedAccess,
  updateWorkOrderWorkflow,
  WorkflowValidationError,
} from '@/lib/maintenance/workflow-db';
import type { EventType } from '@/lib/maintenance/types';

/** Event types staff may post manually from the detail page. */
const POSTABLE_EVENTS: EventType[] = [
  'note',
  'photo',
  'failed_access',
  'scope_change',
  'tenant_ping',
  'tenant_reply',
];

/**
 * POST /api/maintenance/work-orders/:id/events
 *
 * Append an event to the WO timeline. Special behaviors:
 *  - failed_access: requires payload.note + payload.new_next_action_date;
 *    auto-returns the WO to SCHEDULED with the new date (tripwire #5)
 *  - tenant_ping: also flips work_orders.tenant_ping_sent (closure gate #4)
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
    const body = await request.json();
    const eventType = body.event_type as EventType;
    const payload = (body.payload ?? {}) as Record<string, unknown>;

    if (!POSTABLE_EVENTS.includes(eventType)) {
      return NextResponse.json(
        { error: `event_type must be one of: ${POSTABLE_EVENTS.join(', ')}` },
        { status: 400 }
      );
    }

    if (eventType === 'failed_access') {
      const note = payload.note as string | undefined;
      const newDate = payload.new_next_action_date as string | undefined;
      if (!note || !newDate) {
        return NextResponse.json(
          { error: 'failed_access requires payload.note and payload.new_next_action_date' },
          { status: 400 }
        );
      }
      const { workOrder } = await recordFailedAccess(id, note, newDate, session.actor);
      return NextResponse.json({ workOrder });
    }

    if (eventType === 'tenant_ping') {
      // recordEvent happens inside the workflow update (tenant_ping event).
      const { workOrder } = await updateWorkOrderWorkflow(
        id,
        { tenant_ping_sent: true },
        session.actor
      );
      return NextResponse.json({ workOrder });
    }

    await recordEvent({
      work_order_id: id,
      event_type: eventType,
      payload,
      actor: session.actor,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof WorkflowValidationError) {
      return NextResponse.json(
        { error: 'Blocked', errors: error.errors },
        { status: 422 }
      );
    }
    console.error('[Maintenance] Event post error:', error);
    const message = error instanceof Error ? error.message : 'Failed to record event';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
