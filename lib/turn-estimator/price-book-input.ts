/**
 * Validation for price-book create/edit payloads — the API's guard before a
 * new effective row is written. Mirrors the price_book_item column types
 * (INT minutes, NUMERIC(12,2) money, NUMERIC(6,3) markup, pricing_method
 * CHECK list). Pure; shared by the API routes and the admin form.
 */

import type { PricingMethod } from './types';
import type { PriceBookItemInput } from './price-book';

export const PRICING_METHODS: PricingMethod[] = [
  'flat', 'hourly', 'service_min', 'package', 'per_qty', 'cost_plus', 'quoted', 'allowance',
];

/** Marks an item as not ready to quote (needsPriceReview keys off this tag in the name). */
export const REVIEW_TAG = '[PLACEHOLDER]';

type Parsed = { ok: true; value: Omit<PriceBookItemInput, 'item_code'> } | { ok: false; error: string };

const MONEY_MAX = 9_999_999_999.99;

function text(v: unknown, max: number, field: string, required = false): string | null | Error {
  if (v == null || (typeof v === 'string' && v.trim() === '')) return required ? new Error(`${field} is required`) : null;
  if (typeof v !== 'string') return new Error(`${field} must be text`);
  const t = v.trim();
  return t.length > max ? new Error(`${field} must be ${max} characters or fewer`) : t;
}

function money(v: unknown, field: string, required = false): number | null | Error {
  if (v == null || v === '') return required ? new Error(`${field} is required`) : null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > MONEY_MAX) return new Error(`${field} must be a dollar amount of 0 or more`);
  return Math.round(n * 100) / 100;
}

function minutes(v: unknown, field: string): number | null | Error {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 100_000) return new Error(`${field} must be whole minutes, 0 or more`);
  return n;
}

/** Parse an edit/create body (everything except item_code). */
export function parsePriceBookInput(body: unknown): Parsed {
  const b = (body ?? {}) as Record<string, unknown>;
  const method = b.pricing_method as PricingMethod;
  if (!PRICING_METHODS.includes(method)) return { ok: false, error: 'Choose how the item is charged' };

  const fields = {
    name: text(b.name, 200, 'Item name', true),
    category: text(b.category, 60, 'Category', true),
    owner_description: text(b.owner_description, 2000, 'Owner description'),
    internal_instructions: text(b.internal_instructions, 4000, 'Internal instructions'),
    uom: text(b.uom, 30, 'Unit'),
    gl_code: text(b.gl_code, 40, 'GL code'),
    skill_trade: text(b.skill_trade, 60, 'Trade'),
    base_price: money(b.base_price, 'Price', true),
    increment_price: money(b.increment_price, 'Additional block price'),
    included_minutes: minutes(b.included_minutes, 'Included minutes'),
    increment_minutes: minutes(b.increment_minutes, 'Additional block minutes'),
    standard_minutes: minutes(b.standard_minutes, 'Standard minutes'),
  };
  for (const v of Object.values(fields)) if (v instanceof Error) return { ok: false, error: v.message };

  let markup_pct: number | null = null;
  if (b.markup_pct != null && b.markup_pct !== '') {
    const n = Number(b.markup_pct);
    if (!Number.isFinite(n) || n < 0 || n > 999) return { ok: false, error: 'Markup must be a percent between 0 and 999' };
    markup_pct = Math.round(n * 1000) / 1000;
  }
  if (method === 'cost_plus' && markup_pct == null) return { ok: false, error: 'Cost-plus items need a markup %' };
  if (method === 'service_min' && (fields.included_minutes == null || fields.increment_minutes == null || fields.increment_price == null)) {
    return { ok: false, error: 'Minimum-visit items need included minutes, an additional block length, and its price' };
  }
  if (fields.increment_minutes === 0) return { ok: false, error: 'Additional block minutes must be more than 0' };

  return {
    ok: true,
    value: {
      name: fields.name as string,
      category: fields.category as string,
      owner_description: fields.owner_description as string | null,
      internal_instructions: fields.internal_instructions as string | null,
      pricing_method: method,
      base_price: fields.base_price as number,
      included_minutes: fields.included_minutes as number | null,
      increment_minutes: fields.increment_minutes as number | null,
      increment_price: fields.increment_price as number | null,
      standard_minutes: fields.standard_minutes as number | null,
      uom: (fields.uom as string | null) ?? 'each',
      markup_pct,
      markup_eligible: b.markup_eligible === true || method === 'cost_plus',
      gl_code: fields.gl_code as string | null,
      tenant_alloc_eligible: b.tenant_alloc_eligible === true,
      skill_trade: fields.skill_trade as string | null,
      ...(typeof b.market === 'string' && b.market.trim() ? { market: b.market.trim().slice(0, 60) } : {}),
    },
  };
}

/** Apply or clear the needs-review tag on a name. */
export function withReviewTag(name: string, needsReview: boolean): string {
  const clean = name.replace(/\s*\[PLACEHOLDER\]/gi, '').trim();
  return needsReview ? `${clean} ${REVIEW_TAG}` : clean;
}
