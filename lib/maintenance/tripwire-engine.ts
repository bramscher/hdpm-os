/**
 * Maintenance OS — tripwire engine.
 *
 * Loads one snapshot of everything the 12 rules need, then runs the registry
 * with per-rule error capture (pattern: app/api/kpi/cron/route.ts). The
 * Exceptions view calls this live; the daily cron additionally records
 * wo_event('exception') rows and sends owner digests.
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import type {
  Approval,
  MaintWorkOrder,
  Recommendation,
  TripwireException,
  TripwireNumber,
  TripwireSnapshot,
  UnitTurn,
  Vendor,
  VendorAssignment,
  WoDocs,
} from './types';
import { TRIPWIRE_REGISTRY, needsADate } from './tripwires';
import { isDeferredRecurring } from './recurring';

/**
 * Page through a PostgREST query — Supabase caps single reads at 1000 rows,
 * which silently truncates snapshots as volume grows. The builder is a
 * factory because a query object can't be reused across .range() calls.
 */
export async function fetchAllRows<T>(
  makeQuery: () => PromiseLike<{ data: T[] | null; error: { message: string } | null }> & {
    order: (col: string) => { range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }> };
  },
  label: string
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await makeQuery().order('id').range(from, from + 999);
    if (error) throw new Error(`${label} load failed: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return rows;
}

export async function loadTripwireSnapshot(): Promise<TripwireSnapshot> {
  const supabase = getSupabaseAdmin();
  const now = new Date();

  const [openWorkOrdersRaw, assignments, vendors, approvals, recommendations, turnRes] =
    await Promise.all([
      fetchAllRows(
        () => supabase.from('work_orders').select('*').neq('stage', 'CLOSED'),
        'work_orders'
      ),
      fetchAllRows(() => supabase.from('vendor_assignment').select('*'), 'vendor_assignment'),
      fetchAllRows(() => supabase.from('vendor').select('*'), 'vendor'),
      fetchAllRows(
        () => supabase.from('approval').select('*').is('decided_at', null),
        'approval'
      ),
      fetchAllRows(
        () =>
          supabase
            .from('recommendation')
            .select('*')
            .is('resolved_wo_id', null)
            .is('dismissed_reason', null),
        'recommendation'
      ),
      supabase.from('unit_turn').select('*').eq('status', 'active'),
    ]);

  if (turnRes.error) throw new Error(`Snapshot load failed: ${turnRes.error.message}`);

  // Recurring WOs scheduled for a future week are not yet actionable — keep
  // them out of every tripwire (same deferral the board applies).
  const todayStr = now.toISOString().slice(0, 10);
  const openWorkOrders = (openWorkOrdersRaw as MaintWorkOrder[]).filter(
    (wo) => !isDeferredRecurring(wo, todayStr)
  );
  const openIds = openWorkOrders.map((wo) => wo.id);

  // Invoice linkage (rule 8) + line-item docs (rule 7) for open WOs.
  const invoicedWorkOrderIds = new Set<string>();
  const lineItemsByWo = new Map<string, { type?: string }[]>();
  for (let i = 0; i < openIds.length; i += 200) {
    const batch = openIds.slice(i, i + 200);
    const { data, error } = await supabase
      .from('hdms_invoices')
      .select('work_order_id, status, line_items')
      .in('work_order_id', batch)
      .neq('status', 'void');
    if (error) throw new Error(`Snapshot invoice load failed: ${error.message}`);
    for (const inv of data ?? []) {
      if (!inv.work_order_id) continue;
      invoicedWorkOrderIds.add(inv.work_order_id);
      if (Array.isArray(inv.line_items)) {
        const existing = lineItemsByWo.get(inv.work_order_id) ?? [];
        lineItemsByWo.set(inv.work_order_id, existing.concat(inv.line_items));
      }
    }
  }

  // Event-derived docs (rules 5/6/7) + status-entry clocks (rule 11) for open WOs.
  const docsByWorkOrder = new Map<string, WoDocs>();
  const recentFailedAccessWoIds = new Set<string>();
  const statusSince = new Map<string, string>();
  const currentStatusById = new Map(openWorkOrders.map((wo) => [wo.id, wo.appfolio_status]));
  const dayAgo = new Date(now.getTime() - 24 * 3600_000).toISOString();
  for (let i = 0; i < openIds.length; i += 200) {
    const batch = openIds.slice(i, i + 200);
    const { data, error } = await supabase
      .from('wo_event')
      .select('work_order_id, event_type, payload, created_at')
      .in('work_order_id', batch)
      .in('event_type', ['photo', 'scope_change', 'approval_decision', 'failed_access', 'sync_update'])
      .order('created_at', { ascending: true });
    if (error) throw new Error(`Snapshot event load failed: ${error.message}`);
    for (const e of data ?? []) {
      if (e.event_type === 'sync_update') {
        // Ascending order → last matching write wins = latest entry into the current status
        const p = (e.payload ?? {}) as Record<string, unknown>;
        if (p.field === 'appfolio_status' && p.to === currentStatusById.get(e.work_order_id)) {
          statusSince.set(e.work_order_id, e.created_at);
        }
        continue;
      }
      const docs = docsByWorkOrder.get(e.work_order_id) ?? {
        photoCount: 0,
        hasTime: false,
        hasMaterials: false,
        scopeChanges: 0,
        approvedDecisions: 0,
      };
      if (e.event_type === 'photo') docs.photoCount++;
      if (e.event_type === 'scope_change') docs.scopeChanges++;
      if (
        e.event_type === 'approval_decision' &&
        (e.payload as Record<string, unknown>)?.decision === 'APPROVED'
      ) {
        docs.approvedDecisions++;
      }
      if (e.event_type === 'failed_access' && e.created_at >= dayAgo) {
        recentFailedAccessWoIds.add(e.work_order_id);
      }
      docsByWorkOrder.set(e.work_order_id, docs);
    }
  }
  // Fold invoice line items into docs (time/materials).
  for (const wo of openWorkOrders) {
    const items = lineItemsByWo.get(wo.id);
    if (!items) continue;
    const docs = docsByWorkOrder.get(wo.id) ?? {
      photoCount: 0,
      hasTime: false,
      hasMaterials: false,
      scopeChanges: 0,
      approvedDecisions: 0,
    };
    docs.hasTime = docs.hasTime || items.some((li) => li.type === 'labor');
    docs.hasMaterials =
      docs.hasMaterials || items.some((li) => li.type === 'materials' || li.type === 'other');
    docsByWorkOrder.set(wo.id, docs);
  }

  return {
    now,
    openWorkOrders,
    assignments: assignments as VendorAssignment[],
    vendors: vendors as Vendor[],
    approvals: approvals as Approval[],
    recommendations: recommendations as Recommendation[],
    unitTurns: (turnRes.data ?? []) as UnitTurn[],
    invoicedWorkOrderIds,
    docsByWorkOrder,
    recentFailedAccessWoIds,
    statusSince,
  };
}

export interface TripwireRunResult {
  exceptions: TripwireException[];
  /** Rules that threw (never silently dropped). */
  ruleErrors: { tripwire: TripwireNumber; error: string }[];
  ranAt: string;
  /** Triage backlog: open WOs with no next-action date (excl. future-scheduled). */
  needsDate: TripwireException[];
  needsDateCount: number;
}

/** Run all 12 rules with per-rule error capture. Pure given a snapshot. */
export function runTripwires(snapshot: TripwireSnapshot): TripwireRunResult {
  const exceptions: TripwireException[] = [];
  const ruleErrors: TripwireRunResult['ruleErrors'] = [];

  for (const { n, run } of TRIPWIRE_REGISTRY) {
    try {
      exceptions.push(...run(snapshot));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Tripwires] Rule #${n} failed:`, message);
      ruleErrors.push({ tripwire: n, error: message });
    }
  }

  const needsDate = needsADate(snapshot);
  return {
    exceptions,
    ruleErrors,
    ranAt: snapshot.now.toISOString(),
    needsDate,
    needsDateCount: needsDate.length,
  };
}
