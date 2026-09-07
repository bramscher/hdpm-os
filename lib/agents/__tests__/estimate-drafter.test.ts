import { describe, it, expect } from 'vitest';
import { priceDraftLines, type DraftLineSpec } from '../estimate-drafter';
import { type PriceBookItem, DEFAULT_ESTIMATOR_CONFIG } from '@/lib/turn-estimator/types';

function item(overrides: Partial<PriceBookItem> & { item_code: string }): PriceBookItem {
  return {
    id: overrides.item_code,
    org_id: 'hdpm',
    category: 'handyman',
    name: overrides.item_code,
    owner_description: null,
    internal_instructions: null,
    pricing_method: 'hourly',
    base_price: 95,
    included_minutes: null,
    increment_minutes: null,
    increment_price: null,
    standard_minutes: null,
    uom: 'hour',
    markup_pct: null,
    markup_eligible: true,
    gl_code: null,
    tenant_alloc_eligible: false,
    skill_trade: null,
    market: 'bend',
    effective_from: '2026-01-01',
    effective_to: null,
    active: true,
    created_by: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...overrides,
  };
}

const BOOK: PriceBookItem[] = [
  item({ item_code: 'LABOR_STD', pricing_method: 'hourly', base_price: 95, uom: 'hour' }),
  item({
    item_code: 'SVC_MIN',
    pricing_method: 'service_min',
    base_price: 125,
    included_minutes: 60,
    increment_minutes: 15,
    increment_price: 21.25,
    uom: 'visit',
  }),
  item({ item_code: 'MATERIALS_CP', pricing_method: 'cost_plus', base_price: 0, markup_pct: 25, category: 'materials', uom: 'each' }),
];

describe('priceDraftLines', () => {
  it('prices selected lines deterministically and totals them', () => {
    const specs: DraftLineSpec[] = [
      { item_code: 'SVC_MIN', minutes: 90, est_labor_hours: 1.5, description: 'Service call', confidence: 'high' },
      { item_code: 'LABOR_STD', est_labor_hours: 2, description: 'Patch & paint', confidence: 'medium' },
      { item_code: 'MATERIALS_CP', est_material_cost: 80, description: 'Paint', confidence: 'high' },
    ];
    const r = priceDraftLines(specs, BOOK, DEFAULT_ESTIMATOR_CONFIG);
    expect(r.unmapped_codes).toEqual([]);
    expect(r.lines).toHaveLength(3);
    const svc = r.lines.find((l) => l.item_code === 'SVC_MIN')!;
    expect(svc.owner_extended).toBe(167.5); // 125 + ceil(30/15)*21.25 — acceptance #3
    const labor = r.lines.find((l) => l.item_code === 'LABOR_STD')!;
    expect(labor.owner_extended).toBe(190); // 95 * 2
    const mat = r.lines.find((l) => l.item_code === 'MATERIALS_CP')!;
    expect(mat.owner_extended).toBe(100); // 80 cost + 25% markup
    expect(r.owner_total).toBe(457.5);
    // internal cost = labor hours * 35 + material cost
    expect(r.internal_cost_total).toBe(1.5 * 35 + 2 * 35 + 80);
  });

  it('drops hallucinated item codes into unmapped_codes (never priced)', () => {
    const specs: DraftLineSpec[] = [
      { item_code: 'LABOR_STD', est_labor_hours: 1, description: 'Fix', confidence: 'high' },
      { item_code: 'NOT_A_REAL_CODE', description: 'Mystery', confidence: 'low' },
    ];
    const r = priceDraftLines(specs, BOOK, DEFAULT_ESTIMATOR_CONFIG);
    expect(r.lines).toHaveLength(1);
    expect(r.unmapped_codes).toEqual(['NOT_A_REAL_CODE']);
    expect(r.owner_total).toBe(95);
  });

  it('defaults qty to 1 when omitted', () => {
    const flat = item({ item_code: 'FLAT_X', pricing_method: 'flat', base_price: 250, uom: 'each' });
    const r = priceDraftLines(
      [{ item_code: 'FLAT_X', description: 'Clean', confidence: 'high' }],
      [flat],
      DEFAULT_ESTIMATOR_CONFIG
    );
    expect(r.lines[0].qty).toBe(1);
    expect(r.owner_total).toBe(250);
  });
});
