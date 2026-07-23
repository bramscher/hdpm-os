/**
 * Key Manager — reconcile AppFolio's "Keys Detail" report into key_af_checkout.
 *
 * AppFolio key checkout data (assignee + checked-out date) exists only in the
 * web-app Keys Detail report (no v0 API resource — verified 2026-07-22). Staff
 * export it as CSV (Customize → enable "Checked Out Date" and "Unit ID"
 * columns first) and upload it at /keys. Each commit REPLACES the snapshot
 * table wholesale — it mirrors AppFolio's current state, joined to our keys
 * via key_assignment.appfolio_unit_id. When a Reports API credential is
 * provisioned, feed the same commit path from POST /api/v2/reports/keys_detail.
 */

import Papa from 'papaparse';
import { getSupabaseAdmin } from '@/lib/supabase';
import { fetchUnitIdBridge, runReport } from '@/lib/appfolio-reports';
import type {
  KeyAfCheckout,
  KeyReconcileCommitResult,
  KeyReconcileMeta,
  KeyReconcilePreview,
  KeyReconcileRowPreview,
  ReconcileRowClass,
} from '@/types/keys';

// ============================================
// CSV parsing
// ============================================

export interface AfKeysDetailRow {
  key_name: string | null;
  description: string | null;
  assignee: string;
  assignee_type: string | null;
  number_checked_out: number | null;
  checked_out_date: string | null; // ISO yyyy-mm-dd
  unit: string;
  appfolio_unit_id: string | null;
}

/** Normalize a CSV header for fuzzy matching: lowercase, alphanumerics only. */
function normHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const HEADER_MAP: Record<string, keyof AfKeysDetailRow> = {
  keyname: 'key_name',
  description: 'description',
  assignee: 'assignee',
  assigneetype: 'assignee_type',
  numbercheckedout: 'number_checked_out',
  checkedoutdate: 'checked_out_date',
  unit: 'unit',
  unitid: 'appfolio_unit_id',
};

/** Parse "09/13/2024" (or ISO) to yyyy-mm-dd, else null. */
function parseUsDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

/**
 * Parse the Keys Detail CSV export. Header names are matched fuzzily; rows
 * without an Assignee are skipped (group headers / totals rows in the export).
 * Throws when the Assignee column itself is missing — wrong file.
 */
export function parseKeysDetailCsv(csvText: string): AfKeysDetailRow[] {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const headers = (parsed.meta.fields ?? []).filter(Boolean);
  const mapped = new Map<string, keyof AfKeysDetailRow>();
  for (const h of headers) {
    const target = HEADER_MAP[normHeader(h)];
    if (target && ![...mapped.values()].includes(target)) mapped.set(h, target);
  }

  if (![...mapped.values()].includes('assignee')) {
    throw new Error(
      `This doesn't look like a Keys Detail export — no "Assignee" column found (saw: ${headers.join(', ') || 'no headers'})`
    );
  }

  const rows: AfKeysDetailRow[] = [];
  for (const raw of parsed.data) {
    const row: AfKeysDetailRow = {
      key_name: null,
      description: null,
      assignee: '',
      assignee_type: null,
      number_checked_out: null,
      checked_out_date: null,
      unit: '',
      appfolio_unit_id: null,
    };
    for (const [header, field] of mapped) {
      const value = (raw[header] ?? '').trim();
      if (!value) continue;
      if (field === 'number_checked_out') {
        const n = parseInt(value, 10);
        if (!Number.isNaN(n)) row.number_checked_out = n;
      } else if (field === 'checked_out_date') {
        row.checked_out_date = parseUsDate(value);
      } else {
        row[field] = value;
      }
    }
    if (!row.assignee) continue;
    rows.push(row);
  }
  return rows;
}

// ============================================
// Reports API source (no CSV): POST /api/v2/reports/keys_detail.json
// ============================================

interface AfKeysDetailReportRow {
  key_name?: string | null;
  description?: string | null;
  key_quantity?: number | null;
  checked_out_by?: string | null;
  checked_out_type?: string | null;
  checked_out?: number | null;
  checked_out_date?: string | null;
  keyable_name?: string | null;
  /** NUMERIC web-app unit id — NOT the v0 UUID our tables store. */
  unit_id?: number | string | null;
}

/**
 * Fetch the same rows the CSV export carries, straight from the Reports API.
 * Default report filters return checked-out rows only — the same set the CSV
 * flow keeps (it skips assignee-less rows). The report's numeric unit ids are
 * translated to v0 UUIDs via the unit Link bridge so the existing match/commit
 * path works unchanged; unbridgeable rows keep a null unit id and land in the
 * usual missing_unit_id bucket.
 */
export async function fetchAfKeysDetailRows(): Promise<AfKeysDetailRow[]> {
  const [report, bridge] = await Promise.all([
    runReport<AfKeysDetailReportRow>('keys_detail'),
    fetchUnitIdBridge(),
  ]);

  const rows: AfKeysDetailRow[] = [];
  for (const r of report) {
    const assignee = (r.checked_out_by ?? '').trim();
    if (!assignee) continue;
    const bridged = r.unit_id != null ? bridge.get(String(r.unit_id)) : undefined;
    rows.push({
      key_name: r.key_name ?? null,
      description: r.description ?? null,
      assignee,
      assignee_type: r.checked_out_type ?? null,
      number_checked_out: typeof r.checked_out === 'number' ? r.checked_out : null,
      checked_out_date: r.checked_out_date ? parseUsDate(String(r.checked_out_date)) : null,
      unit: r.keyable_name ?? '',
      appfolio_unit_id: bridged?.uuid ?? null,
    });
  }
  return rows;
}

// ============================================
// Preview / commit
// ============================================

const MISSING_TABLE_HINT =
  'key_af_checkout table missing — apply migration 20260724_key_af_checkouts.sql first';

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  return error?.code === '42P01' || /key_af_checkout/.test(error?.message ?? '');
}

/** Active key numbers per appfolio_unit_id (a unit can hold several key slots). */
async function loadUnitKeyMap(): Promise<Map<string, number[]>> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('key_assignment')
    .select('appfolio_unit_id, key_slot(key_number)')
    .is('released_at', null)
    .not('appfolio_unit_id', 'is', null);
  if (error) throw new Error(`Failed to load key assignments: ${error.message}`);

  const map = new Map<string, number[]>();
  for (const a of (data ?? []) as Array<{
    appfolio_unit_id: string;
    key_slot: { key_number: number } | { key_number: number }[] | null;
  }>) {
    const slot = Array.isArray(a.key_slot) ? a.key_slot[0] : a.key_slot;
    if (!slot) continue;
    const list = map.get(a.appfolio_unit_id) ?? [];
    list.push(slot.key_number);
    map.set(a.appfolio_unit_id, list.sort((x, y) => x - y));
  }
  return map;
}

export async function previewKeysReconcile(rows: AfKeysDetailRow[]): Promise<KeyReconcilePreview> {
  const unitKeys = await loadUnitKeyMap();

  const previews: KeyReconcileRowPreview[] = rows.map((row, i) => {
    let classification: ReconcileRowClass;
    let keyNumbers: number[] = [];
    if (!row.appfolio_unit_id) {
      classification = 'missing_unit_id';
    } else if (unitKeys.has(row.appfolio_unit_id)) {
      classification = 'matched';
      keyNumbers = unitKeys.get(row.appfolio_unit_id)!;
    } else {
      classification = 'no_key';
    }
    return {
      row_number: i + 1,
      unit: row.unit || row.appfolio_unit_id || '—',
      assignee: row.assignee,
      assignee_type: row.assignee_type,
      description: row.description || row.key_name,
      checked_out_date: row.checked_out_date,
      classification,
      key_numbers: keyNumbers,
    };
  });

  const matched = previews.filter((r) => r.classification === 'matched');
  const unitsCovered = new Set(
    rows.filter((r) => r.appfolio_unit_id).map((r) => r.appfolio_unit_id as string)
  );
  const keysCovered = new Set(matched.flatMap((r) => r.key_numbers));

  return {
    total_rows: rows.length,
    matched: matched.length,
    no_key: previews.filter((r) => r.classification === 'no_key').length,
    missing_unit_id: previews.filter((r) => r.classification === 'missing_unit_id').length,
    units_covered: unitsCovered.size,
    keys_covered: keysCovered.size,
    rows: previews,
  };
}

/**
 * Replace the snapshot: delete every existing row, insert the joinable rows
 * (those with a Unit ID — rows without one can never reach a key page).
 */
export async function commitKeysReconcile(
  rows: AfKeysDetailRow[],
  actor: string
): Promise<KeyReconcileCommitResult> {
  const supabase = getSupabaseAdmin();
  const preview = await previewKeysReconcile(rows);
  const storable = rows.filter((r) => r.appfolio_unit_id);

  const { error: delError } = await supabase
    .from('key_af_checkout')
    .delete()
    .not('id', 'is', null);
  if (delError) {
    throw new Error(isMissingTable(delError) ? MISSING_TABLE_HINT : `Failed to clear snapshot: ${delError.message}`);
  }

  const CHUNK = 500;
  for (let i = 0; i < storable.length; i += CHUNK) {
    const { error } = await supabase.from('key_af_checkout').insert(
      storable.slice(i, i + CHUNK).map((r) => ({
        appfolio_unit_id: r.appfolio_unit_id,
        key_name: r.key_name,
        description: r.description,
        assignee: r.assignee,
        assignee_type: r.assignee_type,
        number_checked_out: r.number_checked_out,
        checked_out_date: r.checked_out_date,
        imported_by: actor,
      }))
    );
    if (error) throw new Error(`Failed to store snapshot: ${error.message}`);
  }

  return {
    rows_stored: storable.length,
    units_covered: preview.units_covered,
    keys_covered: preview.keys_covered,
    skipped_missing_unit_id: preview.missing_unit_id,
  };
}

// ============================================
// Reads (tolerant of the migration not being applied yet)
// ============================================

export async function getAfCheckoutsForUnit(appfolioUnitId: string): Promise<KeyAfCheckout[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('key_af_checkout')
    .select('*')
    .eq('appfolio_unit_id', appfolioUnitId)
    .order('checked_out_date', { ascending: false });
  if (error) {
    if (isMissingTable(error)) return [];
    console.error('[keys] getAfCheckoutsForUnit failed:', error.message);
    return [];
  }
  return (data ?? []) as KeyAfCheckout[];
}

export async function getReconcileMeta(): Promise<KeyReconcileMeta> {
  const supabase = getSupabaseAdmin();
  const { data, error, count } = await supabase
    .from('key_af_checkout')
    .select('imported_at, imported_by', { count: 'exact' })
    .order('imported_at', { ascending: false })
    .limit(1);
  if (error) {
    if (!isMissingTable(error)) console.error('[keys] getReconcileMeta failed:', error.message);
    return { last_imported_at: null, last_imported_by: null, row_count: 0 };
  }
  return {
    last_imported_at: data?.[0]?.imported_at ?? null,
    last_imported_by: data?.[0]?.imported_by ?? null,
    row_count: count ?? 0,
  };
}
