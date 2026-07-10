import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { completeInspectionCascade } from '@/lib/inspection-complete';

/**
 * PATCH /api/inspections/routes/[id]/stops
 * Update a stop's status (complete, skip, flag issue)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: routePlanId } = await params;
    const body = await request.json();
    const { stop_id, action, notes, issues_found, issue_severity } = body;

    if (!stop_id || !action) {
      return NextResponse.json(
        { error: 'stop_id and action are required' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    const now = new Date().toISOString();

    // Verify the stop belongs to this route
    const { data: stop, error: stopErr } = await supabase
      .from('route_stops')
      .select('id, inspection_id, status')
      .eq('id', stop_id)
      .eq('route_plan_id', routePlanId)
      .single();

    if (stopErr || !stop) {
      return NextResponse.json({ error: 'Stop not found' }, { status: 404 });
    }

    // ── Start Inspection: set stop in_progress ──
    if (action === 'start') {
      // Transition stop to in_progress
      await supabase
        .from('route_stops')
        .update({ status: 'in_progress', actual_arrival: now })
        .eq('id', stop_id);

      // Mark the inspection scheduled
      await supabase
        .from('inspections')
        .update({
          status: 'scheduled',
          updated_at: now,
        })
        .eq('id', stop.inspection_id);

      // Update route to in_progress if it's dispatched
      await supabase
        .from('route_plans')
        .update({ status: 'in_progress', updated_at: now })
        .eq('id', routePlanId)
        .in('status', ['dispatched', 'optimized', 'draft']);

      return NextResponse.json({
        success: true,
        stop_status: 'in_progress',
      });
    }

    let newStopStatus: string;
    let inspectionStatus: string;

    switch (action) {
      case 'complete':
        newStopStatus = 'completed';
        inspectionStatus = 'completed';
        break;
      case 'skip':
        newStopStatus = 'skipped';
        inspectionStatus = 'imported'; // Back to queue
        break;
      case 'flag_issue':
        newStopStatus = 'completed';
        inspectionStatus = 'completed';
        break;
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    // Update route_stop
    const { error: updateStopErr } = await supabase
      .from('route_stops')
      .update({
        status: newStopStatus,
        actual_arrival: now,
        actual_departure: now,
      })
      .eq('id', stop_id);

    if (updateStopErr) {
      console.error('Error updating stop:', updateStopErr);
      return NextResponse.json({ error: updateStopErr.message }, { status: 500 });
    }

    // Update inspection
    const inspectionUpdate: Record<string, unknown> = {
      status: inspectionStatus,
      updated_at: now,
    };

    if (action === 'complete' || action === 'flag_issue') {
      inspectionUpdate.completed_at = now;
      inspectionUpdate.completed_by = session.user.email;
    }

    if (notes) {
      inspectionUpdate.completion_notes = notes;
    }

    if (action === 'flag_issue') {
      inspectionUpdate.issues_found = true;
      inspectionUpdate.issue_severity = issue_severity || 'medium';
    }

    const { error: updateInspErr } = await supabase
      .from('inspections')
      .update(inspectionUpdate)
      .eq('id', stop.inspection_id);

    if (updateInspErr) {
      console.error('Error updating inspection:', updateInspErr);
      return NextResponse.json({ error: updateInspErr.message }, { status: 500 });
    }

    // Check if all stops are done — if so, mark route complete
    const { data: allStops } = await supabase
      .from('route_stops')
      .select('status')
      .eq('route_plan_id', routePlanId);

    const allDone = allStops?.every(
      (s) => s.status === 'completed' || s.status === 'skipped'
    );

    if (allDone) {
      await supabase
        .from('route_plans')
        .update({ status: 'completed', updated_at: now })
        .eq('id', routePlanId);
    }

    // Completion cascade: property cadence write-back + next inspection (+6mo)
    let nextInspectionCreated = false;
    if (action === 'complete' || action === 'flag_issue') {
      const cascade = await completeInspectionCascade(
        supabase,
        [stop.inspection_id],
        now.slice(0, 10)
      );
      nextInspectionCreated = cascade.next_created > 0;
    }

    return NextResponse.json({
      success: true,
      stop_status: newStopStatus,
      inspection_status: inspectionStatus,
      route_completed: allDone || false,
      next_inspection_created: nextInspectionCreated,
    });
  } catch (error) {
    console.error('Stop update error:', error);
    const message = error instanceof Error ? error.message : 'Failed to update stop';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
