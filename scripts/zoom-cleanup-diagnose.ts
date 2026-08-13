/**
 * READ-ONLY diagnosis of Zoom Phone contact-sync data messes, ahead of the
 * one-time cleanup that follows the collision fix (PR #47).
 *
 * Reports two things, writes NOTHING to Zoom or Supabase:
 *   1. Zoom external_contact_ids that >1 zoom_contact_map row points at
 *      (the "shared IDs" — last-writer name churn). The collision fix stabilizes
 *      these going forward; this shows which name Zoom currently holds vs. the
 *      competing map rows, so you can eyeball any that look wrong.
 *   2. Zoom contacts / map rows carrying an EXCLUDED_PHONES shared line
 *      (the office line +15415480383 etc.) — the ones to delete.
 *
 * It also writes a REVIEWABLE JSON reference file (default
 * scripts/zoom-cleanup.candidates.json, gitignored) whose `delete[]` array is
 * the proposed delete list. Curate that file — remove any id you want to KEEP —
 * then feed it to the apply script:
 *   npx tsx scripts/zoom-cleanup-apply.ts --from-file scripts/zoom-cleanup.candidates.json
 *
 * Usage:
 *   npx tsx scripts/zoom-cleanup-diagnose.ts
 *   npx tsx scripts/zoom-cleanup-diagnose.ts --out /tmp/zoom-candidates.json
 *
 * Requires live ZOOM_* + SUPABASE creds in .env.local (same as the sync).
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { writeFileSync } from 'fs';
import { getSupabaseAdmin } from '../lib/supabase';
import { isZoomConfigured, listAllExternalContacts } from '../lib/zoom-phone';
import { normalizePhone, EXCLUDED_PHONES, type ContactMapRow } from '../lib/zoom-sync';

const DEFAULT_OUT = 'scripts/zoom-cleanup.candidates.json';

function getFlag(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

interface DeleteCandidate {
  id: string;
  name: string;
  phones: string[];
  reason: string;
}

async function main() {
  if (!isZoomConfigured()) {
    console.error('Zoom credentials not configured (ZOOM_ACCOUNT_ID / ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET).');
    process.exit(1);
  }
  const outPath = getFlag('--out') ?? DEFAULT_OUT;
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase.from('zoom_contact_map').select('*');
  if (error) {
    console.error(`Failed to read zoom_contact_map: ${error.message}`);
    process.exit(1);
  }
  const rows = (data as ContactMapRow[]) ?? [];

  const zoomContacts = await listAllExternalContacts();
  const zoomById = new Map(zoomContacts.map((z) => [z.external_contact_id, z]));

  console.log(`\n=== Zoom cleanup diagnosis (READ-ONLY) ===`);
  console.log(`map rows: ${rows.length} · zoom external contacts: ${zoomContacts.length}\n`);

  // --- 1. Shared Zoom IDs (>1 map row → same external_contact_id) ---
  const byZoomId = new Map<string, ContactMapRow[]>();
  for (const r of rows) {
    if (!r.zoom_external_contact_id) continue;
    const list = byZoomId.get(r.zoom_external_contact_id) ?? [];
    list.push(r);
    byZoomId.set(r.zoom_external_contact_id, list);
  }
  const shared = [...byZoomId.entries()]
    .filter(([, list]) => list.length > 1)
    .sort((a, b) => b[1].length - a[1].length);

  const sharedIdsReview = shared.map(([zoomId, list]) => {
    const z = zoomById.get(zoomId);
    return {
      zoomId,
      inZoom: !!z,
      zoomName: z?.name ?? null,
      zoomPhones: z?.phone_numbers ?? [],
      rowCount: list.length,
      rows: list
        .slice()
        .sort((a, b) => (a.last_synced_at ?? '').localeCompare(b.last_synced_at ?? ''))
        .map((r) => ({
          key: `${r.contact_type}/${r.appfolio_id}`,
          name: r.name,
          phone: r.phone,
          last_synced_at: r.last_synced_at,
          active: r.active,
        })),
    };
  });

  console.log(`--- Shared Zoom IDs: ${shared.length} (each mapped by 2+ rows) ---`);
  console.log(`    (full detail in the JSON file; printing the 15 widest here)`);
  for (const s of sharedIdsReview.slice(0, 15)) {
    const zoomName = s.inZoom ? `"${s.zoomName ?? '(no name)'}"` : '(NOT in Zoom — dangling)';
    console.log(`\n  zoom ${s.zoomId}  →  ${zoomName}  [${s.zoomPhones.join(', ')}]  (${s.rowCount} rows)`);
    for (const r of s.rows) {
      console.log(
        `      ${r.key}  "${r.name}"  ${r.phone ?? '—'}  synced:${r.last_synced_at ?? 'never'}${r.active ? '' : '  (inactive)'}`
      );
    }
  }
  if (sharedIdsReview.length > 15) console.log(`\n  …and ${sharedIdsReview.length - 15} more (see JSON).`);

  // --- 2. Excluded shared-line contacts → delete candidates ---
  console.log(`\n\n--- Excluded shared lines (${[...EXCLUDED_PHONES].join(', ')}) ---`);
  const deleteCandidates: DeleteCandidate[] = [];
  const seen = new Set<string>();
  for (const line of EXCLUDED_PHONES) {
    const zoomHits = zoomContacts.filter((z) =>
      (z.phone_numbers || []).some((p) => normalizePhone(p) === line)
    );
    const mapHits = rows.filter((r) => r.phone === line);
    console.log(`\n  ${line}  — ${zoomHits.length} Zoom contact(s), ${mapHits.length} map row(s)`);
    for (const z of zoomHits) {
      if (seen.has(z.external_contact_id)) continue;
      seen.add(z.external_contact_id);
      deleteCandidates.push({
        id: z.external_contact_id,
        name: z.name ?? '',
        phones: z.phone_numbers ?? [],
        reason: `excluded-line ${line}`,
      });
      console.log(`      DELETE-CANDIDATE  ${z.external_contact_id}  "${z.name ?? ''}"`);
    }
  }

  // --- Write the reviewable reference file ---
  const payload = {
    _readme:
      'Curate `delete[]` to the exact Zoom external_contact_ids to remove (drop any you want to KEEP), ' +
      'then: npx tsx scripts/zoom-cleanup-apply.ts --from-file ' + outPath +
      '  (dry-run) then add --confirm. `sharedIdsReview` is context only — NOT a delete list.',
    generatedAt: new Date().toISOString(),
    excludedLines: [...EXCLUDED_PHONES],
    delete: deleteCandidates,
    sharedIdsReview,
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 2));

  console.log(`\n=== Wrote ${deleteCandidates.length} delete-candidate(s) + ${sharedIdsReview.length} shared-ID review record(s) to ${outPath} ===`);
  console.log(`Review/curate that file, then:`);
  console.log(`  npx tsx scripts/zoom-cleanup-apply.ts --from-file ${outPath}            # dry-run`);
  console.log(`  npx tsx scripts/zoom-cleanup-apply.ts --from-file ${outPath} --confirm  # delete\n`);
  console.log(`(Nothing was modified in Zoom or Supabase.)\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
