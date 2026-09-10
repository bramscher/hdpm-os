/**
 * Batch 4 verification — notification schema/wiring against the LIVE DB.
 *
 * Confirms the DB side of notifications WITHOUT sending real email:
 *   1. referral_partner.notify_email exists and defaults true.
 *   2. referral_notification_log accepts a row (partner FK, event, status) and
 *      reads back.
 *
 * Email deliverability itself (Resend DKIM/SPF to external referrers) is
 * confirmed during the pilot with a real inbox — see the batch log. Templates,
 * opt-out logic, and event selection are unit-tested (notify-templates.test.ts).
 *
 * Run: node scripts/referrals-batch4-verify.mjs   (needs migration 20260828e)
 */

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const fail = (m) => { throw new Error(m); };
const rid = randomBytes(3).toString('hex');
let partnerId = null;

async function main() {
  // 1. notify_email column exists + defaults true.
  const p = await db.from('referral_partner')
    .insert({ type: 'owner', status: 'active', display_name: 'VERIFY B4', referral_code: `ZZB4${rid.toUpperCase()}` })
    .select('id, notify_email').single();
  if (p.error && /notify_email/.test(p.error.message)) fail('notify_email column missing — apply 20260828e first.');
  if (p.error) fail(`create referrer: ${p.error.message}`);
  partnerId = p.data.id;
  if (p.data.notify_email !== true) fail(`notify_email should default true, got ${p.data.notify_email}`);
  console.log('PASS: referral_partner.notify_email exists and defaults true');

  // 2. referral_notification_log accepts a row + reads back.
  const ins = await db.from('referral_notification_log').insert({
    partner_id: partnerId, event: 'status_change', channel: 'email',
    recipient: 'verify@example.com', status: 'skipped', detail: 'verify (no send)',
  }).select('id, event, status').single();
  if (ins.error) fail(`notification_log insert: ${ins.error.message}`);
  if (ins.data.event !== 'status_change' || ins.data.status !== 'skipped') fail('notification_log row mismatch');
  console.log('PASS: referral_notification_log records a notification (event + status)');
}

async function cleanup() {
  if (partnerId) await db.from('referral_partner').delete().eq('id', partnerId); // notif log cascades
  console.log('cleanup: test referrer (+notification log) removed');
}

main()
  .then(async () => { await cleanup(); console.log('\nALL BATCH 4 CHECKS PASSED — notification schema + log wiring verified (email delivery validated in pilot).'); process.exit(0); })
  .catch(async (e) => { console.error(`\nFAIL: ${e.message}`); try { await cleanup(); } catch (c) { console.error(`cleanup failed: ${c.message}`); } process.exit(1); });
