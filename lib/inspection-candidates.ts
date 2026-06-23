/**
 * Inspection candidate pipeline — pure logic + Supabase persistence.
 *
 * Pulls AppFolio properties (with the "Use Custom Inspection Date" custom field),
 * units (LastInspectedDate), and tenants (active residents) and classifies each
 * unit into one of:
 *   - skip_recent  : last inspection < 90 days ago
 *   - defer        : last inspection 90 days – 6 months ago
 *   - eligible     : last inspection > 6 months ago, or never
 *
 * Eligible candidates get scheduled into proximity-grouped daily routes by the
 * existing route-engine. "Skip" is local-only — we never write back to AppFolio.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fetchAppFolioPropertiesWithCustomFields,
  fetchAppFolioUnits,
  fetchAppFolioTenants,
  type AppFolioPropertyWithCustomFields,
  type AppFolioUnit,
  type AppFolioTenant,
} from '@/lib/appfolio';

// ============================================
// Classification windows
// ============================================

const SKIP_RECENT_DAYS = 90;
const DEFER_DAYS = 182; // ~6 months

export type CandidateStatus =
  | 'skip_recent'
  | 'defer'
  | 'eligible'
  | 'scheduled'
  | 'dismissed';

export interface ClassifyInput {
  lastInspectedDate: string | null;
  today: Date;
}

export function classifyCandidate({
  lastInspectedDate,
  today,
}: ClassifyInput): 'skip_recent' | 'defer' | 'eligible' {
  if (!lastInspectedDate) return 'eligible';
  const inspected = new Date(lastInspectedDate);
  if (Number.isNaN(inspected.getTime())) return 'eligible';

  const ageMs = today.getTime() - inspected.getTime();
  const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));

  if (ageDays < SKIP_RECENT_DAYS) return 'skip_recent';
  if (ageDays < DEFER_DAYS) return 'defer';
  return 'eligible';
}

// ============================================
// Region derivation from city
// ============================================

const REGION_MAP: Record<string, string> = {
  bend: 'Bend',
  redmond: 'Redmond',
  sisters: 'Sisters',
  prineville: 'Prineville',
  'la pine': 'La Pine',
  madras: 'Madras',
  sunriver: 'Sunriver',
  tumalo: 'Tumalo',
  terrebonne: 'Terrebonne',
  'powell butte': 'Powell Butte',
  'crooked river ranch': 'Crooked River Ranch',
  metolius: 'Metolius',
  culver: 'Culver',
};

function deriveRegion(city: string | null): string | null {
  if (!city) return null;
  return REGION_MAP[city.trim().toLowerCase()] || null;
}

// ============================================
// Join properties + units + tenants
// ============================================

export interface JoinedCandidateRecord {
  appfolioPropertyId: string;
  appfolioUnitId: string;
  propertyName: string | null;
  unitName: string | null;
  ownerName: string | null;
  useCustomInspectionDate: boolean;
  address1: string;
  address2: string | null;
  city: string;
  state: string;
  zip: string;
  lastInspectedDate: string | null;
  residentNames: string[];
  classification: 'skip_recent' | 'defer' | 'eligible';
}

export function joinPropertiesUnitsTenants(
  properties: AppFolioPropertyWithCustomFields[],
  units: AppFolioUnit[],
  tenants: AppFolioTenant[],
  today: Date
): JoinedCandidateRecord[] {
  const propsById = new Map(properties.map((p) => [p.appfolioPropertyId, p]));

  // Active tenants keyed by unitId
  const tenantsByUnit = new Map<string, AppFolioTenant[]>();
  for (const t of tenants) {
    if (t.moveOutOn) continue;
    if (t.status && t.status.toLowerCase() !== 'current') continue;
    if (!t.unitId) continue;
    if (!tenantsByUnit.has(t.unitId)) tenantsByUnit.set(t.unitId, []);
    tenantsByUnit.get(t.unitId)!.push(t);
  }

  const records: JoinedCandidateRecord[] = [];

  for (const u of units) {
    if (!u.propertyId) continue;
    const prop = propsById.get(u.propertyId);
    if (!prop) continue;
    if (prop.hidden) continue;
    // Classify every active unit off LastInspectedDate (the v0 API's reliable
    // signal). We intentionally do NOT gate on "Use Custom Inspection Date":
    // that flag is `unit[use_last_inspection_on]`, a web-app form field the v0
    // Database API does not expose, so prop.useCustomInspectionDate is ALWAYS
    // false. Gating on it skipped every unit and produced zero candidates.
    // The custom-date caveat (LastInspectedDate goes stale when the box is
    // checked) is reconciled separately by the web-app audit + CSV cross-check.

    const address1 = u.address1 || prop.address1;
    const city = u.city || prop.city;
    const zip = u.zip || prop.zip;
    if (!address1 || !city || !zip) continue;

    const tenantsForUnit = tenantsByUnit.get(u.id) || [];
    const residentNames = tenantsForUnit
      .map((t) => `${t.firstName} ${t.lastName}`.trim())
      .filter((s) => s.length > 0);

    records.push({
      appfolioPropertyId: prop.appfolioPropertyId,
      appfolioUnitId: u.id,
      propertyName: prop.name,
      unitName: u.name,
      ownerName: prop.ownerName,
      useCustomInspectionDate: prop.useCustomInspectionDate,
      address1,
      address2: u.address2 || prop.address2,
      city,
      state: u.state || prop.state || 'OR',
      zip,
      lastInspectedDate: u.lastInspectedDate,
      residentNames,
      classification: classifyCandidate({
        lastInspectedDate: u.lastInspectedDate,
        today,
      }),
    });
  }

  return records;
}

// ============================================
// Persist to inspection_properties (upsert per unit)
// ============================================

export interface CandidateSyncCounts {
  checked: number;
  skip_recent: number;
  defer: number;
  eligible: number;
  inserted: number;
  updated: number;
  geocode_pending: number;
  unknown_custom_field_names: string[];
}

interface InspectionPropertyRow {
  id: string;
  address_1: string;
  address_2: string | null;
  city: string;
  zip: string;
  appfolio_unit_id: string | null;
  candidate_status: string | null;
}

function normalizeAddrKey(r: { address_1: string; address_2: string | null; city: string; zip: string }): string {
  return [r.address_1.trim().toLowerCase(), (r.address_2 || '').trim().toLowerCase(), r.city.trim().toLowerCase(), r.zip.trim()].join('|');
}

export async function persistCandidates(
  supabase: SupabaseClient,
  candidates: JoinedCandidateRecord[],
  syncTimestamp: string
): Promise<{ inserted: number; updated: number; geocode_pending: number }> {
  // Load existing rows once for matching: by appfolio_unit_id and by normalized address
  const { data: existing, error: loadErr } = await supabase
    .from('inspection_properties')
    .select('id, address_1, address_2, city, zip, appfolio_unit_id, candidate_status');

  if (loadErr) {
    throw new Error(`Failed to load inspection_properties: ${loadErr.message}`);
  }

  const byUnit = new Map<string, InspectionPropertyRow>();
  const byAddr = new Map<string, InspectionPropertyRow>();
  for (const row of (existing || []) as InspectionPropertyRow[]) {
    if (row.appfolio_unit_id) byUnit.set(row.appfolio_unit_id, row);
    byAddr.set(normalizeAddrKey(row), row);
  }

  let inserted = 0;
  let updated = 0;
  let geocodePending = 0;

  for (const c of candidates) {
    const region = deriveRegion(c.city);
    const matchByUnit = byUnit.get(c.appfolioUnitId);
    const matchByAddr = matchByUnit
      ? undefined
      : byAddr.get(normalizeAddrKey({ address_1: c.address1, address_2: c.address2, city: c.city, zip: c.zip }));
    const match = matchByUnit || matchByAddr;

    // Preserve a 'scheduled' status — don't downgrade to skip_recent / defer / eligible
    // while a route is in flight. The schedule action flips back when complete.
    const nextStatus = match?.candidate_status === 'scheduled'
      ? 'scheduled'
      : c.classification;

    const baseFields = {
      appfolio_property_id: c.appfolioPropertyId,
      appfolio_unit_id: c.appfolioUnitId,
      name: c.propertyName,
      address_1: c.address1,
      address_2: c.address2,
      city: c.city,
      state: c.state,
      zip: c.zip,
      region,
      owner_name: c.ownerName,
      // Honest value: false until the web-app audit populates the real
      // unit[use_last_inspection_on] state. Was hardcoded `true` (misleading).
      uses_custom_inspection_date: c.useCustomInspectionDate,
      last_inspection_date: c.lastInspectedDate,
      candidate_status: nextStatus,
      local_skip_reason:
        c.classification === 'skip_recent'
          ? `Inspected within ${SKIP_RECENT_DAYS} days (${c.lastInspectedDate})`
          : null,
      local_skip_set_at:
        c.classification === 'skip_recent' ? syncTimestamp : null,
      last_appfolio_sync_at: syncTimestamp,
    };

    if (match) {
      const { error: updErr } = await supabase
        .from('inspection_properties')
        .update(baseFields)
        .eq('id', match.id);
      if (updErr) {
        console.error('[candidates] update failed:', updErr.message, c.appfolioUnitId);
        continue;
      }
      updated++;
    } else {
      const { error: insErr } = await supabase
        .from('inspection_properties')
        .insert({
          ...baseFields,
          geocode_status: 'pending',
          active: true,
        });
      if (insErr) {
        console.error('[candidates] insert failed:', insErr.message, c.appfolioUnitId);
        continue;
      }
      inserted++;
      geocodePending++;
    }
  }

  return { inserted, updated, geocode_pending: geocodePending };
}

// ============================================
// Orchestrator: full sync from AppFolio
// ============================================

export interface RunCandidateSyncOptions {
  dryRun?: boolean;
  today?: Date;
}

export interface RunCandidateSyncResult extends CandidateSyncCounts {
  dryRun: boolean;
  durationMs: number;
}

export async function runCandidateSync(
  supabase: SupabaseClient,
  options: RunCandidateSyncOptions = {}
): Promise<RunCandidateSyncResult> {
  const started = Date.now();
  const today = options.today ?? new Date();
  const dryRun = Boolean(options.dryRun);
  const syncTimestamp = new Date().toISOString();

  const [properties, units, tenants] = await Promise.all([
    fetchAppFolioPropertiesWithCustomFields(),
    fetchAppFolioUnits(),
    fetchAppFolioTenants(),
  ]);

  const joined = joinPropertiesUnitsTenants(properties, units, tenants, today);

  // Surface any unknown custom-field names so we can adjust matching without a redeploy.
  const observedNames = new Set<string>();
  for (const p of properties) {
    for (const n of p.customValueNames) observedNames.add(n);
  }
  const knownNames = new Set([
    'Use Custom Inspection Date',
    'Custom Inspection Date',
    'Use Custom Inspection Schedule',
    'Owner Name',
    'Owner',
    'Property Owner',
    'Accounting Management Fee',
    'Annual Accounting Fee',
  ]);
  const unknownCustomFieldNames = [...observedNames].filter((n) => !knownNames.has(n));

  const counts = {
    checked: joined.length,
    skip_recent: joined.filter((c) => c.classification === 'skip_recent').length,
    defer: joined.filter((c) => c.classification === 'defer').length,
    eligible: joined.filter((c) => c.classification === 'eligible').length,
    inserted: 0,
    updated: 0,
    geocode_pending: 0,
    unknown_custom_field_names: unknownCustomFieldNames,
  };

  if (!dryRun) {
    const persisted = await persistCandidates(supabase, joined, syncTimestamp);
    counts.inserted = persisted.inserted;
    counts.updated = persisted.updated;
    counts.geocode_pending = persisted.geocode_pending;
  }

  return {
    ...counts,
    dryRun,
    durationMs: Date.now() - started,
  };
}
