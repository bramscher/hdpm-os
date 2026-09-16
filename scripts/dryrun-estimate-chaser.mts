/**
 * Local dry run of the estimate-chaser against the (prod) Supabase in .env.local.
 * Writes NOTHING — computes the TW11 pool + decisions and prints the counts, so
 * you can see the owner-approval fix (skippedNotOwnerGated / ownerDrafts) without
 * touching the prod endpoint, Graph, or AppFolio.
 *
 * Run from the repo root:
 *   npx tsx scripts/dryrun-estimate-chaser.mts
 */
import { readFileSync } from 'node:fs';

// Load .env.local into process.env (Supabase creds) before the lib reads them.
try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
} catch (e) {
  console.error('Could not read .env.local — run from the repo root.', e);
  process.exit(1);
}

const { runEstimateChaser } = await import('../lib/agents/estimate-chaser-run');
const res = await runEstimateChaser({ dryRun: true });
console.log(JSON.stringify(res, null, 2));
