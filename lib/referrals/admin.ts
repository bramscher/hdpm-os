/**
 * Referral admin service layer (Batch 1) — the admin/staff path.
 *
 * All access here is the SERVICE-ROLE client behind requireReferralAdmin(): the
 * admin side is app-enforced (like the rest of HDPM-OS), NOT RLS-enforced. The
 * RLS path is the referrer side (Batch 2+). Keeping the two apart is the design
 * (plan §2/§3): getSupabaseAdmin() is correct HERE, banned in referrer routes.
 */

import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';
import { makeReferralCode } from './codes';
import { assertFeeAllowed } from './fee-policy';
import {
  type FeeKind,
  type FeePolicyRow,
  type PartnerType,
  type ReferralPartner,
} from './types';

type Guard =
  | { ok: true; email: string }
  | { ok: false; response: NextResponse };

/**
 * Who may work the referral pipeline. Admin-only for Batch 1 — matches the
 * proxy.ts edge gate on /partners/admin and the `isAdmin` page redirect, so all
 * three layers agree. Widen to manager/finance here (one place) when the
 * payout/ops batches need it.
 */
export async function requireReferralAdmin(): Promise<Guard> {
  const guard = await requireRole('admin');
  if (!guard.ok) return guard;
  return { ok: true, email: guard.email };
}

export async function listReferrers(): Promise<ReferralPartner[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('referral_partner')
    .select(
      'id, org_id, auth_user_id, type, status, display_name, company, email, phone, ' +
        'license_number, w9_status, w9_doc_path, legal_name, tax_id_last4, payout_method, ' +
        'payout_last4, agreement_accepted_at, referral_code, created_at, updated_at'
    )
    .eq('org_id', 'hdpm')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`listReferrers: ${error.message}`);
  // Cast through unknown: the concatenated column string defeats supabase-js's
  // literal-type inference (it can't parse a runtime-built select).
  return (data ?? []) as unknown as ReferralPartner[];
}

export async function getReferrer(id: string): Promise<ReferralPartner | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('referral_partner')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`getReferrer: ${error.message}`);
  return (data as ReferralPartner) ?? null;
}

export interface CreateReferrerInput {
  type: PartnerType;
  display_name: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  license_number?: string | null;
}

/** Create a referrer with a unique referral_code (collision-retry). status='pending'. */
export async function createReferrer(
  input: CreateReferrerInput,
  actor: string
): Promise<ReferralPartner> {
  const supabase = getSupabaseAdmin();

  let lastErr: string | null = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = makeReferralCode(input.display_name);
    const { data, error } = await supabase
      .from('referral_partner')
      .insert({
        type: input.type,
        status: 'pending',
        display_name: input.display_name,
        company: input.company ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        license_number: input.license_number ?? null,
        referral_code: code,
      })
      .select('*')
      .single();

    if (!error) {
      await logAudit('referral_partner', data.id, 'created', actor, {
        type: input.type,
        display_name: input.display_name,
        referral_code: code,
      });
      return data as ReferralPartner;
    }
    // 23505 = unique_violation (referral_code collision) → retry with a new code.
    if (error.code === '23505' && /referral_code/.test(error.message)) {
      lastErr = error.message;
      continue;
    }
    throw new Error(`createReferrer: ${error.message}`);
  }
  throw new Error(`createReferrer: could not generate a unique referral_code (${lastErr})`);
}

export async function setReferrerStatus(
  id: string,
  status: 'active' | 'paused' | 'terminated',
  actor: string
): Promise<ReferralPartner> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('referral_partner')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(`setReferrerStatus: ${error.message}`);
  await logAudit('referral_partner', id, 'status_change', actor, { status });
  return data as ReferralPartner;
}

export async function getFeePolicies(): Promise<FeePolicyRow[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('referral_fee_policy')
    .select('*')
    .eq('org_id', 'hdpm');
  if (error) throw new Error(`getFeePolicies: ${error.message}`);
  return (data ?? []) as FeePolicyRow[];
}

export interface SetTermsInput {
  fee_kind: FeeKind;
  bounty_mode?: string | null;
  bounty_amount?: number | null;
  bounty_trigger?: string | null;
  trailing_pct?: number | null;
  trailing_months?: number | null;
}

/**
 * Set a referrer's DEFAULT terms for a fee kind. GATED: throws FeeNotAllowedError
 * if referral_fee_policy.allowed is false for (partner.type, fee_kind) — the
 * Oregon eligibility switch. Upserts on (partner_id, fee_kind).
 */
export async function setReferrerTerms(
  partnerId: string,
  input: SetTermsInput,
  actor: string,
  today: string = new Date().toISOString().slice(0, 10)
): Promise<void> {
  const supabase = getSupabaseAdmin();

  const partner = await getReferrer(partnerId);
  if (!partner) throw new Error(`setReferrerTerms: no referrer ${partnerId}`);

  const policies = await getFeePolicies();
  assertFeeAllowed(policies, partner.type, input.fee_kind, today); // throws if disallowed

  const { error } = await supabase.from('referral_partner_terms').upsert(
    {
      partner_id: partnerId,
      fee_kind: input.fee_kind,
      bounty_mode: input.bounty_mode ?? null,
      bounty_amount: input.bounty_amount ?? null,
      bounty_trigger: input.bounty_trigger ?? null,
      trailing_pct: input.trailing_pct ?? null,
      trailing_months: input.trailing_months ?? null,
      active: true,
      set_by: actor,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'partner_id,fee_kind' }
  );
  if (error) throw new Error(`setReferrerTerms: ${error.message}`);
  await logAudit('referral_partner', partnerId, 'terms_set', actor, {
    fee_kind: input.fee_kind,
  });
}

/** Flip a fee-policy eligibility switch (the attorney-gated action). */
export async function setFeePolicyAllowed(
  partnerType: PartnerType,
  feeKind: FeeKind,
  allowed: boolean,
  actor: string
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('referral_fee_policy')
    .update({ allowed, updated_at: new Date().toISOString() })
    .eq('org_id', 'hdpm')
    .eq('partner_type', partnerType)
    .eq('fee_kind', feeKind);
  if (error) throw new Error(`setFeePolicyAllowed: ${error.message}`);
  await logAudit('referral_fee_policy', `${partnerType}:${feeKind}`, 'eligibility_change', actor, {
    allowed,
  });
}
