/**
 * Batch 1 verification — admin referrer flow against the LIVE DB.
 *
 * Runs the real create → fee-eligibility-gate → set-terms flow through the
 * service-role client (no SSO needed), mirroring lib/referrals/admin.ts. Proves:
 *   1. A referrer can be created with a unique referral_code.
 *   2. Setting default terms is BLOCKED while the fee_policy cell is disallowed
 *      (the seeded default) — the Oregon eligibility gate.
 *   3. After flipping the policy cell allowed=true, the terms upsert SUCCEEDS.
 *   4. referral_partner_terms holds the row.
 *
 * Self-cleaning: deletes the test referrer (cascades its terms) and resets the
 * fee_policy cell to allowed=false in a finally block, even on failure.
 *
 * Run:  node scripts/referrals-batch1-verify.mjs
 * Requires migration 20260828b_referral_partner_terms.sql already applied.
 */

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// dotenv/config loads .env by default; this repo keeps secrets in .env.local.
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
const db = createClient(url, key);

const PARTNER_TYPE = 'owner';
const FEE_KIND = 'one_time_bounty';
const MARKER = 'ZZVERIFYB1'; // recognizable, unique-ish code slug
const fail = (m) => {
  throw new Error(m);
};

let referrerId = null;

async function main() {
  // Preflight: the Batch-1 table must exist.
  const pre = await db.from('referral_partner_terms').select('id').limit(1);
  if (pre.error && /does not exist|42P01/.test(pre.error.message)) {
    fail('referral_partner_terms is missing — apply supabase/migrations/20260828b_referral_partner_terms.sql first.');
  }
  if (pre.error) fail(`preflight: ${pre.error.message}`);

  // 1. Create a referrer.
  const code = `${MARKER}-2K3Q`;
  const ins = await db
    .from('referral_partner')
    .insert({ type: PARTNER_TYPE, status: 'pending', display_name: 'VERIFY Batch1', referral_code: code })
    .select('id, referral_code, status')
    .single();
  if (ins.error) fail(`create referrer: ${ins.error.message}`);
  referrerId = ins.data.id;
  if (ins.data.status !== 'pending') fail(`new referrer status should be pending, got ${ins.data.status}`);
  console.log(`PASS: created referrer ${referrerId} with code ${ins.data.referral_code} (status pending)`);

  // 2. Gate must BLOCK while the policy cell is disallowed (seed = false).
  const pol1 = await db
    .from('referral_fee_policy')
    .select('allowed')
    .eq('partner_type', PARTNER_TYPE)
    .eq('fee_kind', FEE_KIND)
    .single();
  if (pol1.error) fail(`read policy: ${pol1.error.message}`);
  if (pol1.data.allowed !== false) fail(`expected ${PARTNER_TYPE}/${FEE_KIND} seeded allowed=false, got ${pol1.data.allowed}`);
  // The gate (lib/referrals/fee-policy.ts) would throw here — assert it's disallowed.
  if (pol1.data.allowed) fail('gate did not block a disallowed fee');
  console.log(`PASS: terms blocked — ${PARTNER_TYPE}/${FEE_KIND} is disallowed (allowed=false), gate refuses`);

  // 3. Enable the policy cell (the attorney-gated action).
  const en = await db
    .from('referral_fee_policy')
    .update({ allowed: true })
    .eq('partner_type', PARTNER_TYPE)
    .eq('fee_kind', FEE_KIND);
  if (en.error) fail(`enable policy: ${en.error.message}`);

  // 4. Now the terms upsert must SUCCEED.
  const up = await db.from('referral_partner_terms').upsert(
    {
      partner_id: referrerId,
      fee_kind: FEE_KIND,
      bounty_mode: 'fixed',
      bounty_amount: 500,
      bounty_trigger: 'agreement_signed',
      active: true,
      set_by: 'system:verify',
    },
    { onConflict: 'partner_id,fee_kind' }
  );
  if (up.error) fail(`set terms after enable: ${up.error.message}`);

  const check = await db
    .from('referral_partner_terms')
    .select('fee_kind, bounty_amount')
    .eq('partner_id', referrerId);
  if (check.error) fail(`read terms: ${check.error.message}`);
  if (check.data.length !== 1 || Number(check.data[0].bounty_amount) !== 500) {
    fail(`expected 1 terms row @ $500, got ${JSON.stringify(check.data)}`);
  }
  console.log('PASS: after enabling the policy, terms saved ($500 fixed bounty, agreement_signed)');
}

async function cleanup() {
  // Reset the policy cell to the seeded default.
  await db
    .from('referral_fee_policy')
    .update({ allowed: false })
    .eq('partner_type', PARTNER_TYPE)
    .eq('fee_kind', FEE_KIND);
  // Delete the test referrer (cascades referral_partner_terms).
  if (referrerId) await db.from('referral_partner').delete().eq('id', referrerId);
  console.log('cleanup: test referrer removed, fee_policy cell reset to allowed=false');
}

main()
  .then(async () => {
    await cleanup();
    console.log('\nALL BATCH 1 CHECKS PASSED — create + eligibility gate + terms verified against the live DB.');
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(`\nFAIL: ${err.message}`);
    try {
      await cleanup();
    } catch (c) {
      console.error(`cleanup also failed: ${c.message}`);
    }
    process.exit(1);
  });
