import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { PageContainer, PageHeader } from '@/components/ui/page-header';
import { getPayoutsOverview } from '@/lib/referrals/payouts-server';
import PayoutsAdmin from './payouts-admin';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'HDPM-OS — Referral payouts' };

/** Admin → Partners → Payouts (Batch 8): pay approved bounties in a batch and export for QuickBooks. */
export default async function PayoutsPage() {
  const session = await auth();
  if (!session?.user?.isAdmin) redirect('/');
  const overview = await getPayoutsOverview().catch(() => ({ ready: [], batches: [] }));
  return (
    <PageContainer>
      <PageHeader
        title="Referral payouts"
        description="Approved bounties waiting to be paid. Pay them in QuickBooks, then record the batch here so referrers see it as paid."
        actions={
          <>
            <a href="/partners/admin" className="text-sm text-charcoal-600 hover:underline">Overview</a>
            <a href="/partners/admin/referrers" className="text-sm text-charcoal-600 hover:underline">Referrers</a>
            <a href="/partners/admin/leads" className="text-sm text-charcoal-600 hover:underline">Pipeline</a>
            <a href="/partners/admin/payouts/1099" className="text-sm text-charcoal-600 hover:underline">1099s</a>
          </>
        }
      />
      <PayoutsAdmin ready={overview.ready} batches={overview.batches} />
    </PageContainer>
  );
}
