import '../../../maintenance/board/maintenance-theme.css';
import { notFound, redirect } from 'next/navigation';
import { requireSection } from '@/lib/require-role';
import { loadTurnSchedule } from '@/lib/maintenance/load-turn-schedule';
import TurnGantt from '../../../maintenance/board/turn/[id]/TurnGantt';

export const metadata = { title: 'Turn schedule · HDPM OS' };
export const dynamic = 'force-dynamic';

/**
 * The turn's Gantt schedule on its own, for the pop-up window opened from
 * Brody Turnover (no sidebar; see AppShell). Resizing the window refits the
 * chart; − / Fit / + zoom.
 */
export default async function TurnSchedulePopupPage({ params }: { params: Promise<{ id: string }> }) {
  const guard = await requireSection('brody_turnover');
  if (!guard.ok) redirect('/');
  const { id } = await params;
  const data = await loadTurnSchedule(id);
  if (!data) notFound();
  return <TurnGantt turn={data.turn} schedule={data.schedule} today={data.today} popup />;
}
