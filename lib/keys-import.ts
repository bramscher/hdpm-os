/**
 * Key Manager — one-time seed import of "Z - Key List - MASTER.xlsx".
 *
 * Sheet layout: key # | address of property | owner | date used. Rows whose
 * address is "OPEN" are unassigned (recyclable) numbers. Address strings are
 * matched to AppFolio units (exact normalized match, then a looser
 * street-number + street-name pass); unmatched rows become "unlinked"
 * assignments carrying the raw address, linkable later from the UI.
 */

import * as XLSX from 'xlsx';
import { getSupabaseAdmin } from '@/lib/supabase';
import { DEFAULT_KEY_TEMPLATE } from '@/lib/keys';
import type { AppFolioPropertyWithCustomFields, AppFolioUnit } from '@/lib/appfolio';
import type {
  KeyImportCommitResult,
  KeyImportPreview,
  KeyImportRowPreview,
} from '@/types/keys';

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

export interface RawKeyRow {
  rowNumber: number;
  keyNumber: string;
  address: string;
  owner: string;
  dateUsed: string;
}

const HEADER_ALIASES: Record<keyof Omit<RawKeyRow, 'rowNumber'>, string[]> = {
  keyNumber: ['prop #', 'prop#', 'key #', 'key#', 'key number', 'number', '#'],
  address: ['address of property', 'address', 'property address'],
  owner: ['owner', 'owner name'],
  dateUsed: ['date used', 'date', 'date assigned', 'assigned'],
};

function matchHeader(headers: string[], aliases: string[]): string | null {
  for (const h of headers) {
    if (aliases.includes(h.trim().toLowerCase())) return h;
  }
  return null;
}

export function parseKeysWorkbook(buffer: Buffer): RawKeyRow[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];

  const sheet = workbook.Sheets[sheetName];
  const rawRows: Record<string, string>[] = XLSX.utils.sheet_to_json(sheet, {
    defval: '',
    raw: false,
  });
  if (rawRows.length === 0) return [];

  const headers = Object.keys(rawRows[0]);
  const keyCol = matchHeader(headers, HEADER_ALIASES.keyNumber) ?? headers[0];
  const addrCol = matchHeader(headers, HEADER_ALIASES.address) ?? headers[1];
  const ownerCol = matchHeader(headers, HEADER_ALIASES.owner) ?? headers[2];
  const dateCol = matchHeader(headers, HEADER_ALIASES.dateUsed) ?? headers[3];

  return rawRows
    .map((row, idx) => ({
      rowNumber: idx + 2, // 1-based + header row
      keyNumber: String(row[keyCol] ?? '').trim(),
      address: String(row[addrCol] ?? '').trim(),
      owner: String(row[ownerCol] ?? '').trim(),
      dateUsed: String(row[dateCol] ?? '').trim(),
    }))
    .filter((r) => r.keyNumber !== '' || r.address !== '');
}

// ---------------------------------------------------------------------------
// Field parsing helpers (pure — unit tested)
// ---------------------------------------------------------------------------

/** "012" -> 12; non-numeric -> null. */
export function parseKeyNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = parseInt(trimmed, 10);
  return n >= 1 ? n : null;
}

const OPEN_VALUES = new Set(['open', 'open.', '-', '']);

export function isOpenRow(address: string): boolean {
  return OPEN_VALUES.has(address.trim().toLowerCase());
}

/**
 * Excel serials ("44256"), "July-17", "May 21", or normal date strings →
 * ISO date, else null (assignment date then defaults to import day).
 */
export function parseSheetDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || isOpenRow(trimmed)) return null;

  if (/^\d{4,6}$/.test(trimmed)) {
    const serial = parseInt(trimmed, 10);
    if (serial > 20000 && serial < 60000) {
      // Excel epoch 1899-12-30
      const ms = (serial - 25569) * 86400 * 1000;
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) return d.toISOString().split('T')[0];
    }
    return null;
  }

  const d = new Date(trimmed);
  if (!Number.isNaN(d.getTime()) && d.getFullYear() > 1990 && d.getFullYear() < 2100) {
    return d.toISOString().split('T')[0];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Address matching against AppFolio units (pure — unit tested)
// ---------------------------------------------------------------------------

const STREET_ABBREV: Record<string, string> = {
  street: 'st', 'st.': 'st',
  avenue: 'ave', 'ave.': 'ave', av: 'ave',
  drive: 'dr', 'dr.': 'dr',
  road: 'rd', 'rd.': 'rd',
  court: 'ct', 'ct.': 'ct',
  place: 'pl', 'pl.': 'pl',
  lane: 'ln', 'ln.': 'ln',
  boulevard: 'blvd', 'blvd.': 'blvd',
  circle: 'cir', 'cir.': 'cir',
  way: 'way',
  loop: 'loop',
  terrace: 'ter', 'ter.': 'ter',
  highway: 'hwy', 'hwy.': 'hwy',
};

/**
 * Normalize a single-string address for matching: lowercase, collapse
 * whitespace, standardize street suffixes, normalize unit markers
 * ("#A", "# A", "Apt A", "Unit A" -> "#a"), fix glued number+direction
 * ("1551NE" -> "1551 ne").
 */
export function normalizeAddressString(address: string): string {
  let s = address.trim().toLowerCase();
  s = s.replace(/(\d)([a-z]{2})\b/g, (m, num, dir) =>
    ['ne', 'nw', 'se', 'sw'].includes(dir) ? `${num} ${dir}` : m
  );
  s = s.replace(/\b(apt|unit|apartment)\.?\s*/g, '#');
  s = s.replace(/#\s+/g, '#');
  s = s.replace(/\s+/g, ' ').trim();
  const words = s.split(' ').map((w) => STREET_ABBREV[w] ?? w);
  return words.join(' ').replace(/[.,]/g, '');
}

export interface UnitMatchTarget {
  appfolioUnitId: string;
  appfolioPropertyId: string | null;
  propertyName: string | null;
  address1: string;
  address2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  ownerName: string | null;
  normalized: string;
  streetKey: string; // "<number> <street words w/o suffix>" for the fuzzy pass
}

/** "2741 ne laramie way" -> "2741 ne laramie" (drop trailing suffix token). */
function streetKeyOf(normalized: string): string {
  const base = normalized.split('#')[0].trim();
  const words = base.split(' ');
  if (words.length > 2 && Object.values(STREET_ABBREV).includes(words[words.length - 1])) {
    words.pop();
  }
  return words.join(' ');
}

export function buildUnitMatchTargets(
  units: AppFolioUnit[],
  properties: AppFolioPropertyWithCustomFields[]
): UnitMatchTarget[] {
  const propsById = new Map(properties.map((p) => [p.appfolioPropertyId, p]));
  const targets: UnitMatchTarget[] = [];
  for (const u of units) {
    const prop = u.propertyId ? propsById.get(u.propertyId) : undefined;
    if (prop?.hidden) continue;
    const address1 = u.address1 || prop?.address1;
    if (!address1) continue;
    const address2 = u.address2 || prop?.address2 || null;
    const normalized = normalizeAddressString([address1, address2].filter(Boolean).join(' '));
    targets.push({
      appfolioUnitId: u.id,
      appfolioPropertyId: u.propertyId,
      propertyName: prop?.name ?? null,
      address1,
      address2,
      city: u.city || prop?.city || null,
      state: u.state || prop?.state || null,
      zip: u.zip || prop?.zip || null,
      ownerName: prop?.ownerName ?? null,
      normalized,
      streetKey: streetKeyOf(normalized),
    });
  }
  return targets;
}

export function matchRowToUnit(
  rawAddress: string,
  targets: UnitMatchTarget[]
): UnitMatchTarget | null {
  const normalized = normalizeAddressString(rawAddress);
  const exact = targets.filter((t) => t.normalized === normalized);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null; // ambiguous — leave unlinked for manual pick

  const key = streetKeyOf(normalized);
  if (!/^\d/.test(key)) return null; // no leading street number — too weak
  const fuzzy = targets.filter((t) => t.streetKey === key);
  if (fuzzy.length === 1) return fuzzy[0];
  return null;
}

// ---------------------------------------------------------------------------
// Validate (preview)
// ---------------------------------------------------------------------------

export function validateKeyRows(
  rows: RawKeyRow[],
  targets: UnitMatchTarget[]
): KeyImportPreview {
  const seen = new Map<number, number>(); // key number -> first row
  const previews: KeyImportRowPreview[] = [];

  for (const row of rows) {
    const issues: string[] = [];
    const keyNumber = parseKeyNumber(row.keyNumber);
    if (keyNumber === null) {
      issues.push(`Key number "${row.keyNumber}" is not a valid number`);
    } else if (seen.has(keyNumber)) {
      issues.push(`Duplicate of key #${keyNumber} on row ${seen.get(keyNumber)}`);
    } else {
      seen.set(keyNumber, row.rowNumber);
    }

    let classification: KeyImportRowPreview['classification'];
    let match: UnitMatchTarget | null = null;

    if (issues.length > 0) {
      classification = 'error';
    } else if (isOpenRow(row.address)) {
      classification = 'open';
    } else {
      match = matchRowToUnit(row.address, targets);
      classification = match ? 'matched' : 'unmatched';
    }

    previews.push({
      row_number: row.rowNumber,
      key_number: keyNumber,
      raw_address: row.address,
      owner: row.owner,
      date_used: parseSheetDate(row.dateUsed),
      classification,
      appfolio_unit_id: match?.appfolioUnitId ?? null,
      matched_address: match
        ? [match.address1, match.address2].filter(Boolean).join(' ')
        : null,
      issues,
    });
  }

  return {
    total_rows: previews.length,
    open: previews.filter((p) => p.classification === 'open').length,
    matched: previews.filter((p) => p.classification === 'matched').length,
    unmatched: previews.filter((p) => p.classification === 'unmatched').length,
    errors: previews.filter((p) => p.classification === 'error').length,
    rows: previews,
  };
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

export async function commitKeysImport(
  preview: KeyImportPreview,
  targets: UnitMatchTarget[],
  actor: string,
  filename: string,
  force = false
): Promise<KeyImportCommitResult> {
  const supabase = getSupabaseAdmin();

  if (!force) {
    const { count, error } = await supabase
      .from('key_assignment')
      .select('id', { count: 'exact', head: true });
    if (error) throw new Error(`Failed to check existing assignments: ${error.message}`);
    if ((count ?? 0) > 0) {
      throw new Error(
        'Key assignments already exist — the seed import can only run once (pass force to override)'
      );
    }
  }

  const targetsByUnit = new Map(targets.map((t) => [t.appfolioUnitId, t]));
  const batchId = crypto.randomUUID();
  const today = new Date().toISOString().split('T')[0];

  // Ensure slots exist for any number beyond the migration's 1..972 seed.
  const numbers = preview.rows
    .map((r) => r.key_number)
    .filter((n): n is number => n !== null);
  const maxNumber = Math.max(972, ...numbers);
  let slotsCreated = 0;
  if (maxNumber > 972) {
    const extras = [];
    for (let n = 973; n <= maxNumber; n++) extras.push({ key_number: n });
    const { error } = await supabase
      .from('key_slot')
      .upsert(extras, { onConflict: 'key_number', ignoreDuplicates: true });
    if (error) throw new Error(`Failed to extend key slots: ${error.message}`);
    slotsCreated = maxNumber - 972;
  }

  const { data: slots, error: sErr } = await supabase
    .from('key_slot')
    .select('id, key_number');
  if (sErr) throw new Error(`Failed to load slots: ${sErr.message}`);
  const slotByNumber = new Map(
    ((slots || []) as Array<{ id: string; key_number: number }>).map((s) => [s.key_number, s])
  );

  let assignmentsCreated = 0;
  let openSlots = 0;

  for (const row of preview.rows) {
    if (row.key_number === null || row.classification === 'error') continue;
    const slot = slotByNumber.get(row.key_number);
    if (!slot) continue;

    if (row.classification === 'open') {
      openSlots++;
      continue; // slot stays 'open'
    }

    const match = row.appfolio_unit_id ? targetsByUnit.get(row.appfolio_unit_id) : null;
    const assignedAt = row.date_used ?? today;

    const { data: assignment, error: aErr } = await supabase
      .from('key_assignment')
      .insert({
        key_slot_id: slot.id,
        appfolio_unit_id: match?.appfolioUnitId ?? null,
        appfolio_property_id: match?.appfolioPropertyId ?? null,
        property_name: match?.propertyName ?? null,
        address_1: match?.address1 ?? null,
        address_2: match?.address2 ?? null,
        city: match?.city ?? null,
        state: match?.state ?? null,
        zip: match?.zip ?? null,
        owner_name: match?.ownerName ?? (row.owner || null),
        raw_address: row.raw_address,
        assigned_at: assignedAt,
        assigned_by: actor,
      })
      .select('id')
      .single();
    if (aErr || !assignment) {
      console.error('[keys-import] assignment insert failed:', aErr?.message, row.key_number);
      continue;
    }

    // Assumed default template — real copy state gets corrected by staff over time.
    for (let i = 0; i < DEFAULT_KEY_TEMPLATE.length; i++) {
      const t = DEFAULT_KEY_TEMPLATE[i];
      const { data: typeRow, error: tErr } = await supabase
        .from('key_type')
        .insert({ assignment_id: assignment.id, label: t.label, sort_order: i })
        .select('id')
        .single();
      if (tErr || !typeRow) continue;
      await supabase.from('key_copy').insert(
        t.copies.map((c) => ({
          key_type_id: typeRow.id,
          holder_type: c.holder_type,
          status: 'issued',
          issued_at: assignedAt,
        }))
      );
    }

    await supabase
      .from('key_slot')
      .update({ status: 'assigned' })
      .eq('id', slot.id);

    await supabase.from('key_event').insert({
      key_slot_id: slot.id,
      assignment_id: assignment.id,
      event_type: 'imported',
      payload: {
        batch_id: batchId,
        filename,
        raw_row: {
          key_number: row.key_number,
          address: row.raw_address,
          owner: row.owner,
          date_used: row.date_used,
        },
        matched: row.classification === 'matched',
        default_template_assumed: true,
      },
      actor,
    });

    assignmentsCreated++;
  }

  return {
    slots_created: slotsCreated,
    assignments_created: assignmentsCreated,
    open_slots: openSlots,
    batch_id: batchId,
  };
}
