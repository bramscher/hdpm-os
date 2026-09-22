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
