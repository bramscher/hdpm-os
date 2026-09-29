import type { WorkOrderExtraction } from '@/lib/work-order-extraction';
import type { PriceBookItem } from './types';
import { needsPriceReview } from './price-book-display';

/** Invoice-style scope: hourly labor plus separate materials; amounts need review. */
export function workOrderDraft(description: string, extracted: WorkOrderExtraction, items: PriceBookItem[]) {
  const usable = (code: string, method: string) => items.find(item => item.item_code === code && item.pricing_method === method && !needsPriceReview(item));
  const labor = usable('LABOR_STD', 'hourly');
  const material = usable('MATERIALS_CP', 'cost_plus');
  const lines: {item_code: string; qty: number; minutes: number | null; est_material_cost: number | null; description: string; room: null}[] = [];
  const notes: string[] = [];
  const laborText = extracted.laborDescription.trim() || (!extracted.materials.length ? description : '');
  if (laborText.trim()) {
    lines.push({item_code: labor?.item_code ?? '', qty: 1, minutes: 0, est_material_cost: null, description: laborText, room: null});
    notes.push('Enter estimated labor hours before issuing. No labor time has been assumed.');
    if (!labor) notes.push('Select an approved hourly labor item for the labor scope.');
  }
  for (const part of extracted.materials) {
    const cost = Number(part.amount);
    lines.push({item_code: material?.item_code ?? '', qty: 1, minutes: null, est_material_cost: Number.isFinite(cost) && cost > 0 ? cost : null, description: part.description, room: null});
  }
  if (extracted.materials.length) {
    notes.push('Review material costs and quantities. Blank costs must be entered before issuing.');
    if (!material) notes.push('Select an approved materials item for each material line.');
  }
  if (!lines.length) notes.push('This work order has no description. Add the scope and pricing manually.');
  return {lines, unmapped_notes: notes, summary: 'Rough draft from the work order using the same labor/material extraction as invoices. Review the full scope, hours and costs before issuing.'};
}
