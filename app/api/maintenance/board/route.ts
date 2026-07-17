import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { fetchAllRows } from '@/lib/maintenance/tripwire-engine';
import { isDeferredRecurring } from '@/lib/maintenance/recurring';
import type { MaintWorkOrder, Turn, VendorAssignment } from '@/lib/maintenance/types';

/**
 * GET /api/maintenance/board
 *
 * One payload for the 7-view maintenance dashboard:
 *  - all open (stage != CLOSED) work orders with workflow columns
 *  - work orders closed in the last 7 days (the "CLOSED (wk)" column)
 *  - turn rows (Turnover view)
 *  - open vendor assignments (Waiting-On / vendor wait ages)
 *  - KPI counts for the header tiles
 */
export async function GET() {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

    const [openRaw, closedRes, turnsRes, assignmentsRes] = await Promise.all([
      fetchAllRows(
        () => supabase.from('work_orders').select('*').neq('stage', 'CLOSED'),
        'work_orders'
      ),
      supabase
        .from('work_orders')
        .select('*')
        .eq('stage', 'CLOSED')
        .gte('closed_at', weekAgo)
        .order('closed_at', { ascending: false }),
      supabase.from('turn').select('*'),
      supabase
        .from('vendor_assignment')
        .select('*')
        .is('completed_at', null)
        .is('declined_at', null),
    ]);

    for (const res of [closedRes, turnsRes, assignmentsRes]) {
      if (res.error) throw new Error(res.error.message);
    }

    // Recurring WOs stay off the board (and out of the KPIs below) until the
    // calendar week their scheduled date falls in.
    const todayStr = new Date().toISOString().slice(0, 10);
    const open = (openRaw as MaintWorkOrder[])
      .filter((wo) => !isDeferredRecurring(wo, todayStr))
      .sort((a, b) => (a.next_action_date ?? '').localeCompare(b.next_action_date ?? ''));
    const closedThisWeek = (closedRes.data ?? []) as MaintWorkOrder[];
    const turns = (turnsRes.data ?? []) as Turn[];
    const assignments = (assignmentsRes.data ?? []) as VendorAssignment[];

    // How long has each WAITING_ON WO been waiting? (latest stage_change → WAITING_ON)
    const waitingIds = open.filter((wo) => wo.stage === 'WAITING_ON').map((wo) => wo.id);
    const waitingSince: Record<string, string> = {};
    if (waitingIds.length > 0) {
      const { data: waitEvents } = await supabase
        .from('wo_event')
        .select('work_order_id, payload, created_at')
        .in('work_order_id', waitingIds)
        .eq('event_type', 'stage_change')
        .order('created_at', { ascending: true });
      for (const e of waitEvents ?? []) {
        if ((e.payload as Record<string, unknown>)?.to === 'WAITING_ON') {
          waitingSince[e.work_order_id] = e.created_at; // ascending → last write wins
        }
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

    // Age math uses AppFolio's CreatedAt (catch-up syncs insert old history
    // with fresh row timestamps), falling back to our row insert time.
    const createdAt = (wo: MaintWorkOrder) => wo.appfolio_created_at ?? wo.created_at;
    const kpis = {
      open: open.length,
      pastDue: open.filter((wo) => wo.next_action_date && wo.next_action_date < today).length,
      aging30Plus: open.filter((wo) => createdAt(wo) < thirtyDaysAgo).length,
      p1ThisWeek: open
        .concat(closedThisWeek)
        .filter((wo) => wo.priority_class === 'P1' && createdAt(wo) >= sevenDaysAgo).length,
      ownerAndDateCoverage:
        open.length === 0
          ? 100
          : Math.round(
              (open.filter((wo) => wo.owner_name && wo.next_action_date).length / open.length) * 100
            ),
    };

    return NextResponse.json({ open, closedThisWeek, turns, assignments, waitingSince, kpis });
  } catch (error) {
    console.error('[Maintenance] Board fetch error:', error);
    const message = error instanceof Error ? error.message : 'Failed to load board';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
