/**
 * Estimate-drafter agent — pure contract + pricing mapper.
 *
 * The LLM reads a work order's text and selects price-book items + quantities.
 * It NEVER prices: the deterministic engine (lib/turn-estimator/pricing.ts)
 * turns the selected lines into dollars, so every amount is auditable and
 * reproducible. This module holds the output schema and the pure mapping from
 * the model's line specs to priced draft lines; the DB/LLM I/O lives in
 * estimate-drafter-run.ts. Advisory: a human reviews/edits/issues the estimate.
 */

import { priceLine, totalLines } from '@/lib/turn-estimator/pricing';
import {
  type PriceBookItem,
  type LineInput,
  type EstimatorConfig,
  DEFAULT_ESTIMATOR_CONFIG,
} from '@/lib/turn-estimator/types';

export const ESTIMATE_DRAFTER_AGENT = 'estimate_drafter';
export const DRAFT_ESTIMATE_ACTION = 'draft_estimate';

/** One line the model proposes — a price-book selection, never a price. */
export interface DraftLineSpec {
  /** Must be an item_code from the price book passed to the model. */
  item_code: string;
  /** What this line covers, in the estimator's words. */
  description: string;
  /** Quantity (rooms, loads, units). Defaults to 1 when omitted. */
  qty?: number;
  /** On-site minutes — for service_min / hourly lines. */
  minutes?: number;
  /** Labor hours to attribute (drives internal cost / margin). */
  est_labor_hours?: number;
  /** Direct material/vendor cost basis — for cost_plus / materials lines. */
  est_material_cost?: number;
  /** Room / area, if the WO text names one. */
  room?: string;
  /** How confident the model is that this line belongs. */
  confidence: 'high' | 'medium' | 'low';
  /** The WO phrase this line is drawn from (traceability). */
  source_quote?: string;
}

/** The model's full output. */
export interface AgentDraftResult {
  lines: DraftLineSpec[];
  /** WO details the model could not map to a price-book item (never dropped). */
  unmapped_notes: string[];
  /** One-paragraph plain-English summary of the drafted scope. */
  summary: string;
}

/**
 * JSON Schema for output_config.format (json_schema). Respects the structured-
 * output constraints: additionalProperties:false, no min/max/length. Numeric
 * fields are optional (omitted from `required`) so the model only sets the ones
 * a given pricing method needs.
 */
export const DRAFT_ESTIMATE_SCHEMA = {
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      description: 'One entry per distinct task/material the work order calls for.',
      items: {
        type: 'object',
        properties: {
          item_code: {
            type: 'string',
            description: 'An item_code from the provided price book. Use the closest fit; do not invent codes.',
          },
          description: {
            type: 'string',
            description: 'What this line covers, specific to this job.',
          },
          qty: { type: 'number', description: 'Quantity (rooms, loads, units). Omit for a single occurrence.' },
          minutes: { type: 'number', description: 'On-site minutes — only for service_min or hourly items.' },
          est_labor_hours: { type: 'number', description: 'Estimated labor hours (drives internal cost).' },
          est_material_cost: { type: 'number', description: 'Direct material/vendor cost in dollars — only for cost_plus / materials items.' },
          room: { type: 'string', description: 'Room or area, if named in the work order.' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          source_quote: { type: 'string', description: 'The work-order phrase this line is drawn from.' },
        },
        required: ['item_code', 'description', 'confidence'],
        additionalProperties: false,
      },
    },
    unmapped_notes: {
      type: 'array',
      items: { type: 'string' },
      description: 'Anything the work order asks for that no price-book item covers. Empty if all mapped.',
    },
    summary: {
      type: 'string',
      description: 'One short paragraph describing the drafted scope for the reviewer.',
    },
  },
  required: ['lines', 'unmapped_notes', 'summary'],
  additionalProperties: false,
} as const;

/** A priced draft line — the spec plus the deterministic engine's numbers. */
export interface DraftedLine {
  item_code: string;
  category: string;
  pricing_method: string;
  uom: string;
  description: string;
  room: string | null;
  qty: number;
  minutes: number | null;
  est_labor_hours: number | null;
  est_material_cost: number | null;
  internal_cost: number;
  owner_unit_price: number;
  owner_extended: number;
  confidence: 'high' | 'medium' | 'low';
  source_quote: string | null;
}

export interface PricedDraft {
  lines: DraftedLine[];
  /** item_codes the model chose that aren't in the price book (dropped, surfaced). */
  unmapped_codes: string[];
  owner_total: number;
  internal_cost_total: number;
}

/**
 * Pure: turn the model's line specs into priced draft lines using the
 * deterministic engine. Unknown item_codes are dropped and returned in
 * `unmapped_codes` (never silently priced). No I/O.
 */
export function priceDraftLines(
  specs: DraftLineSpec[],
  priceBook: PriceBookItem[],
  cfg: EstimatorConfig = DEFAULT_ESTIMATOR_CONFIG
): PricedDraft {
  const byCode = new Map<string, PriceBookItem>();
  for (const it of priceBook) byCode.set(it.item_code, it);

  const lines: DraftedLine[] = [];
  const unmapped_codes: string[] = [];

  for (const spec of specs) {
    const item = byCode.get(spec.item_code);
    if (!item) {
      unmapped_codes.push(spec.item_code);
      continue;
    }
    const input: LineInput = {
      item,
      qty: spec.qty ?? 1,
      minutes: spec.minutes,
      estLaborHours: spec.est_labor_hours,
      estMaterialCost: spec.est_material_cost,
      description: spec.description,
      room: spec.room ?? null,
    };
    const priced = priceLine(input, cfg);
    lines.push({
      item_code: item.item_code,
      category: item.category,
      pricing_method: item.pricing_method,
      uom: item.uom,
      description: priced.description,
      room: priced.room,
      qty: priced.qty,
      minutes: spec.minutes ?? null,
      est_labor_hours: priced.est_labor_hours,
      est_material_cost: priced.est_material_cost,
      internal_cost: priced.internal_cost,
      owner_unit_price: priced.owner_unit_price,
      owner_extended: priced.owner_extended,
      confidence: spec.confidence,
      source_quote: spec.source_quote ?? null,
    });
  }

  // Total via the shared engine so it agrees with the estimate to the cent.
  const totals = totalLines(
    lines.map((l) => ({
      price_book_item_id: '',
      price_book_item_code: l.item_code,
      category: l.category,
      pricing_method: l.pricing_method as LineInput['item']['pricing_method'],
      description: l.description,
      room: l.room,
      location: null,
      qty: l.qty,
      uom: l.uom,
      est_labor_hours: l.est_labor_hours,
      est_material_cost: l.est_material_cost,
      internal_cost: l.internal_cost,
      owner_unit_price: l.owner_unit_price,
      owner_extended: l.owner_extended,
      tax_amount: 0,
      tenant_alloc_proposed: 0,
      responsibility: 'owner',
      responsibility_rationale: null,
    }))
  );

  return {
    lines,
    unmapped_codes,
    owner_total: totals.owner_total,
    internal_cost_total: totals.internal_cost_total,
  };
}

/** Compact price-book menu for the prompt — the model may only choose these codes. */
export function priceBookMenu(priceBook: PriceBookItem[]): string {
  return priceBook
    .map((i) => {
      const bits = [`${i.item_code} [${i.pricing_method}, per ${i.uom}]`, i.name];
      if (i.owner_description && i.owner_description !== i.name) bits.push(`— ${i.owner_description}`);
      return `- ${bits.join(' ')}`;
    })
    .join('\n');
}
