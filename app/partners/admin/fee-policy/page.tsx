import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { PageContainer, PageHeader } from '@/components/ui/page-header';
import { getFeePolicies } from '@/lib/referrals/admin';
import FeePolicyAdmin from './fee-policy-admin';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'HDPM-OS — Fee policy' };

/**
 * Admin → Fee policy (Batch 1). The data-driven Oregon compensation-eligibility
 * matrix. Every cell is seeded OFF; turning one ON asserts counsel has confirmed
 * that (referrer type × fee kind) is legal to pay. No fee terms can be set for a
 * disabled cell.
 */
export default async function FeePolicyPage() {
  const session = await auth();
  if (!session?.user?.isAdmin) redirect('/');

  const policies = await getFeePolicies();

  return (
    <PageContainer>
      <PageHeader
        title="Fee policy — compensation eligibility"
        description="Oregon restricts paying compensation for real-estate activity to licensed persons. Enable a cell only after your attorney confirms that referrer type may be paid that fee kind. This is a policy switch, not a bug — disabled cells block fee terms by design."
      />
      <FeePolicyAdmin initialPolicies={policies} />
    </PageContainer>
  );
}
