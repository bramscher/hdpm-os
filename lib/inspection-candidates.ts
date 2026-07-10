/**
 * Inspection candidate pipeline — pure logic + Supabase persistence.
 *
 * Pulls AppFolio properties, units (LastInspectedDate), and tenants (active
 * residents, with move-in dates + contact email). Routine inspections run twice
 * a year — every 6 months — and the clock is anchored to the current tenant's
 * MOVE-IN date so it resets for every new tenant. The next due date is
 *   max(move_in, last_inspection) + 6 months.
 *
 * Each occupied unit is classified into one of:
 *   - skip_recent : recently inspected, not due for a while
 *   - defer       : occupied but not due yet (or vacant — no tenant to inspect)
 *   - eligible    : due within the scheduling horizon, or overdue
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
// Cadence: 6 months, anchored to move-in
// ============================================

/** Routine inspections run twice a year — every 6 months. */
export const INSPECTION_INTERVAL_MONTHS = 6;

/**
 * How far ahead of the due date a unit becomes "eligible" (i.e. ready to put on
 * a route). Wide enough to schedule and still give the tenant the required
 * advance notice before the route date.
 */
const DUE_HORIZON_DAYS = 45;

/** A just-inspected unit (within this window) is surfaced as skip_recent, not defer. */
const SKIP_RECENT_DAYS = 90;

export type CandidateStatus =
  | 'skip_recent'
  | 'defer'
  | 'eligible'
  | 'scheduled'
  | 'dismissed';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toISODate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function addMonths(d: Date, months: number): Date {
  const out = new Date(d);
  out.setMonth(out.getMonth() + months);
  return out;
}

/**
 * The date the 6-month clock counts from: the LATER of the current tenant's
 * move-in date and the last real inspection. Move-in resets the clock for every
 * new tenant; a genuine mid-lease inspection pushes the next one out.
 */
export function computeAnchorDate(
  moveInDate: string | null,
  lastInspectedDate: string | null
): string | null {
  const moveIn = parseDate(moveInDate);
  const inspected = parseDate(lastInspectedDate);
  if (moveIn && inspected) return toISODate(moveIn > inspected ? moveIn : inspected);
  if (moveIn) return toISODate(moveIn);
  if (inspected) return toISODate(inspected);
  return null;
}

/** Next inspection due date = anchor + 6 months (null when there is no anchor). */
export function computeInspectionDueDate(
  moveInDate: string | null,
  lastInspectedDate: string | null
): string | null {
  const anchor = computeAnchorDate(moveInDate, lastInspectedDate);
  if (!anchor) return null;
  return toISODate(addMonths(new Date(anchor), INSPECTION_INTERVAL_MONTHS));
}

export interface ClassifyInput {
  moveInDate: string | null;
  lastInspectedDate: string | null;
  hasActiveTenant: boolean;
  today: Date;
}

/**
 * Classify a unit for the inspection pipeline. Only occupied units are ever
 * eligible ("once a tenant is in"). Eligibility is driven by the move-in-anchored
 * due date, not raw inspection age.
 */
export function classifyCandidate({
  moveInDate,
  lastInspectedDate,
  hasActiveTenant,
  today,
}: ClassifyInput): 'skip_recent' | 'defer' | 'eligible' {
  // Vacant unit — no tenant to inspect around, hold until one moves in.
  if (!hasActiveTenant) return 'defer';

  const due = computeInspectionDueDate(moveInDate, lastInspectedDate);
  // Occupied but no anchor at all (no move-in, never inspected) — inspect now.
  if (!due) return 'eligible';

  const dueDays = Math.floor((new Date(due).getTime() - today.getTime()) / MS_PER_DAY);
  if (dueDays <= DUE_HORIZON_DAYS) return 'eligible'; // due soon or overdue

  // Not due yet. Flag freshly-inspected units distinctly from merely-deferred ones.
  const inspected = parseDate(lastInspectedDate);
  if (inspected) {
    const ageDays = Math.floor((today.getTime() - inspected.getTime()) / MS_PER_DAY);
    if (ageDays < SKIP_RECENT_DAYS) return 'skip_recent';
  }
  return 'defer';
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
  moveInDate: string | null;
  nextDueDate: string | null;
  residentNames: string[];
  residentName: string | null;
  tenantEmail: string | null;
  hasActiveTenant: boolean;
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

    // The clock starts on the most recent move-in among active tenants, so a new
    // tenant (or added occupant) resets it. Fall back to lease start when MoveInOn
    // is absent.
    const moveInDate = tenantsForUnit.reduce<string | null>((latest, t) => {
      const d = t.moveInOn || t.leaseStartDate;
      if (!d) return latest;
      return !latest || d > latest ? d : latest;
    }, null);

    // Prefer the primary tenant for the notice contact; otherwise the first with an email.
    const primary = tenantsForUnit.find((t) => t.isPrimary) ?? tenantsForUnit[0] ?? null;
    const withEmail = tenantsForUnit.find((t) => t.email);
    const contact = primary?.email ? primary : withEmail ?? primary;
    const residentName = contact
      ? `${contact.firstName} ${contact.lastName}`.trim() || null
      : residentNames[0] || null;
    const tenantEmail = contact?.email ?? withEmail?.email ?? null;

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
      moveInDate,
      nextDueDate: computeInspectionDueDate(moveInDate, u.lastInspectedDate),
      residentNames,
      residentName,
      tenantEmail,
      hasActiveTenant: tenantsForUnit.length > 0,
      classification: classifyCandidate({
        moveInDate,
        lastInspectedDate: u.lastInspectedDate,
        hasActiveTenant: tenantsForUnit.length > 0,
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
  last_inspection_date: string | null;
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
    .select('id, address_1, address_2, city, zip, appfolio_unit_id, candidate_status, last_inspection_date');

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

    // Our completions aren't written back to AppFolio, so its LastInspectedDate
    // can lag the local one — never regress the local date, and recompute the
    // cadence (classification + next due) from the effective (newest) date.
    const localInspected = match?.last_inspection_date ?? null;
    const usesLocalDate =
      !!localInspected && (!c.lastInspectedDate || localInspected > c.lastInspectedDate);
    const effectiveInspected = usesLocalDate ? localInspected : c.lastInspectedDate;
    const effectiveClassification = usesLocalDate
      ? classifyCandidate({
          moveInDate: c.moveInDate,
          lastInspectedDate: effectiveInspected,
          hasActiveTenant: c.hasActiveTenant,
          today: new Date(syncTimestamp),
        })
      : c.classification;
    const effectiveNextDue = usesLocalDate
      ? computeInspectionDueDate(c.moveInDate, effectiveInspected)
      : c.nextDueDate;

    // Preserve terminal statuses: 'scheduled' while a route is in flight
    // (completion flips it back via completeInspectionCascade), 'dismissed'
    // until manually restored — a sync must not resurrect dismissed units.
    const nextStatus =
      match?.candidate_status === 'scheduled' || match?.candidate_status === 'dismissed'
        ? match.candidate_status
        : effectiveClassification;

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
      last_inspection_date: effectiveInspected,
      move_in_date: c.moveInDate,
      next_due_date: effectiveNextDue,
      resident_name: c.residentName,
      tenant_email: c.tenantEmail,
      candidate_status: nextStatus,
      local_skip_reason:
        effectiveClassification === 'skip_recent'
          ? `Inspected within ${SKIP_RECENT_DAYS} days (${effectiveInspected})`
          : !c.hasActiveTenant
            ? 'Vacant — no active tenant'
            : null,
      local_skip_set_at:
        effectiveClassification === 'skip_recent' ? syncTimestamp : null,
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
