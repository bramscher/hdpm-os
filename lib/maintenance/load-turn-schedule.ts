/**
 * Everything the turn Gantt chart needs for one unit turn: the turn, its work
 * orders laid out as a schedule, and today (Pacific). Shared by the
 * maintenance board's turn page and the Brody Turnover schedule popup.
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import { buildTurnSchedule, type TurnSchedule, type TurnTaskInput } from './turn-schedule';

const TASK_COLS =
  'id, wo_number, description, unit_turn_category, stage, scheduled_start, scheduled_end, completed_date, next_action_date, appfolio_created_at, created_at, owner_name, appfolio_link';

export interface TurnScheduleSummary {
  id: string;
  propertyName: string;
  unitName: string | null;
  vacatedAt: string;
  targetReady: string | null;
  moveinDate: string | null;
  availableDate: string | null;
  budget: number | null;
  actual: number | null;
  currentBlocker: string | null;
  afUnitLink: string | null;
}

function pacificToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

/** The turn's Gantt data, or null if there's no such turn. */
export async function loadTurnSchedule(
  id: string
): Promise<{ turn: TurnScheduleSummary; schedule: TurnSchedule; today: string } | null> {
  const supabase = getSupabaseAdmin();
  const { data: turn } = await supabase
    .from('unit_turn')
    .select(
      'id, property_name, unit_name, unit_id, vacated_at, target_ready, movein_date, budget, actual, current_blocker, af_unit_link, status'
    )
    .eq('id', id)
    .maybeSingle();
  if (!turn) return null;

  const [{ data: woRows }, vacancy] = await Promise.all([
    supabase.from('work_orders').select(TASK_COLS).eq('unit_turn_id', id),
    turn.unit_id
      ? supabase.from('cached_vacancies').select('available_date').eq('appfolio_unit_id', turn.unit_id).maybeSingle()
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

  return {
    turn: {
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
    },
    schedule,
    today,
  };
}
