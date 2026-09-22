import { describe, expect, it } from 'vitest';
import { dayRouteLinks, drivingLink, scheduledDayRoute } from '../day-route';
import type { Job, Visit } from '../model';
const job = (id: string, address = `${id} Main St, Redmond, OR`): Job => ({ id, property_address: address, property_name: id, work_order_id: id, unit_name: null, title: 'Repair', status: 'active', progress_billing: false, approval_note: '' });
const visit = (id: string, start: number, extra: Partial<Visit> = {}): Visit => ({ id, job_id: id, work_date: '2026-09-23', technicians: ['Alberto'], start_minute: start, planned_minutes: 60, status: 'planned', note: '', version: 1, source: 'local_plan', ...extra });
describe('calendar day routes', () => {
  it('keeps appointment order, shared crew visits, and repeat visits without including cancelled/completed/other days', () => {
    const visits = [visit('b', 600, { technicians: ['Alberto', 'Brody'] }), visit('a', 480), visit('repeat', 700, { job_id: 'a' }), visit('cancelled', 500, { status: 'cancelled' }), visit('complete', 500, { status: 'complete' }), visit('tomorrow', 500, { work_date: '2026-09-24' }), visit('other', 500, { technicians: ['Brody'] })];
    const route = scheduledDayRoute([job('a'), job('b')], visits, 'Alberto', '2026-09-23');
    expect(route.map(s => s.visit.id)).toEqual(['a', 'b', 'repeat']);
    expect(route.map(s => s.gapMinutes)).toEqual([null, 60, 40]);
    expect(visits[0].id).toBe('b');
  });
  it('shows overlaps instead of silently reordering appointments', () => {
    const route = scheduledDayRoute([job('a'), job('b')], [visit('a', 480), visit('b', 510)], 'Alberto', '2026-09-23');
    expect(route[1].gapMinutes).toBe(-30);
  });
  it('blocks full directions if any job is missing or lacks an address', () => {
    const route = scheduledDayRoute([job('a')], [visit('a', 480), visit('missing', 600)], 'Alberto', '2026-09-23');
    expect(route).toHaveLength(2); expect(dayRouteLinks(route)).toEqual([]);
    expect(drivingLink([''])).toBeNull();
  });
  it('splits long days into mobile-compatible parts with continuous origins', () => {
    const jobs = Array.from({ length: 10 }, (_, i) => job(String(i)));
    const stops = scheduledDayRoute(jobs, jobs.map((j, i) => visit(j.id, 480 + i * 60)), 'Alberto', '2026-09-23');
    const links = dayRouteLinks(stops);
    expect(links.map(l => [l.first, l.last])).toEqual([[1, 4], [5, 8], [9, 10]]);
    const first = new URL(links[0].href).searchParams, second = new URL(links[1].href).searchParams;
    expect(first.has('origin')).toBe(false);
    expect(first.get('waypoints')?.split('|')).toHaveLength(3);
    expect(second.get('origin')).toBe(jobs[3].property_address);
    expect(second.get('destination')).toBe(jobs[7].property_address);
  });
  it('encodes addresses without injecting directions parameters', () => {
    const address = '12 A & B St #2, Bend, OR';
    const url = new URL(drivingLink([address])!);
    expect(url.hostname).toBe('www.google.com'); expect(url.searchParams.get('destination')).toBe(address);
    expect(url.searchParams.get('travelmode')).toBe('driving');
  });
  it('never emits an oversized URL or drops an oversized stop', () => {
    expect(drivingLink(['a'.repeat(2100)])).toBeNull();
    expect(dayRouteLinks(scheduledDayRoute([job('a', 'a'.repeat(2100))], [visit('a', 480)], 'Alberto', '2026-09-23'))).toEqual([]);
  });
});
