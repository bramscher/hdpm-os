import { describe, expect, it } from 'vitest';
import { computeBoardKpis } from '../board-kpis';
import { filterDashboardInputs, type DashboardInputs } from '../dashboard';
import type { MaintWorkOrder, TripwireException } from '../types';

const NOW = new Date('2026-10-18T18:00:00Z');
const wo = (id: string, description: string, extra: Partial<MaintWorkOrder> = {}) =>
  ({ id, description, appfolio_recurring: false, created_at: '2026-10-01T00:00:00Z', appfolio_created_at: null, next_action_date: null, owner_name: 'Cheryl', priority_class: 'P3', ...extra }) as unknown as MaintWorkOrder;
const ex = (workOrderId: string | null): TripwireException => ({ tripwire: 3, label: '#3', item: 'x', fixRequired: 'y', owner: 'Cheryl', workOrderId: workOrderId ?? undefined }) as TripwireException;

const open = [
  wo('w1', 'Irrigation Winterization', { appfolio_recurring: true, created_at: '2026-08-01T00:00:00Z' }),
  wo('w2', 'Irrigation / Winterization', { next_action_date: '2026-10-01' }),
  wo('r1', 'Leaky faucet', { next_action_date: '2026-10-10' }),
  wo('r2', 'No heat', { priority_class: 'P1', created_at: '2026-10-15T00:00:00Z' }),
];

describe('board header numbers', () => {
  it('count only what is passed in', () => {
    expect(computeBoardKpis(open, [], NOW)).toMatchObject({ open: 4, pastDue: 2, aging30Plus: 1, p1ThisWeek: 1 });
    const kept = open.filter((w) => w.id.startsWith('r'));
    expect(computeBoardKpis(kept, [], NOW)).toMatchObject({ open: 2, pastDue: 1, aging30Plus: 0, p1ThisWeek: 1, ownerAndDateCoverage: 50 });
  });
});

describe('dashboard with the recurring filter', () => {
  const inputs = {
    snapshot: { openWorkOrders: open },
    tripwires: { exceptions: [ex('w1'), ex('r1'), ex(null)], needsDate: [ex('w1'), ex('r2')], needsDateCount: 2, ruleErrors: [], ranAt: '' },
    closed: [{ id: 'c1', description: 'Irrigation Winterization', appfolio_recurring: true }, { id: 'c2', description: 'Fix door' }],
  } as unknown as DashboardInputs;

  it('leaves everything alone for all work', () => {
    expect(filterDashboardInputs(inputs, 'all')).toBe(inputs);
  });

  it('hides recurring work from open, closed, exceptions and needs-a-date', () => {
    const hidden = filterDashboardInputs(inputs, 'hide');
    expect(hidden.snapshot.openWorkOrders.map((w) => w.id)).toEqual(['r1', 'r2']);
    expect(hidden.tripwires.exceptions.map((e) => e.workOrderId)).toEqual(['r1', undefined]);
    expect(hidden.tripwires.needsDateCount).toBe(1);
    expect(hidden.closed.map((c) => c.id)).toEqual(['c2']);
  });

  it('shows only recurring work', () => {
    const only = filterDashboardInputs(inputs, 'only');
    expect(only.snapshot.openWorkOrders.map((w) => w.id)).toEqual(['w1', 'w2']);
    expect(only.tripwires.exceptions.map((e) => e.workOrderId)).toEqual(['w1']); // unit-turn hits aren't recurring work
    expect(only.closed.map((c) => c.id)).toEqual(['c1']);
  });
});
