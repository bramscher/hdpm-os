import { calendarDays, pacificDay, shiftDay, type Job, type Workspace } from './model';
import { remainingScope } from './planning';
import type { EstimateQueueItem } from '../turn-estimator/estimate-queue';

/** Monday-first full weeks, including muted adjacent-month dates. */
export function monthGridDays(day: string): string[] {
  const month = calendarDays(day, 'month');
  const offset = (new Date(`${month[0]}T12:00:00Z`).getUTCDay() + 6) % 7;
  return Array.from({ length: Math.ceil((offset + month.length) / 7) * 7 }, (_, i) => shiftDay(month[0], i - offset));
}
export function appointmentTime(minutes: number): string {
  const hour = Math.floor(minutes / 60) % 24;
  return `${hour % 12 || 12}:${String(minutes % 60).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}${minutes >= 1440 ? ' next day' : ''}`;
}
export interface SchedulingQueueRow { key: string; job?: Job; estimates: EstimateQueueItem[] }
/** One card per work order, with all its approved estimates retained for review. */
export function schedulingQueue(data: Workspace, estimates: EstimateQueueItem[], filter = '', today = pacificDay()): SchedulingQueueRow[] {
  const groups = new Map<string, SchedulingQueueRow>();
  const scheduled = (job: Job) => data.visits.some(v => v.job_id === job.id && v.status === 'planned' && v.work_date >= today);
  const needsVisit = (job: Job) => job.status === 'active' && !scheduled(job) && (!data.tasks.some(t => t.job_id === job.id) || remainingScope(data, job.id).length > 0);
  for (const job of data.jobs.filter(needsVisit)) groups.set(job.work_order_id, { key: job.work_order_id, job, estimates: [] });
  for (const estimate of estimates.filter(e => e.stage === 'approved')) {
    const job = data.jobs.find(j => j.work_order_id === estimate.workOrderId);
    if (job && !needsVisit(job)) continue;
    const key = estimate.workOrderId || `estimate:${estimate.id}`;
    const group = groups.get(key) || { key, job, estimates: [] };
    group.estimates.push(estimate); groups.set(key, group);
  }
  const query = filter.trim().toLowerCase();
  return [...groups.values()].filter(group => !query || [group.job?.property_name, group.job?.unit_name, group.job?.title, ...group.estimates.flatMap(e => [e.property, e.unit, e.workOrder])].join(' ').toLowerCase().includes(query));
}
