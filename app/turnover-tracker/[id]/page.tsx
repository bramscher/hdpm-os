import { notFound, redirect } from 'next/navigation';
import { requireSection } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { loadDetail } from '@/lib/turnover/server';
import { todayPacific } from '@/lib/turnover/model';
import { TurnDetail } from './detail';

export const metadata = { title: 'Unit turnover · HDPM OS' };
export const dynamic = 'force-dynamic';

export default async function TurnoverDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const guard = await requireSection('brody_turnover');
  if (!guard.ok) redirect('/');
  const { id } = await params;
  const detail = await loadDetail(getSupabaseAdmin(), id, todayPacific());
  if (!detail) notFound();
  return <TurnDetail detail={detail} />;
}
