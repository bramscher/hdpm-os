import type { PriceBookItem, PricingMethod } from './types';

export const PRICING_LABELS: Record<PricingMethod, string> = {
  flat: 'Fixed price', hourly: 'Hourly labor', service_min: 'Minimum visit charge',
  package: 'Package price', per_qty: 'Price per item', cost_plus: 'Cost plus markup',
  quoted: 'Custom quote', allowance: 'Estimated allowance',
};
/** A cost-plus item's default cost for a new estimate line (its base_price; 0 = none). Editable on the line. */
export function defaultLineCost(item: Pick<PriceBookItem, 'pricing_method' | 'base_price'> | undefined): string {
  return item?.pricing_method === 'cost_plus' && item.base_price > 0 ? String(item.base_price) : '';
}
export const needsPriceReview = (item: Pick<PriceBookItem, 'name'>) => /placeholder/i.test(item.name);
export function priceBookName(item: Pick<PriceBookItem, 'name'>): string {
  const name = item.name.replace(/\s*\[PLACEHOLDER\]/gi, '').trim();
  const names: Record<string, string> = {
    'Standard labor (hourly)': 'Maintenance labor',
    'Two-person labor (hourly)': 'Two-person maintenance crew',
    'Appliance (cost + markup)': 'Appliance purchase',
    'Materials (cost + markup)': 'Materials and supplies',
    'Standard service-call minimum': 'Maintenance service visit',
    'After-hours emergency minimum': 'After-hours emergency visit',
    'Turn coordination minimum': 'Unit turn coordination',
    'Turn inspection & scope': 'Unit inspection and repair plan',
    'Standard maintenance turn package': 'Standard unit turn package',
    'Standard turn clean': 'Unit cleaning',
    'Wall paint per room': 'Room painting',
    'Haul-away per load': 'Debris removal',
  };
  return names[name] || name;
}
const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
export function priceBookRate(item: PriceBookItem): string {
  switch (item.pricing_method) {
    case 'hourly': return `${money(item.base_price)} per hour`;
    case 'service_min': return `${money(item.base_price)} includes ${item.included_minutes ?? 0} minutes; then ${money(item.increment_price ?? 0)} per additional ${item.increment_minutes ?? 15} minutes`;
    case 'cost_plus': return `Purchase cost plus ${item.markup_pct ?? 0}%${item.base_price > 0 ? ` · default ${money(item.base_price)}` : ''}`;
    case 'per_qty': return `${money(item.base_price)} per ${item.uom}`;
    default: return money(item.base_price);
  }
}
