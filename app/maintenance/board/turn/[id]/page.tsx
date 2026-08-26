import '../../maintenance-theme.css';
import { getSupabaseAdmin } from '@/lib/supabase';
import { buildTurnSchedule, type TurnTaskInput } from '@/lib/maintenance/turn-schedule';
import TurnGantt from './TurnGantt';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Turn Schedule — HDMS Maintenance',
};

const TASK_COLS =
  'id, wo_number, description, unit_turn_category, stage, scheduled_start, scheduled_end, completed_date, next_action_date, appfolio_created_at, created_at, owner_name, appfolio_link';

function pacificToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

export default async function TurnSchedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const { data: turn } = await supabase
    .from('unit_turn')
    .select(
      'id, property_name, unit_name, unit_id, vacated_at, target_ready, movein_date, budget, actual, current_blocker, af_unit_link, status'
    )
    .eq('id', id)
    .maybeSingle();

  if (!turn) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center text-sm text-charcoal-500">
        Turn not found. <a href="/maintenance/board?view=turnover" className="text-sky-600 hover:underline">Back to the turnover board</a>.
      </div>
    );
  }

  const [{ data: woRows }, vacancy] = await Promise.all([
    supabase.from('work_orders').select(TASK_COLS).eq('unit_turn_id', id),
    turn.unit_id
      ? supabase
          .from('cached_vacancies')
          .select('available_date')
          .eq('appfolio_unit_id', turn.unit_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const availableDate = (vacancy?.data?.available_date as string | undefined)?.trim() || null;
  const today = pacificToday();

  const schedule = buildTurnSchedule(
    { vacated_at: turn.vacated_at, target_ready: turn.target_ready, movein_date: turn.movein_date },
    (woRows ?? []) as TurnTaskInput[],
    availableDate,
    today
  );

  return (
    <TurnGantt
      turn={{
        id: turn.id,
        propertyName: turn.property_name,
        unitName: turn.unit_name,
        vacatedAt: turn.vacated_at,
        targetReady: turn.target_ready,
        moveinDate: turn.movein_date,
        availableDate,
        budget: turn.budget,
        actual: turn.actual,
        currentBlocker: turn.current_blocker,
        afUnitLink: turn.af_unit_link,
      }}
      schedule={schedule}
      today={today}
    />
  );
}
