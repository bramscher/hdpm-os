import { describe, it, expect } from 'vitest';
import { STARTER_TEMPLATES } from '@/lib/turn-estimator/templates';
import { defaultLineCost, priceBookRate } from '@/lib/turn-estimator/price-book-display';
import type { PriceBookItem } from '@/lib/turn-estimator/types';

describe('Standard unit turn template', () => {
  const turn = STARTER_TEMPLATES.find((t) => t.id === 'starter-turn')!;

  it('includes a 1-hour dump run and a $10 dump fee after haul-away', () => {
    const codes = turn.entries.map((e) => e.item_code);
    const haul = codes.indexOf('HAUL_LOAD');
    expect(codes.slice(haul, haul + 3)).toEqual(['HAUL_LOAD', 'DUMP_RUN', 'DUMP_FEE']);
    expect(turn.entries.find((e) => e.item_code === 'DUMP_RUN')).toMatchObject({ minutes: '60', qty: '1' });
    expect(turn.entries.find((e) => e.item_code === 'DUMP_FEE')).toMatchObject({ material_cost: '10' });
    expect(turn.version).toBe(3);
  });

  it('replaces the old marked-up "Dump fees" materials line', () => {
    expect(turn.entries.some((e) => e.description === 'Dump fees')).toBe(false);
  });
});

describe('default line cost', () => {
  const base = { pricing_method: 'cost_plus', base_price: 10, markup_pct: 0, uom: 'each' } as PriceBookItem;

  it('pre-fills cost-plus lines from the price book default, never other methods', () => {
    expect(defaultLineCost(base)).toBe('10');
    expect(defaultLineCost({ ...base, base_price: 0 })).toBe('');
    expect(defaultLineCost({ ...base, pricing_method: 'hourly', base_price: 95 })).toBe('');
    expect(defaultLineCost(undefined)).toBe('');
  });

  it('shows the default in the rate text', () => {
    expect(priceBookRate(base)).toBe('Purchase cost plus 0% · default $10.00');
    expect(priceBookRate({ ...base, base_price: 0, markup_pct: 25 })).toBe('Purchase cost plus 25%');
  });
});
