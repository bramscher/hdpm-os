import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';

/**
 * GET /api/inspections/stats
 *
 * Returns dashboard KPI stats for the inspection queue.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    // Get start of current week (Monday)
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    const mondayStr = monday.toISOString().split('T')[0];

    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);
    const fridayStr = friday.toISOString().split('T')[0];

    // Run all queries in parallel
    const [totalRes, overdueRes, thisWeekRes, completedRes, unassignedRes] = await Promise.all([
      // Total in queue (not completed or canceled)
      supabase
        .from('inspections')
        .select('id', { count: 'exact', head: true })
        .not('status', 'in', '("completed","canceled")'),

      // Overdue (due_date < today, not completed/canceled)
      supabase
        .from('inspections')
        .select('id', { count: 'exact', head: true })
        .lt('due_date', today)
        .not('status', 'in', '("completed","canceled")'),

      // Scheduled this week
      supabase
        .from('inspections')
        .select('id', { count: 'exact', head: true })
        .gte('due_date', mondayStr)
        .lte('due_date', fridayStr)
        .not('status', 'in', '("completed","canceled")'),

      // Completed this week
      supabase
        .from('inspections')
        .select('id', { count: 'exact', head: true })
        .gte('completed_at', mondayStr)
        .eq('status', 'completed'),

      // Unassigned and in queue
      supabase
        .from('inspections')
        .select('id', { count: 'exact', head: true })
        .is('assigned_to', null)
        .in('status', ['queued', 'validated', 'imported']),
    ]);

    // Also fetch distinct assignees for filter dropdown
    const { data: assigneeData } = await supabase
      .from('inspections')
      .select('assigned_to')
      .not('assigned_to', 'is', null);

    const assignees = [...new Set((assigneeData || []).map((r: { assigned_to: string }) => r.assigned_to).filter(Boolean))];

    return NextResponse.json({
      total: totalRes.count ?? 0,
      overdue: overdueRes.count ?? 0,
      this_week: thisWeekRes.count ?? 0,
      completed: completedRes.count ?? 0,
      unassigned: unassignedRes.count ?? 0,
      assignees,
    });
  } catch (error) {
    console.error('Inspection stats error:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch stats';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
