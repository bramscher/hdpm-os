/**
 * Work Orders — CRUD operations and bulk sync
 *
 * Stores AppFolio work orders in the `work_orders` table
 * for fast filtering and display in the dashboard.
 */

import { getSupabaseAdmin } from './supabase';
import type { AppFolioWorkOrder } from './appfolio';
import {
  buildMirrorRow,
  initialWorkflowFor,
  stageAutomationFor,
} from './maintenance/sync-rules';
import { recordEvents, type NewEvent } from './maintenance/events';
import { updateWorkOrderWorkflow } from './maintenance/workflow-db';
import type { Stage } from './maintenance/types';

// ============================================
// Types
// ============================================

export interface WorkOrder {
  id: string;
  appfolio_id: string;
  property_id: string | null;
  property_name: string;
  property_address: string | null;
  unit_id: string | null;
  unit_name: string | null;
  wo_number: string | null;
  description: string;
  category: string | null;
  priority: string | null;
  status: 'open' | 'closed' | 'done';
  appfolio_status: string | null;
  assigned_to: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  completed_date: string | null;
  canceled_date: string | null;
  permission_to_enter: boolean;
  synced_at: string;
  created_at: string;
  updated_at: string;

  // ── Maintenance OS workflow columns (20260702_maintenance_os.sql) ──
  // Owned by this app, never written by the AppFolio mirror sync.
  // `stage` is our workflow source of truth; `status`/`appfolio_status`
  // remain the AppFolio mirror. See lib/maintenance/types.ts for enums.
  stage: string;
  waiting_reason: string | null;
  owner_name: string;
  next_action_date: string | null;
  priority_class: string | null;
  assigned_tech: string | null;
  origin: string;
  is_turn: boolean;
  verified_by: string | null;
  verified_at: string | null;
  tenant_ping_sent: boolean;
  tenant_ping_sent_at: string | null;
  preventive_scheduled: boolean | null;
  closed_at: string | null;
  aging_reason: string | null;
}

export interface WorkOrderFilter {
  status?: ('open' | 'closed' | 'done')[];
  appfolio_status?: string[];
  priority?: string[];
  vendor_id?: string;
  search?: string;
  date_from?: string;
  date_to?: string;
}

export interface WorkOrderStats {
  total: number;
  open: number;
  closed: number;
  done: number;
}

// ============================================
// Read
// ============================================

export async function getWorkOrders(
  filter?: WorkOrderFilter,
  limit = 200,
  offset = 0
): Promise<WorkOrder[]> {
  const supabase = getSupabaseAdmin();

  let query = supabase
    .from('work_orders')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (filter?.status?.length) {
    query = query.in('status', filter.status);
  }

  if (filter?.appfolio_status?.length) {
    query = query.in('appfolio_status', filter.appfolio_status);
  }

  if (filter?.priority?.length) {
    query = query.in('priority', filter.priority);
  }

  if (filter?.vendor_id) {
    query = query.eq('vendor_id', filter.vendor_id);
  }

  if (filter?.search) {
    query = query.or(
      `property_name.ilike.%${filter.search}%,property_address.ilike.%${filter.search}%,description.ilike.%${filter.search}%,wo_number.ilike.%${filter.search}%`
    );
  }

  if (filter?.date_from) {
    query = query.gte('created_at', filter.date_from);
  }

  if (filter?.date_to) {
    query = query.lte('created_at', filter.date_to);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching work orders:', error);
    throw new Error(`Failed to fetch work orders: ${error.message}`);
  }

  return data as WorkOrder[];
}

export async function getWorkOrderById(id: string): Promise<WorkOrder | null> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('work_orders')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // Not found
    console.error('Error fetching work order:', error);
    throw new Error(`Failed to fetch work order: ${error.message}`);
  }

  return data as WorkOrder;
}

// ============================================
// Stats
// ============================================

export async function getWorkOrderStats(
  filter?: WorkOrderFilter
): Promise<WorkOrderStats> {
  const supabase = getSupabaseAdmin();

  let query = supabase
    .from('work_orders')
    .select('status, appfolio_status');

  if (filter?.appfolio_status?.length) {
    query = query.in('appfolio_status', filter.appfolio_status);
  }

  if (filter?.vendor_id) {
    query = query.eq('vendor_id', filter.vendor_id);
  }

  if (filter?.search) {
    query = query.or(
      `property_name.ilike.%${filter.search}%,property_address.ilike.%${filter.search}%,description.ilike.%${filter.search}%,wo_number.ilike.%${filter.search}%`
    );
  }

  if (filter?.date_from) {
    query = query.gte('created_at', filter.date_from);
  }

  if (filter?.date_to) {
    query = query.lte('created_at', filter.date_to);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching work order stats:', error);
    throw new Error(`Failed to fetch work order stats: ${error.message}`);
  }

  const rows = data || [];
  return {
    total: rows.length,
    open: rows.filter((r) => r.status === 'open').length,
    closed: rows.filter((r) => r.status === 'closed').length,
    done: rows.filter((r) => r.status === 'done').length,
  };
}

// ============================================
// Bulk Upsert (for AppFolio Sync)
// ============================================

/**
 * Sync work orders from AppFolio into the work_orders table.
 *
 * Maintenance OS contract: the sync owns ONLY the AppFolio mirror columns
 * (see buildMirrorRow). Workflow columns (stage, owner_name, next_action_date,
 * …) are owned by this app and are never written on existing rows — row ids
 * are stable, so FKs (hdms_invoices, wo_event, turn, …) survive every sync.
 *
 *  - New appfolio_ids  → insert mirror + initial workflow defaults + `created` event
 *  - Existing          → upsert mirror columns only (onConflict: appfolio_id)
 *  - Stage automation  → canceled → CLOSED; completed → VERIFY (never further)
 *
 * @param orders - Work orders fetched from AppFolio
 * @param propertyMap - Map of AppFolio propertyId → { name, address }
 * @returns Number of rows written (inserted + updated)
 */
export async function bulkUpsertWorkOrders(
  orders: AppFolioWorkOrder[],
  propertyMap: Map<string, { name: string; address: string }>
): Promise<number> {
  if (orders.length === 0) return 0;

  const supabase = getSupabaseAdmin();
  const now = new Date();

  // 1. Which of these already exist? (id + stage for automation)
  const appfolioIds = orders.map((o) => o.appfolioId);
  const existing = new Map<string, { id: string; stage: Stage }>();
  for (let i = 0; i < appfolioIds.length; i += 500) {
    const batch = appfolioIds.slice(i, i + 500);
    const { data, error } = await supabase
      .from('work_orders')
      .select('id, appfolio_id, stage')
      .in('appfolio_id', batch);
    if (error) {
      throw new Error(`Failed to look up existing work orders: ${error.message}`);
    }
    for (const row of data ?? []) {
      existing.set(row.appfolio_id, { id: row.id, stage: row.stage as Stage });
    }
  }

  const mirrorRowFor = (wo: AppFolioWorkOrder) =>
    buildMirrorRow(wo, wo.propertyId ? propertyMap.get(wo.propertyId) : null, now);

  // 2. Insert brand-new WOs with workflow defaults + `created` events
  const newOrders = orders.filter((o) => !existing.has(o.appfolioId));
  let writtenCount = 0;
  for (let i = 0; i < newOrders.length; i += 500) {
    const batch = newOrders.slice(i, i + 500);
    const rows = batch.map((wo) => ({ ...mirrorRowFor(wo), ...initialWorkflowFor(wo, now) }));
    const { data: inserted, error: insError } = await supabase
      .from('work_orders')
      .insert(rows)
      .select('id, appfolio_id');

    if (insError) {
      console.error('Error inserting work orders batch:', insError);
      throw new Error(`Failed to insert work orders: ${insError.message}`);
    }
    writtenCount += batch.length;

    const events: NewEvent[] = (inserted ?? []).map((row) => ({
      work_order_id: row.id,
      event_type: 'created',
      payload: { appfolio_id: row.appfolio_id, source: 'sync' },
      actor: 'system:sync',
    }));
    await recordEvents(events);
  }

  // 3. Update existing WOs — mirror columns ONLY, workflow untouched
  const existingOrders = orders.filter((o) => existing.has(o.appfolioId));
  for (let i = 0; i < existingOrders.length; i += 500) {
    const batch = existingOrders.slice(i, i + 500);
    const rows = batch.map(mirrorRowFor);
    const { error: upError } = await supabase
      .from('work_orders')
      .upsert(rows, { onConflict: 'appfolio_id' });

    if (upError) {
      console.error('Error updating work orders batch:', upError);
      throw new Error(`Failed to update work orders: ${upError.message}`);
    }
    writtenCount += batch.length;
  }

  // 4. Sync-driven stage automation (cancel → CLOSED, completed → VERIFY,
  //    early-stage catch-up to AppFolio's own status)
  for (const wo of existingOrders) {
    const row = existing.get(wo.appfolioId)!;
    const auto = stageAutomationFor(row.stage, wo, now);
    if (!auto) continue;
    try {
      await updateWorkOrderWorkflow(
        row.id,
        {
          stage: auto.stage,
          ...(auto.closed_at ? { closed_at: auto.closed_at } : {}),
          ...(auto.waiting_reason ? { waiting_reason: auto.waiting_reason } : {}),
        },
        'system:sync',
        { systemOverride: true }
      );
    } catch (err) {
      console.error(
        `[Sync] Stage automation failed for ${wo.appfolioId} (${auto.reason}):`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return writtenCount;
}

// ============================================
// Lookup by AppFolio ID (for webhook handler)
// ============================================

export async function getWorkOrderByAppfolioId(
  appfolioId: string
): Promise<WorkOrder | null> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('work_orders')
    .select('*')
    .eq('appfolio_id', appfolioId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // Not found
    console.error('Error looking up work order by appfolio_id:', error);
    return null;
  }

  return data as WorkOrder;
}

// ============================================
// Single Upsert (for webhook real-time updates)
// ============================================

/**
 * Upsert a single work order from a webhook notification.
 * Same contract as bulkUpsertWorkOrders: mirror columns only on update,
 * workflow defaults + `created` event on insert, then stage automation.
 */
export async function upsertSingleWorkOrder(
  order: AppFolioWorkOrder,
  propertyName: string,
  propertyAddress: string | null
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const now = new Date();

  const row = buildMirrorRow(
    order,
    { name: propertyName, address: propertyAddress },
    now
  );

  // Check if exists
  const existing = await getWorkOrderByAppfolioId(order.appfolioId);

  if (existing) {
    // Update mirror columns only — workflow fields untouched
    const { error } = await supabase
      .from('work_orders')
      .update(row)
      .eq('id', existing.id);

    if (error) {
      console.error('[Webhook] Error updating work order:', error);
      throw new Error(`Failed to update work order: ${error.message}`);
    }
    console.log(`[Webhook] Updated work order ${order.appfolioId}`);

    // Stage automation (cancel → CLOSED, completed → VERIFY, early catch-up)
    const auto = stageAutomationFor(existing.stage as Stage, order, now);
    if (auto) {
      try {
        await updateWorkOrderWorkflow(
          existing.id,
          {
            stage: auto.stage,
            ...(auto.closed_at ? { closed_at: auto.closed_at } : {}),
            ...(auto.waiting_reason ? { waiting_reason: auto.waiting_reason } : {}),
          },
          'system:sync',
          { systemOverride: true }
        );
      } catch (err) {
        console.error(
          `[Webhook] Stage automation failed for ${order.appfolioId} (${auto.reason}):`,
          err instanceof Error ? err.message : err
        );
      }
    }
  } else {
    // Insert with workflow defaults + `created` event
    const { data: inserted, error } = await supabase
      .from('work_orders')
      .insert({ ...row, ...initialWorkflowFor(order, now) })
      .select('id')
      .single();

    if (error) {
      console.error('[Webhook] Error inserting work order:', error);
      throw new Error(`Failed to insert work order: ${error.message}`);
    }
    if (inserted) {
      await recordEvents([
        {
          work_order_id: inserted.id,
          event_type: 'created',
          payload: { appfolio_id: order.appfolioId, source: 'webhook' },
          actor: 'system:sync',
        },
      ]);
    }
    console.log(`[Webhook] Inserted new work order ${order.appfolioId}`);
  }
}
