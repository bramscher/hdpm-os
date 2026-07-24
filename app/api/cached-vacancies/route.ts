import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { syncVacancies } from '@/lib/vacancy-sync';

// GET — return cached vacancies (instant load)
export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('cached_vacancies')
      .select('*')
      .order('ready_for_posting', { ascending: false })
      .order('city', { ascending: true })
      .order('address', { ascending: true });

    // Table doesn't exist yet — return empty (user needs to run migration)
    if (error?.code === '42P01' || error?.message?.includes('does not exist')) {
      return NextResponse.json({ units: [], cached: true, needsMigration: true });
    }
    if (error) throw new Error(error.message);

    return NextResponse.json({ units: data || [], cached: true });
  } catch (err) {
    console.error('[cached-vacancies] GET error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load cached vacancies' },
      { status: 500 }
    );
  }
}

// POST — sync: pull fresh from AppFolio, upsert new/updated, remove stale.
// Same logic as the morning cron (/api/sync/vacancies) via lib/vacancy-sync.
export async function POST() {
  try {
    const result = await syncVacancies();
    return NextResponse.json({
      units: result.units,
      cached: false,
      synced: {
        total: result.total,
        removed: result.removed,
      },
    });
  } catch (err) {
    console.error('[cached-vacancies] POST sync error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Sync failed' },
      { status: 500 }
    );
  }
}
