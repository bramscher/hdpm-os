/** Recorded hourly quantities only. Flat-price scope and dollars are not measured hours. */
export function recordedLaborHours(line: {type?:string;qty?:number;pricing_method?:string;workspace_task_id?:string}): number {
  if ((line.type || 'labor') !== 'labor' || line.workspace_task_id || (line.pricing_method && line.pricing_method !== 'hourly')) return 0;
  const qty = Number(line.qty);
  return Number.isFinite(qty) && qty > 0 ? qty : 0;
}
export function invoiceServiceDate(invoice: {completed_date?:string|null;created_at?:string|null}): string | null {
  if(invoice.completed_date) return invoice.completed_date.slice(0,10);
  if(!invoice.created_at) return null;
  const date = new Date(invoice.created_at);
  if(!Number.isFinite(date.getTime()))return null;
  return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
}
/** Hourly labor rates for Brody and Alberto alike (Craig, 2026-10-15). */
export const STANDARD_LABOR_RATE = 95;
export const AFTER_HOURS_LABOR_RATE = STANDARD_LABOR_RATE * 1.5;
/** Hourly labor line whose rate is neither standard nor after-hours — usually a typo or an unmarked flat price. */
export function offStandardLaborRate(line: {type?:string;pricing_method?:string;workspace_task_id?:string;unit_price?:number}): boolean {
  if ((line.type || 'labor') !== 'labor' || line.workspace_task_id || (line.pricing_method && line.pricing_method !== 'hourly')) return false;
  const rate = Number(line.unit_price);
  return Number.isFinite(rate) && rate > 0 && Math.abs(rate - STANDARD_LABOR_RATE) > 0.005 && Math.abs(rate - AFTER_HOURS_LABOR_RATE) > 0.005;
}
