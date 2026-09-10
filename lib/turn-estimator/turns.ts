/**
 * Turn Estimator — turn record + lifecycle transitions (Slice 1).
 *
 * unit_turn already exists (turnover board, Gantt, AppFolio sync). This adds the
 * controlled lifecycle on top: advanceTurn validates a transition against the
 * pure state machine, appends a turn_status_event, updates lifecycle_status +
 * the derived legacy status, and audits. Inspection condition capture stays in
 * AppFolio (Craig 2026-09-03) — INSPECTION_SCHEDULED/INSPECTED are just
 * coordinator-set statuses here.
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';
import {
  canTransition,
  deriveLegacyStatus,
  isTurnStatus,
  isMainState,
  TURN_STATES,
  type TurnLifecycleStatus,
} from './turn-lifecycle';

export interface CreateTurnInput {
  property_name: string;
  property_id?: string | null;
  unit_id?: string | null;
  unit_name?: string | null;
  vacated_at: string; // YYYY-MM-DD (unit_turn requires it)
  target_ready?: string | null;
  movein_date?: string | null;
  notes?: string | null;
}

/** Create a turn record at NOTICE_RECEIVED (manual path). */
export async function createTurnRecord(
  input: CreateTurnInput,
  actor: string
): Promise<{ id: string; lifecycle_status: TurnLifecycleStatus }> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('unit_turn')
    .insert({
      property_name: input.property_name,
      property_id: input.property_id ?? null,
      unit_id: input.unit_id ?? null,
      unit_name: input.unit_name ?? null,
      vacated_at: input.vacated_at,
      target_ready: input.target_ready ?? null,
      movein_date: input.movein_date ?? null,
      notes: input.notes ?? null,
      status: 'active',
      lifecycle_status: 'NOTICE_RECEIVED',
    })
    .select('id')
    .single();
  if (error) throw new Error(`create turn failed: ${error.message}`);

  await supabase.from('turn_status_event').insert({
    unit_turn_id: data.id,
    from_status: null,
    to_status: 'NOTICE_RECEIVED',
    actor,
    reason: 'turn created',
  });
  await logAudit('unit_turn', data.id as string, 'turn_created', actor, {
    property_name: input.property_name,
    unit_name: input.unit_name ?? null,
  });
  return { id: data.id as string, lifecycle_status: 'NOTICE_RECEIVED' };
}

/**
 * Advance a turn to `to`. Validates the transition against the state machine;
 * throws on an illegal move. Appends an event, updates lifecycle_status + the
 * derived legacy status, and audits.
 */
export async function advanceTurn(
  turnId: string,
  to: string,
  actor: string,
  reason?: string
): Promise<{ from: string; to: TurnLifecycleStatus }> {
  if (!isTurnStatus(to)) throw new Error(`unknown turn status: ${to}`);
  const supabase = getSupabaseAdmin();

  const { data: turn, error } = await supabase
    .from('unit_turn')
    .select('id, lifecycle_status')
    .eq('id', turnId)
    .single();
  if (error || !turn) throw new Error(`turn not found: ${error?.message}`);

  const from = turn.lifecycle_status as string;
  if (!canTransition(from, to)) {
    throw new Error(`illegal turn transition: ${from} → ${to}`);
  }

  await supabase.from('turn_status_event').insert({
    unit_turn_id: turnId,
    from_status: from,
    to_status: to,
    actor,
    reason: reason ?? null,
  });

  const { error: updErr } = await supabase
    .from('unit_turn')
    .update({ lifecycle_status: to, status: deriveLegacyStatus(to) })
    .eq('id', turnId);
  if (updErr) throw new Error(`update turn status failed: ${updErr.message}`);

  await logAudit('unit_turn', turnId, 'turn_status_change', actor, { from, to, reason: reason ?? null });
  return { from, to: to as TurnLifecycleStatus };
}

/**
 * Best-effort advance for automated hooks (estimate issued/approved/converted):
 * moves the turn only if the transition is currently legal, and never throws —
 * a turn that isn't at a compatible state is simply left alone.
 */
export async function tryAdvanceTurn(
  turnId: string | null | undefined,
  to: string,
  actor: string,
  reason?: string
): Promise<boolean> {
  if (!turnId) return false;
  try {
    await advanceTurn(turnId, to, actor, reason);
    return true;
  } catch {
    return false;
  }
}

/**
 * Advance a turn FORWARD along the main chain toward `target`, one valid step at
 * a time (used by WO-progress sync). Never moves backward, never leaves an
 * exception state automatically, and stops at the first step it can't take. All
 * best-effort — never throws.
 */
export async function advanceTurnToward(
  turnId: string,
  target: string,
  actor: string,
  reason?: string
): Promise<void> {
  if (!isMainState(target)) return;
  const supabase = getSupabaseAdmin();
  const targetIdx = TURN_STATES.indexOf(target);
  for (let guard = 0; guard < TURN_STATES.length; guard++) {
    const { data: turn } = await supabase
      .from('unit_turn')
      .select('lifecycle_status')
      .eq('id', turnId)
      .maybeSingle();
    const cur = turn?.lifecycle_status as string | undefined;
    if (!cur || !isMainState(cur)) return; // don't auto-move out of an exception
    const curIdx = TURN_STATES.indexOf(cur);
    if (curIdx >= targetIdx) return; // already at/past target
    const ok = await tryAdvanceTurn(turnId, TURN_STATES[curIdx + 1], actor, reason);
    if (!ok) return;
  }
}

/** Turn header + full status history (for the lifecycle UI + metrics). */
export async function getTurnLifecycle(turnId: string) {
  const supabase = getSupabaseAdmin();
  const { data: turn } = await supabase.from('unit_turn').select('*').eq('id', turnId).maybeSingle();
  if (!turn) return null;
  const { data: events } = await supabase
    .from('turn_status_event')
    .select('*')
    .eq('unit_turn_id', turnId)
    .order('created_at', { ascending: true });
  return { turn, events: events ?? [] };
}
