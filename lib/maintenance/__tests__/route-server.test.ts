import { describe, expect, it } from 'vitest';
import { routeLinks, toDayRoute, validatePublish } from '../route-server';

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const body = (extra: Record<string, unknown> = {}) => ({
  routeDate: '2026-10-20', assignedTech: 'Alberto', startTime: '07:30', notes: '  Bring the\nladder  ',
  stops: [
    { work_order_id: id(1), address: '3602 SW Badger Ave, Redmond, OR', lat: 44.25, lng: -121.19, drive_minutes_from_prev: 12.4, service_minutes: 90 },
    { work_order_id: id(2), address: '2150 NW 7th St, Redmond, OR', lat: 'x', lng: null, drive_minutes_from_prev: 999, service_minutes: 2 },
  ], ...extra,
});

describe('validatePublish', () => {
  it('normalises the route and clamps minutes; the server owns the times', () => {
    const v = validatePublish(body());
    expect(v).toMatchObject({ routeDate: '2026-10-20', assignedTech: 'Alberto', startTime: '07:30', notes: 'Bring the ladder', createCalendarEvent: true });
    expect(v.stops.map(s => [s.stop_order, s.drive_minutes_from_prev, s.service_minutes, s.lat])).toEqual([[1, 12, 90, 44.25], [2, 240, 5, null]]);
  });
  it('falls back to 8:00 and refuses bad routes', () => {
    expect(validatePublish(body({ startTime: '7am' })).startTime).toBe('08:00');
    expect(() => validatePublish(body({ routeDate: 'tomorrow' }))).toThrow(/route date/);
    expect(() => validatePublish(body({ assignedTech: ' ' }))).toThrow(/technician/);
    expect(() => validatePublish(body({ stops: [] }))).toThrow(/at least one stop/);
    expect(() => validatePublish(body({ stops: [body().stops[0], body().stops[0]] }))).toThrow(/different work order/);
    expect(() => validatePublish(body({ stops: [{ ...body().stops[0], address: '' }] }))).toThrow(/no address/);
  });
});

describe('toDayRoute', () => {
  const row = (n: number, extra: Record<string, unknown> = {}) => ({
    id: `s${n}`, route_plan_id: 'p', work_order_id: id(n), stop_order: n, address: 'A', lat: null, lng: null, drive_minutes_from_prev: 15, service_minutes: 60,
    estimated_arrival: null, estimated_departure: null, details: null,
    work_orders: { wo_number: `4328${n}-1`, property_name: 'Weinberger 284', unit_name: null, stage: 'SCHEDULED', description: 'Tenant Expense - Unit Turn Maintenance\nRemove TV mount' }, ...extra,
  });
  it('keeps stored times, recomputes missing ones, and falls back to the work order for the task', () => {
    const route = toDayRoute({ route_date: '2026-10-20', assigned_tech: 'Alberto', start_time: '07:30:00', notes: null }, [
      row(1, { estimated_arrival: '2026-10-20T14:50:00.000Z' }), row(2),
    ] as never);
    expect(route.startTime).toBe('07:30');
    expect(route.stops[0].arrival).toBe('2026-10-20T14:50:00.000Z');
    // 7:30 start, 15 min drive, 60 on site, 15 min drive: stop 2 at 8:00 AM Pacific.
    expect(route.stops[1].arrival).toBe('2026-10-20T16:00:00.000Z');
    expect(route.stops[1].details?.task).toBe('Remove TV mount');
  });
});

describe('routeLinks', () => {
  it('points the tech at My Day for that date and at the day sheet', () => {
    expect(routeLinks('https://os.example', 'p1', '2026-10-20')).toEqual({ myDay: 'https://os.example/maintenance/field?date=2026-10-20', daySheet: 'https://os.example/api/maintenance/routes/p1/day-sheet' });
  });
});
