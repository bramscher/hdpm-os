import Link from 'next/link';
import { requireReferrer } from '@/lib/referrals/referrer-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'HDPM — Your referrals' };

/**
 * Referrer's own leads (Batch 3), read THROUGH RLS. A referrer sees status only
 * (stage), never the internal event history or other partners' leads.
 */
export default async function ReferrerLeadsPage() {
  const ctx = await requireReferrer();
  const { data: leads } = await ctx.supabase
    .from('referral_lead')
    .select('id, prospect_name, stage, created_at')
    .order('created_at', { ascending: false });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-charcoal-900">Your referrals</h1>
        <Link href="/partners/leads/new">
          <Button>Submit a referral</Button>
        </Link>
      </div>

      {(!leads || leads.length === 0) && (
        <div className="rounded-xl border border-dashed border-sand-300 bg-white p-8 text-center text-sm text-charcoal-400">
          No referrals yet. Submit your first one.
        </div>
      )}

      {leads && leads.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-sand-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand-200 text-left text-xs uppercase tracking-wide text-charcoal-400">
                <th className="px-4 py-3 font-medium">Prospect</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className="border-b border-sand-100 last:border-0">
                  <td className="px-4 py-3 font-medium text-charcoal-800">{l.prospect_name}</td>
                  <td className="px-4 py-3">
                    <Badge tone="neutral">{l.stage}</Badge>
                  </td>
                  <td className="px-4 py-3 text-charcoal-500">
                    {new Date(l.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
