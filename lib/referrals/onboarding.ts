/**
 * Referrer onboarding — the token-gated accept flow (Batch 2).
 *
 * Runs pre-auth (the referrer isn't logged in yet), authorized by the invite
 * token, so it legitimately uses the service role. Kept in lib/ (not a referrer
 * route) by design: the ESLint guardrail bans service-role clients in referrer
 * routes; the thin accept route delegates here.
 *
 * Links the Supabase Auth user, encrypts the TIN, stores the W-9, records the
 * agreement acceptance, and activates the partner. After this, the referrer logs
 * in via magic link (their email is already confirmed).
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';
import { encryptField, last4 } from './crypto';
import { getValidInvite, consumeInvite } from './invites';
import { uploadW9 } from './storage';
import { AGREEMENT_VERSION, agreementSha256 } from './agreement';

export interface AcceptInput {
  token: string;
  email: string;
  agreementAccepted: boolean;
  legalName?: string | null;
  taxId?: string | null; // raw TIN — encrypted here, never stored cleartext
  taxAddress?: Record<string, unknown> | null;
  w9?: { bytes: Buffer; contentType: string } | null;
  ip?: string | null;
}

/** Find the Supabase Auth user for an email, creating one (confirmed) if absent. */
async function findOrCreateAuthUser(email: string): Promise<string> {
  const supabase = getSupabaseAdmin();
  const created = await supabase.auth.admin.createUser({ email, email_confirm: true });
  if (created.data?.user) return created.data.user.id;

  // Already registered → find them (paginate a bounded number of pages).
  const emailLower = email.toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`findOrCreateAuthUser: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === emailLower);
    if (hit) return hit.id;
    if (data.users.length < 200) break; // last page
  }
  throw new Error(`findOrCreateAuthUser: could not create or locate an auth user for ${email}`);
}

export interface AcceptResult {
  partnerId: string;
  email: string;
}

export async function acceptInvite(input: AcceptInput): Promise<AcceptResult> {
  if (!input.agreementAccepted) throw new Error('The referral agreement must be accepted to continue.');

  const invite = await getValidInvite(input.token);
  if (!invite) throw new Error('This invite link is invalid, expired, or already used.');
  if (input.email.trim().toLowerCase() !== invite.email.toLowerCase()) {
    throw new Error('Email does not match this invitation.');
  }

  const supabase = getSupabaseAdmin();
  const authUserId = await findOrCreateAuthUser(invite.email);

  const patch: Record<string, unknown> = {
    auth_user_id: authUserId,
    status: 'active',
    agreement_accepted_at: new Date().toISOString(),
    agreement_version: AGREEMENT_VERSION,
    agreement_text_sha256: agreementSha256(),
    agreement_accepted_ip: input.ip ?? null,
    updated_at: new Date().toISOString(),
  };
  if (input.legalName) patch.legal_name = input.legalName;
  if (input.taxId) {
    patch.tax_id_encrypted = encryptField(input.taxId);
    patch.tax_id_last4 = last4(input.taxId);
  }
  if (input.taxAddress) patch.tax_address = input.taxAddress;
  if (input.w9) {
    patch.w9_doc_path = await uploadW9(invite.partner_id, input.w9.bytes, input.w9.contentType);
    patch.w9_status = 'on_file';
  }

  const { error } = await supabase.from('referral_partner').update(patch).eq('id', invite.partner_id);
  if (error) throw new Error(`acceptInvite: ${error.message}`);

  await consumeInvite(invite.id);
  await logAudit('referral_partner', invite.partner_id, 'onboarded', `referrer:${invite.email}`, {
    agreement_version: AGREEMENT_VERSION,
    w9: !!input.w9,
    tin: !!input.taxId,
  });

  return { partnerId: invite.partner_id, email: invite.email };
}

/** Public-safe partner summary for the accept page (no PII). */
export async function invitePartnerSummary(
  token: string
): Promise<{ display_name: string; email: string; type: string } | null> {
  const invite = await getValidInvite(token);
  if (!invite) return null;
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('referral_partner')
    .select('display_name, email, type')
    .eq('id', invite.partner_id)
    .maybeSingle();
  return data ?? null;
}
