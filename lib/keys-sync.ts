/**
 * Key Manager — AppFolio sync.
 *
 * Refreshes the sync-owned snapshot columns on ACTIVE, LINKED key assignments
 * (property name, address, owner, tenant names, occupancy) from the AppFolio
 * API. Never touches app-owned state: slot status, assigned dates, key types,
 * copies, or notes. Occupancy disagreements are surfaced as sync_flag values
 * for staff to resolve; a flag CHANGE is logged as a key_event (flag spam is
 * not re-logged every run).
 */

import {
  fetchAppFolioPropertiesWithCustomFields,
  fetchAppFolioUnits,
  fetchAppFolioTenants,
  type AppFolioPropertyWithCustomFields,
  type AppFolioTenant,
  type AppFolioUnit,
} from '@/lib/appfolio';
import { getSupabaseAdmin } from '@/lib/supabase';
import type { KeySlotStatus, KeySyncFlag } from '@/types/keys';

const SYNC_ACTOR = 'system:key-sync';

// ============================================
// Pure snapshot/flag logic (unit tested)
// ============================================

export interface UnitSnapshot {
  appfolioUnitId: string;
  appfolioPropertyId: string | null;
  propertyName: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  ownerName: string | null;
  tenantNames: string[];
  occupied: boolean;
}

export function buildUnitSnapshotMap(
  properties: AppFolioPropertyWithCustomFields[],
  units: AppFolioUnit[],
  tenants: AppFolioTenant[]
): Map<string, UnitSnapshot> {
  const propsById = new Map(properties.map((p) => [p.appfolioPropertyId, p]));

  // Active tenants keyed by unitId (same rules as the inspection pipeline).
  const tenantsByUnit = new Map<string, AppFolioTenant[]>();
  for (const t of tenants) {
    if (t.moveOutOn) continue;
    if (t.status && t.status.toLowerCase() !== 'current') continue;
    if (!t.unitId) continue;
    if (!tenantsByUnit.has(t.unitId)) tenantsByUnit.set(t.unitId, []);
    tenantsByUnit.get(t.unitId)!.push(t);
  }

  const map = new Map<string, UnitSnapshot>();
  for (const u of units) {
    const prop = u.propertyId ? propsById.get(u.propertyId) : undefined;
    if (prop?.hidden) continue;
    const tenantsForUnit = tenantsByUnit.get(u.id) || [];
    map.set(u.id, {
      appfolioUnitId: u.id,
      appfolioPropertyId: u.propertyId,
      propertyName: prop?.name ?? null,
      address1: u.address1 || prop?.address1 || null,
      address2: u.address2 || prop?.address2 || null,
      city: u.city || prop?.city || null,
      state: u.state || prop?.state || null,
      zip: u.zip || prop?.zip || null,
      ownerName: prop?.ownerName ?? null,
      tenantNames: tenantsForUnit
        .map((t) => `${t.firstName} ${t.lastName}`.trim())
        .filter((s) => s.length > 0),
      occupied: tenantsForUnit.length > 0,
    });
  }
  return map;
}

export function computeSyncFlag(
  slotStatus: KeySlotStatus,
  snapshot: UnitSnapshot | undefined
): KeySyncFlag | null {
  if (!snapshot) return 'unit_missing';
  if (snapshot.occupied && slotStatus === 'vacant') return 'appfolio_occupied_but_key_vacant';
  if (!snapshot.occupied && slotStatus === 'assigned') return 'appfolio_vacant_but_key_assigned';
  return null;
}

// ============================================
// Sync runner
// ============================================

export interface KeySyncResult {
  scanned: number;
  updated: number;
  flagged: number;
  durationMs: number;
}

interface ActiveLinkedAssignment {
  id: string;
  key_slot_id: string;
  appfolio_unit_id: string;
  sync_flag: KeySyncFlag | null;
  key_slot: { status: KeySlotStatus } | { status: KeySlotStatus }[];
}

function slotStatusOf(row: ActiveLinkedAssignment): KeySlotStatus {
  return Array.isArray(row.key_slot) ? row.key_slot[0].status : row.key_slot.status;
}

export async function syncKeyAssignments(): Promise<KeySyncResult> {
  const started = Date.now();
  const supabase = getSupabaseAdmin();
  const syncTimestamp = new Date().toISOString();

  const [properties, units, tenants] = await Promise.all([
    fetchAppFolioPropertiesWithCustomFields(),
    fetchAppFolioUnits(),
    fetchAppFolioTenants(),
  ]);
  const snapshots = buildUnitSnapshotMap(properties, units, tenants);

  const { data: assignments, error } = await supabase
    .from('key_assignment')
    .select('id, key_slot_id, appfolio_unit_id, sync_flag, key_slot(status)')
    .is('released_at', null)
    .not('appfolio_unit_id', 'is', null);
  if (error) throw new Error(`Failed to load active assignments: ${error.message}`);

  let updated = 0;
  let flagged = 0;

  for (const a of (assignments || []) as unknown as ActiveLinkedAssignment[]) {
    const snapshot = snapshots.get(a.appfolio_unit_id);
    const flag = computeSyncFlag(slotStatusOf(a), snapshot);
    if (flag) flagged++;

    const fields: Record<string, unknown> = {
      sync_flag: flag,
      last_synced_at: syncTimestamp,
    };
    if (snapshot) {
      fields.appfolio_property_id = snapshot.appfolioPropertyId;
      fields.property_name = snapshot.propertyName;
      fields.address_1 = snapshot.address1;
      fields.address_2 = snapshot.address2;
      fields.city = snapshot.city;
      fields.state = snapshot.state;
      fields.zip = snapshot.zip;
      fields.owner_name = snapshot.ownerName;
      fields.tenant_names = snapshot.tenantNames;
      fields.unit_occupied = snapshot.occupied;
    }

    const { error: updErr } = await supabase
      .from('key_assignment')
      .update(fields)
      .eq('id', a.id);
    if (updErr) {
      console.error('[keys-sync] update failed:', updErr.message, a.id);
      continue;
    }
    updated++;

    // Log only flag CHANGES so daily runs don't spam the history.
    if (flag !== a.sync_flag) {
      await supabase.from('key_event').insert({
        key_slot_id: a.key_slot_id,
        assignment_id: a.id,
        event_type: 'sync_flag',
        payload: { flag, previous_flag: a.sync_flag },
        actor: SYNC_ACTOR,
      });
    }
  }

  return {
    scanned: (assignments || []).length,
    updated,
    flagged,
    durationMs: Date.now() - started,
  };
}
