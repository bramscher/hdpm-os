/**
 * Work Orders — CRUD operations and bulk sync
 *
 * Stores AppFolio work orders in the `work_orders` table
 * for fast filtering and display in the dashboard.
 */

import { getSupabaseAdmin } from './supabase';
import type { AppFolioWorkOrder } from './appfolio';

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
 * Uses delete-then-insert strategy keyed on appfolio_id.
 *
 * @param orders - Work orders fetched from AppFolio
 * @param propertyMap - Map of AppFolio propertyId → { name, address }
 * @returns Number of rows inserted
 */
export async function bulkUpsertWorkOrders(
  orders: AppFolioWorkOrder[],
  propertyMap: Map<string, { name: string; address: string }>
): Promise<number> {
  if (orders.length === 0) return 0;

  const supabase = getSupabaseAdmin();

  // Build rows to insert
  const rows = orders.map((wo) => {
    const prop = wo.propertyId ? propertyMap.get(wo.propertyId) : null;
    return {
      appfolio_id: wo.appfolioId,
      property_id: wo.propertyId,
      property_name: prop?.name || 'Unknown Property',
      property_address: prop?.address || null,
      unit_id: wo.unitId,
      wo_number: wo.woNumber,
      description: wo.description || 'No description',
      status: wo.status,
      appfolio_status: wo.appfolioStatus,
      priority: wo.priority,
      assigned_to: wo.assignedTo,
      vendor_id: wo.vendorId,
      vendor_name: wo.vendorName,
      scheduled_start: wo.scheduledStart,
      scheduled_end: wo.scheduledEnd,
      completed_date: wo.completedDate,
      canceled_date: wo.canceledDate,
      permission_to_enter: wo.permissionToEnter,
      synced_at: new Date().toISOString(),
    };
  });

  // Delete all existing synced work orders, then insert fresh
  const appfolioIds = rows.map((r) => r.appfolio_id);

  // Batch delete in chunks of 500 to avoid query size limits
  for (let i = 0; i < appfolioIds.length; i += 500) {
    const batch = appfolioIds.slice(i, i + 500);
    const { error: delError } = await supabase
      .from('work_orders')
      .delete()
      .in('appfolio_id', batch);

    if (delError) {
      console.error('Error deleting work orders batch:', delError);
    }
  }

  // Insert in chunks of 500
  let insertedCount = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error: insError } = await supabase
      .from('work_orders')
      .insert(batch);

    if (insError) {
      console.error('Error inserting work orders batch:', insError);
      throw new Error(`Failed to insert work orders: ${insError.message}`);
    }
    insertedCount += batch.length;
  }

  return insertedCount;
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
 * If the work order exists (by appfolio_id), update it.
 * If not, insert a new row.
 */
export async function upsertSingleWorkOrder(
  order: AppFolioWorkOrder,
  propertyName: string,
  propertyAddress: string | null
): Promise<void> {
  const supabase = getSupabaseAdmin();

  const row = {
    appfolio_id: order.appfolioId,
    property_id: order.propertyId,
    property_name: propertyName,
    property_address: propertyAddress,
    unit_id: order.unitId,
    wo_number: order.woNumber,
    description: order.description || 'No description',
    status: order.status,
    appfolio_status: order.appfolioStatus,
    priority: order.priority,
    assigned_to: order.assignedTo,
    vendor_id: order.vendorId,
    vendor_name: order.vendorName,
    scheduled_start: order.scheduledStart,
    scheduled_end: order.scheduledEnd,
    completed_date: order.completedDate,
    canceled_date: order.canceledDate,
    permission_to_enter: order.permissionToEnter,
    synced_at: new Date().toISOString(),
  };

  // Check if exists
  const existing = await getWorkOrderByAppfolioId(order.appfolioId);

  if (existing) {
    // Update
    const { error } = await supabase
      .from('work_orders')
      .update(row)
      .eq('id', existing.id);

    if (error) {
      console.error('[Webhook] Error updating work order:', error);
      throw new Error(`Failed to update work order: ${error.message}`);
    }
    console.log(`[Webhook] Updated work order ${order.appfolioId}`);
  } else {
    // Insert
    const { error } = await supabase
      .from('work_orders')
      .insert(row);

    if (error) {
      console.error('[Webhook] Error inserting work order:', error);
      throw new Error(`Failed to insert work order: ${error.message}`);
    }
    console.log(`[Webhook] Inserted new work order ${order.appfolioId}`);
  }
}
