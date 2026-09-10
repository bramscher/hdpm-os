/**
 * AppFolio → Zoom Phone contact sync orchestrator.
 *
 * Pulls vendors / owners / tenants from AppFolio, normalizes phones to E.164,
 * and reconciles them against Zoom Phone external contacts. The local
 * `zoom_contact_map` table is the source of truth for which AppFolio contact
 * maps to which Zoom external_contact_id (Zoom's update API keys off its own id,
 * and searching Zoom by our id/phone is unreliable).
 *
 * First version is create + update only — contacts that disappear from AppFolio
 * are flagged inactive in the map (active=false) but NOT deleted from Zoom.
 *
 * Run history lands in `zoom_sync_runs` so the admin page can show "last synced".
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import {
  fetchAppFolioZoomContacts,
  type AppFolioContact,
  type ZoomContactType,
} from '@/lib/appfolio';
import { listEmergencyVendorAppfolioIds } from '@/lib/maintenance/vendors';
import {
  isZoomConfigured,
  listAllExternalContacts,
  createExternalContact,
  updateExternalContact,
} from '@/lib/zoom-phone';

export const ALL_CONTACT_TYPES: ZoomContactType[] = ['vendor', 'owner', 'tenant'];

// Cap writes per run so a single invocation stays within the serverless time
// budget and Zoom's rate limits. Remaining work rolls to the next run. Logged,
// never silent.
const MAX_WRITES_PER_RUN = 600;
const WRITE_DELAY_MS = 120;

// ============================================
// Phone normalization (E.164, US default)
// ============================================

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Drop extensions ("x123", "ext 4") before stripping.
  const noExt = raw.toLowerCase().split(/x|ext/)[0];
  let digits = noExt.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length === 10) return `+1${digits}`;
  // Already-international numbers that came in with a leading "+".
  if (raw.trim().startsWith('+')) {
    const full = raw.replace(/\D/g, '');
    if (full.length >= 11 && full.length <= 15) return `+${full}`;
  }
  return null;
}

// Shared / office lines that must never become an external contact: one number
// sits on many AppFolio records, so syncing it means Zoom duplicate-phone create
// errors plus last-writer name churn on the single contact Zoom keeps. Excluded
// here → treated as "no usable phone" everywhere, and the vanished-contact pass
// then deactivates any stale map rows that used to carry the number.
// +15415480383 = HDPM office line (was on TEST VENDOR / HDPM / HDMS).
export const EXCLUDED_PHONES = new Set<string>(['+15415480383']);

/** A normalized phone we're willing to push to Zoom (non-null, not a shared line). */
export function isSyncablePhone(phone: string | null): phone is string {
  return phone !== null && !EXCLUDED_PHONES.has(phone);
}

function descriptionFor(c: AppFolioContact): string {
  if (c.type === 'tenant') {
    return c.propertyAddress ? `Tenant — ${c.propertyAddress}` : 'Tenant';
  }
  return c.type === 'vendor' ? 'Vendor' : 'Owner';
}

// ============================================
// Phone-collision resolution
//
// Zoom Phone allows only one external contact per phone number. When two+
// desired contacts share a number, all but one would perpetually resolve to
// the same existing Zoom contact via the phone index and take the UPDATE
// branch forever — re-PATCHing it every run and burning the write cap on
// churn instead of ever reaching the never-synced tail. Collapse each
// phone's group down to a single primary before the write loop runs.
// ============================================

export interface DesiredContact {
  contact: AppFolioContact;
  phone: string;
}

export interface PhoneCollisionSkip extends DesiredContact {
  /** Human-readable reason, naming which contact the phone resolved to. */
  reason: string;
}

export interface PhonePrimariesResult {
  primaries: DesiredContact[];
  skipped: PhoneCollisionSkip[];
}

const CONTACT_TYPE_PRIORITY: Record<ZoomContactType, number> = {
  vendor: 0,
  owner: 1,
  tenant: 2,
};

function compareAppfolioIds(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Groups `desired` by normalized phone and, for any phone shared by more
 * than one contact, keeps exactly one primary: the incumbent already mapped
 * to that phone's Zoom contact if one exists, otherwise a deterministic
 * pick (type priority vendor > owner > tenant, then lowest appfolioId). All
 * other contacts on that phone are returned in `skipped` with a reason —
 * never silently dropped.
 */
export function resolvePhonePrimaries(
  desired: DesiredContact[],
  phoneIndex: Map<string, string>,
  mapByKey: Map<string, ContactMapRow>
): PhonePrimariesResult {
  const byPhone = new Map<string, DesiredContact[]>();
  for (const d of desired) {
    const group = byPhone.get(d.phone);
    if (group) group.push(d);
    else byPhone.set(d.phone, [d]);
  }

  const primaries: DesiredContact[] = [];
  const skipped: PhoneCollisionSkip[] = [];

  for (const group of byPhone.values()) {
    if (group.length === 1) {
      primaries.push(group[0]);
      continue;
    }

    const incumbentZoomId = phoneIndex.get(group[0].phone) || null;
    let primary = incumbentZoomId
      ? group.find((d) => {
          const row = mapByKey.get(`${d.contact.type}:${d.contact.appfolioId}`);
          return row?.zoom_external_contact_id === incumbentZoomId;
        })
      : undefined;

    if (!primary) {
      const sorted = [...group].sort((a, b) => {
        const pa = CONTACT_TYPE_PRIORITY[a.contact.type];
        const pb = CONTACT_TYPE_PRIORITY[b.contact.type];
        if (pa !== pb) return pa - pb;
        return compareAppfolioIds(a.contact.appfolioId, b.contact.appfolioId);
      });
      primary = sorted[0];
    }

    primaries.push(primary);
    for (const d of group) {
      if (d === primary) continue;
      skipped.push({
        ...d,
        reason: `phone ${d.phone} already resolves to "${primary.contact.name}" (${primary.contact.type} ${primary.contact.appfolioId}); Zoom allows only one contact per number`,
      });
    }
  }

  return { primaries, skipped };
}

/**
 * Orders desired contacts so never-synced contacts (no map row, or a row
 * with last_synced_at null) go first, then by ascending last_synced_at —
 * so the never-synced tail is reached even if the write cap is hit again
 * mid-run.
 */
export function orderByLastSyncedAscending(
  items: DesiredContact[],
  mapByKey: Map<string, ContactMapRow>
): DesiredContact[] {
  const lastSyncedTime = (item: DesiredContact): number => {
    const row = mapByKey.get(`${item.contact.type}:${item.contact.appfolioId}`);
    const t = row?.last_synced_at ? new Date(row.last_synced_at).getTime() : NaN;
    return Number.isFinite(t) ? t : -Infinity; // never-synced sorts first
  };
  return [...items].sort((a, b) => lastSyncedTime(a) - lastSyncedTime(b));
}

/**
 * Build a lookup from our custom contact id (hdpm-<type>-<appfolioId>, set on
 * create) to the Zoom external_contact_id, from a Zoom contact listing.
 */
export function buildCustomIdIndex(
  zoomContacts: { external_contact_id: string; id?: string }[]
): Map<string, string> {
  const idIndex = new Map<string, string>();
  for (const zc of zoomContacts) {
    if (zc.id && !idIndex.has(zc.id)) idIndex.set(zc.id, zc.external_contact_id);
  }
  return idIndex;
}

/**
 * Resolve which existing Zoom contact a desired contact maps to, if any.
 * Priority: our recorded mapping → adopt by phone → adopt by our custom id.
 * The custom-id fallback covers contacts that already exist in Zoom under
 * hdpm-<type>-<appfolioId> but have no phone Zoom can index — without it they
 * fail create forever with "ID already exists".
 */
export function resolveZoomId(
  existingZoomId: string | null | undefined,
  phone: string,
  customId: string,
  phoneIndex: Map<string, string>,
  idIndex: Map<string, string>
): string | null {
  return existingZoomId || phoneIndex.get(phone) || idIndex.get(customId) || null;
}

// ============================================
// DB types & helpers
// ============================================

export interface ContactMapRow {
  id: string;
  contact_type: ZoomContactType;
  appfolio_id: string;
  zoom_external_contact_id: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  description: string | null;
  active: boolean;
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface SyncRunRow {
  id: string;
  status: 'running' | 'completed' | 'failed';
  triggered_by: string | null;
  started_at: string;
  completed_at: string | null;
  total_source: number;
  with_phone: number;
  created_count: number;
  updated_count: number;
  skipped_count: number;
  failed_count: number;
  deactivated_count: number;
  error_message: string | null;
  details: Record<string, unknown> | null;
}

export async function getLastRun(): Promise<SyncRunRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('zoom_sync_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Failed to read last run: ${error.message}`);
  return (data as SyncRunRow) ?? null;
}

export async function getRecentRuns(limit = 10): Promise<SyncRunRow[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('zoom_sync_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to read runs: ${error.message}`);
  return (data as SyncRunRow[]) ?? [];
}

export interface ContactSummary {
  total: number;
  active: number;
  byType: Record<ZoomContactType, { active: number; total: number }>;
}

export async function getContactSummary(): Promise<ContactSummary> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('zoom_contact_map')
    .select('contact_type, active');
  if (error) throw new Error(`Failed to read contact map: ${error.message}`);

  const rows = (data as { contact_type: ZoomContactType; active: boolean }[]) ?? [];
  const byType = {
    vendor: { active: 0, total: 0 },
    owner: { active: 0, total: 0 },
    tenant: { active: 0, total: 0 },
  } as Record<ZoomContactType, { active: number; total: number }>;
  let active = 0;
  for (const r of rows) {
    byType[r.contact_type].total++;
    if (r.active) {
      byType[r.contact_type].active++;
      active++;
    }
  }
  return { total: rows.length, active, byType };
}

export interface ContactListResult {
  rows: ContactMapRow[];
  total: number;
}

export async function listContactMap(opts: {
  type?: ZoomContactType;
  search?: string;
  activeOnly?: boolean;
  limit: number;
  offset: number;
}): Promise<ContactListResult> {
  const supabase = getSupabaseAdmin();
  let q = supabase
    .from('zoom_contact_map')
    .select('*', { count: 'exact' })
    .order('name', { ascending: true });

  if (opts.type) q = q.eq('contact_type', opts.type);
  if (opts.activeOnly) q = q.eq('active', true);
  if (opts.search) {
    const s = opts.search.replace(/[%,]/g, ' ').trim();
    q = q.or(`name.ilike.%${s}%,phone.ilike.%${s}%,email.ilike.%${s}%`);
  }
  q = q.range(opts.offset, opts.offset + opts.limit - 1);

  const { data, error, count } = await q;
  if (error) throw new Error(`Failed to list contacts: ${error.message}`);
  return { rows: (data as ContactMapRow[]) ?? [], total: count ?? 0 };
}

// ============================================
// Dry run — read-only projection of what a sync WOULD do.
// Validates AppFolio phone coverage without any Zoom or DB writes.
// ============================================

export interface SyncPreview {
  dryRun: true;
  zoomConfigured: boolean;
  types: ZoomContactType[];
  totalSource: number;
  withPhone: number;
  withoutPhone: number;
  wouldCreate: number;
  wouldUpdate: number;
  wouldSkip: number;
  /** Contacts that share a phone with another desired contact and would be skipped (see resolvePhonePrimaries). */
  wouldSkipCollisions: number;
  byType: Record<ZoomContactType, { source: number; withPhone: number }>;
  samplesWithoutPhone: string[];
}

export async function previewZoomSync(opts: {
  types?: ZoomContactType[];
}): Promise<SyncPreview> {
  const types = opts.types?.length ? opts.types : ALL_CONTACT_TYPES;
  const supabase = getSupabaseAdmin();

  const emergencyVendorIds = await listEmergencyVendorAppfolioIds();
  const source = await fetchAppFolioZoomContacts(types, { emergencyVendorIds });
  const byType = {
    vendor: { source: 0, withPhone: 0 },
    owner: { source: 0, withPhone: 0 },
    tenant: { source: 0, withPhone: 0 },
  } as Record<ZoomContactType, { source: number; withPhone: number }>;

  const samplesWithoutPhone: string[] = [];
  const desired: { contact: AppFolioContact; phone: string }[] = [];
  for (const c of source) {
    byType[c.type].source++;
    const phone = normalizePhone(c.phoneRaw);
    if (isSyncablePhone(phone)) {
      byType[c.type].withPhone++;
      desired.push({ contact: c, phone });
    } else if (samplesWithoutPhone.length < 10) {
      samplesWithoutPhone.push(c.name);
    }
  }

  // Read-only: existing map + Zoom phone index, to project create vs update.
  const { data: mapData } = await supabase.from('zoom_contact_map').select('*');
  const mapRows = (mapData as ContactMapRow[]) ?? [];
  const mapByKey = new Map(mapRows.map((r) => [`${r.contact_type}:${r.appfolio_id}`, r]));

  let phoneIndex = new Map<string, string>();
  let idIndex = new Map<string, string>();
  if (isZoomConfigured()) {
    try {
      const zoomContacts = await listAllExternalContacts();
      for (const zc of zoomContacts) {
        for (const p of zc.phone_numbers || []) {
          const norm = normalizePhone(p);
          if (norm && !phoneIndex.has(norm)) phoneIndex.set(norm, zc.external_contact_id);
        }
      }
      idIndex = buildCustomIdIndex(zoomContacts);
    } catch {
      phoneIndex = new Map();
      idIndex = new Map();
    }
  }

  const { primaries, skipped: collisions } = resolvePhonePrimaries(desired, phoneIndex, mapByKey);

  let wouldCreate = 0;
  let wouldUpdate = 0;
  let wouldSkip = 0;
  for (const { contact, phone } of primaries) {
    const existing = mapByKey.get(`${contact.type}:${contact.appfolioId}`);
    const customId = `hdpm-${contact.type}-${contact.appfolioId}`;
    const zoomId = resolveZoomId(existing?.zoom_external_contact_id, phone, customId, phoneIndex, idIndex);
    if (!zoomId) {
      wouldCreate++;
    } else if (
      !existing ||
      existing.name !== contact.name ||
      existing.phone !== phone ||
      (existing.email || null) !== (contact.email || null)
    ) {
      wouldUpdate++;
    } else {
      wouldSkip++;
    }
  }

  return {
    dryRun: true,
    zoomConfigured: isZoomConfigured(),
    types,
    totalSource: source.length,
    withPhone: desired.length,
    withoutPhone: source.length - desired.length,
    wouldCreate,
    wouldUpdate,
    wouldSkip,
    wouldSkipCollisions: collisions.length,
    byType,
    samplesWithoutPhone,
  };
}

// ============================================
// The sync
// ============================================

export interface SyncResult {
  runId: string;
  status: 'completed' | 'failed';
  totalSource: number;
  withPhone: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  deactivated: number;
  writeCapHit: boolean;
  error?: string;
}

export async function runZoomSync(opts: {
  types?: ZoomContactType[];
  triggeredBy: string;
}): Promise<SyncResult> {
  const types = opts.types?.length ? opts.types : ALL_CONTACT_TYPES;
  const supabase = getSupabaseAdmin();

  // Open a run row immediately so a crash still leaves a record.
  const { data: runRow, error: runErr } = await supabase
    .from('zoom_sync_runs')
    .insert({ status: 'running', triggered_by: opts.triggeredBy })
    .select('id')
    .single();
  if (runErr) throw new Error(`Failed to create run: ${runErr.message}`);
  const runId = (runRow as { id: string }).id;

  const counts = {
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    deactivated: 0,
  };
  const sampleErrors: string[] = [];
  let writeCapHit = false;
  let withPhone = 0;
  let totalSource = 0;

  try {
    if (!isZoomConfigured()) {
      throw new Error('Zoom credentials not configured (ZOOM_ACCOUNT_ID / ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET)');
    }

    // 1. Source contacts from AppFolio (emergency vendors → 'EV - ' prefix).
    const emergencyVendorIds = await listEmergencyVendorAppfolioIds();
    const source = await fetchAppFolioZoomContacts(types, { emergencyVendorIds });
    totalSource = source.length;

    // 2. Normalize phones; keep only contacts with a usable, non-shared number.
    const desired = source
      .map((c) => ({ contact: c, phone: normalizePhone(c.phoneRaw) }))
      .filter((d): d is { contact: AppFolioContact; phone: string } => isSyncablePhone(d.phone));
    withPhone = desired.length;
    const desiredKeys = new Set(desired.map((d) => `${d.contact.type}:${d.contact.appfolioId}`));

    // 3. Existing local mapping.
    const { data: mapData, error: mapErr } = await supabase
      .from('zoom_contact_map')
      .select('*');
    if (mapErr) throw new Error(`Failed to load contact map: ${mapErr.message}`);
    const mapRows = (mapData as ContactMapRow[]) ?? [];
    const mapByKey = new Map(mapRows.map((r) => [`${r.contact_type}:${r.appfolio_id}`, r]));

    // 4. Existing Zoom contacts → phone + custom-id indexes for reconciliation
    //    (so we adopt rather than duplicate contacts already in Zoom). The
    //    custom-id index catches contacts that exist under our hdpm-<...> id but
    //    have no phone Zoom can match, which otherwise fail create forever.
    const zoomContacts = await listAllExternalContacts();
    const phoneIndex = new Map<string, string>();
    for (const zc of zoomContacts) {
      for (const p of zc.phone_numbers || []) {
        const norm = normalizePhone(p);
        if (norm && !phoneIndex.has(norm)) phoneIndex.set(norm, zc.external_contact_id);
      }
    }
    const idIndex = buildCustomIdIndex(zoomContacts);

    // 5. Collapse phone collisions to one primary per number (see
    //    resolvePhonePrimaries doc comment), then order never-synced /
    //    oldest-synced contacts first so the tail is reached even if the
    //    write cap is hit again this run.
    const { primaries, skipped: collisions } = resolvePhonePrimaries(desired, phoneIndex, mapByKey);
    counts.skipped += collisions.length;
    if (collisions.length) {
      console.warn(`[ZoomSync] Skipped ${collisions.length} contact(s) sharing a phone with an already-resolved contact.`);
    }
    const orderedPrimaries = orderByLastSyncedAscending(primaries, mapByKey);

    // 6. Create / update each desired contact.
    let writes = 0;
    for (const { contact, phone } of orderedPrimaries) {
      const key = `${contact.type}:${contact.appfolioId}`;
      const existing = mapByKey.get(key);
      const description = descriptionFor(contact);
      const customId = `hdpm-${contact.type}-${contact.appfolioId}`;

      let zoomId = resolveZoomId(existing?.zoom_external_contact_id, phone, customId, phoneIndex, idIndex);
      const changed =
        !existing ||
        existing.name !== contact.name ||
        existing.phone !== phone ||
        (existing.email || null) !== (contact.email || null);

      try {
        if (!zoomId) {
          if (writes >= MAX_WRITES_PER_RUN) {
            writeCapHit = true;
            counts.skipped++;
            continue;
          }
          zoomId = await createExternalContact({
            name: contact.name,
            phone_numbers: [phone],
            email: contact.email || undefined,
            description,
            id: customId,
          });
          writes++;
          counts.created++;
          await sleep(WRITE_DELAY_MS);
        } else if (changed) {
          if (writes >= MAX_WRITES_PER_RUN) {
            writeCapHit = true;
            counts.skipped++;
            continue;
          }
          await updateExternalContact(zoomId, {
            name: contact.name,
            phone_numbers: [phone],
            email: contact.email || undefined,
            description,
          });
          writes++;
          counts.updated++;
          await sleep(WRITE_DELAY_MS);
        } else {
          counts.skipped++;
        }

        await upsertMapRow(supabase, {
          contact_type: contact.type,
          appfolio_id: contact.appfolioId,
          zoom_external_contact_id: zoomId,
          name: contact.name,
          phone,
          email: contact.email,
          description,
          active: true,
          last_error: null,
        });
      } catch (err) {
        counts.failed++;
        const msg = err instanceof Error ? err.message : String(err);
        if (sampleErrors.length < 10) sampleErrors.push(`${contact.name}: ${msg}`);
        // Still record the attempt so the row exists and surfaces the error.
        await upsertMapRow(supabase, {
          contact_type: contact.type,
          appfolio_id: contact.appfolioId,
          zoom_external_contact_id: zoomId,
          name: contact.name,
          phone,
          email: contact.email,
          description,
          active: true,
          last_error: msg.substring(0, 500),
        }).catch(() => {});
      }
    }

    // 7. Flag contacts that vanished from AppFolio as inactive (no Zoom delete).
    const toDeactivate = mapRows
      .filter((r) => r.active && !desiredKeys.has(`${r.contact_type}:${r.appfolio_id}`))
      .map((r) => r.id);
    if (toDeactivate.length) {
      const { error: deErr } = await supabase
        .from('zoom_contact_map')
        .update({ active: false, updated_at: new Date().toISOString() })
        .in('id', toDeactivate);
      if (!deErr) counts.deactivated = toDeactivate.length;
    }

    if (writeCapHit) {
      console.warn(`[ZoomSync] Hit write cap (${MAX_WRITES_PER_RUN}); remaining contacts roll to next run.`);
    }

    await supabase
      .from('zoom_sync_runs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        total_source: totalSource,
        with_phone: withPhone,
        created_count: counts.created,
        updated_count: counts.updated,
        skipped_count: counts.skipped,
        failed_count: counts.failed,
        deactivated_count: counts.deactivated,
        details: {
          types,
          withoutPhone: totalSource - withPhone,
          writeCapHit,
          sampleErrors,
          phoneCollisions: {
            skippedCount: collisions.length,
            samples: collisions.slice(0, 10).map((c) => `${c.contact.name}: ${c.reason}`),
          },
        },
      })
      .eq('id', runId);

    return {
      runId,
      status: 'completed',
      totalSource,
      withPhone,
      created: counts.created,
      updated: counts.updated,
      skipped: counts.skipped,
      failed: counts.failed,
      deactivated: counts.deactivated,
      writeCapHit,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase
      .from('zoom_sync_runs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        total_source: totalSource,
        with_phone: withPhone,
        created_count: counts.created,
        updated_count: counts.updated,
        skipped_count: counts.skipped,
        failed_count: counts.failed,
        deactivated_count: counts.deactivated,
        error_message: msg.substring(0, 1000),
        details: { types, sampleErrors },
      })
      .eq('id', runId)
      .then(undefined, () => {});

    return {
      runId,
      status: 'failed',
      totalSource,
      withPhone,
      created: counts.created,
      updated: counts.updated,
      skipped: counts.skipped,
      failed: counts.failed,
      deactivated: counts.deactivated,
      writeCapHit,
      error: msg,
    };
  }
}

// ============================================
// Internals
// ============================================

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function upsertMapRow(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  row: {
    contact_type: ZoomContactType;
    appfolio_id: string;
    zoom_external_contact_id: string | null;
    name: string;
    phone: string | null;
    email: string | null;
    description: string | null;
    active: boolean;
    last_error: string | null;
  }
): Promise<void> {
  const { error } = await supabase.from('zoom_contact_map').upsert(
    {
      ...row,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'contact_type,appfolio_id' }
  );
  if (error) throw new Error(`Failed to upsert map row: ${error.message}`);
}
