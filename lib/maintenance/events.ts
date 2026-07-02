/**
 * Maintenance OS — wo_event append-only audit trail.
 *
 * Every workflow change is an event; nothing is overwritten silently.
 * The table itself rejects UPDATE/DELETE via trigger (20260702_maintenance_os.sql).
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import type { EventType, WoEvent } from './types';

export interface NewEvent {
  work_order_id: string;
  event_type: EventType;
  payload?: Record<string, unknown>;
  actor: string;
}

/** Insert a single event. Never throws — audit failures are logged, not fatal. */
export async function recordEvent(event: NewEvent): Promise<void> {
  await recordEvents([event]);
}

/** Batch-insert events (e.g. one `created` per new WO in a sync run). */
export async function recordEvents(events: NewEvent[]): Promise<void> {
  if (events.length === 0) return;
  const supabase = getSupabaseAdmin();

  const rows = events.map((e) => ({
    work_order_id: e.work_order_id,
    event_type: e.event_type,
    payload: e.payload ?? {},
    actor: e.actor,
  }));

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('wo_event').insert(rows.slice(i, i + 500));
    if (error) {
      console.error('[wo_event] Failed to record events:', error.message);
    }
  }
}

/** Full event timeline for one work order, oldest first. */
export async function listEvents(workOrderId: string): Promise<WoEvent[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('wo_event')
    .select('*')
    .eq('work_order_id', workOrderId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[wo_event] Failed to list events:', error.message);
    return [];
  }
  return (data ?? []) as WoEvent[];
}
