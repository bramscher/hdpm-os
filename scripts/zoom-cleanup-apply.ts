/**
 * GUARDED cleanup of specific Zoom Phone external contacts (the office-line
 * duplicates surfaced by zoom-cleanup-diagnose.ts). DRY-RUN by default — it
 * only deletes when you pass --confirm, and only the ids you name.
 *
 * What it does per id: DELETE the Zoom external contact, then (unless
 * --keep-map) null out zoom_external_contact_id + set active=false on any
 * zoom_contact_map row that referenced it, so the map never patches a deleted
 * Zoom id. With EXCLUDED_PHONES in place, the next sync leaves these alone.
 *
 * Usage:
 *   # 1. get ids from the diagnosis first:
 *   npx tsx scripts/zoom-cleanup-diagnose.ts
 *
 *   # 2. preview (no writes):
 *   npx tsx scripts/zoom-cleanup-apply.ts --ids ext_abc,ext_def
 *
 *   # 3. actually delete (Zoom + map), after you've reviewed:
 *   npx tsx scripts/zoom-cleanup-apply.ts --ids ext_abc,ext_def --confirm
 *
 * Flags:
 *   --ids a,b,c   (required) comma-separated Zoom external_contact_ids to delete
 *   --confirm     perform the deletes/updates (omit = dry-run)
 *   --keep-map    delete from Zoom only; leave zoom_contact_map rows untouched
 *
 * Requires live ZOOM_* + SUPABASE creds in .env.local.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { getSupabaseAdmin } from '../lib/supabase';
import {
  isZoomConfigured,
  listAllExternalContacts,
  deleteExternalContact,
} from '../lib/zoom-phone';
import type { ContactMapRow } from '../lib/zoom-sync';

function getFlag(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

async function main() {
  const confirm = process.argv.includes('--confirm');
  const keepMap = process.argv.includes('--keep-map');
  const idsArg = getFlag('--ids');

  if (!idsArg) {
    console.error('Missing --ids. Run scripts/zoom-cleanup-diagnose.ts first, then pass --ids a,b,c.');
    process.exit(1);
  }
  const ids = idsArg.split(',').map((s) => s.trim()).filter(Boolean);
  if (!ids.length) {
    console.error('--ids was empty.');
    process.exit(1);
  }
  if (!isZoomConfigured()) {
    console.error('Zoom credentials not configured (ZOOM_ACCOUNT_ID / ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET).');
    process.exit(1);
  }

  const supabase = getSupabaseAdmin();

  // Show exactly what each id is before touching anything.
  const zoomContacts = await listAllExternalContacts();
  const zoomById = new Map(zoomContacts.map((z) => [z.external_contact_id, z]));
  const { data: mapData } = await supabase
    .from('zoom_contact_map')
    .select('*')
    .in('zoom_external_contact_id', ids);
  const mapRows = (mapData as ContactMapRow[]) ?? [];

  console.log(`\n=== Zoom cleanup ${confirm ? 'APPLY' : 'DRY-RUN'} — ${ids.length} id(s) ===\n`);
  for (const id of ids) {
    const z = zoomById.get(id);
    const rows = mapRows.filter((r) => r.zoom_external_contact_id === id);
    console.log(`  ${id}`);
    console.log(`     zoom: ${z ? `"${z.name ?? ''}" [${(z.phone_numbers || []).join(', ')}]` : '(not found in Zoom — already gone?)'}`);
    console.log(`     map rows referencing it: ${rows.length}${keepMap ? ' (left untouched: --keep-map)' : ''}`);
    for (const r of rows) console.log(`       - ${r.contact_type}/${r.appfolio_id} "${r.name}"`);
  }

  if (!confirm) {
    console.log(`\nDry run — nothing changed. Re-run with --confirm to delete the above.\n`);
    return;
  }

  let deleted = 0;
  let mapUpdated = 0;
  for (const id of ids) {
    try {
      await deleteExternalContact(id); // idempotent: 404 is treated as success
      deleted++;
      console.log(`  ✓ deleted Zoom contact ${id}`);
    } catch (e) {
      console.error(`  ! failed to delete ${id}: ${e instanceof Error ? e.message : String(e)}`);
      continue; // don't orphan the map update onto a still-live contact
    }

    if (keepMap) continue;
    const { error, count } = await supabase
      .from('zoom_contact_map')
      .update(
        {
          zoom_external_contact_id: null,
          active: false,
          last_error: 'cleanup: shared/office line removed from Zoom',
          updated_at: new Date().toISOString(),
        },
        { count: 'exact' }
      )
      .eq('zoom_external_contact_id', id);
    if (error) console.error(`  ! map update failed for ${id}: ${error.message}`);
    else mapUpdated += count ?? 0;
  }

  console.log(`\nDeleted ${deleted}/${ids.length} Zoom contact(s); updated ${mapUpdated} map row(s).\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
