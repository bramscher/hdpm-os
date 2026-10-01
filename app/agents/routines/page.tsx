import Link from 'next/link';
import { PageContainer, PageHeader } from '@/components/ui/page-header';
import RoutineCalendar from '@/components/agents/RoutineCalendar';
import { loadRoutineViews } from '@/lib/routines/status';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Routine calendar · HDPM OS',
};

/**
 * /agents/routines — every scheduled job on a Monday–Sunday week grid (Pacific),
 * coloured by its last recorded run. Covered by the `agents` section prefix.
 */
export default async function RoutinesPage() {
  const now = new Date();
  const { routines, logReady } = await loadRoutineViews(now);
  return (
    <PageContainer width="full">
      <PageHeader
        title="Routine calendar"
        description="Every scheduled job this week, who hears from it, and how its last run went."
        actions={
          <Link href="/agents" className="inline-flex min-h-10 items-center rounded-lg border border-sand-200 px-4 text-sm">
            Back to Agents
          </Link>
        }
      />
      <RoutineCalendar routines={routines} logReady={logReady} nowIso={now.toISOString()} />
    </PageContainer>
  );
}
