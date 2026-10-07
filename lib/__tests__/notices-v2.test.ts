import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildRealmxRequest, routeArrivals } from '../inspection-realmx-request';
import { checkRecipients } from '../inspection-notice-recipients';
import { rescheduleRoute } from '../inspection-route-reschedule';
import { recordNoticeResults } from '../inspection-notify';
import type { AppFolioTenant } from '../appfolio';

type Call = { table: string; ops: [string, unknown[]][] };
const op = (c: Call, name: string) => c.ops.find(([n]) => n === name)?.[1];
/** Chainable Supabase stand-in; `respond` decides each awaited result. */
function fake(respond: (c: Call, single: boolean) => { data: unknown; error: unknown }) {
  const calls: Call[] = [];
  const client = {
    from: (table: string) => {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const chain: unknown = new Proxy({}, {
        get: (_, prop: string) => {
          if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(respond(call, false));
          if (prop === 'maybeSingle' || prop === 'single') return async () => respond(call, true);
          return (...args: unknown[]) => { call.ops.push([prop, args]); return chain; };
        },
      });
      return chain;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe('arrival window and Realm-X request', () => {
  it('rounds the route window to half hours and skips skipped stops', () => {
    const { arrivals, window } = routeArrivals('08:00', [
      { travel_minutes_from_previous: 20, service_minutes: 15 },
      { status: 'skipped', travel_minutes_from_previous: 10 },
      { travel_minutes_from_previous: 30, service_minutes: 15 },
    ]);
    expect(arrivals).toEqual(['8:20 AM', null, '9:10 AM']);
    expect(window?.label).toBe('between 8:00 AM and 10:00 AM');
  });
  it('builds a paste-ready request with each unit once and the window in the body', () => {
    const { request, subject, body } = buildRealmxRequest({
      routeDate: '2026-10-14', windowLabel: 'between 8:00 AM and 10:00 AM',
      units: [{ address: '330 W 1st St #5, Prineville' }, { address: '330 W 1st St #5, Prineville' }, { address: '255 S Main St, Prineville' }],
    });
    expect(request.match(/330 W 1st St #5/g)).toHaveLength(1);
    expect(request).toContain('do not send yet');
    expect(subject).toContain('Wednesday, October 14, 2026');
    expect(body).toContain('between 8:00 AM and 10:00 AM');
    expect(buildRealmxRequest({ routeDate: '2026-10-14', units: [], dateChanged: true }).subject).toMatch(/^Updated:/);
  });
});

describe('recipient re-check', () => {
  const tenant = (over: Partial<AppFolioTenant>): AppFolioTenant => ({
    id: 't', firstName: 'Pat', lastName: 'Lee', propertyId: 'p', unitId: 'u1', status: 'Current', moveInOn: '2025-01-01', moveOutOn: null,
    leaseStartDate: null, leaseEndDate: null, email: 'pat@example.com', phone: '541-555-0100', address1: null, address2: null, city: null,
    currentRent: null, isPrimary: true, tenantType: 'Financially Responsible', ...over,
  });
  const notice = { id: 'n1', appfolio_unit_id: 'u1', target_date: '2026-10-14', resident_name: 'Pat Lee', email: 'pat@example.com' };

  it('lists current tenants and stays quiet when nothing changed', () => {
    const [r] = checkRecipients([notice], [tenant({}), tenant({ id: 't2', firstName: 'Sam', isPrimary: false, tenantType: 'Occupant', email: null })], '2026-10-05');
    expect(r.tenants.map((t) => t.name)).toEqual(['Pat Lee', 'Sam Lee']);
    expect(r.tenants[0].financially_responsible).toBe(true);
    expect(r.warnings).toEqual([]);
  });
  it('flags a changed tenant, a move-out before the visit, vacancy, and no email', () => {
    expect(checkRecipients([notice], [tenant({ firstName: 'Alex', email: 'alex@example.com' })], '2026-10-05')[0].warnings.join(' ')).toMatch(/changed since scheduling/);
    expect(checkRecipients([notice], [tenant({ moveOutOn: '2026-10-10' })], '2026-10-05')[0].warnings.join(' ')).toMatch(/moves out 2026-10-10/);
    expect(checkRecipients([notice], [tenant({ status: 'Past' })], '2026-10-05')[0].warnings.join(' ')).toMatch(/vacant/);
    expect(checkRecipients([notice], [tenant({ email: null })], '2026-10-05')[0].warnings.join(' ')).toMatch(/No email/);
    expect(checkRecipients([{ ...notice, appfolio_unit_id: null }], [], '2026-10-05')[0].warnings[0]).toMatch(/Not linked/);
  });
});

describe('rescheduleRoute', () => {
  const plan = { id: 'r1', route_date: '2026-10-14', start_time: '08:00', status: 'optimized' };
  const stops = [
    { id: 's1', inspection_id: 'i1', stop_order: 1, status: 'pending', travel_minutes_from_previous: 20, service_minutes: 15 },
    { id: 's2', inspection_id: 'i2', stop_order: 2, status: 'skipped', travel_minutes_from_previous: 10, service_minutes: 15 },
  ];
  const respond = (overrides: { plan?: unknown; stops?: unknown[]; noticed?: unknown[] } = {}) => (c: Call, single: boolean) => {
    if (c.table === 'route_plans' && single) return { data: overrides.plan ?? plan, error: null };
    if (c.table === 'route_stops' && op(c, 'select')) return { data: overrides.stops ?? stops, error: null };
    if (c.table === 'inspections' && op(c, 'select')) return { data: overrides.noticed ?? [{ id: 'i1', target_date: '2026-10-14', notice_previous_target_date: null }], error: null };
    return { data: null, error: null };
  };

  it('moves the route, its arrivals and inspections, and re-queues sent notices', async () => {
    const { client, calls } = fake(respond());
    const result = await rescheduleRoute(client, 'r1', '2026-10-16', '2026-10-05');
    expect(result).toEqual({ moved: true, from: '2026-10-14', to: '2026-10-16', renoticed: 1 });
    const updates = calls.filter((c) => op(c, 'update')).map((c) => ({ table: c.table, data: op(c, 'update')![0] as Record<string, unknown> }));
    expect(updates[0]).toMatchObject({ table: 'route_plans', data: { route_date: '2026-10-16' } });
    expect(updates.filter((u) => u.table === 'route_stops').map((u) => u.data.estimated_arrival)).toEqual(['2026-10-16T15:20:00.000Z', null]);
    expect(updates.find((u) => u.data.notice_sent_at === null)?.data).toMatchObject({ notice_previous_target_date: '2026-10-14', notice_status: 'pending' });
    const dated = calls.find((c) => c.table === 'inspections' && (op(c, 'update')?.[0] as Record<string, unknown>)?.target_date);
    expect(op(dated!, 'in')).toEqual(['id', ['i1']]);
  });
  it.each([
    ['too soon', '2026-10-08', {}, 400],
    ['too far', '2026-10-30', {}, 400],
    ['started route', '2026-10-16', { plan: { ...plan, status: 'in_progress' } }, 409],
    ['started stop', '2026-10-16', { stops: [{ ...stops[0], status: 'in_progress' }] }, 409],
    ['missing route', '2026-10-16', { plan: null }, 404],
  ])('refuses a %s without writing', async (_, date, overrides, status) => {
    const o = overrides as { plan?: unknown; stops?: unknown[] };
    const { client, calls } = fake((c, single) => (c.table === 'route_plans' && single && 'plan' in o ? { data: o.plan, error: null } : respond(o)(c, single)));
    expect(await rescheduleRoute(client, 'r1', date, '2026-10-05')).toMatchObject({ status });
    expect(calls.some((c) => op(c, 'update'))).toBe(false);
  });
});

describe('recordNoticeResults', () => {
  it('records who sent it and clears the date-changed marker', async () => {
    const { client, calls } = fake(() => ({ data: [], error: null }));
    await recordNoticeResults(client, [{ id: 'i1', status: 'sent' }], 'craig@highdesertpm.com');
    const update = calls.find((c) => op(c, 'update'));
    expect(op(update!, 'update')![0]).toMatchObject({ notice_status: 'sent', notice_sent_by: 'craig@highdesertpm.com', notice_previous_target_date: null });
  });
});

describe('notice contact number', () => {
  it('tells tenants to call the office, not the AI leasing line', () => {
    expect(buildRealmxRequest({ routeDate: '2026-10-14', units: [] }).body).toContain('(541) 548-0383');
    expect(buildRealmxRequest({ routeDate: '2026-10-14', units: [] }).body).not.toContain('406-6409');
  });
});
