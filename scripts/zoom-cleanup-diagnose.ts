/**
 * READ-ONLY diagnosis of Zoom Phone contact-sync data messes, ahead of the
 * one-time cleanup that follows the collision fix (PR #47).
 *
 * Reports two things, writes NOTHING to Zoom or Supabase:
 *   1. Zoom external_contact_ids that >1 zoom_contact_map row points at
 *      (the "41 shared IDs" — last-writer name churn). The collision fix
 *      stabilizes these going forward; this shows which name Zoom currently
 *      holds vs. the competing map rows, so you can eyeball any that look wrong.
 *   2. Zoom contacts / map rows carrying an EXCLUDED_PHONES shared line
 *      (the office line +15415480383 on TEST VENDOR / HDPM / HDMS) — the ones
 *      zoom-cleanup-apply.ts deletes.
 *
 * Usage:
 *   npx tsx scripts/zoom-cleanup-diagnose.ts
 *
 * Requires live ZOOM_* + SUPABASE creds in .env.local (same as the sync).
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { getSupabaseAdmin } from '../lib/supabase';
import { isZoomConfigured, listAllExternalContacts } from '../lib/zoom-phone';
import { normalizePhone, EXCLUDED_PHONES, type ContactMapRow } from '../lib/zoom-sync';

async function main() {
  if (!isZoomConfigured()) {
    console.error('Zoom credentials not configured (ZOOM_ACCOUNT_ID / ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET).');
    process.exit(1);
  }
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

  console.log(`--- Shared Zoom IDs: ${shared.length} (each mapped by 2+ rows) ---`);
  for (const [zoomId, list] of shared) {
    const z = zoomById.get(zoomId);
    const zoomName = z ? z.name ?? '(no name)' : '(NOT in Zoom — dangling)';
    const zoomPhones = z?.phone_numbers?.join(', ') ?? '';
    console.log(`\n  zoom ${zoomId}  →  "${zoomName}"  [${zoomPhones}]`);
    for (const r of list.sort((a, b) => (a.last_synced_at ?? '').localeCompare(b.last_synced_at ?? ''))) {
      console.log(
        `      ${r.contact_type}/${r.appfolio_id}  "${r.name}"  ${r.phone ?? '—'}` +
          `  synced:${r.last_synced_at ?? 'never'}${r.active ? '' : '  (inactive)'}`
      );
    }
  }

  // --- 2. Excluded shared-line contacts (office line etc.) ---
  console.log(`\n\n--- Excluded shared lines (${[...EXCLUDED_PHONES].join(', ')}) ---`);
  for (const line of EXCLUDED_PHONES) {
    const zoomHits = zoomContacts.filter((z) =>
      (z.phone_numbers || []).some((p) => normalizePhone(p) === line)
    );
    const mapHits = rows.filter((r) => r.phone === line);
    console.log(`\n  ${line}`);
    console.log(`    Zoom contacts carrying it (${zoomHits.length}):`);
    for (const z of zoomHits) {
      console.log(`      DELETE-CANDIDATE  zoom ${z.external_contact_id}  "${z.name ?? ''}"`);
    }
    console.log(`    map rows carrying it (${mapHits.length}):`);
    for (const r of mapHits) {
      console.log(
        `      ${r.contact_type}/${r.appfolio_id}  "${r.name}"  zoom:${r.zoom_external_contact_id ?? '—'}` +
          `${r.active ? '' : '  (inactive)'}`
      );
    }

    if (zoomHits.length) {
      const ids = zoomHits.map((z) => z.external_contact_id).join(',');
      console.log(`\n    → to delete these from Zoom, review then run:`);
      console.log(`      npx tsx scripts/zoom-cleanup-apply.ts --ids ${ids}            # dry-run`);
      console.log(`      npx tsx scripts/zoom-cleanup-apply.ts --ids ${ids} --confirm  # actually delete`);
    }
  }

  console.log(`\n=== Nothing was modified. ===\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
