/**
 * Referrer invites (Batch 2) — admin-minted, single-use onboarding tokens.
 *
 * The admin generates an invite link and delivers it themselves (no email
 * dependency — the chosen onboarding path). The token authorizes the pre-auth
 * accept flow; all reads/writes here are the service-role client (admin path).
 */

import { randomBytes } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';

const INVITE_TTL_DAYS = 14;

export interface CreatedInvite {
  token: string;
  url: string;
  email: string;
  expires_at: string;
}

export interface InviteRow {
  id: string;
  partner_id: string;
  token: string;
  email: string;
  expires_at: string;
  consumed_at: string | null;
}

/** Create (or refresh) an invite for a referrer. baseUrl = request origin. */
export async function createInvite(
  partnerId: string,
  actor: string,
  baseUrl: string
): Promise<CreatedInvite> {
  const supabase = getSupabaseAdmin();

  const { data: partner, error: pErr } = await supabase
    .from('referral_partner')
    .select('id, email, display_name')
    .eq('id', partnerId)
    .maybeSingle();
  if (pErr) throw new Error(`createInvite: ${pErr.message}`);
  if (!partner) throw new Error(`createInvite: no referrer ${partnerId}`);
  if (!partner.email) throw new Error('createInvite: referrer has no email on file — add one first');

  const token = randomBytes(24).toString('base64url'); // ~192 bits
  const expires_at = new Date(Date.now() + INVITE_TTL_DAYS * 86400_000).toISOString();

  const { error } = await supabase.from('referral_invite').insert({
    partner_id: partnerId,
    token,
    email: partner.email,
    expires_at,
    created_by: actor,
  });
  if (error) throw new Error(`createInvite: ${error.message}`);

  await logAudit('referral_partner', partnerId, 'invited', actor, { email: partner.email });
  return {
    token,
    url: `${baseUrl.replace(/\/$/, '')}/partners/invite/${token}`,
    email: partner.email,
    expires_at,
  };
}

/** Resolve a token to a valid (unconsumed, unexpired) invite, or null. */
export async function getValidInvite(token: string): Promise<InviteRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('referral_invite')
    .select('id, partner_id, token, email, expires_at, consumed_at')
    .eq('token', token)
    .maybeSingle();
  if (error) throw new Error(`getValidInvite: ${error.message}`);
  if (!data) return null;
  if (data.consumed_at) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) return null;
  return data as InviteRow;
}

export async function consumeInvite(inviteId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('referral_invite')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', inviteId);
  if (error) throw new Error(`consumeInvite: ${error.message}`);
}
