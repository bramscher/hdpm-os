import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';

// ============================================
// POST /api/inspections/routes/bulk-delete
// Delete all routes for a given date, returning inspections to the pool
// ============================================

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { date } = await request.json();

    if (!date) {
      return NextResponse.json({ error: 'date is required (YYYY-MM-DD)' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Step 1: Find all route plans for this date
    const { data: routes, error: routesError } = await supabase
      .from('route_plans')
      .select('id')
      .eq('route_date', date);

    if (routesError) {
      console.error('Error fetching routes for date:', routesError);
      return NextResponse.json({ error: routesError.message }, { status: 500 });
    }

    if (!routes || routes.length === 0) {
      return NextResponse.json({ deleted: 0, inspections_freed: 0, message: 'No routes found for this date' });
    }

    const routeIds = routes.map((r) => r.id);

    // Step 2: Get all inspection IDs from these routes
    const { data: stops, error: stopsError } = await supabase
      .from('route_stops')
      .select('inspection_id')
      .in('route_plan_id', routeIds);

    if (stopsError) {
      console.error('Error fetching stops for bulk delete:', stopsError);
      return NextResponse.json({ error: stopsError.message }, { status: 500 });
    }

    const inspectionIds = (stops || []).map((s) => s.inspection_id).filter(Boolean);

    // Step 3: Delete all route stops
    const { error: deleteStopsError } = await supabase
      .from('route_stops')
      .delete()
      .in('route_plan_id', routeIds);

    if (deleteStopsError) {
      console.error('Error deleting route stops:', deleteStopsError);
      return NextResponse.json({ error: deleteStopsError.message }, { status: 500 });
    }

    // Step 4: Delete all route plans
    const { error: deletePlansError } = await supabase
      .from('route_plans')
      .delete()
      .in('id', routeIds);

    if (deletePlansError) {
      console.error('Error deleting route plans:', deletePlansError);
      return NextResponse.json({ error: deletePlansError.message }, { status: 500 });
    }

    // Step 5: Reset inspections back to "imported" so they re-enter the pool
    if (inspectionIds.length > 0) {
      const { error: resetError } = await supabase
        .from('inspections')
        .update({ status: 'imported' })
        .in('id', inspectionIds);

      if (resetError) {
        console.error('Error resetting inspections:', resetError);
        // Non-fatal — routes are already deleted
      }
    }

    return NextResponse.json({
      deleted: routes.length,
      inspections_freed: inspectionIds.length,
      message: `Deleted ${routes.length} route(s) for ${date}. ${inspectionIds.length} inspections returned to pool.`,
    });
  } catch (error) {
    console.error('Bulk delete routes error:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete routes';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
