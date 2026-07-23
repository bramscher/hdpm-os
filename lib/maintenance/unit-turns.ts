import { getSupabaseAdmin } from '@/lib/supabase';
import { fetchAppFolioTenants } from '@/lib/appfolio';
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
