import { pacificDay, shiftDay, type Workspace, type Task } from './model';

export interface Workweek {
  weekdays: number[];
  start: string;
  end: string;
  paidBreak: number;
  unpaidBreak: number;
}
export interface AvailabilityProfile {
  person: string;
  enabled: boolean;
  starts_on: string;
  ends_on: string | null;
  schedule: Workweek | null;
  exceptions: { date: string; off: boolean; unavailableMinutes: number }[];
}
export interface PlannedValue {
  visitId: string;
  jobId: string;
  person: string;
  day: string;
  revenue: number;
  service: number;
  priced: boolean;
}
export const clockMinutes = (value: string) => {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
};
const cents = (value: number) => Math.round(Number(value) * 100);
export function remainingScope(data: Workspace, jobId: string): Task[] {
  return data.tasks.filter(task => task.job_id === jobId && task.approved &&
    !data.allocations.some(a => a.task_id === task.id) &&
    !data.records.some(r => r.task_id === task.id && r.progress === 'done' && !['draft','returned'].includes(r.status)));
}
/** Allocate a job's remaining approved value once across all upcoming planned crew minutes. */
export function plannedValues(data: Workspace, asOf = pacificDay()): PlannedValue[] {
  const result: PlannedValue[] = [];
  for (const job of data.jobs) {
    const visits = data.visits.filter(v => v.job_id === job.id && v.status === 'planned' && v.work_date >= asOf)
      .sort((a,b) => a.work_date.localeCompare(b.work_date) || a.id.localeCompare(b.id));
    const slots = visits.flatMap(v => [...new Set(v.technicians)].sort().map(person => ({visit:v, person})));
    const minutes = slots.reduce((sum, s) => sum + s.visit.planned_minutes, 0);
    if (!minutes) continue;
    const remaining = remainingScope(data, job.id);
    const total = remaining.reduce((sum,t) => sum + cents(t.amount), 0);
    const service = remaining.reduce((sum,t) => sum + cents(t.service_value), 0);
    const priced = data.tasks.some(t => t.job_id === job.id && t.approved);
    let used = 0, usedService = 0;
    slots.forEach((slot, index) => {
      const last = index === slots.length - 1;
      const revenue = last ? total - used : Math.floor(total * slot.visit.planned_minutes / minutes);
      const value = last ? service - usedService : Math.floor(service * slot.visit.planned_minutes / minutes);
      used += revenue; usedService += value;
      result.push({visitId:slot.visit.id,jobId:job.id,person:slot.person,day:slot.visit.work_date,revenue:revenue/100,service:value/100,priced});
    });
  }
  return result;
}
/** Job capacity excludes all planned breaks. Overnight work is split over the actual calendar dates. */
export function workCapacity(profile: AvailabilityProfile | undefined, day: string): number | null {
  if (!profile) return null;
  if (!profile.enabled || day < profile.starts_on || (profile.ends_on && day > profile.ends_on)) return 0;
  const exception = profile.exceptions.find(e => e.date === day);
  if (exception?.off) return 0;
  const schedule = profile.schedule;
  if (!schedule) return null;
  const start = clockMinutes(schedule.start), end = clockMinutes(schedule.end);
  const duration = (end > start ? end : end + 1440) - start;
  if (!(duration > 0)) return null;
  const net = Math.max(0, duration - schedule.paidBreak - schedule.unpaidBreak);
  let capacity = 0;
  for (const anchor of [shiftDay(day,-1),day]) {
    if (anchor < profile.starts_on || (profile.ends_on && anchor > profile.ends_on)) continue;
    if (!schedule.weekdays.includes(new Date(`${anchor}T12:00:00Z`).getUTCDay())) continue;
    const offset = anchor === day ? 0 : -1440;
    const overlap = Math.max(0, Math.min(1440,offset+start+duration)-Math.max(0,offset+start));
    capacity += net * overlap / duration;
  }
  return Math.max(0, Math.round(capacity) - (exception?.unavailableMinutes || 0));
}
export function dayPlan(data: Workspace, person: string, day: string, excludeVisit?: string) {
  const visits = data.visits.filter(v => v.id !== excludeVisit && v.work_date === day && v.status !== 'cancelled' && v.technicians.includes(person));
  const booked = visits.reduce((sum,v) => sum + v.planned_minutes, 0);
  const capacity = workCapacity(data.availability?.find(p => p.person === person), day);
  const sorted = [...visits].sort((a,b)=>a.start_minute-b.start_minute);
  let end = -1, conflict = false;
  for (const v of sorted) { if (v.start_minute < end) conflict = true; end = Math.max(end,v.start_minute+v.planned_minutes); }
  return {booked,capacity,available:capacity === null ? null : Math.max(0,capacity-booked),overbooked:capacity === null ? null : Math.max(0,booked-capacity),conflict};
}
