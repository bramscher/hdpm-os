import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { PageContainer, PageHeader } from '@/components/ui/page-header';
import { listLeads } from '@/lib/referrals/leads';
import LeadsAdmin from './leads-admin';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'HDPM-OS — Referral pipeline' };

/**
 * Admin → Referral pipeline (Batch 3). The single owner-acquisition funnel:
 * referral + organic leads, filterable by stage/source. This is the SoR for
 * pipeline stage, attribution, and dedupe.
 */
export default async function LeadsPage() {
  const session = await auth();
  if (!session?.user?.isAdmin) redirect('/');

  const leads = await listLeads();

  return (
    <PageContainer>
      <PageHeader
        title="Referral pipeline"
        description="Every owner lead — referral and organic — in one funnel. Filter by stage or source; open a lead to see its history, resolve duplicates, and link it to AppFolio at signing."
        actions={
          <>
            <a href="/partners/admin/referrers" className="text-sm text-charcoal-600 hover:underline">Referrers</a>
            <a href="/partners/admin/fee-policy" className="text-sm text-charcoal-600 hover:underline">Fee policy</a>
          </>
        }
      />
      <LeadsAdmin initialLeads={leads} />
    </PageContainer>
  );
}
