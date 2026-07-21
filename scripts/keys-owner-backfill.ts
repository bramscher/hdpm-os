/**
 * One-time backfill of key_assignment.owner_name from AppFolio's /owners
 * endpoint (per-property lookups, throttled). Only fills rows whose
 * owner_name is currently NULL — never overwrites an existing name.
 * Dev use: npx tsx scripts/keys-owner-backfill.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

async function main() {
  const { getSupabaseAdmin } = await import('../lib/supabase');
  const { fetchAppFolioUnits, fetchAppFolioPropertyOwnerMap } = await import('../lib/appfolio');
  const supabase = getSupabaseAdmin();

  const { data: assignments, error } = await supabase
    .from('key_assignment')
    .select('id, appfolio_unit_id, owner_name')
    .is('released_at', null)
    .is('owner_name', null)
    .not('appfolio_unit_id', 'is', null);
  if (error) throw new Error(error.message);
  console.log(`assignments missing owner: ${assignments.length}`);
  if (assignments.length === 0) return;

  const units = await fetchAppFolioUnits();
  const unitToProperty = new Map(units.map((u) => [u.id, u.propertyId]));
  const propertyIds = [
    ...new Set(
      assignments
        .map((a) => unitToProperty.get(a.appfolio_unit_id))
        .filter((p): p is string => Boolean(p))
    ),
  ];
  console.log(`properties to resolve: ${propertyIds.length}`);

  const ownerMap = await fetchAppFolioPropertyOwnerMap(propertyIds);

  let updated = 0;
  for (const a of assignments) {
    const propId = unitToProperty.get(a.appfolio_unit_id);
    const owner = propId ? ownerMap.get(propId) : undefined;
    if (!owner) continue;
    const { error: uErr } = await supabase
      .from('key_assignment')
      .update({ owner_name: owner })
      .eq('id', a.id)
      .is('owner_name', null);
    if (uErr) console.warn('update failed', a.id, uErr.message);
    else updated++;
  }
  console.log(`DONE: ${updated}/${assignments.length} assignments updated`);
}

main().catch((e) => { console.error(e); process.exit(1); });
