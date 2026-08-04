import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';

// ============================================
// GET /api/inspections/routes/[id]
// Fetch a single route plan with stops + property data
// ============================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const supabase = getSupabaseAdmin();

    // Fetch route plan
    const { data: routePlan, error: planError } = await supabase
      .from('route_plans')
      .select('*')
      .eq('id', id)
      .single();

    if (planError) {
      if (planError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Route plan not found' }, { status: 404 });
      }
      console.error('Error fetching route plan:', planError);
      return NextResponse.json({ error: planError.message }, { status: 500 });
    }

    // Fetch stops with joined inspection and property data
    const { data: stops, error: stopsError } = await supabase
      .from('route_stops')
      .select(`
        *,
        inspections (
          id,
          inspection_type,
          status,
          due_date,
          priority,
          notes,
          unit_name,
          resident_name,
          inspection_properties (
            id,
            address_1,
            city,
            state,
            zip,
            latitude,
            longitude
          )
        )
      `)
      .eq('route_plan_id', id)
      .order('stop_order', { ascending: true });

    if (stopsError) {
      console.error('Error fetching route stops:', stopsError);
      return NextResponse.json({ error: stopsError.message }, { status: 500 });
    }

    return NextResponse.json({
      ...routePlan,
      stops: stops || [],
    });
  } catch (error) {
    console.error('Route plan GET error:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch route plan';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ============================================
// PATCH /api/inspections/routes/[id]
// Update route plan fields and/or reorder stops
// ============================================

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const supabase = getSupabaseAdmin();

    // Verify the route plan exists
    const { data: existing, error: existError } = await supabase
      .from('route_plans')
      .select('id')
      .eq('id', id)
      .single();

    if (existError || !existing) {
      return NextResponse.json({ error: 'Route plan not found' }, { status: 404 });
    }

    // Enforce 7-day minimum lead time if route_date is being changed
    if (body.route_date) {
      const minRouteDate = new Date();
      minRouteDate.setDate(minRouteDate.getDate() + 7);
      const minDateStr = minRouteDate.toISOString().split('T')[0];

      if (body.route_date < minDateStr) {
        return NextResponse.json(
          { error: 'Routes must be scheduled at least 7 days in advance to allow time for tenant notices.' },
          { status: 400 }
        );
      }
    }

    // Update route plan fields (whitelisted)
    const allowedFields = ['name', 'status', 'assigned_to', 'route_date', 'notes'];
    const updates: Record<string, unknown> = {};

    for (const field of allowedFields) {
      if (field in body) {
        updates[field] = body[field];
      }
    }

    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();

      const { error: updateError } = await supabase
        .from('route_plans')
        .update(updates)
        .eq('id', id);

      if (updateError) {
        console.error('Error updating route plan:', updateError);
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
    }

    // Handle stop reordering if provided
    if (body.stops && Array.isArray(body.stops)) {
      for (const stop of body.stops as Array<{ id: string; stop_order: number }>) {
        if (!stop.id || stop.stop_order == null) continue;

        const { error: stopError } = await supabase
          .from('route_stops')
          .update({ stop_order: stop.stop_order, updated_at: new Date().toISOString() })
          .eq('id', stop.id)
          .eq('route_plan_id', id);

        if (stopError) {
          console.error('Error reordering stop:', stopError);
          return NextResponse.json({ error: `Failed to reorder stop ${stop.id}: ${stopError.message}` }, { status: 500 });
        }
      }
    }

    // Return the updated route plan with stops
    const { data: updatedPlan, error: fetchError } = await supabase
      .from('route_plans')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError) {
      console.error('Error fetching updated route plan:', fetchError);
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    const { data: updatedStops, error: stopsError } = await supabase
      .from('route_stops')
      .select(`
        *,
        inspections (
          id,
          inspection_type,
          status,
          due_date,
          priority,
          notes,
          unit_name,
          resident_name,
          inspection_properties (
            id,
            address_1,
            city,
            state,
            zip,
            latitude,
            longitude
          )
        )
      `)
      .eq('route_plan_id', id)
      .order('stop_order', { ascending: true });

    if (stopsError) {
      console.error('Error fetching updated stops:', stopsError);
    }

    return NextResponse.json({
      ...updatedPlan,
      stops: updatedStops || [],
    });
  } catch (error) {
    console.error('Route plan PATCH error:', error);
    const message = error instanceof Error ? error.message : 'Failed to update route plan';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ============================================
// DELETE /api/inspections/routes/[id]
// Delete route plan and reset inspection statuses
// ============================================

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const supabase = getSupabaseAdmin();

    // Fetch the route plan to get calendar_event_id before deletion
    const { data: routePlan } = await supabase
      .from('route_plans')
      .select('calendar_event_id')
      .eq('id', id)
      .single();

    // Delete the calendar event if one was created
    if (routePlan?.calendar_event_id && session.accessToken) {
      try {
        const graphRes = await fetch(
          `https://graph.microsoft.com/v1.0/me/events/${routePlan.calendar_event_id}`,
          {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${session.accessToken}` },
          }
        );
        if (!graphRes.ok && graphRes.status !== 404) {
          console.error('Failed to delete calendar event:', graphRes.status);
        }
      } catch (calErr) {
        // Non-fatal: route deletion should proceed even if calendar cleanup fails
        console.error('Calendar event cleanup error:', calErr);
      }
    }

    // Fetch the route stops to get inspection IDs before deletion
    const { data: stops, error: stopsError } = await supabase
      .from('route_stops')
      .select('inspection_id')
      .eq('route_plan_id', id);

    if (stopsError) {
      console.error('Error fetching route stops for deletion:', stopsError);
      return NextResponse.json({ error: stopsError.message }, { status: 500 });
    }

    const inspectionIds = (stops || []).map((s) => s.inspection_id).filter(Boolean);

    // Delete route stops (cascade from route plan or explicit)
    const { error: deleteStopsError } = await supabase
      .from('route_stops')
      .delete()
      .eq('route_plan_id', id);

    if (deleteStopsError) {
      console.error('Error deleting route stops:', deleteStopsError);
      return NextResponse.json({ error: deleteStopsError.message }, { status: 500 });
    }

    // Delete the route plan
    const { error: deletePlanError } = await supabase
      .from('route_plans')
      .delete()
      .eq('id', id);

    if (deletePlanError) {
      console.error('Error deleting route plan:', deletePlanError);
      return NextResponse.json({ error: deletePlanError.message }, { status: 500 });
    }

    // Reset associated inspections back to 'imported'
    if (inspectionIds.length > 0) {
      const { error: resetError } = await supabase
        .from('inspections')
        .update({ status: 'imported', updated_at: new Date().toISOString() })
        .in('id', inspectionIds);

      if (resetError) {
        console.error('Error resetting inspection statuses:', resetError);
        // Non-fatal: route was deleted, but status reset failed
      }
    }

    return NextResponse.json({
      deleted: true,
      inspections_reset: inspectionIds.length,
      calendar_event_deleted: !!routePlan?.calendar_event_id,
    });
  } catch (error) {
    console.error('Route plan DELETE error:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete route plan';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
