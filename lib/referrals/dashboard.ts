/**
 * Referral admin dashboard stats (Batch 4 UI) — service-role counts for the
 * /partners/admin overview hub.
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import { BACKFILL_STAGES, OPEN_LEAD_STAGES } from './types';
import { summarizeLedger } from './bounty';

export interface ReferralAdminStats {
  referrersTotal: number;
  referrersActive: number;
  w9Missing: number;
  leadsTotal: number;
  leadsOpen: number;
  suspectedDupes: number;
  leadsReferral: number;
  leadsOrganic: number;
  /** Referrals still being worked (submitted/contacted/qualified) not on the website pipeline board because they have no email (the website needs one). */
  notOnBoardNeedsEmail: number;
  /** Referrals still being worked with an email that still have no website lead (a push failed; retry from the Pipeline page). */
  notOnBoardUnpushed: number;
  /** Batch 5 bounty totals ($). 0 before the ledger migration / any bounties. */
  bountyPendingApproval: number;
  bountyApprovedUnpaid: number;
  bountyPaid: number;
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
    notOnBoardNeedsEmail,
    notOnBoardUnpushed,
  ] = await Promise.all([
    partner(),
    partner().eq('status', 'active'),
    partner().eq('w9_status', 'missing').neq('status', 'terminated'),
    lead(),
    lead().in('stage', OPEN_LEAD_STAGES),
    lead().eq('dup_status', 'suspected'),
    lead().eq('source', 'referral'),
    lead().eq('source', 'organic'),
    lead().in('stage', [...BACKFILL_STAGES]).is('hdpm_web_lead_id', null).is('prospect_email', null),
    lead().in('stage', [...BACKFILL_STAGES]).is('hdpm_web_lead_id', null).not('prospect_email', 'is', null),
  ]);

  const n = (r: { count: number | null; error: unknown }, label: string): number => {
    if (r.error) throw new Error(`dashboard ${label}: ${(r.error as { message?: string }).message ?? 'error'}`);
    return r.count ?? 0;
  };

  const { data: ledgerRows } = await db.from('referral_ledger').select('entry_type, amount').eq('org_id', 'hdpm');
  const money = summarizeLedger((ledgerRows ?? []) as { entry_type: 'earned'; amount: number }[]);

  return {
    bountyPendingApproval: money.pendingApproval,
    bountyApprovedUnpaid: money.approvedUnpaid,
    bountyPaid: money.paid,
    referrersTotal: n(referrersTotal, 'referrersTotal'),
    referrersActive: n(referrersActive, 'referrersActive'),
    w9Missing: n(w9Missing, 'w9Missing'),
    leadsTotal: n(leadsTotal, 'leadsTotal'),
    leadsOpen: n(leadsOpen, 'leadsOpen'),
    suspectedDupes: n(suspectedDupes, 'suspectedDupes'),
    leadsReferral: n(leadsReferral, 'leadsReferral'),
    leadsOrganic: n(leadsOrganic, 'leadsOrganic'),
    notOnBoardNeedsEmail: n(notOnBoardNeedsEmail, 'notOnBoardNeedsEmail'),
    notOnBoardUnpushed: n(notOnBoardUnpushed, 'notOnBoardUnpushed'),
  };
}
