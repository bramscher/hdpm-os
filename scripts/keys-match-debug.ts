/**
 * Debug harness for the keys-import address matcher. Runs the real preview
 * pipeline against live AppFolio data and the master spreadsheet, then dumps
 * unmatched rows alongside near-miss candidates so matcher changes can be
 * evaluated offline. Not deployed — dev use only (npx tsx scripts/keys-match-debug.ts).
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { readFileSync, writeFileSync } from 'fs';
import {
  fetchAppFolioPropertiesWithCustomFields,
  fetchAppFolioUnits,
} from '../lib/appfolio';
import {
  buildUnitMatchTargets,
  normalizeAddressString,
  parseKeysWorkbook,
  validateKeyRows,
} from '../lib/keys-import';

async function main() {
  const buffer = readFileSync('/Users/cab_1/Desktop/Z - Key List - MASTER.xlsx');
  const rows = parseKeysWorkbook(buffer);
  const [units, properties] = await Promise.all([
    fetchAppFolioUnits(),
    fetchAppFolioPropertiesWithCustomFields(),
  ]);
  const targets = buildUnitMatchTargets(units, properties);
  writeFileSync('/tmp/keys-targets.json', JSON.stringify(targets, null, 1));

  const preview = validateKeyRows(rows, targets);
  console.log(JSON.stringify({
    total: preview.total_rows, open: preview.open,
    matched: preview.matched, unmatched: preview.unmatched, errors: preview.errors,
  }));

  const unmatched = preview.rows.filter((r) => r.classification === 'unmatched');
  const lines: string[] = [];
  for (const r of unmatched) {
    const norm = normalizeAddressString(r.raw_address);
    const streetNum = norm.match(/^\d+/)?.[0];
    const candidates = streetNum
      ? targets.filter((t) => t.normalized.startsWith(streetNum + ' ')).slice(0, 4)
      : [];
    lines.push(`#${r.key_number} RAW="${r.raw_address}" NORM="${norm}" OWNER="${r.owner}"`);
    for (const c of candidates) {
      lines.push(`    cand: "${c.normalized}" (unit ${c.appfolioUnitId}, ${c.propertyName})`);
    }
  }
  writeFileSync('/tmp/keys-unmatched.txt', lines.join('\n'));
  console.log(`wrote /tmp/keys-unmatched.txt (${unmatched.length} rows)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
