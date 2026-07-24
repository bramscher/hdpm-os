/**
 * Vacancy cache sync — pulls fresh vacant units from AppFolio, upserts them
 * into cached_vacancies, and removes rows for units no longer vacant.
 *
 * Shared by the Craigslist tool's "Sync from AppFolio" button
 * (POST /api/cached-vacancies) and the morning cron (/api/sync/vacancies) so
 * the cache is already fresh when staff arrive.
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import { fetchVacantUnits, type VacantUnit } from '@/lib/appfolio-vacancies';

export interface VacancySyncResult {
  units: VacantUnit[];
  total: number;
  removed: number;
}

export async function syncVacancies(): Promise<VacancySyncResult> {
  const freshUnits: VacantUnit[] = await fetchVacantUnits();
  const freshIds = new Set(freshUnits.map((u) => u.appfolio_unit_id));
  const now = new Date().toISOString();

  const supabase = getSupabaseAdmin();

  if (freshUnits.length > 0) {
    const rows = freshUnits.map((u) => ({
      appfolio_unit_id: u.appfolio_unit_id,
      appfolio_property_id: u.appfolio_property_id || '',
      address: u.address,
      city: u.city,
      state: u.state,
      zip: u.zip,
      bedrooms: u.bedrooms,
      bathrooms: u.bathrooms,
      rent: u.rent,
      sqft: u.sqft,
      available_date: u.available_date || '',
      unit_type: u.unit_type || 'Rental',
      amenities: u.amenities || [],
      marketing_description: u.marketing_description || '',
      ready_for_posting: u.ready_for_posting,
      status_reason: u.status_reason || '',
      last_synced_at: now,
    }));

    const { error: upsertError } = await supabase
      .from('cached_vacancies')
      .upsert(rows, { onConflict: 'appfolio_unit_id' });

    if (upsertError) throw new Error(`Upsert failed: ${upsertError.message}`);
  }

  const { data: existing } = await supabase
    .from('cached_vacancies')
    .select('appfolio_unit_id');

  const staleIds = (existing || [])
    .map((r) => r.appfolio_unit_id)
    .filter((id: string) => !freshIds.has(id));

  if (staleIds.length > 0) {
    const { error: deleteError } = await supabase
      .from('cached_vacancies')
      .delete()
      .in('appfolio_unit_id', staleIds);

    if (deleteError) console.error('[vacancy-sync] Delete stale error:', deleteError);
  }

  return { units: freshUnits, total: freshUnits.length, removed: staleIds.length };
}
