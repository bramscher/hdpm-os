/**
 * Referral admin dashboard stats (Batch 4 UI) — service-role counts for the
 * /partners/admin overview hub.
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import { OPEN_LEAD_STAGES } from './types';

export interface ReferralAdminStats {
  referrersTotal: number;
  referrersActive: number;
  w9Missing: number;
  leadsTotal: number;
  leadsOpen: number;
  suspectedDupes: number;
  leadsReferral: number;
  leadsOrganic: number;
}

export async function getReferralAdminStats(): Promise<ReferralAdminStats> {
  const db = getSupabaseAdmin();
  const partner = () => db.from('referral_partner').select('*', { count: 'exact', head: true }).eq('org_id', 'hdpm');
  const lead = () => db.from('referral_lead').select('*', { count: 'exact', head: true }).eq('org_id', 'hdpm');

  const [
    referrersTotal,
    referrersActive,
    w9Missing,
    leadsTotal,
    leadsOpen,
    suspectedDupes,
    leadsReferral,
    leadsOrganic,
  ] = await Promise.all([
    partner(),
    partner().eq('status', 'active'),
    partner().eq('w9_status', 'missing').neq('status', 'terminated'),
    lead(),
    lead().in('stage', OPEN_LEAD_STAGES),
    lead().eq('dup_status', 'suspected'),
    lead().eq('source', 'referral'),
    lead().eq('source', 'organic'),
  ]);

  const n = (r: { count: number | null; error: unknown }, label: string): number => {
    if (r.error) throw new Error(`dashboard ${label}: ${(r.error as { message?: string }).message ?? 'error'}`);
    return r.count ?? 0;
  };

  return {
    referrersTotal: n(referrersTotal, 'referrersTotal'),
    referrersActive: n(referrersActive, 'referrersActive'),
    w9Missing: n(w9Missing, 'w9Missing'),
    leadsTotal: n(leadsTotal, 'leadsTotal'),
    leadsOpen: n(leadsOpen, 'leadsOpen'),
    suspectedDupes: n(suspectedDupes, 'suspectedDupes'),
    leadsReferral: n(leadsReferral, 'leadsReferral'),
    leadsOrganic: n(leadsOrganic, 'leadsOrganic'),
  };
}
