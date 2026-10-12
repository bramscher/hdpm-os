import { redirect } from 'next/navigation';
import { requireSection } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { loadDashboard } from '@/lib/turnover/server';
import { todayPacific, type TurnView } from '@/lib/turnover/model';
import { TurnoverDashboard } from './dashboard';

export const metadata = { title: 'Unit Turnovers · HDPM OS' };
export const dynamic = 'force-dynamic';

const VIEWS: TurnView[] = ['active', 'not_yet_ready', 'completed', 'all'];

export default async function TurnoverTrackerPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const guard = await requireSection('brody_turnover');
  if (!guard.ok) redirect('/');
  const { view: raw } = await searchParams;
  const view = VIEWS.includes(raw as TurnView) ? (raw as TurnView) : 'active';
  const data = await loadDashboard(getSupabaseAdmin(), view, todayPacific());
  return <TurnoverDashboard data={data} view={view} />;
}
