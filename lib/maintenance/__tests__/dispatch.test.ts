import { describe, expect, it } from 'vitest';
import type { MaintWorkOrder, VendorAssignment } from '../types';
import {
  dispatchPlacement,
  inPile,
  inUnassignedColumn,
  indexVendors,
  livePlansByWo,
  type DispatchVendor,
} from '../dispatch';
import { parseTarget } from '../dispatch-db';

const HDMS: DispatchVendor = { id: 'v-hdms', name: 'High Desert Maintenance Services', appfolio_vendor_id: 'af-hdms' };
const ACME: DispatchVendor = { id: 'v-acme', name: 'Acme Plumbing', appfolio_vendor_id: 'af-acme' };
const BOLT: DispatchVendor = { id: 'v-bolt', name: 'Bolt Electric', appfolio_vendor_id: 'af-bolt' };
const vendors = indexVendors([HDMS, ACME, BOLT]);

function wo(o: Partial<MaintWorkOrder> = {}): MaintWorkOrder {
  return {
    id: 'wo-1', description: 'Leaky faucet', property_name: 'Elm', unit_name: null, stage: 'NEW',
    priority_class: 'P3', next_action_date: null, assigned_tech: null, vendor_id: null, vendor_name: null,
    created_at: '2026-10-01T00:00:00Z', appfolio_created_at: null,
    ...o,
  } as MaintWorkOrder;
}

function plan(o: Partial<VendorAssignment> = {}): VendorAssignment {
  return {
    id: 'a-1', work_order_id: 'wo-1', vendor_id: ACME.id, sent_at: '2026-10-10T00:00:00Z', accepted_at: null,
    declined_at: null, scheduled_at: null, completed_at: null, callback: false, created_by: 'Brody',
    created_at: '2026-10-10T00:00:00Z', source: 'board', withdrawn_at: null, af_vendor_at_plan: null,
    ...o,
  };
}

describe('dispatchPlacement', () => {
  it('puts a work order with nothing on it in Unassigned', () => {
    const p = dispatchPlacement(wo(), undefined, vendors);
    expect(p.column).toBe('unassigned');
    expect(p.needsAppFolio).toBeNull();
  });

  it('puts an in-house tech first, and nudges when AppFolio is not HDMS', () => {
    const onHdms = dispatchPlacement(wo({ assigned_tech: 'alberto', vendor_id: 'af-hdms', vendor_name: HDMS.name }), plan(), vendors);
    expect(onHdms.column).toBe('tech:Alberto');
    expect(onHdms.needsAppFolio).toBeNull();
    const notHdms = dispatchPlacement(wo({ assigned_tech: 'Brody' }), undefined, vendors);
    expect(notHdms.needsAppFolio).toEqual({ kind: 'hdms' });
  });

  it('shows a board plan with an AppFolio nudge until the sync matches', () => {
    const planned = dispatchPlacement(wo(), plan(), vendors);
    expect(planned.column).toBe('vendor:v-acme');
    expect(planned.needsAppFolio).toEqual({ kind: 'vendor', vendorName: 'Acme Plumbing' });
    const synced = dispatchPlacement(wo({ vendor_id: 'af-acme', vendor_name: ACME.name }), plan(), vendors);
    expect(synced.column).toBe('vendor:v-acme');
    expect(synced.needsAppFolio).toBeNull();
  });

  it('keeps the plan while AppFolio still shows the vendor it had when planned', () => {
    const p = dispatchPlacement(wo({ vendor_id: 'af-bolt', vendor_name: BOLT.name }), plan({ af_vendor_at_plan: 'af-bolt' }), vendors);
    expect(p.column).toBe('vendor:v-acme');
    expect(p.needsAppFolio?.kind).toBe('vendor');
  });

  it('lets AppFolio win when it moves to a third vendor after the plan', () => {
    const p = dispatchPlacement(wo({ vendor_id: 'af-bolt', vendor_name: BOLT.name }), plan({ af_vendor_at_plan: null }), vendors);
    expect(p.column).toBe('vendor:v-bolt');
    expect(p.planned).toBeNull();
    expect(p.needsAppFolio).toBeNull();
  });

  it('sends HDMS work with no tech to the Unassigned pile', () => {
    const p = dispatchPlacement(wo({ vendor_id: 'af-hdms', vendor_name: HDMS.name }), undefined, vendors);
    expect(p.hdmsNoTech).toBe(true);
    expect(inUnassignedColumn(p)).toBe(true);
    expect(inPile('hdms_no_tech', wo(), p, '2026-10-18', '2026-10-11T00:00:00Z')).toBe(true);
  });

  it('keeps vendors missing from our table in their own AppFolio column', () => {
    const p = dispatchPlacement(wo({ vendor_id: 'af-ghost', vendor_name: 'Ghost LLC' }), undefined, vendors);
    expect(p.column).toBe('af:af-ghost');
  });
});

describe('piles and plans', () => {
  const today = '2026-10-18';
  const weekAgo = '2026-10-11T00:00:00Z';
  const p = dispatchPlacement(wo(), undefined, vendors);

  it('sorts work orders into smart piles', () => {
    expect(inPile('p1p2', wo({ priority_class: 'P2' }), p, today, weekAgo)).toBe(true);
    expect(inPile('p1p2', wo({ priority_class: 'P3' }), p, today, weekAgo)).toBe(false);
    expect(inPile('overdue', wo({ next_action_date: '2026-10-17' }), p, today, weekAgo)).toBe(true);
    expect(inPile('overdue', wo({ next_action_date: '2026-10-18' }), p, today, weekAgo)).toBe(false);
    expect(inPile('needs_date', wo(), p, today, weekAgo)).toBe(true);
    expect(inPile('new_week', wo({ appfolio_created_at: '2026-10-15T00:00:00Z' }), p, today, weekAgo)).toBe(true);
    expect(inPile('new_week', wo({ appfolio_created_at: '2026-09-01T00:00:00Z', created_at: '2026-10-15T00:00:00Z' }), p, today, weekAgo)).toBe(false);
    expect(inPile('waiting', wo({ stage: 'WAITING_ON' }), p, today, weekAgo)).toBe(true);
  });

  it('uses only the newest live board plan per work order', () => {
    const plans = livePlansByWo([
      plan({ id: 'old', created_at: '2026-10-01T00:00:00Z' }),
      plan({ id: 'new', created_at: '2026-10-05T00:00:00Z' }),
      plan({ id: 'gone', created_at: '2026-10-09T00:00:00Z', withdrawn_at: '2026-10-09T01:00:00Z' }),
      plan({ id: 'manual', created_at: '2026-10-09T00:00:00Z', source: 'manual' }),
    ]);
    expect(plans.get('wo-1')?.id).toBe('new');
  });
});

describe('parseTarget', () => {
  it('accepts known techs, vendors and unassigned only', () => {
    expect(parseTarget({ kind: 'tech', person: 'alberto' })).toEqual({ kind: 'tech', person: 'Alberto' });
    expect(parseTarget({ kind: 'tech', person: 'Bryce' })).toBeNull();
    expect(parseTarget({ kind: 'vendor', vendor_id: 'v-acme' })).toEqual({ kind: 'vendor', vendor_id: 'v-acme' });
    expect(parseTarget({ kind: 'vendor' })).toBeNull();
    expect(parseTarget({ kind: 'unassigned' })).toEqual({ kind: 'unassigned' });
    expect(parseTarget(null)).toBeNull();
  });
});

describe('week helpers', () => {
  it('finds the Monday of any day, Sunday included', async () => {
    const { mondayOf, weekDays } = await import('../dispatch');
    expect(mondayOf('2026-10-18')).toBe('2026-10-12'); // Sunday
    expect(mondayOf('2026-10-19')).toBe('2026-10-19'); // Monday
    expect(mondayOf('2026-10-22')).toBe('2026-10-19');
    expect(weekDays('2026-10-26')).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
  });

  it('plans next week once it is the weekend', async () => {
    const { planningMonday } = await import('../dispatch');
    expect(planningMonday('2026-10-16')).toBe('2026-10-12'); // Friday
    expect(planningMonday('2026-10-17')).toBe('2026-10-19'); // Saturday
    expect(planningMonday('2026-10-18')).toBe('2026-10-19'); // Sunday
  });

  it('adds days across the daylight-saving change without slipping', async () => {
    const { addDays } = await import('../dispatch');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(addDays('2026-03-07', 2)).toBe('2026-03-09');
  });

  it('reads AppFolio timestamps as Pacific dates', async () => {
    const { pacificDate } = await import('../dispatch');
    expect(pacificDate('2026-10-23')).toBe('2026-10-23');
    expect(pacificDate('2026-10-24T03:00:00Z')).toBe('2026-10-23'); // 8 PM Pacific
    expect(pacificDate(null)).toBeNull();
  });

  it('nudges for a vendor date until AppFolio shows the same day', async () => {
    const { vendorDateToSet, vendorDateIso } = await import('../dispatch');
    const dated = plan({ scheduled_at: vendorDateIso('2026-10-23') });
    expect(vendorDateToSet(wo({ scheduled_start: null }), dated)).toBe('2026-10-23');
    expect(vendorDateToSet(wo({ scheduled_start: '2026-10-23T16:00:00Z' }), dated)).toBeNull();
    expect(vendorDateToSet(wo({ scheduled_start: '2026-10-21' }), dated)).toBe('2026-10-23');
    expect(vendorDateToSet(wo(), plan())).toBeNull();
  });
});
