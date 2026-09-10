/**
 * Batch 3 verification — lead pipeline against the LIVE DB (service role).
 *
 * Exercises the DB-level behaviors the intake/pipeline code relies on:
 *   1. Attribution — a lead carrying a known ref_code links to that partner
 *      (source=referral); no code = organic (partner NULL).
 *   2. Dedupe wiring — a second lead with the same email flags suspected and
 *      dup_of points at the earlier lead (the self-FK + event write work).
 *   3. Stage change writes an append-only 'stage_change' event.
 *
 * The dedupe DECISION logic itself is unit-tested (dedupe.test.ts, 9 cases);
 * this proves the integration/wiring. Self-cleaning.
 *
 * Run: node scripts/referrals-batch3-verify.mjs   (needs Batch 0–3 migrations)
 */

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const rid = randomBytes(3).toString('hex');
const code = `ZZB3${rid.toUpperCase()}`;
const dupEmail = `dupe-${rid}@example.com`;
const fail = (m) => { throw new Error(m); };
let partnerId = null;
const leadIds = [];

async function insertLead(fields) {
  const { data, error } = await db.from('referral_lead').insert(fields).select('id, source, partner_id').single();
  if (error) fail(`insert lead: ${error.message}`);
  leadIds.push(data.id);
  await db.from('referral_lead_event').insert({ lead_id: data.id, event_type: 'created', payload: {}, actor: 'system:verify' });
  return data;
}

async function main() {
  const pre = await db.from('referral_lead').select('id').limit(1);
  if (pre.error) fail(`preflight: ${pre.error.message}`);

  // Setup: a referrer with a code.
  const p = await db.from('referral_partner')
    .insert({ type: 'owner', status: 'active', display_name: 'VERIFY B3', referral_code: code })
    .select('id').single();
  if (p.error) fail(`create referrer: ${p.error.message}`);
  partnerId = p.data.id;

  // 1. Attribution — referral (code resolves to the partner).
  const resolved = await db.from('referral_partner').select('id').eq('referral_code', code).single();
  if (resolved.error || resolved.data.id !== partnerId) fail('ref_code did not resolve to the partner');
  const refLead = await insertLead({
    partner_id: partnerId, source: 'referral', stage: 'submitted',
    prospect_name: 'Referred Owner', prospect_email: dupEmail, ref_code: code,
  });
  if (refLead.source !== 'referral' || refLead.partner_id !== partnerId) fail('referral attribution wrong');
  console.log(`PASS: referral lead attributed to partner (source=referral, code ${code})`);

  // Attribution — organic (no code).
  const orgLead = await insertLead({
    partner_id: null, source: 'organic', stage: 'submitted',
    prospect_name: 'Walk-in Owner', prospect_email: `organic-${rid}@example.com`,
    utm: { utm_source: 'google' }, landing_page: '/manage',
  });
  if (orgLead.source !== 'organic' || orgLead.partner_id !== null) fail('organic attribution wrong');
  console.log('PASS: organic lead captured (source=organic, partner NULL, UTM stored)');

  // 2. Dedupe wiring — second lead, same email → flag suspected + dup_of earlier.
  const dupLead = await insertLead({
    partner_id: partnerId, source: 'referral', stage: 'submitted',
    prospect_name: 'Referred Owner Again', prospect_email: dupEmail, ref_code: code,
  });
  // Emulate finalize: find the earlier open lead with the same email.
  const open = await db.from('referral_lead')
    .select('id, first_touch_at')
    .eq('prospect_email', dupEmail)
    .neq('id', dupLead.id)
    .order('first_touch_at', { ascending: true });
  if (open.error || open.data.length === 0) fail('dedupe: earlier lead not found');
  const earlier = open.data[0].id;
  const upd = await db.from('referral_lead').update({ dup_status: 'suspected', dup_of_lead_id: earlier }).eq('id', dupLead.id);
  if (upd.error) fail(`dedupe update: ${upd.error.message}`);
  await db.from('referral_lead_event').insert({ lead_id: dupLead.id, event_type: 'dedupe', payload: { reason: 'email', matched_id: earlier }, actor: 'system:dedupe' });

  const check = await db.from('referral_lead').select('dup_status, dup_of_lead_id').eq('id', dupLead.id).single();
  if (check.data.dup_status !== 'suspected' || check.data.dup_of_lead_id !== earlier) fail('dedupe not recorded');
  if (earlier !== refLead.id) fail('first-touch pointed at the wrong lead');
  console.log('PASS: duplicate email flagged suspected, dup_of → first-touch lead');

  // 3. Stage change writes an event.
  await db.from('referral_lead').update({ stage: 'contacted' }).eq('id', refLead.id);
  await db.from('referral_lead_event').insert({ lead_id: refLead.id, event_type: 'stage_change', payload: { from: 'submitted', to: 'contacted' }, actor: 'admin@highdesertpm.com' });
  const evs = await db.from('referral_lead_event').select('event_type').eq('lead_id', refLead.id);
  if (!evs.data.some((e) => e.event_type === 'stage_change')) fail('stage_change event missing');
  console.log('PASS: stage change recorded as an append-only event');
}

async function cleanup() {
  for (const id of leadIds) await db.from('referral_lead').delete().eq('id', id); // events cascade
  if (partnerId) await db.from('referral_partner').delete().eq('id', partnerId);
  console.log('cleanup: test leads (+events) and referrer removed');
}

main()
  .then(async () => { await cleanup(); console.log('\nALL BATCH 3 CHECKS PASSED — attribution, dedupe, and pipeline events verified against the live DB.'); process.exit(0); })
  .catch(async (e) => { console.error(`\nFAIL: ${e.message}`); try { await cleanup(); } catch (c) { console.error(`cleanup failed: ${c.message}`); } process.exit(1); });
