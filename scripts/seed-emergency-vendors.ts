/**
 * Flag HDPM's emergency vendors so the Zoom sync prefixes them 'EV - ' (typing
 * "EV" in Zoom Phone then surfaces only emergency vendors). Sets
 * vendor.emergency_available = true for the list below, matched to AppFolio
 * vendors by normalized name.
 *
 * DRY-RUN by default (prints the match report only). Pass --apply to write.
 *
 * Usage:
 *   npx tsx scripts/seed-emergency-vendors.ts          # report matches, no writes
 *   npx tsx scripts/seed-emergency-vendors.ts --apply  # set the flags
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { getSupabaseAdmin } from '../lib/supabase';
import { fetchAllVendors } from '../lib/appfolio';

const EMERGENCY_VENDORS = [
  'Tri County Cleaning Service',
  '365 Contracting LLC',
  'Best Cleaners and Restoration, LLC',
  "Chet's Electric LLC",
  'Cove Electric',
  'G2 Fire and Backflow LLC',
  'Overhead Door Co of Central Oregon',
  'AccuAir Heating & Cooling, Inc.',
  "Alonso's Landscaping Maintenance LLC",
  'B & M Landscape Maintenance LLC',
  'Yak Landscaping Maintenance LLC',
  'American Leak Detection',
  'Firkus Plumbing Heating & Repairs, Inc.',
  'Rapid Rooter of Central Oregon Inc.',
  'Rainbow International Restoration',
  'Drytime',
  "Scott's Roofing",
  'ABE JONES Septic Service, Inc.',
  'Bulldog Septic',
  '4 Brothers Tree Service Inc',
];

/** Lowercase, &→and, drop punctuation + legal suffixes, collapse whitespace. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[.,'"]/g, ' ')
    .replace(/\b(inc|incorporated|llc|ltd|corp|co)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  const apply = process.argv.includes('--apply');
  const supabase = getSupabaseAdmin();

  // AppFolio is the authoritative id source.
  const afVendors = await fetchAllVendors(); // Map<id, name>
  const afByNorm = new Map<string, { id: string; name: string }[]>();
  for (const [id, name] of afVendors) {
    const key = normalize(name);
    const list = afByNorm.get(key) ?? [];
    list.push({ id, name });
    afByNorm.set(key, list);
  }

  const matched: { target: string; id: string; afName: string }[] = [];
  const unmatched: string[] = [];
  const ambiguous: { target: string; count: number }[] = [];

  for (const target of EMERGENCY_VENDORS) {
    const key = normalize(target);
    let hits = afByNorm.get(key);
    // Fallback: unique substring match either direction.
    if (!hits) {
      const cands = [...afByNorm.entries()].filter(
        ([k]) => k.includes(key) || key.includes(k)
      );
      hits = cands.length === 1 ? cands[0][1] : undefined;
      if (cands.length > 1) {
        ambiguous.push({ target, count: cands.reduce((n, [, v]) => n + v.length, 0) });
        continue;
      }
    }
    if (hits && hits.length === 1) matched.push({ target, id: hits[0].id, afName: hits[0].name });
    else if (hits && hits.length > 1) ambiguous.push({ target, count: hits.length });
    else unmatched.push(target);
  }

  console.log(`\n=== Emergency vendor match report (${apply ? 'APPLY' : 'DRY-RUN'}) ===`);
  console.log(`\nMatched (${matched.length}/${EMERGENCY_VENDORS.length}):`);
  for (const m of matched) console.log(`  ✓ ${m.target}  →  ${m.afName} [${m.id}]`);
  if (ambiguous.length) {
    console.log(`\nAmbiguous (multiple AppFolio matches — resolve manually):`);
    for (const a of ambiguous) console.log(`  ? ${a.target}  (${a.count} candidates)`);
  }
  if (unmatched.length) {
    console.log(`\nUnmatched (tick manually in the vendor scoreboard):`);
    for (const u of unmatched) console.log(`  ✗ ${u}`);
  }

  if (!apply) {
    console.log(`\nDry run — no changes. Re-run with --apply to set emergency_available.`);
    return;
  }

  let wrote = 0;
  for (const m of matched) {
    // Upsert by appfolio_vendor_id: sets name + emergency_available, preserves
    // every other manual profile field (upsert only touches payload columns).
    const { error } = await supabase
      .from('vendor')
      .upsert(
        { appfolio_vendor_id: m.id, name: m.afName, emergency_available: true },
        { onConflict: 'appfolio_vendor_id' }
      );
    if (error) console.error(`  ! Failed ${m.target}: ${error.message}`);
    else wrote++;
  }
  console.log(`\nApplied: set emergency_available on ${wrote}/${matched.length} vendors.`);
  console.log(`Run the Zoom sync (/admin/zoom-sync → Sync Now) to apply the EV - prefix.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
