import { inspectionSchedulingAlert } from '@/lib/inspection-scheduling-alert';
import { inspectionWeek } from '@/lib/inspection-week';
import { actionableInspections, inspectionToday, shiftInspectionDate, loadInspectionQueue } from '@/lib/inspection-queue';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';

/**
 * GET /api/inspections/stats
 *
 * Returns dashboard KPI stats for the inspection queue.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();
    const today = inspectionToday();
    const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
    const monday = shiftInspectionDate(today, -(weekday === 0 ? 6 : weekday - 1));
    const nextMonday = shiftInspectionDate(monday, 7);
    const [{ rows, properties }, routeResult] = await Promise.all([
      loadInspectionQueue(supabase),
      supabase.from('route_plans').select('id,route_date,status,route_stops(id,status)')
        .gte('route_date', monday).lt('route_date', nextMonday),
    ]);
    if (routeResult.error) throw new Error(routeResult.error.message);
    const week = inspectionWeek(routeResult.data || [], monday, nextMonday);
    const active = actionableInspections(rows, properties, today);
    return NextResponse.json({
      scheduling_alert: inspectionSchedulingAlert(properties, today),
      total: active.length,
      overdue: active.filter(row => (row.target_date || row.due_date || today) < today).length,
      this_week: week.planned,
      week,
      completed: rows.filter(row => row.status === 'completed' && row.completed_at && inspectionToday(new Date(row.completed_at)) >= monday && inspectionToday(new Date(row.completed_at)) < nextMonday).length,
      unassigned: active.filter(row => !row.assigned_to).length,
      assignees: [...new Set(rows.map(row => row.assigned_to).filter(Boolean))],
    });

  } catch (error) {
    console.error('Inspection stats error:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch stats';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
