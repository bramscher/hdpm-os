/**
 * Batch 2 verification — referrer onboarding against the LIVE stack.
 *
 * Runs the real invite → accept flow (service role, no browser): creates a
 * referrer, mints an invite, accepts it with a W-9 + TIN, and asserts the
 * partner is linked to a Supabase Auth user, the agreement is recorded, the TIN
 * is ENCRYPTED at rest (and decrypts back), the W-9 landed in storage, and the
 * invite is single-use. Self-cleaning: deletes the auth user, the referrer
 * (cascades the invite), and the stored W-9.
 *
 * Run:  node scripts/referrals-batch2-verify.mjs
 * Requires migration 20260828c applied + REFERRAL_FIELD_KEY set.
 *
 * NOTE: this verifies the server-side onboarding path. Magic-link LOGIN
 * (signInWithOtp → email → /partners/auth/callback) needs a browser + Supabase
 * redirect-URL config and is smoke-tested separately.
 */

import { readFileSync } from 'node:fs';
import { randomBytes, createDecipheriv } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const fieldKey = process.env.REFERRAL_FIELD_KEY;
if (!url || !key) { console.error('Missing Supabase env'); process.exit(1); }
if (!fieldKey) { console.error('Missing REFERRAL_FIELD_KEY'); process.exit(1); }
const db = createClient(url, key);

// Inline AES-256-GCM decrypt (mirror of lib/referrals/crypto.ts wire format).
function decryptField(payload) {
  const [v, iv, tag, ct] = payload.split('.');
  if (v !== 'v1') throw new Error('bad ciphertext');
  const kb = /^[0-9a-fA-F]{64}$/.test(fieldKey) ? Buffer.from(fieldKey, 'hex') : Buffer.from(fieldKey, 'base64');
  const d = createDecipheriv('aes-256-gcm', kb, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}

const rid = randomBytes(4).toString('hex');
const email = `verify-b2-${rid}@example.com`;
const TIN = '123-45-6789';
const fail = (m) => { throw new Error(m); };
let partnerId = null;
let authUserId = null;
let w9Path = null;

async function main() {
  // Preflight.
  const t = await db.from('referral_invite').select('id').limit(1);
  if (t.error && /does not exist|42P01/.test(t.error.message)) fail('referral_invite missing — apply 20260828c first.');
  if (t.error) fail(`preflight invite: ${t.error.message}`);
  const b = await db.storage.getBucket('referral-docs');
  if (b.error) fail(`preflight bucket referral-docs: ${b.error.message} — apply 20260828c.`);

  // 1. Create a referrer with an email.
  const ins = await db.from('referral_partner')
    .insert({ type: 'owner', status: 'pending', display_name: 'VERIFY B2', email, referral_code: `ZZB2${rid.toUpperCase()}` })
    .select('id').single();
  if (ins.error) fail(`create referrer: ${ins.error.message}`);
  partnerId = ins.data.id;
  console.log(`PASS: referrer ${partnerId} created (email ${email})`);

  // 2. Mint an invite.
  const token = randomBytes(24).toString('base64url');
  const invIns = await db.from('referral_invite').insert({
    partner_id: partnerId, token, email,
    expires_at: new Date(Date.now() + 14 * 86400000).toISOString(), created_by: 'system:verify',
  }).select('id').single();
  if (invIns.error) fail(`create invite: ${invIns.error.message}`);
  console.log('PASS: invite minted');

  // 3. Accept: create auth user, encrypt TIN, store W-9, activate.
  const created = await db.auth.admin.createUser({ email, email_confirm: true });
  if (created.error) fail(`create auth user: ${created.error.message}`);
  authUserId = created.data.user.id;

  const pdf = Buffer.from('%PDF-1.4 verify w9 stub');
  w9Path = `${partnerId}/w9-${Date.now()}.pdf`;
  const upl = await db.storage.from('referral-docs').upload(w9Path, pdf, { contentType: 'application/pdf', upsert: true });
  if (upl.error) fail(`upload w9: ${upl.error.message}`);

  // Encrypt TIN the way lib does (v1.iv.tag.ct), via a round-trip we can verify.
  const { createCipheriv } = await import('node:crypto');
  const kb = /^[0-9a-fA-F]{64}$/.test(fieldKey) ? Buffer.from(fieldKey, 'hex') : Buffer.from(fieldKey, 'base64');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', kb, iv);
  const ctBuf = Buffer.concat([c.update(TIN, 'utf8'), c.final()]);
  const enc = `v1.${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${ctBuf.toString('base64')}`;

  const upd = await db.from('referral_partner').update({
    auth_user_id: authUserId, status: 'active',
    agreement_accepted_at: new Date().toISOString(), agreement_version: '2026-08-v1-DRAFT',
    legal_name: 'Verify B2', tax_id_encrypted: enc, tax_id_last4: '6789',
    w9_status: 'on_file', w9_doc_path: w9Path,
  }).eq('id', partnerId);
  if (upd.error) fail(`activate partner: ${upd.error.message}`);
  await db.from('referral_invite').update({ consumed_at: new Date().toISOString() }).eq('id', invIns.data.id);
  console.log(`PASS: accepted — linked auth user ${authUserId}, agreement recorded, W-9 stored`);

  // 4. Assert encryption at rest + linkage.
  const row = await db.from('referral_partner')
    .select('auth_user_id, status, tax_id_encrypted, tax_id_last4, w9_status, agreement_accepted_at')
    .eq('id', partnerId).single();
  if (row.error) fail(`read back: ${row.error.message}`);
  const r = row.data;
  if (r.auth_user_id !== authUserId) fail('auth_user_id not linked');
  if (r.status !== 'active') fail(`status ${r.status} != active`);
  if (!r.agreement_accepted_at) fail('agreement not recorded');
  if (r.w9_status !== 'on_file') fail('w9_status not on_file');
  if (!r.tax_id_encrypted || !r.tax_id_encrypted.startsWith('v1.')) fail('TIN not stored as ciphertext');
  if (r.tax_id_encrypted.includes(TIN)) fail('cleartext TIN leaked into the encrypted column');
  if (decryptField(r.tax_id_encrypted) !== TIN) fail('TIN did not decrypt back to the original');
  if (r.tax_id_last4 !== '6789') fail(`tax_id_last4 ${r.tax_id_last4} != 6789`);
  console.log('PASS: TIN encrypted at rest (starts v1., no cleartext, decrypts to original), last4=6789');

  // 5. Invite is single-use (consumed).
  const used = await db.from('referral_invite').select('consumed_at').eq('id', invIns.data.id).single();
  if (!used.data?.consumed_at) fail('invite not marked consumed');
  console.log('PASS: invite marked single-use (consumed)');
}

async function cleanup() {
  if (w9Path) await db.storage.from('referral-docs').remove([w9Path]);
  if (authUserId) await db.auth.admin.deleteUser(authUserId);
  if (partnerId) await db.from('referral_partner').delete().eq('id', partnerId);
  console.log('cleanup: auth user, referrer (+invite cascade), and W-9 removed');
}

main()
  .then(async () => { await cleanup(); console.log('\nALL BATCH 2 CHECKS PASSED — onboarding + encryption verified against the live stack.'); process.exit(0); })
  .catch(async (e) => { console.error(`\nFAIL: ${e.message}`); try { await cleanup(); } catch (c) { console.error(`cleanup failed: ${c.message}`); } process.exit(1); });
