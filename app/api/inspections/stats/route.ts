import { loadInspectionReview } from '@/lib/inspection-review-loader';
export const maxDuration = 120;
import { inspectionSchedulingAlert } from '@/lib/inspection-scheduling-alert';
import { inspectionWeek } from '@/lib/inspection-week';
import { actionableInspections, inspectionToday, shiftInspectionDate } from '@/lib/inspection-queue';
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
    const [review, routeResult] = await Promise.all([
      loadInspectionReview(supabase),
      supabase.from('route_plans').select('id,route_date,status,route_stops(id,status)')
        .gte('route_date', monday).lt('route_date', nextMonday),
    ]);
    const {rows, properties} = review;
    if (routeResult.error) throw new Error(routeResult.error.message);
    const week = inspectionWeek(routeResult.data || [], monday, nextMonday);
    const active = actionableInspections(rows, properties, today);
    const schedulingAlert = inspectionSchedulingAlert(review.candidates.filter(candidate=>candidate.review_group==='ready').map(candidate=>({...candidate,candidate_status:'eligible'})), today);
    return NextResponse.json({
      scheduling_alert: schedulingAlert,
      review_counts:review.review_counts,
      verification_error:review.verification_error,
      total: active.length,
      overdue: schedulingAlert.overdue,
      appointments_needing_review: active.filter(row => row.status === 'needs_review').length,
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
