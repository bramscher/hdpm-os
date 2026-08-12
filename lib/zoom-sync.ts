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

function descriptionFor(c: AppFolioContact): string {
  if (c.type === 'tenant') {
    return c.propertyAddress ? `Tenant — ${c.propertyAddress}` : 'Tenant';
  }
  return c.type === 'vendor' ? 'Vendor' : 'Owner';
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
    if (phone) {
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
  if (isZoomConfigured()) {
    try {
      const zoomContacts = await listAllExternalContacts();
      for (const zc of zoomContacts) {
        for (const p of zc.phone_numbers || []) {
          const norm = normalizePhone(p);
          if (norm && !phoneIndex.has(norm)) phoneIndex.set(norm, zc.external_contact_id);
        }
      }
    } catch {
      phoneIndex = new Map();
    }
  }

  let wouldCreate = 0;
  let wouldUpdate = 0;
  let wouldSkip = 0;
  for (const { contact, phone } of desired) {
    const existing = mapByKey.get(`${contact.type}:${contact.appfolioId}`);
    const zoomId = existing?.zoom_external_contact_id || phoneIndex.get(phone) || null;
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

    // 2. Normalize phones; keep only contacts with a usable number.
    const desired = source
      .map((c) => ({ contact: c, phone: normalizePhone(c.phoneRaw) }))
      .filter((d): d is { contact: AppFolioContact; phone: string } => d.phone !== null);
    withPhone = desired.length;
    const desiredKeys = new Set(desired.map((d) => `${d.contact.type}:${d.contact.appfolioId}`));

    // 3. Existing local mapping.
    const { data: mapData, error: mapErr } = await supabase
      .from('zoom_contact_map')
      .select('*');
    if (mapErr) throw new Error(`Failed to load contact map: ${mapErr.message}`);
    const mapRows = (mapData as ContactMapRow[]) ?? [];
    const mapByKey = new Map(mapRows.map((r) => [`${r.contact_type}:${r.appfolio_id}`, r]));

    // 4. Existing Zoom contacts → phone index for first-run reconciliation
    //    (so we adopt rather than duplicate contacts already in Zoom).
    const zoomContacts = await listAllExternalContacts();
    const phoneIndex = new Map<string, string>();
    for (const zc of zoomContacts) {
      for (const p of zc.phone_numbers || []) {
        const norm = normalizePhone(p);
        if (norm && !phoneIndex.has(norm)) phoneIndex.set(norm, zc.external_contact_id);
      }
    }

    // 5. Create / update each desired contact.
    let writes = 0;
    for (const { contact, phone } of desired) {
      const key = `${contact.type}:${contact.appfolioId}`;
      const existing = mapByKey.get(key);
      const description = descriptionFor(contact);
      const customId = `hdpm-${contact.type}-${contact.appfolioId}`;

      let zoomId = existing?.zoom_external_contact_id || phoneIndex.get(phone) || null;
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

    // 6. Flag contacts that vanished from AppFolio as inactive (no Zoom delete).
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
