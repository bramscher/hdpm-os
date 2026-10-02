import { requireReferrer } from '@/lib/referrals/referrer-context';
import BrandButton from '@/components/referrals/BrandButton';
import { BOUNTY_STATUS_LABEL, bountyStatus, summarizeLedger } from '@/lib/referrals/bounty';
import type { LedgerEntry } from '@/lib/referrals/types';

const usd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

export const dynamic = 'force-dynamic';
export const metadata = { title: 'HDPM — Your referrals' };

/**
 * Referrer's own leads (Batch 3), read THROUGH RLS. hdpm-web brand styling.
 */
export default async function ReferrerLeadsPage() {
  const ctx = await requireReferrer();
  const { data: leads } = await ctx.supabase
    .from('referral_lead')
    .select('id, prospect_name, stage, created_at')
    .order('created_at', { ascending: false });
  // Bounty per lead (Batch 5), through RLS like the leads themselves.
  const { data: ledger } = await ctx.supabase.from('referral_ledger').select('lead_id, entry_type, amount');
  const byLead = new Map<string, Pick<LedgerEntry, 'entry_type' | 'amount'>[]>();
  for (const r of (ledger ?? []) as Pick<LedgerEntry, 'lead_id' | 'entry_type' | 'amount'>[]) {
    if (r.lead_id) byLead.set(r.lead_id, [...(byLead.get(r.lead_id) ?? []), r]);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-brand-greenDark">Referrals</p>
          <h1 className="mt-1 font-brand-heading text-2xl font-extrabold tracking-tight text-brand-ink">Your referrals</h1>
        </div>
        <BrandButton href="/partners/leads/new" withArrow>
          Submit a referral
        </BrandButton>
      </div>

      {(!leads || leads.length === 0) && (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-10 text-center text-sm text-neutral-400">
          No referrals yet. Submit your first one.
        </div>
      )}

      {leads && leads.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-[11px] uppercase tracking-wider text-neutral-400">
                <th className="px-5 py-3 font-semibold">Prospect</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Bounty</th>
                <th className="px-5 py-3 font-semibold">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className="border-b border-neutral-100 last:border-0">
                  <td className="px-5 py-3.5 font-semibold text-brand-ink">{l.prospect_name}</td>
                  <td className="px-5 py-3.5">
                    <span className="inline-flex items-center rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-700">
                      {l.stage}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-neutral-700">
                    {(() => {
                      const rows = byLead.get(l.id) ?? [];
                      const status = bountyStatus(rows);
                      return status === 'none' ? <span className="text-neutral-400">—</span> : `${usd(summarizeLedger(rows).earned)} · ${BOUNTY_STATUS_LABEL[status]}`;
                    })()}
                  </td>
                  <td className="px-5 py-3.5 text-neutral-500">{new Date(l.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
