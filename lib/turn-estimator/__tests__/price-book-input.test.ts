import { describe, it, expect } from 'vitest';
import { parsePriceBookInput, withReviewTag } from '../price-book-input';

const base = { name: 'Room painting', category: 'paint', pricing_method: 'per_qty', base_price: '325', uom: 'room' };

describe('parsePriceBookInput', () => {
  it('accepts a full edit and normalizes numbers and text', () => {
    const r = parsePriceBookInput({
      ...base,
      name: '  Room painting ',
      owner_description: 'Two coats, walls only',
      internal_instructions: '',
      standard_minutes: '240',
      gl_code: '6420',
      tenant_alloc_eligible: true,
      skill_trade: 'paint',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      name: 'Room painting',
      base_price: 325,
      uom: 'room',
      standard_minutes: 240,
      internal_instructions: null,
      gl_code: '6420',
      tenant_alloc_eligible: true,
      markup_eligible: false,
    });
  });

  it('rejects missing name/category, bad method, and negative or non-numeric prices', () => {
    expect(parsePriceBookInput({ ...base, name: ' ' })).toEqual({ ok: false, error: 'Item name is required' });
    expect(parsePriceBookInput({ ...base, category: '' }).ok).toBe(false);
    expect(parsePriceBookInput({ ...base, pricing_method: 'barter' }).ok).toBe(false);
    expect(parsePriceBookInput({ ...base, base_price: '-5' }).ok).toBe(false);
    expect(parsePriceBookInput({ ...base, base_price: 'abc' }).ok).toBe(false);
    expect(parsePriceBookInput({ ...base, standard_minutes: '12.5' }).ok).toBe(false);
  });

  it('enforces method-specific fields', () => {
    expect(parsePriceBookInput({ ...base, pricing_method: 'cost_plus' }).ok).toBe(false);
    const cp = parsePriceBookInput({ ...base, pricing_method: 'cost_plus', markup_pct: '15' });
    expect(cp.ok && cp.value.markup_eligible).toBe(true);
    expect(parsePriceBookInput({ ...base, pricing_method: 'service_min', included_minutes: 60 }).ok).toBe(false);
    expect(
      parsePriceBookInput({ ...base, pricing_method: 'service_min', included_minutes: 60, increment_minutes: 15, increment_price: 30 }).ok
    ).toBe(true);
    expect(
      parsePriceBookInput({ ...base, pricing_method: 'service_min', included_minutes: 60, increment_minutes: 0, increment_price: 30 }).ok
    ).toBe(false);
  });

  it('rounds money to cents', () => {
    const r = parsePriceBookInput({ ...base, base_price: '19.999' });
    expect(r.ok && r.value.base_price).toBe(20);
  });
});

describe('withReviewTag', () => {
  it('adds or clears the pricing-review tag once', () => {
    expect(withReviewTag('Deck stain [PLACEHOLDER]', false)).toBe('Deck stain');
    expect(withReviewTag('Deck stain', true)).toBe('Deck stain [PLACEHOLDER]');
    expect(withReviewTag('Deck stain [placeholder]', true)).toBe('Deck stain [PLACEHOLDER]');
  });
});
