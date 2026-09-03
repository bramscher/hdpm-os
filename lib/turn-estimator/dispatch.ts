/**
 * Turn Estimator — Slice 2: Dispatch & Execution (thin connective layer).
 *
 * AppFolio stays the system of record for work orders. This does NOT create or
 * store work orders, clock time, or capture materials. It only:
 *   1. reads the turn's existing WOs (the work_orders mirror) and drives the
 *      turn lifecycle forward from their AppFolio stages, and
 *   2. computes estimate-vs-actual variance at invoice time (actual = the
 *      invoices already generated from those WOs).
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import { advanceTurnToward } from './turns';
import type { TurnState } from './turn-lifecycle';

/**
 * Map the turn's work-order stages to the lifecycle state the turn should be at
 * (or past). Pure + testable. Returns null when the WOs don't yet imply any
 * lifecycle move (none scheduled, or no WOs) — leave the turn where it is.
 *
 * WO stages: NEW, TRIAGED, SCHEDULED, IN_PROGRESS, WAITING_ON, VERIFY, BILL, CLOSED.
 */
export function mapWorkOrdersToTurnStatus(stages: string[]): TurnState | null {
  if (stages.length === 0) return null;
  const has = (s: string) => stages.includes(s);
  const allIn = (set: string[]) => stages.every((s) => set.includes(s));

  if (allIn(['BILL', 'CLOSED'])) return 'TURN_READY'; // all work done/billing
  if (has('IN_PROGRESS') || has('WAITING_ON')) return 'IN_PROGRESS'; // active work wins over QC
  if (has('VERIFY')) return 'QC_PENDING'; // in final check, nothing still active
  if (has('SCHEDULED')) return 'SCHEDULED';
  return null; // only NEW/TRIAGED — not scheduled yet
}

export interface TurnWorkOrder {
  id: string;
  wo_number: string | null;
  stage: string;
  appfolio_status: string | null;
  assigned_to: string | null;
  description: string | null;
}

async function turnWorkOrders(turnId: string): Promise<TurnWorkOrder[]> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('work_orders')
    .select('id, wo_number, stage, appfolio_status, assigned_to, description')
    .eq('unit_turn_id', turnId)
    .order('wo_number');
  return (data ?? []) as TurnWorkOrder[];
}

/**
 * Drive the turn lifecycle from its work orders' AppFolio stages. Read-only wrt
 * AppFolio and WOs; only the turn's own lifecycle advances (forward, best-effort).
 */
export async function syncTurnStatusFromWorkOrders(
  turnId: string,
  actor: string
): Promise<{ target: TurnState | null }> {
  const wos = await turnWorkOrders(turnId);
  const target = mapWorkOrdersToTurnStatus(wos.map((w) => w.stage));
  if (target) {
    await advanceTurnToward(turnId, target, actor, 'work-order progress');
  }
  return { target };
}

export interface TurnVariance {
  approved: number; // approved estimate owner total (0 if none)
  actual: number; // billed to the owner from the turn's WOs (non-void invoices)
  variance: number; // actual − approved
  pct: number | null; // variance as % of approved (null when approved is 0)
  invoice_count: number;
}

/**
 * Estimate-vs-actual variance for a turn: the approved estimate total vs the
 * invoices already generated from the turn's work orders (system of record).
 */
export async function getTurnVariance(turnId: string): Promise<TurnVariance> {
  const supabase = getSupabaseAdmin();

  // Approved estimate total (latest approved estimate for the turn).
  let approved = 0;
  const versionIds: string[] = [];
  const { data: ests } = await supabase
    .from('estimate')
    .select('id, status, current_version_id, created_at')
    .eq('unit_turn_id', turnId)
    .order('created_at', { ascending: false });
  for (const e of ests ?? []) {
    if (e.current_version_id) versionIds.push(e.current_version_id as string);
  }
  const approvedEst = (ests ?? []).find((e) => e.status === 'approved');
  if (approvedEst?.current_version_id) {
    const { data: ver } = await supabase
      .from('estimate_version')
      .select('owner_total')
      .eq('id', approvedEst.current_version_id)
      .maybeSingle();
    approved = ver ? Number(ver.owner_total) : 0;
  }

  // Actual = non-void invoices tied to the turn: either generated from one of
  // the turn's WOs, or converted from one of the turn's estimate versions.
  const woIds = (await turnWorkOrders(turnId)).map((w) => w.id);
  const byId = new Map<string, number>();
  if (woIds.length > 0) {
    const { data } = await supabase
      .from('hdms_invoices')
      .select('id, total_amount, status')
      .in('work_order_id', woIds)
      .neq('status', 'void');
    for (const inv of data ?? []) byId.set(inv.id as string, Number(inv.total_amount));
  }
  if (versionIds.length > 0) {
    const { data } = await supabase
      .from('hdms_invoices')
      .select('id, total_amount, status')
      .in('source_estimate_version_id', versionIds)
      .neq('status', 'void');
    for (const inv of data ?? []) byId.set(inv.id as string, Number(inv.total_amount));
  }
  const actual = Math.round([...byId.values()].reduce((s, v) => s + v, 0) * 100) / 100;

  return {
    approved,
    actual,
    variance: Math.round((actual - approved) * 100) / 100,
    pct: approved > 0 ? Math.round(((actual - approved) / approved) * 1000) / 10 : null,
    invoice_count: byId.size,
  };
}

/** Everything the dispatch view needs: the turn's WOs + variance. */
export async function getTurnDispatch(turnId: string): Promise<{
  workOrders: TurnWorkOrder[];
  variance: TurnVariance;
}> {
  const [workOrders, variance] = await Promise.all([turnWorkOrders(turnId), getTurnVariance(turnId)]);
  return { workOrders, variance };
}
