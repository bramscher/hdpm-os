import { getSupabaseAdmin } from '@/lib/supabase';
import type { Interval } from '@/lib/field-time/model';
import { getClock, ownSheets } from '@/lib/timekeeping/server';
import type { Shift } from '@/lib/timekeeping/model';
import { workTime } from './model';

/**
 * A person's clocked-in time and timed breaks touching [from, to] (Pacific dates), from Timekeeping:
 * closed shifts on their sheets plus the shift still open on the clock (`open`). Timekeeping stays the payroll record.
 */
export async function loadWorkTime(person: string, from: string, to: string, now = Date.now()): Promise<{ windows: Interval[]; breaks: Interval[]; open: boolean }> {
  const { data: employee, error } = await getSupabaseAdmin().from('timekeeping_employee').select('id').eq('staff_person', person).maybeSingle();
  if (error) throw new Error(`timekeeping_employee: ${error.message}`);
  if (!employee) return { windows: [], breaks: [], open: false };
  const [sheets, clock] = await Promise.all([ownSheets(employee.id), getClock(employee.id)]);
  const shifts: Shift[] = sheets.flatMap(s => s.days.filter(d => d.date >= from && d.date <= to).flatMap(d => d.shifts));
  if (clock.shift) shifts.push(clock.shift);
  return { ...workTime(shifts, now), open: !!clock.shift };
}
