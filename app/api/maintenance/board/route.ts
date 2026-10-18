import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { fetchAllRows } from '@/lib/maintenance/tripwire-engine';
import { isDeferredRecurring } from '@/lib/maintenance/recurring';
import { computeBoardKpis } from '@/lib/maintenance/board-kpis';
import type { MaintWorkOrder, Turn, VendorAssignment, UnitTurn } from '@/lib/maintenance/types';
import type { DispatchVendor } from '@/lib/maintenance/dispatch';

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

    const [openRaw, closedRes, turnsRes, unitTurnsRes, turnWosRes, assignmentsRes, vendorsRaw] = await Promise.all([
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
      supabase.from('unit_turn').select('*').neq('status', 'closed'),
      supabase.from('work_orders').select('*').not('unit_turn_id', 'is', null),
      supabase
        .from('vendor_assignment')
        .select('*')
        .is('completed_at', null)
        .is('declined_at', null),
      fetchAllRows(() => supabase.from('vendor').select('id,name,appfolio_vendor_id').eq('active', true), 'vendor'),
    ]);

    for (const res of [closedRes, turnsRes, unitTurnsRes, turnWosRes, assignmentsRes]) {
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
    const unitTurns = (unitTurnsRes.data ?? []) as UnitTurn[];
    const turnWos = (turnWosRes.data ?? []) as MaintWorkOrder[];
    // Withdrawn dispatch-board plans are history, not open assignments.
    const assignments = ((assignmentsRes.data ?? []) as VendorAssignment[]).filter((a) => !a.withdrawn_at);
    const vendors = vendorsRaw as DispatchVendor[];

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

    const kpis = computeBoardKpis(open, closedThisWeek);

    return NextResponse.json({ open, closedThisWeek, turns, unitTurns, turnWos, assignments, vendors, waitingSince, kpis });
  } catch (error) {
    console.error('[Maintenance] Board fetch error:', error);
    const message = error instanceof Error ? error.message : 'Failed to load board';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
