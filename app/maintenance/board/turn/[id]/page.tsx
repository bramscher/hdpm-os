import '../../maintenance-theme.css';
import { loadTurnSchedule } from '@/lib/maintenance/load-turn-schedule';
import TurnGantt from './TurnGantt';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Turn Schedule — HDMS Maintenance',
};

export default async function TurnSchedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await loadTurnSchedule(id);

  if (!data) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center text-sm text-charcoal-500">
        Turn not found. <a href="/maintenance/board?view=turnover" className="text-sky-600 hover:underline">Back to the turnover board</a>.
      </div>
    );
  }

  return <TurnGantt turn={data.turn} schedule={data.schedule} today={data.today} />;
}
