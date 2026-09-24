/**
 * AppFolio activities — server side: report fetch (cached) + staff lookups.
 * Pure grouping/formatting lives in lib/activities.ts.
 */

import { runReport } from '@/lib/appfolio-reports';
import { getSupabaseAdmin } from '@/lib/supabase';
import { normalizeActivity, type Activity, type UpcomingActivityRow } from '@/lib/activities';

// Fresh report runs are rate-limited (7 per 15s), so page loads share one run.
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Activity[] } | null = null;

export async function fetchActivities(opts: { fresh?: boolean } = {}): Promise<{ rows: Activity[]; fetchedAt: string }> {
  if (!opts.fresh && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return { rows: cache.rows, fetchedAt: new Date(cache.fetchedAt).toISOString() };
  }
  const raw = await runReport<UpcomingActivityRow>('upcoming_activities', { paginate_results: true });
  const rows = raw.map(normalizeActivity).filter((a): a is Activity => a !== null);
  cache = { fetchedAt: Date.now(), rows };
  return { rows, fetchedAt: new Date(cache.fetchedAt).toISOString() };
}

export interface ActivityStaff {
  person: string;
  name: string | null;
  email: string | null;
  slack_user_id: string | null;
  access_role: string | null;
}

export async function loadActiveStaff(): Promise<ActivityStaff[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('staff')
    .select('person,name,email,slack_user_id,access_role')
    .eq('active', true);
  if (error) throw new Error(`staff lookup failed: ${error.message}`);
  return (data ?? []) as ActivityStaff[];
}
