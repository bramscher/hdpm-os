/**
 * Local dry run of the HDMS billing reconciliation against the (prod) Supabase
 * in .env.local. Read-only — prints the bucket summary + a few sample leak rows.
 *   npx tsx scripts/dryrun-hdms-recon.mts
 */
import { readFileSync } from 'node:fs';

try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  /* no .env.local — rely on ambient env */
}

const { buildHdmsReconciliation, HDMS_RECON_LABELS, HDMS_RECON_CATEGORIES } = await import(
  '../lib/maintenance/hdms-reconcile.ts'
);

const r = await buildHdmsReconciliation({ windowDays: 180 });
console.log(`\nHDMS billing recon — last ${r.windowDays} days · ${r.rows.length} work orders\n`);
for (const cat of HDMS_RECON_CATEGORIES) {
  const b = r.summary[cat];
  console.log(`  ${HDMS_RECON_LABELS[cat].padEnd(30)} ${String(b.count).padStart(4)}   $${Math.round(b.invoicedTotal).toLocaleString()}`);
}

const leaks = r.rows.filter((x) => x.category === 'done_unbilled').slice(0, 8);
console.log(`\n  Sample "done, not billed" (first ${leaks.length}):`);
for (const l of leaks) {
  console.log(`    ${(l.wo_number ?? '—').padEnd(10)} ${(l.appfolio_status ?? '').padEnd(11)} ${(l.unit_name ?? l.property_name ?? '').slice(0, 40)}`);
}
console.log('');
