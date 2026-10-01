/**
 * Server-side reads for the routine calendar: registry + last run + who hears
 * from each routine. A missing routine_run table (migration not applied yet)
 * reads as "never ran", not a crash.
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import { getNotifyRecipients } from '@/lib/agents/config';
import { ROUTINES, cadence, nextRun, type Routine } from './registry';

export interface RoutineRun {
  id: string;
  routine_id: string;
  path: string;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'ok' | 'halted' | 'skipped' | 'error';
  halt_reason: string | null;
  items: number | null;
  recipients: string[];
  summary: Record<string, unknown>;
  error: string | null;
}

export interface RoutineView extends Routine {
  cadence: 'continuous' | 'scheduled';
  nextRunAt: string;
  lastRun: Pick<RoutineRun, 'status' | 'started_at' | 'finished_at' | 'halt_reason' | 'error' | 'items'> | null;
  recipientNames: string[];
}

/** A run still 'running' after this long died without finishing (function timeout). */
const STALE_MS = 15 * 60_000;

export function effectiveStatus(run: Pick<RoutineRun, 'status' | 'started_at'>, now = Date.now()): RoutineRun['status'] {
  return run.status === 'running' && now - new Date(run.started_at).getTime() > STALE_MS ? 'error' : run.status;
}

export async function loadRoutineViews(now = new Date()): Promise<{ routines: RoutineView[]; logReady: boolean }> {
  const supabase = getSupabaseAdmin();
  const since = new Date(now.getTime() - 35 * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from('routine_run')
    .select('routine_id, status, started_at, finished_at, halt_reason, error, items')
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(4000);
  const last = new Map<string, RoutineView['lastRun']>();
  for (const r of (data ?? []) as RoutineRun[]) {
    if (!last.has(r.routine_id)) last.set(r.routine_id, { ...r, status: effectiveStatus(r, now.getTime()) });
  }

  const notifyCache = new Map<string, Promise<string[]>>();
  const namesFor = (r: Routine): Promise<string[]> => {
    if (!r.notify) return Promise.resolve(r.recipients ?? []);
    const key = `${r.notify.agent}:${r.notify.action}`;
    if (!notifyCache.has(key)) {
      notifyCache.set(
        key,
        getNotifyRecipients(r.notify.agent, r.notify.action, r.notify.fallback)
          .then((staff) => staff.map((s) => s.name || s.person))
          .catch(() => r.notify!.fallback)
      );
    }
    return notifyCache.get(key)!;
  };

  const routines = await Promise.all(
    ROUTINES.map(async (r) => ({
      ...r,
      cadence: cadence(r.schedule),
      nextRunAt: nextRun(r.schedule, now).toISOString(),
      lastRun: last.get(r.id) ?? null,
      recipientNames: await namesFor(r),
    }))
  );
  return { routines, logReady: !error };
}

export async function loadRuns(routineId: string, limit = 20): Promise<RoutineRun[]> {
  const { data } = await getSupabaseAdmin()
    .from('routine_run')
    .select('*')
    .eq('routine_id', routineId)
    .order('started_at', { ascending: false })
    .limit(limit);
  return ((data ?? []) as RoutineRun[]).map((r) => ({ ...r, status: effectiveStatus(r) }));
}
