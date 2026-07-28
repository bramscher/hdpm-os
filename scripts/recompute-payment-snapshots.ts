/**
 * One-time re-split of hdms_payments snapshot totals after the appliance_total
 * column landed (migration 20260728_payment_appliance_total.sql).
 *
 * Existing rows have appliance charges folded into materials_total. This
 * recomputes every payment's snapshot from its currently linked invoices via
 * the same recomputeSnapshot() used by attach/detach, populating
 * appliance_total and narrowing materials_total to materials only.
 *
 * Idempotent — safe to re-run.
 *
 * Usage: npx tsx scripts/recompute-payment-snapshots.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { getSupabaseAdmin } from '../lib/supabase';
import { recomputeSnapshot } from '../lib/payments';

async function main() {
  const supabase = getSupabaseAdmin();

  const { data: payments, error } = await supabase
    .from('hdms_payments')
    .select('id, paid_on, payee, materials_total, appliance_total')
    .order('paid_on', { ascending: true });

  if (error) throw new Error(`Failed to list payments: ${error.message}`);
  if (!payments || payments.length === 0) {
    console.log('No payments to recompute.');
    return;
  }

  console.log(`Recomputing ${payments.length} payment snapshot(s)...`);
  for (const p of payments) {
    const updated = await recomputeSnapshot(p.id);
    console.log(
      `  ${p.paid_on} ${p.payee}: materials ${p.materials_total} -> ${updated.materials_total}, ` +
        `appliances ${p.appliance_total ?? 0} -> ${updated.appliance_total}`
    );
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
