import { describe, expect, it } from 'vitest';
import { candidateWorkOrders, matchStop, suggestCandidate, type MatchContext } from '../match';
import { workOrderTitle, type Candidate } from '../model';
import { DATE, LOWES, PLACES, WEINBERGER, offset, place, unit, wo } from './fixtures';

const ctx = (extra: Partial<MatchContext> & { workOrders?: ReturnType<typeof wo>[]; technician?: string } = {}): MatchContext => {
  const ranked = candidateWorkOrders(extra.workOrders ?? [wo('wo-wein', 'Weinberger 284')], extra.technician ?? 'Alberto', DATE);
  const candidates = new Map<string, Candidate[]>();
  for (const r of ranked) if (r.propertyId) candidates.set(r.propertyId, [...(candidates.get(r.propertyId) || []), r.candidate]);
  return { places: PLACES, units: [unit('u-wein', 'Weinberger 284', WEINBERGER)], candidates, inspectionStops: [], ...extra };
};

describe('candidateWorkOrders', () => {
  it('ranks this tech, then unassigned, then the other tech, and skips canceled or long-closed work', () => {
    const list = candidateWorkOrders([
      wo('mine', 'P'), wo('nobody', 'P', { assigned_to: null }), wo('brody', 'P', { assigned_to: 'Brody Bramscher' }),
      wo('canceled', 'P', { canceled_date: '2026-10-02' }), wo('old', 'P', { completed_date: '2026-09-20', status: 'done' }),
      wo('future', 'P', { created_at: '2026-10-09T16:00:00Z' }), wo('done-soon', 'P', { completed_date: '2026-10-12', status: 'done' }),
    ], 'Alberto', DATE);
    expect(Object.fromEntries(list.map(r => [r.candidate.work_order_id, r.candidate.tier]))).toEqual({ mine: 1, nobody: 2, brody: 3, 'done-soon': 1 });
  });

  it('suggests a work order only when one is clearly ahead', () => {
    const c = (id: string, tier: number, today = false) => ({ work_order_id: id, wo_number: id, property_name: 'P', tier, today });
    expect(suggestCandidate([c('a', 1), c('b', 2)])?.work_order_id).toBe('a');
    expect(suggestCandidate([c('a', 1), c('b', 1)])).toBeNull();
    // Two of the tech's own jobs at one property: no guess, even if one is dated today.
    expect(suggestCandidate([c('a', 1, true), c('b', 1)])).toBeNull();
    expect(suggestCandidate([c('a', 2, true), c('b', 3)])?.work_order_id).toBe('a');
  });
});

describe('matchStop', () => {
  it('picks the property with a work order over a nearer neighbour without one', () => {
    const neighbour = unit('u-next', 'Next Door', offset(WEINBERGER, 40, 0));
    const m = matchStop(offset(WEINBERGER, 35, 0), { ...ctx(), units: [unit('u-wein', 'Weinberger 284', WEINBERGER), neighbour] });
    expect(m).toMatchObject({ kind: 'job', propertyId: 'Weinberger 284', suggested: { work_order_id: 'wo-wein' } });
  });

  it('gives no suggestion when two properties at the same spot both have this tech’s work', () => {
    const units = [unit('u-a', 'Duplex A', WEINBERGER), unit('u-b', 'Duplex B', WEINBERGER)];
    const m = matchStop(WEINBERGER, { ...ctx({ workOrders: [wo('a', 'Duplex A'), wo('b', 'Duplex B')] }), units });
    expect(m).toMatchObject({ kind: 'job', suggested: null });
    expect(m.kind === 'job' && m.candidates.map(c => c.work_order_id).sort()).toEqual(['a', 'b']);
  });

  it('still matches a rural property geocoded 200 m away', () => {
    expect(matchStop(offset(WEINBERGER, 200, 0), ctx())).toMatchObject({ kind: 'job', propertyId: 'Weinberger 284' });
  });

  it('prefers a store to a property next to it', () => {
    const units = [unit('u-strip', 'Strip mall unit', offset(LOWES, 30, 0))];
    expect(matchStop(offset(LOWES, 40, 0), { ...ctx({ workOrders: [wo('strip', 'Strip mall unit')] }), units })).toMatchObject({ kind: 'place', place: { id: 'lowes' } });
  });

  it('ignores inactive locations', () => {
    const places = PLACES.map(p => (p.id === 'lowes' ? { ...p, active: false } : p));
    expect(matchStop(LOWES, { ...ctx(), places })).toEqual({ kind: 'unknown' });
  });

  it('labels a stop on the inspection route, unless the work order there is this tech’s', () => {
    const inspectionStops = [{ id: 'rs-1', unitRowId: 'u-wein', propertyId: 'Weinberger 284', unitId: 'u-wein-u', label: 'Weinberger 284', status: 'completed' }];
    expect(matchStop(WEINBERGER, { ...ctx({ technician: 'Brody' }), inspectionStops })).toMatchObject({ kind: 'inspection', stop: { id: 'rs-1' } });
    const brodys = ctx({ technician: 'Brody', workOrders: [wo('rekey', 'Weinberger 284', { assigned_to: 'Brody Bramscher' })] });
    expect(matchStop(WEINBERGER, { ...brodys, inspectionStops })).toMatchObject({ kind: 'job', suggested: { work_order_id: 'rekey' } });
  });

  it('records a property visit with no work order, and unknown places', () => {
    expect(matchStop(WEINBERGER, { ...ctx({ workOrders: [] }) })).toMatchObject({ kind: 'property', label: 'Weinberger 284' });
    expect(matchStop(offset(WEINBERGER, 5000, 5000), ctx())).toEqual({ kind: 'unknown' });
  });

  it('uses each location’s own radius', () => {
    const far = offset(LOWES, 180, 0);
    expect(matchStop(far, ctx())).toMatchObject({ kind: 'place', place: { id: 'lowes' } });
    expect(matchStop(far, { ...ctx(), places: [place('lowes', 'store', LOWES, { radiusM: 100 })] })).toEqual({ kind: 'unknown' });
  });
});

describe('workOrderTitle', () => {
  it('uses the first real task line of an AppFolio description', () => {
    expect(workOrderTitle('Tenant Expense - Unit Turn Maintenance\nRemove TV mount and repair Mounting holes\nRemove foam')).toBe('Remove TV mount and repair Mounting holes');
    expect(workOrderTitle('Tenant Expense - Remove all tenant items throughout and dispose\r\nshower curtains')).toBe('Remove all tenant items throughout and dispose');
    expect(workOrderTitle('Owner Expense - Unit Turn Maintenance\r\nPaint touch up - wear and tear throughout (some small spots, white marks)')).toBe('Paint touch up - wear and tear throughout…');
    expect(workOrderTitle(null)).toBe('');
  });
});
