import { getSupabaseAdmin } from '@/lib/supabase';
import { fetchAppFolioTenants } from '@/lib/appfolio';
import { fetchUnitIdBridge, runReport } from '@/lib/appfolio-reports';
import { recordEvents } from './events';
import type { UnitTurn } from './types';

/**
 * Unit-level turnover helpers (Turnover board v2).
 *
 * A unit_turn groups MANY work orders (paint, flooring, clean, punch...)
 * under one turnover cycle. Linking/unlinking always writes a wo_event so
 * the audit trail shows when a WO joined or left a turn and who did it.
 */

function turnLabel(turn: Pick<UnitTurn, 'property_name' | 'unit_name'>): string {
  return turn.unit_name ? `${turn.property_name} · ${turn.unit_name}` : turn.property_name;
}

/** Link work orders to a turn (sets unit_turn_id + is_turn, audited). */
export async function linkWorkOrdersToTurn(
  turn: UnitTurn,
  woIds: string[],
  actor: string
): Promise<void> {
  if (woIds.length === 0) return;
  const supabase = getSupabaseAdmin();

  const { error } = await supabase
    .from('work_orders')
    .update({ unit_turn_id: turn.id, is_turn: true })
    .in('id', woIds);
  if (error) throw new Error(`Turn link failed: ${error.message}`);

  await recordEvents(
    woIds.map((id) => ({
      work_order_id: id,
      event_type: 'note',
      payload: { kind: 'turn_link', unit_turn_id: turn.id, unit_turn: turnLabel(turn) },
      actor,
    }))
  );
}

/** Unlink work orders from whatever turn they belong to (audited). */
export async function unlinkWorkOrdersFromTurn(woIds: string[], actor: string): Promise<void> {
  if (woIds.length === 0) return;
  const supabase = getSupabaseAdmin();

  const { error } = await supabase
    .from('work_orders')
    .update({ unit_turn_id: null })
    .in('id', woIds);
  if (error) throw new Error(`Turn unlink failed: ${error.message}`);

  await recordEvents(
    woIds.map((id) => ({
      work_order_id: id,
      event_type: 'note',
      payload: { kind: 'turn_unlink' },
      actor,
    }))
  );
}

/**
 * Bridge for the legacy per-WO turn endpoint: make sure a unit-level turn
 * exists for this work order's unit and that the WO is linked to it.
 *
 * Matching rule: an ACTIVE unit_turn on the same property_name + unit_name.
 * If none exists, one is created from the legacy turn fields.
 */
export async function ensureUnitTurnForWorkOrder(
  woId: string,
  fields: {
    vacated_at: string;
    target_ready?: string | null;
    current_blocker?: string | null;
    budget?: number | null;
    actual?: number | null;
  },
  actor: string
): Promise<UnitTurn | null> {
  const supabase = getSupabaseAdmin();

  const { data: wo, error: woError } = await supabase
    .from('work_orders')
    .select('id, property_id, property_name, unit_id, unit_name, unit_turn_id')
    .eq('id', woId)
    .single();
  if (woError || !wo) return null;

  // Already linked? Refresh the turn's fields from the legacy payload and stop.
  if (wo.unit_turn_id) {
    const { data: existing } = await supabase
      .from('unit_turn')
      .update({
        vacated_at: fields.vacated_at,
        target_ready: fields.target_ready ?? null,
        current_blocker: fields.current_blocker ?? null,
        budget: fields.budget ?? null,
        actual: fields.actual ?? null,
      })
      .eq('id', wo.unit_turn_id)
      .select('*')
      .single();
    return (existing as UnitTurn) ?? null;
  }

  // Find an active turn for the same unit.
  let query = supabase
    .from('unit_turn')
    .select('*')
    .eq('status', 'active')
    .eq('property_name', wo.property_name);
  query = wo.unit_name ? query.eq('unit_name', wo.unit_name) : query.is('unit_name', null);
  const { data: matches } = await query.limit(1);

  let turn = (matches?.[0] as UnitTurn) ?? null;

  if (!turn) {
    const { data: created, error: createError } = await supabase
      .from('unit_turn')
      .insert({
        property_id: wo.property_id,
        property_name: wo.property_name,
        unit_id: wo.unit_id,
        unit_name: wo.unit_name,
        vacated_at: fields.vacated_at,
        target_ready: fields.target_ready ?? null,
        current_blocker: fields.current_blocker ?? null,
        budget: fields.budget ?? null,
        actual: fields.actual ?? null,
      })
      .select('*')
      .single();
    if (createError || !created) {
      throw new Error(createError?.message || 'unit_turn create failed');
    }
    turn = created as UnitTurn;
  }

  await linkWorkOrdersToTurn(turn, [woId], actor);
  return turn;
}

// ============================================
// AppFolio Unit Turn Board sync (20260724)
//
// WOs created from AppFolio's Turn Board carry unit_turn_category (phase)
// and share one af_service_request_id per turn. This reconciler groups the
// not-yet-linked ones, creates missing unit_turn rows keyed by that id,
// and links the WOs (audited). Idempotent; safe after every sync.
// ============================================

interface TurnWoRow {
  id: string;
  property_id: string | null;
  property_name: string;
  unit_id: string | null;
  unit_name: string | null;
  stage: string;
  appfolio_created_at: string | null;
  created_at: string;
  af_service_request_id: string | null;
}

/** unit_id -> ascending move-out dates, for seeding vacated_at. */
async function fetchMoveOutsByUnit(): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  try {
    const tenants = await fetchAppFolioTenants();
    for (const t of tenants) {
      if (!t.unitId || !t.moveOutOn) continue;
      const list = map.get(t.unitId);
      if (list) list.push(t.moveOutOn);
      else map.set(t.unitId, [t.moveOutOn]);
    }
    for (const list of map.values()) list.sort();
  } catch (err) {
    console.error('[UnitTurns] Tenant fetch failed; vacated_at falls back to WO dates:', err);
  }
  return map;
}

/**
 * Best vacated date for a turn: the latest tenant move-out at or before the
 * turn's first WO (turn work can start a few days pre-move-out, hence the
 * grace window), else the first WO date itself (turn started ≈ vacated).
 */
function pickVacatedAt(moveOuts: string[] | undefined, firstWoDate: string): string {
  if (moveOuts?.length) {
    const cutoff = new Date(new Date(`${firstWoDate}T00:00:00Z`).getTime() + 14 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const eligible = moveOuts.filter((d) => d <= cutoff);
    if (eligible.length) return eligible[eligible.length - 1];
  }
  return firstWoDate;
}

/**
 * Create/refresh unit turns from the AppFolio mirror columns. Never edits
 * HDPM-owned turn fields (blocker, target, budget) and never unlinks; the
 * one status write is reactivating a closed turn when AppFolio adds new
 * open work to it.
 */
export async function syncUnitTurnsFromMirror(
  actor = 'appfolio-sync'
): Promise<{ created: number; linked: number }> {
  const supabase = getSupabaseAdmin();

  const { data: unlinkedRaw, error } = await supabase
    .from('work_orders')
    .select(
      'id, property_id, property_name, unit_id, unit_name, stage, appfolio_created_at, created_at, af_service_request_id'
    )
    .not('unit_turn_category', 'is', null)
    .not('af_service_request_id', 'is', null)
    .is('unit_turn_id', null);
  if (error) throw new Error(`Turn sync WO query failed: ${error.message}`);

  const unlinked = (unlinkedRaw ?? []) as TurnWoRow[];
  if (unlinked.length === 0) return { created: 0, linked: 0 };

  const bySr = new Map<string, TurnWoRow[]>();
  for (const wo of unlinked) {
    const sr = wo.af_service_request_id as string;
    const list = bySr.get(sr);
    if (list) list.push(wo);
    else bySr.set(sr, [wo]);
  }

  const { data: existingRaw, error: exError } = await supabase
    .from('unit_turn')
    .select('*')
    .in('af_service_request_id', [...bySr.keys()]);
  if (exError) throw new Error(`Turn sync lookup failed: ${exError.message}`);
  const turnBySr = new Map<string, UnitTurn>(
    ((existingRaw ?? []) as UnitTurn[]).map((t) => [t.af_service_request_id as string, t])
  );

  let moveOutsByUnit: Map<string, string[]> | null = null;
  let created = 0;
  let linked = 0;

  for (const [sr, wos] of bySr) {
    let turn = turnBySr.get(sr) ?? null;
    const anyOpen = wos.some((w) => w.stage !== 'CLOSED');

    if (!turn && wos[0].unit_id) {
      // Adopt an existing active turn on this unit that isn't SR-keyed yet
      // (created manually or by the Reports-API true-up before any WOs
      // existed) so all creation paths converge on one row per turn.
      const { data: adoptable } = await supabase
        .from('unit_turn')
        .select('*')
        .eq('status', 'active')
        .is('af_service_request_id', null)
        .eq('unit_id', wos[0].unit_id)
        .limit(1);
      if (adoptable?.[0]) {
        const { data: adopted } = await supabase
          .from('unit_turn')
          .update({ af_service_request_id: sr })
          .eq('id', (adoptable[0] as UnitTurn).id)
          .select('*')
          .single();
        turn = (adopted as UnitTurn) ?? null;
      }
    }

    if (!turn) {
      moveOutsByUnit ??= await fetchMoveOutsByUnit();
      const first = wos[0];
      const firstWoDate = wos
        .map((w) => (w.appfolio_created_at || w.created_at).slice(0, 10))
        .sort()[0];
      const vacatedAt = pickVacatedAt(
        first.unit_id ? moveOutsByUnit.get(first.unit_id) : undefined,
        firstWoDate
      );

      const { data: createdTurn, error: createError } = await supabase
        .from('unit_turn')
        .insert({
          property_id: first.property_id,
          property_name: first.property_name,
          unit_id: first.unit_id,
          unit_name: first.unit_name,
          vacated_at: vacatedAt,
          status: anyOpen ? 'active' : 'closed',
          af_service_request_id: sr,
        })
        .select('*')
        .single();
      if (createError || !createdTurn) {
        // Unique-index race with a concurrent sync — re-read instead of failing.
        const { data: raced } = await supabase
          .from('unit_turn')
          .select('*')
          .eq('af_service_request_id', sr)
          .single();
        if (!raced) {
          console.error(`[UnitTurns] Create failed for SR ${sr}: ${createError?.message}`);
          continue;
        }
        turn = raced as UnitTurn;
      } else {
        turn = createdTurn as UnitTurn;
        created++;
      }
    } else if (turn.status === 'closed' && anyOpen) {
      await supabase.from('unit_turn').update({ status: 'active' }).eq('id', turn.id);
      turn = { ...turn, status: 'active' };
    }

    await linkWorkOrdersToTurn(
      turn,
      wos.map((w) => w.id),
      actor
    );
    linked += wos.length;
  }

  if (created || linked) {
    console.log(`[UnitTurns] AppFolio turn sync: ${created} turns created, ${linked} WOs linked`);
  }
  return { created, linked };
}

// ============================================
// Reports API true-up (20260725): unit_turn_detail.json
//
// AppFolio's Unit Turn Detail report carries the authoritative turn facts the
// v0 API can't see: the AF turn id, move-out / expected-move-in dates, target
// days, and the billed rollup from work orders. This trues up our unit_turn
// rows against it (AF is the system of record for facts) and creates turns
// that exist in AppFolio but have no WOs yet — the board's early warning.
// ============================================

interface UnitTurnDetailRow {
  property?: string | null;
  unit?: string | null;
  unit_turn_id?: string | number | null;
  move_out_date?: string | null;
  turn_end_date?: string | null;
  expected_move_in_date?: string | null;
  target_days_to_complete?: number | null;
  total_billed?: string | number | null;
  billables_from_work_orders?: string | number | null;
  /** NUMERIC web-app unit id — bridged to the v0 UUID via unit Link. */
  unit_id?: number | string | null;
}

function parseAmount(v: string | number | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isNaN(n) ? null : n;
}

function addDays(iso: string, days: number): string {
  return new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function daysApart(a: string, b: string): number {
  return Math.abs(new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 86_400_000;
}

/**
 * True up unit_turn rows from AppFolio's unit_turn_detail report (last 180
 * days of move-outs). Matching: af_unit_turn_id first, else same unit UUID
 * with vacated_at within 45 days of the report's move-out (non-closed rows
 * preferred, then closest). Craig-owned fields (blocker, budget, notes, an
 * already-set target_ready, status) are never touched.
 */
export async function trueUpUnitTurnsFromReport(): Promise<{
  reportRows: number;
  updated: number;
  created: number;
  unbridged: number;
}> {
  const supabase = getSupabaseAdmin();
  const since = addDays(new Date().toISOString().slice(0, 10), -180);

  const [report, bridge] = await Promise.all([
    runReport<UnitTurnDetailRow>('unit_turn_detail', { move_out_date_from: since }),
    fetchUnitIdBridge(),
  ]);

  const { data: oursRaw, error } = await supabase
    .from('unit_turn')
    .select('*')
    .gte('vacated_at', addDays(since, -90));
  if (error) throw new Error(`Turn true-up load failed: ${error.message}`);
  const ours = (oursRaw ?? []) as UnitTurn[];

  const byAfId = new Map<string, UnitTurn>();
  const byUnitUuid = new Map<string, UnitTurn[]>();
  for (const t of ours) {
    if (t.af_unit_turn_id) byAfId.set(t.af_unit_turn_id, t);
    if (t.unit_id) {
      const list = byUnitUuid.get(t.unit_id) ?? [];
      list.push(t);
      byUnitUuid.set(t.unit_id, list);
    }
  }

  let updated = 0;
  let created = 0;
  let unbridged = 0;

  for (const row of report) {
    if (!row.move_out_date || row.unit_turn_id == null) continue;
    const afId = String(row.unit_turn_id);
    const bridged = row.unit_id != null ? bridge.get(String(row.unit_id)) : undefined;
    if (!bridged) unbridged++;

    let target = byAfId.get(afId) ?? null;
    if (!target && bridged) {
      const candidates = (byUnitUuid.get(bridged.uuid) ?? [])
        .filter((t) => !t.af_unit_turn_id && daysApart(t.vacated_at, row.move_out_date!) <= 45)
        .sort(
          (a, b) =>
            (a.status === 'closed' ? 1 : 0) - (b.status === 'closed' ? 1 : 0) ||
            daysApart(a.vacated_at, row.move_out_date!) - daysApart(b.vacated_at, row.move_out_date!)
        );
      target = candidates[0] ?? null;
    }

    const actual = parseAmount(row.total_billed) ?? parseAmount(row.billables_from_work_orders);
    const targetReady =
      row.target_days_to_complete != null
        ? addDays(row.move_out_date, row.target_days_to_complete)
        : null;

    if (target) {
      const patch: Record<string, unknown> = {};
      if (!target.af_unit_turn_id) patch.af_unit_turn_id = afId;
      if (target.vacated_at !== row.move_out_date) patch.vacated_at = row.move_out_date;
      if (row.expected_move_in_date && target.movein_date !== row.expected_move_in_date) {
        patch.movein_date = row.expected_move_in_date;
      }
      if (actual != null && Number(target.actual) !== actual) patch.actual = actual;
      if (!target.target_ready && targetReady) patch.target_ready = targetReady;
      if (Object.keys(patch).length > 0) {
        const { error: upError } = await supabase.from('unit_turn').update(patch).eq('id', target.id);
        if (upError) console.error(`[UnitTurns] True-up update failed for AF turn ${afId}: ${upError.message}`);
        else updated++;
      }
    } else if (!row.turn_end_date && bridged) {
      // In AppFolio but unknown to us and still in progress — create it so the
      // board (and tripwire #12) see the vacancy before any WOs exist.
      const { error: insError } = await supabase.from('unit_turn').insert({
        property_name: row.property || bridged.name || 'Unknown Property',
        unit_id: bridged.uuid,
        unit_name: bridged.name ?? row.unit ?? null,
        vacated_at: row.move_out_date,
        movein_date: row.expected_move_in_date ?? null,
        target_ready: targetReady,
        actual,
        status: 'active',
        af_unit_turn_id: afId,
      });
      if (insError) console.error(`[UnitTurns] True-up create failed for AF turn ${afId}: ${insError.message}`);
      else created++;
    }
  }

  console.log(
    `[UnitTurns] Report true-up: ${report.length} rows, ${updated} updated, ${created} created, ${unbridged} unbridged units`
  );
  return { reportRows: report.length, updated, created, unbridged };
}
