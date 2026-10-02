import { redirect, notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { PageContainer } from '@/components/ui/page-header';
import { getLeadWithEvents } from '@/lib/referrals/leads';
import { getLeadAgreement, getLeadLedger, previewBounty } from '@/lib/referrals/ledger';
import LeadDetail from './lead-detail';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'HDPM-OS — Lead' };

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.isAdmin) redirect('/');

  const { id } = await params;
  const result = await getLeadWithEvents(id);
  if (!result) notFound();
  // Bounty data is best-effort: before the Batch 5 migration the card just shows nothing earned.
  const ledger = await getLeadLedger(id).catch(() => []);
  const [agreement, preview] = await Promise.all([
    getLeadAgreement(id).catch(() => null),
    previewBounty(result.lead, ledger).catch(() => null),
  ]);

  return (
    <PageContainer>
      <LeadDetail lead={result.lead} events={result.events} ledger={ledger} agreement={agreement} preview={preview} />
    </PageContainer>
  );
}
