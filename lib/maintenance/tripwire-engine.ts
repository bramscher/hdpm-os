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
  Turn,
  Vendor,
  VendorAssignment,
  WoDocs,
} from './types';
import { TRIPWIRE_REGISTRY } from './tripwires';

export async function loadTripwireSnapshot(): Promise<TripwireSnapshot> {
  const supabase = getSupabaseAdmin();
  const now = new Date();

  const [openRes, assignRes, vendorRes, approvalRes, recRes, turnRes] = await Promise.all([
    supabase.from('work_orders').select('*').neq('stage', 'CLOSED'),
    supabase.from('vendor_assignment').select('*'),
    supabase.from('vendor').select('*'),
    supabase.from('approval').select('*').is('decided_at', null),
    supabase
      .from('recommendation')
      .select('*')
      .is('resolved_wo_id', null)
      .is('dismissed_reason', null),
    supabase.from('turn').select('*'),
  ]);

  for (const res of [openRes, assignRes, vendorRes, approvalRes, recRes, turnRes]) {
    if (res.error) throw new Error(`Snapshot load failed: ${res.error.message}`);
  }

  const openWorkOrders = (openRes.data ?? []) as MaintWorkOrder[];
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

  // Event-derived docs (rules 5/6/7) for open WOs.
  const docsByWorkOrder = new Map<string, WoDocs>();
  const recentFailedAccessWoIds = new Set<string>();
  const dayAgo = new Date(now.getTime() - 24 * 3600_000).toISOString();
  for (let i = 0; i < openIds.length; i += 200) {
    const batch = openIds.slice(i, i + 200);
    const { data, error } = await supabase
      .from('wo_event')
      .select('work_order_id, event_type, payload, created_at')
      .in('work_order_id', batch)
      .in('event_type', ['photo', 'scope_change', 'approval_decision', 'failed_access']);
    if (error) throw new Error(`Snapshot event load failed: ${error.message}`);
    for (const e of data ?? []) {
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
    assignments: (assignRes.data ?? []) as VendorAssignment[],
    vendors: (vendorRes.data ?? []) as Vendor[],
    approvals: (approvalRes.data ?? []) as Approval[],
    recommendations: (recRes.data ?? []) as Recommendation[],
    turns: (turnRes.data ?? []) as Turn[],
    invoicedWorkOrderIds,
    docsByWorkOrder,
    recentFailedAccessWoIds,
  };
}

export interface TripwireRunResult {
  exceptions: TripwireException[];
  /** Rules that threw (never silently dropped). */
  ruleErrors: { tripwire: TripwireNumber; error: string }[];
  ranAt: string;
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

  return { exceptions, ruleErrors, ranAt: snapshot.now.toISOString() };
}
