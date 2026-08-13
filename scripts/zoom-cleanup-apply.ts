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
 *   # 1. generate + curate the candidate file:
 *   npx tsx scripts/zoom-cleanup-diagnose.ts       # writes scripts/zoom-cleanup.candidates.json
 *   #    → open that file, drop any id from `delete[]` you want to KEEP
 *
 *   # 2. preview (no writes):
 *   npx tsx scripts/zoom-cleanup-apply.ts --from-file scripts/zoom-cleanup.candidates.json
 *
 *   # 3. actually delete (Zoom + map), after you've reviewed:
 *   npx tsx scripts/zoom-cleanup-apply.ts --from-file scripts/zoom-cleanup.candidates.json --confirm
 *
 *   # (ad-hoc alternative: pass ids inline)
 *   npx tsx scripts/zoom-cleanup-apply.ts --ids ext_abc,ext_def --confirm
 *
 * Flags:
 *   --from-file p  read ids from `delete[].id` in the JSON file p (from the diagnose script)
 *   --ids a,b,c    comma-separated Zoom external_contact_ids (use instead of --from-file)
 *   --confirm      perform the deletes/updates (omit = dry-run)
 *   --keep-map     delete from Zoom only; leave zoom_contact_map rows untouched
 *
 * Provide exactly one of --from-file or --ids.
 * Requires live ZOOM_* + SUPABASE creds in .env.local.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { readFileSync } from 'fs';
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

function idsFromFile(path: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.error(`Could not read/parse ${path}: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
  const del = (parsed as { delete?: { id?: string }[] }).delete;
  if (!Array.isArray(del)) {
    console.error(`${path} has no \`delete\` array — is it the file from zoom-cleanup-diagnose.ts?`);
    process.exit(1);
  }
  return del.map((d) => (d?.id ?? '').trim()).filter(Boolean);
}

async function main() {
  const confirm = process.argv.includes('--confirm');
  const keepMap = process.argv.includes('--keep-map');
  const idsArg = getFlag('--ids');
  const fromFile = getFlag('--from-file');

  if ((idsArg && fromFile) || (!idsArg && !fromFile)) {
    console.error('Provide exactly one of --from-file <path> or --ids a,b,c. Run zoom-cleanup-diagnose.ts first.');
    process.exit(1);
  }
  const ids = fromFile
    ? idsFromFile(fromFile)
    : (idsArg as string).split(',').map((s) => s.trim()).filter(Boolean);
  if (!ids.length) {
    console.error(fromFile ? `No ids in ${fromFile} \`delete[]\`.` : '--ids was empty.');
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
