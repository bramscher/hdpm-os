import { describe, it, expect } from 'vitest';
import {
  ownerChargeForLine,
  priceLine,
  priceEstimate,
  bundleServiceMinimums,
  evaluateAuthorization,
  changeOrderRequired,
} from '@/lib/turn-estimator/pricing';
import type { PriceBookItem, PricingMethod, LineInput } from '@/lib/turn-estimator/types';

function item(over: Partial<PriceBookItem> & { pricing_method: PricingMethod }): PriceBookItem {
  return {
    id: over.item_code ?? 'itm',
    org_id: 'hdpm',
    item_code: over.item_code ?? 'ITM',
    category: 'other',
    name: 'Item',
    owner_description: null,
    internal_instructions: null,
    base_price: 0,
    included_minutes: null,
    increment_minutes: null,
    increment_price: null,
    standard_minutes: null,
    uom: 'each',
    markup_pct: null,
    markup_eligible: false,
    gl_code: null,
    tenant_alloc_eligible: false,
    skill_trade: null,
    market: 'central_oregon',
    effective_from: '2026-01-01',
    effective_to: null,
    active: true,
    created_by: null,
    created_at: '',
    updated_at: '',
    ...over,
  };
}

const serviceMin = () =>
  item({
    item_code: 'SVC_MIN',
    pricing_method: 'service_min',
    base_price: 125,
    included_minutes: 60,
    increment_minutes: 15,
    increment_price: 21.25,
  });

describe('service_min pricing (acceptance #3)', () => {
  it('90-min standard visit = $125 + 2×$21.25 = $167.50', () => {
    expect(ownerChargeForLine(serviceMin(), { item: serviceMin(), minutes: 90 })).toBe(167.5);
  });
  it('within the included hour is just the minimum', () => {
    expect(ownerChargeForLine(serviceMin(), { item: serviceMin(), minutes: 45 })).toBe(125);
    expect(ownerChargeForLine(serviceMin(), { item: serviceMin(), minutes: 60 })).toBe(125);
  });
  it('rounds partial increments up to the next block', () => {
    // 61–75 min → one increment; 76–90 → two.
    expect(ownerChargeForLine(serviceMin(), { item: serviceMin(), minutes: 61 })).toBe(146.25);
    expect(ownerChargeForLine(serviceMin(), { item: serviceMin(), minutes: 76 })).toBe(167.5);
  });
});

describe('one service minimum per visit (acceptance #2)', () => {
  it('five 30-min tasks in one visit apply ONE $125 minimum, not five', () => {
    const inputs: LineInput[] = Array.from({ length: 5 }, () => ({
      item: serviceMin(),
      minutes: 30,
    }));
    const bundled = bundleServiceMinimums(inputs);
    const minimums = bundled.filter((b) => b.item.pricing_method === 'service_min');
    expect(minimums).toHaveLength(1);

    const { totals } = priceEstimate(inputs);
    // First line keeps the $125 minimum (30 < 60 included → no overage).
    // Each of the other four: 30 min → ceil(30/15)=2 blocks × $21.25 = $42.50.
    expect(totals.owner_total).toBe(125 + 4 * 42.5); // 295, NOT 5×125=625
    expect(totals.owner_total).not.toBe(625);
  });
});

describe('other pricing methods', () => {
  it('flat = base × qty', () => {
    const it = item({ pricing_method: 'flat', base_price: 75 });
    expect(ownerChargeForLine(it, { item: it, qty: 2 })).toBe(150);
  });
  it('hourly = rate × hours', () => {
    const it = item({ pricing_method: 'hourly', base_price: 95 });
    expect(ownerChargeForLine(it, { item: it, estLaborHours: 1.5 })).toBe(142.5);
  });
  it('per_qty = base × qty', () => {
    const it = item({ pricing_method: 'per_qty', base_price: 12 });
    expect(ownerChargeForLine(it, { item: it, qty: 3 })).toBe(36);
  });
  it('cost_plus reuses chargedFromCost', () => {
    const it = item({ pricing_method: 'cost_plus', markup_pct: 25 });
    expect(ownerChargeForLine(it, { item: it, estMaterialCost: 100 })).toBe(125);
  });
});

describe('priceLine internal cost + margin', () => {
  it('computes internal cost from labor hours × internal rate + material', () => {
    const it = item({ pricing_method: 'hourly', base_price: 95 });
    const line = priceLine({ item: it, estLaborHours: 2, estMaterialCost: 10 });
    // internal = 2×35 + 10 = 80; owner = 95×2 = 190
    expect(line.internal_cost).toBe(80);
    expect(line.owner_extended).toBe(190);
  });
  it('tenant allocation defaults to 0 (acceptance #10 spirit)', () => {
    const it = item({ pricing_method: 'flat', base_price: 50 });
    expect(priceLine({ item: it }).tenant_alloc_proposed).toBe(0);
  });
});

describe('evaluateAuthorization (spec §5.4)', () => {
  it('at/under limit auto-approves; over needs approval; null is conservative', () => {
    expect(evaluateAuthorization(400, 500)).toBe('auto_approved');
    expect(evaluateAuthorization(500, 500)).toBe('auto_approved');
    expect(evaluateAuthorization(600, 500)).toBe('approval_pending');
    expect(evaluateAuthorization(100, null)).toBe('approval_pending');
  });
});

describe('changeOrderRequired (acceptance #6)', () => {
  it('tolerance = greater of $100 or 10% of approved', () => {
    // approved 1000 → tolerance max(100, 100) = 100
    expect(changeOrderRequired(1000, 1050)).toBe(false);
    expect(changeOrderRequired(1000, 1100)).toBe(false);
    expect(changeOrderRequired(1000, 1150)).toBe(true);
    // approved 2000 → tolerance 200
    expect(changeOrderRequired(2000, 2200)).toBe(false);
    expect(changeOrderRequired(2000, 2201)).toBe(true);
    // small approved → $100 floor dominates
    expect(changeOrderRequired(200, 300)).toBe(false);
    expect(changeOrderRequired(200, 305)).toBe(true);
  });
});
