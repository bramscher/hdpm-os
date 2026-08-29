import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { PageContainer, PageHeader } from '@/components/ui/page-header';
import { listReferrers, getFeePolicies } from '@/lib/referrals/admin';
import ReferrersAdmin from './referrers-admin';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'HDPM-OS — Referrers' };

/**
 * Admin → Referral partners (Batch 1). Create referrers, set default fee terms
 * (gated on the Oregon eligibility switch), pause/activate. Referrer login and
 * the lead pipeline arrive in Batches 2–3.
 */
export default async function ReferrersPage() {
  const session = await auth();
  if (!session?.user?.isAdmin) redirect('/');

  const [referrers, policies] = await Promise.all([listReferrers(), getFeePolicies()]);

  return (
    <PageContainer>
      <PageHeader
        title="Referral partners"
        description="Owners, agents, builders and vendors who send us owner leads. Create a referrer to mint their referral code; set default fee terms once the fee type is legally enabled."
        actions={
          <>
            <a href="/partners/admin" className="text-sm text-charcoal-600 hover:underline">Overview</a>
            <a href="/partners/admin/leads" className="text-sm text-charcoal-600 hover:underline">Pipeline</a>
            <a href="/partners/admin/fee-policy" className="text-sm text-charcoal-600 hover:underline">Fee policy</a>
          </>
        }
      />
      <ReferrersAdmin initialReferrers={referrers} policies={policies} />
    </PageContainer>
  );
}
