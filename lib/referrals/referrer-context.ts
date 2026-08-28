/**
 * Referrer request context (Batch 2) — the guarded entry point for referrer
 * routes. The ESLint guardrail (.eslintrc.referrals.json) bans getSupabaseAdmin
 * under app/partners/**; this module is how a referrer route legitimately gets a
 * DB client — always the JWT-bound, RLS-enforced one from supabase-referrer.ts.
 *
 * NOTE: there is deliberately no @highdesertpm.com check here (that's the STAFF
 * guard). A referrer is any Supabase-authenticated user with a linked
 * referral_partner row.
 */

import { redirect } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createReferrerServerClient } from './supabase-referrer';
import type { ReferralPartner } from './types';

export interface ReferrerContext {
  supabase: SupabaseClient; // JWT-bound anon client (RLS as this referrer)
  userId: string; // auth.uid()
  email: string | null;
}

/** The logged-in referrer, or null. Never throws. */
export async function getReferrer(): Promise<ReferrerContext | null> {
  const supabase = await createReferrerServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { supabase, userId: user.id, email: user.email ?? null };
}

/** Require a logged-in referrer; redirect to the referrer login otherwise. */
export async function requireReferrer(): Promise<ReferrerContext> {
  const ctx = await getReferrer();
  if (!ctx) redirect('/partners/login');
  return ctx;
}

/**
 * The referrer's own partner row, read through RLS (proves the linkage). Returns
 * null if the auth user has no linked referral_partner yet (mid-onboarding).
 */
export async function getReferrerPartner(
  ctx: ReferrerContext
): Promise<ReferralPartner | null> {
  const { data, error } = await ctx.supabase
    .from('referral_partner')
    .select('*')
    .eq('auth_user_id', ctx.userId)
    .maybeSingle();
  if (error) throw new Error(`getReferrerPartner: ${error.message}`);
  return (data as ReferralPartner) ?? null;
}
