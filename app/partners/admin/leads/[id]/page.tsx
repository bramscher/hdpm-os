import { redirect, notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { PageContainer } from '@/components/ui/page-header';
import { getLeadWithEvents } from '@/lib/referrals/leads';
import LeadDetail from './lead-detail';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'HDPM-OS — Lead' };

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.isAdmin) redirect('/');

  const { id } = await params;
  const result = await getLeadWithEvents(id);
  if (!result) notFound();

  return (
    <PageContainer>
      <LeadDetail lead={result.lead} events={result.events} />
    </PageContainer>
  );
}
