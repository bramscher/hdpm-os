/**
 * Turn Estimator — price book service layer (Slice 0).
 *
 * Effective-dated, version-on-change semantics:
 *  - createItem: a new item_code + its first effective row.
 *  - reprice: close the current row (effective_to) and insert a NEW effective
 *    row — never overwrite an issued price (so already-issued estimates keep the
 *    rate effective on their priced_asof date; spec acceptance #4).
 *  - retire: deactivate; no destructive delete of a used item.
 *  - resolvePriceBookItem: the row effective on a given date.
 *
 * Every mutation writes an audit_event.
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';
import type { PriceBookItem, PricingMethod } from './types';

const num = (v: unknown): number => (v == null ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

function mapRow(r: Record<string, unknown>): PriceBookItem {
  return {
    id: r.id as string,
    org_id: (r.org_id as string) ?? 'hdpm',
    item_code: r.item_code as string,
    category: r.category as string,
    name: r.name as string,
    owner_description: (r.owner_description as string) ?? null,
    internal_instructions: (r.internal_instructions as string) ?? null,
    pricing_method: r.pricing_method as PricingMethod,
    base_price: num(r.base_price),
    included_minutes: numOrNull(r.included_minutes),
    increment_minutes: numOrNull(r.increment_minutes),
    increment_price: numOrNull(r.increment_price),
    standard_minutes: numOrNull(r.standard_minutes),
    uom: (r.uom as string) ?? 'each',
    markup_pct: numOrNull(r.markup_pct),
    markup_eligible: Boolean(r.markup_eligible),
    gl_code: (r.gl_code as string) ?? null,
    tenant_alloc_eligible: Boolean(r.tenant_alloc_eligible),
    skill_trade: (r.skill_trade as string) ?? null,
    market: (r.market as string) ?? 'central_oregon',
    effective_from: r.effective_from as string,
    effective_to: (r.effective_to as string) ?? null,
    active: Boolean(r.active),
    created_by: (r.created_by as string) ?? null,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  };
}

export interface PriceBookItemInput {
  item_code: string;
  category: string;
  name: string;
  owner_description?: string | null;
  internal_instructions?: string | null;
  pricing_method: PricingMethod;
  base_price: number;
  included_minutes?: number | null;
  increment_minutes?: number | null;
  increment_price?: number | null;
  standard_minutes?: number | null;
  uom?: string;
  markup_pct?: number | null;
  markup_eligible?: boolean;
  gl_code?: string | null;
  tenant_alloc_eligible?: boolean;
  skill_trade?: string | null;
  market?: string;
  effective_from?: string; // YYYY-MM-DD, default today
}

function toRow(input: PriceBookItemInput, createdBy: string): Record<string, unknown> {
  return {
    item_code: input.item_code,
    category: input.category,
    name: input.name,
    owner_description: input.owner_description ?? null,
    internal_instructions: input.internal_instructions ?? null,
    pricing_method: input.pricing_method,
    base_price: input.base_price,
    included_minutes: input.included_minutes ?? null,
    increment_minutes: input.increment_minutes ?? null,
    increment_price: input.increment_price ?? null,
    standard_minutes: input.standard_minutes ?? null,
    uom: input.uom ?? 'each',
    markup_pct: input.markup_pct ?? null,
    markup_eligible: input.markup_eligible ?? false,
    gl_code: input.gl_code ?? null,
    tenant_alloc_eligible: input.tenant_alloc_eligible ?? false,
    skill_trade: input.skill_trade ?? null,
    market: input.market ?? 'central_oregon',
    ...(input.effective_from ? { effective_from: input.effective_from } : {}),
    created_by: createdBy,
  };
}

/** The price-book row for an item effective on `asOf` (YYYY-MM-DD, default today). */
export async function resolvePriceBookItem(
  itemCode: string,
  asOf?: string
): Promise<PriceBookItem | null> {
  const supabase = getSupabaseAdmin();
  const date = asOf ?? new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('price_book_item')
    .select('*')
    .eq('org_id', 'hdpm')
    .eq('item_code', itemCode)
    .eq('active', true)
    .lte('effective_from', date)
    .or(`effective_to.is.null,effective_to.gt.${date}`)
    .order('effective_from', { ascending: false })
    .limit(1);
  if (error) throw new Error(`price book resolve failed: ${error.message}`);
  const row = (data ?? [])[0];
  return row ? mapRow(row as Record<string, unknown>) : null;
}

/** All current (effective-today, active) items — for the admin list + estimate builder. */
export async function listPriceBookItems(opts: { category?: string } = {}): Promise<PriceBookItem[]> {
  const supabase = getSupabaseAdmin();
  const today = new Date().toISOString().slice(0, 10);
  let q = supabase
    .from('price_book_item')
    .select('*')
    .eq('org_id', 'hdpm')
    .eq('active', true)
    .lte('effective_from', today)
    .or(`effective_to.is.null,effective_to.gt.${today}`)
    .order('category')
    .order('item_code');
  if (opts.category) q = q.eq('category', opts.category);
  const { data, error } = await q;
  if (error) throw new Error(`price book list failed: ${error.message}`);
  return (data ?? []).map((r) => mapRow(r as Record<string, unknown>));
}

/** Create a brand-new item (its first effective row). Throws if the code already has a current row. */
export async function createPriceBookItem(
  input: PriceBookItemInput,
  actor: string
): Promise<PriceBookItem> {
  const existing = await resolvePriceBookItem(input.item_code, input.effective_from);
  if (existing) {
    throw new Error(`price-book item ${input.item_code} already has a current row — use reprice`);
  }
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('price_book_item')
    .insert(toRow(input, actor))
    .select()
    .single();
  if (error) throw new Error(`price book create failed: ${error.message}`);
  const item = mapRow(data as Record<string, unknown>);
  await logAudit('price_book_item', item.id, 'price_book_create', actor, {
    item_code: item.item_code,
    pricing_method: item.pricing_method,
    base_price: item.base_price,
  });
  return item;
}

/**
 * Reprice / re-version an item: close the current row (effective_to = the new
 * effective date) and insert a new effective row. Never mutates an issued price.
 */
export async function repricePriceBookItem(
  itemCode: string,
  input: Omit<PriceBookItemInput, 'item_code'>,
  actor: string,
  effectiveFrom?: string
): Promise<PriceBookItem> {
  const supabase = getSupabaseAdmin();
  const from = effectiveFrom ?? new Date().toISOString().slice(0, 10);
  const current = await resolvePriceBookItem(itemCode, from);

  if (current) {
    const { error: closeErr } = await supabase
      .from('price_book_item')
      .update({ effective_to: from })
      .eq('id', current.id);
    if (closeErr) throw new Error(`price book close-current failed: ${closeErr.message}`);
  }

  const { data, error } = await supabase
    .from('price_book_item')
    .insert(toRow({ ...input, item_code: itemCode, effective_from: from }, actor))
    .select()
    .single();
  if (error) throw new Error(`price book reprice failed: ${error.message}`);
  const item = mapRow(data as Record<string, unknown>);
  await logAudit('price_book_item', item.id, 'price_book_reprice', actor, {
    item_code: itemCode,
    effective_from: from,
    old_base_price: current?.base_price ?? null,
    new_base_price: item.base_price,
    closed_row: current?.id ?? null,
  });
  return item;
}

/** Retire an item's current row (deactivate + close). No destructive delete. */
export async function retirePriceBookItem(
  itemCode: string,
  actor: string,
  effectiveTo?: string
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const to = effectiveTo ?? new Date().toISOString().slice(0, 10);
  const current = await resolvePriceBookItem(itemCode, to);
  if (!current) throw new Error(`no current price-book row for ${itemCode}`);
  const { error } = await supabase
    .from('price_book_item')
    .update({ active: false, effective_to: to })
    .eq('id', current.id);
  if (error) throw new Error(`price book retire failed: ${error.message}`);
  await logAudit('price_book_item', current.id, 'price_book_retire', actor, {
    item_code: itemCode,
    effective_to: to,
  });
}
