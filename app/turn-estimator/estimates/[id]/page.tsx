import { requireEstimateAuthor } from '@/lib/require-estimate-author';
import { redirect } from 'next/navigation';
import EstimateReview from '@/components/turn-estimator/EstimateReview';

export const metadata = { title: 'HDPM — Review estimate' };
export default async function EstimatePage({ params }: { params: Promise<{ id: string }> }) {
  const guard = await requireEstimateAuthor(true);
  if (!guard.ok) redirect('/maintenance/invoices');
  const { id } = await params;
  return <main className="mx-auto max-w-4xl px-4 py-8"><EstimateReview estimateId={id}/></main>;
}
