import { describe, it, expect } from 'vitest';
import {
  chargedFromCost,
  lineCost,
  lineMarkup,
  DEFAULT_MARKUP_PCT,
  type LineItem,
} from '../invoices';

describe('chargedFromCost', () => {
  it('applies the default materials markup (25%)', () => {
    expect(chargedFromCost(400, DEFAULT_MARKUP_PCT.materials)).toBe(500);
  });

  it('applies the default appliance markup (10%)', () => {
    expect(chargedFromCost(400, DEFAULT_MARKUP_PCT.appliance)).toBe(440);
  });

  it('rounds to cents', () => {
    // 33.33 * 1.25 = 41.6625 -> 41.66
    expect(chargedFromCost(33.33, 25)).toBe(41.66);
  });

  it('returns the cost unchanged at 0% markup', () => {
    expect(chargedFromCost(120, 0)).toBe(120);
  });
});

describe('lineCost', () => {
  it('returns the recorded cost', () => {
    expect(lineCost({ description: 'x', amount: 500, cost: 400 })).toBe(400);
  });

  it('returns 0 when no cost recorded', () => {
    expect(lineCost({ description: 'x', amount: 500 })).toBe(0);
  });
});

describe('lineMarkup', () => {
  const base = (over: Partial<LineItem>): LineItem => ({ description: 'x', amount: 0, ...over });

  it('is charge minus cost for an appliance line', () => {
    expect(lineMarkup(base({ type: 'appliance', amount: 440, cost: 400 }))).toBe(40);
  });

  it('is charge minus cost for a materials line', () => {
    expect(lineMarkup(base({ type: 'materials', amount: 500, cost: 400 }))).toBe(100);
  });

  it('is 0 for a materials line with no cost recorded', () => {
    expect(lineMarkup(base({ type: 'materials', amount: 500 }))).toBe(0);
  });

  it('is 0 for labor and other lines even if a cost slipped in', () => {
    expect(lineMarkup(base({ type: 'labor', amount: 500, cost: 100 }))).toBe(0);
    expect(lineMarkup(base({ type: 'other', amount: 500, cost: 100 }))).toBe(0);
  });

  it('rounds to cents', () => {
    expect(lineMarkup(base({ type: 'materials', amount: 41.66, cost: 33.33 }))).toBe(8.33);
  });
});
