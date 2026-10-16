import type { Decision, Issue } from '@/lib/daily-billing/model';
import { linkInvoices } from '@/lib/daily-billing/links';
import { recordedLaborHours, STANDARD_LABOR_RATE } from '@/lib/invoice-labor';
import type { HdmsInvoice, LineItem } from '@/lib/invoices';
import { FIELD_CONFIG, type FieldConfig } from './config';
import { workOrderDone } from './match';
import { minutesOf, needsInput, type Allocation, type SegmentKind, type SegmentLabel } from './model';

/** The fields of a stored segment that billing and totals need. */
export interface FieldTimeRow {
  technician: string; work_date: string; kind: SegmentKind; started_at: string; ended_at: string;
  allocations: Allocation[]; label: SegmentLabel | null; state: 'suggested' | 'confirmed'; confirmed_at: string | null;
}
export interface WorkOrderFieldTime { onSiteMin: number; partsMin: number; dumpDays: string[]; days: string[]; technicians: string[]; lastConfirmedAt: string | null }
export interface BillingWorkOrder { id: string; wo_number: string | null; property_name: string | null; completed_date: string | null; status: string | null; appfolio_status: string | null; stage: string | null }

export const ceil15 = (minutes: number) => Math.ceil(minutes / 15 - 1e-9) * 15;
/** Hourly labor a work order's field time supports: 1-hour minimum on site, parts runs on top, 15-minute steps. */
export const expectedMinutes = (onSite: number, parts: number) => (onSite > 0 ? Math.max(60, ceil15(onSite)) : 0) + ceil15(parts);
/** Dump runs are a flat runbook charge, so their lines never count as measured hours. */
export const isDumpLine = (l: Pick<LineItem, 'description' | 'account'>) => /\bdump\b/i.test(`${l.description || ''} ${l.account || ''}`);
/** Any line that charges for a dump trip: a dump-run line, or a disposal / landfill / transfer-station fee (HDMS-INV-000482 bills "Disposal fee"). */
export const isDumpCharge = (l: Pick<LineItem, 'description' | 'account'>) => isDumpLine(l) || /\b(disposal|landfill|transfer station)\b/i.test(`${l.description || ''} ${l.account || ''}`);

export const hm = (minutes: number) => {
  const m = Math.round(minutes), h = Math.floor(m / 60), r = m % 60;
  return h && r ? `${h} h ${r} m` : h ? `${h} h` : `${r} m`;
};
const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const dayList = (days: string[]) => [...new Set(days)].sort().map(shortDate).join(', ');
const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

/** Confirmed job, parts-run and dump-run time per work order, split by each segment's allocation. */
export function fieldTimeByWorkOrder(rows: FieldTimeRow[]): Map<string, WorkOrderFieldTime> {
  const out = new Map<string, WorkOrderFieldTime>();
  for (const r of rows) {
    if (r.state !== 'confirmed' || !['on_site', 'parts_run', 'dump_run'].includes(r.kind)) continue;
    for (const a of r.allocations) {
      const t = out.get(a.work_order_id) ?? { onSiteMin: 0, partsMin: 0, dumpDays: [], days: [], technicians: [], lastConfirmedAt: null };
      const share = (minutesOf(r) * a.percent) / 100;
      if (r.kind === 'on_site') t.onSiteMin += share;
      else if (r.kind === 'parts_run') t.partsMin += share;
      else t.dumpDays.push(r.work_date);
      t.days.push(r.work_date);
      if (!t.technicians.includes(r.technician)) t.technicians.push(r.technician);
      if (r.confirmed_at && (!t.lastConfirmedAt || r.confirmed_at > t.lastConfirmedAt)) t.lastConfirmedAt = r.confirmed_at;
      out.set(a.work_order_id, t);
    }
  }
  return out;
}

const describe = (t: WorkOrderFieldTime) =>
  [t.onSiteMin ? `on site ${hm(t.onSiteMin)}` : '', t.partsMin ? `parts runs ${hm(t.partsMin)}` : '', t.dumpDays.length ? `${t.dumpDays.length} dump run${t.dumpDays.length > 1 ? 's' : ''}` : '']
    .filter(Boolean).join(', ') + ` (${dayList(t.days)}; ${t.technicians.join(', ')})`;

export interface FieldBillingInput {
  /** Segments from lookbackDays before `from` through today. */
  rows: FieldTimeRow[];
  from: string; to: string; today: string;
  invoices: HdmsInvoice[];
  workOrders: BillingWorkOrder[];
  decisions: Decision[];
  sample: boolean;
  hrefFor: (technician: string, date: string) => string;
  cfg?: FieldConfig;
}

/**
 * "Field time not fully billed" items, one per work order with confirmed field time in the period.
 * Compared per work order (not per day), because jobs span days and invoices are dated by completion.
 * Silent for open work orders without an invoice and for flat-priced labor; a completed work order with
 * no invoice gets a note on its existing no-invoice item instead of a second item.
 */
export function fieldBillingIssues(input: FieldBillingInput): { issues: Issue[]; noInvoiceNotes: Map<string, string> } {
  const cfg = input.cfg ?? FIELD_CONFIG;
  const byWo = fieldTimeByWorkOrder(input.rows);
  const inPeriod = new Set(
    input.rows.filter(r => r.state === 'confirmed' && r.work_date >= input.from && r.work_date <= input.to).flatMap(r => r.allocations.map(a => a.work_order_id)),
  );
  const woById = new Map(input.workOrders.map(w => [w.id, w]));
  const { live, invoiceWo } = linkInvoices(input.invoices, input.workOrders);
  const invoicesByWo = new Map<string, HdmsInvoice[]>();
  for (const i of live) {
    const wo = invoiceWo.get(i.id);
    if (wo) invoicesByWo.set(wo, [...(invoicesByWo.get(wo) || []), i]);
  }
  const issues: Issue[] = [];
  const noInvoiceNotes = new Map<string, string>();
  const kind = input.sample ? 'field_time_sample' : 'field_time';
  for (const woId of inPeriod) {
    const wo = woById.get(woId), t = byWo.get(woId);
    if (!wo || !t) continue;
    const invoices = invoicesByWo.get(woId) || [];
    if (!invoices.length) {
      if (workOrderDone(wo)) noInvoiceNotes.set(woId, `Location time: ${describe(t)}.`);
      continue;
    }
    const lines = invoices.flatMap(i => i.line_items || []);
    const labor = lines.filter(l => (l.type || 'labor') === 'labor' && !isDumpLine(l));
    const flat = labor.some(l => !!l.workspace_task_id || (!!l.pricing_method && l.pricing_method !== 'hourly'));
    const billedHours = labor.reduce((n, l) => n + recordedLaborHours(l), 0);
    const expected = expectedMinutes(t.onSiteMin, t.partsMin);
    const shortHours = expected / 60 - billedHours;
    const problems: string[] = [];
    if (!flat && shortHours >= cfg.shortfallHours) problems.push(`About ${hm(shortHours * 60)} (~${money(shortHours * STANDARD_LABOR_RATE)}) is not billed.`);
    const missingDump = t.dumpDays.length > 0 && !lines.some(isDumpCharge);
    if (missingDump) problems.push(`Dump run on ${dayList(t.dumpDays)} has no dump-run charge on the invoice.`);
    if (!problems.length) continue;
    const codes = invoices.map(i => i.invoice_code).join(', ');
    const billed = billedHours > 0 ? `${hm(billedHours * 60)} hourly` : 'no hourly labor';
    const hours = flat ? `${codes} prices the labor flat` : `expected about ${hm(expected)} at $95/h (1-hour minimum, parts runs on top); ${codes} bill${invoices.length > 1 ? '' : 's'} ${billed}`;
    const key = `wo:${woId}:${kind}`;
    const decision = input.decisions.find(d => d.issue_key === key);
    const lastDay = [...t.days].sort().at(-1)!;
    issues.push({
      key, kind,
      title: problems.length === 1 && missingDump ? 'Dump run not on the invoice' : 'Field time not fully billed',
      detail: `${describe(t).replace(/^./, c => c.toUpperCase())}. ${hours[0].toUpperCase()}${hours.slice(1)}. ${problems.join(' ')}`,
      day: wo.completed_date?.slice(0, 10) || lastDay,
      person: t.technicians.join(', '),
      woId,
      invoiceId: invoices[0].id,
      property: wo.property_name || wo.wo_number || 'Work order',
      href: input.hrefFor(t.technicians[t.technicians.length - 1], lastDay),
      decision,
      // A saved decision comes back when newer confirmed field time arrives.
      overdue: !!decision && (decision.review_on <= input.today || (!!t.lastConfirmedAt && t.lastConfirmedAt > decision.updated_at)),
    });
  }
  return { issues, noInvoiceNotes };
}

export interface FieldDayTotals {
  date: string; onSite: number; parts: number; dump: number; inspection: number; drive: number; shop: number;
  other: number; unlabeled: number; breaks: number; unconfirmed: number; technicians: string[];
}
/** Minutes per day by kind, for the review's Field time column. Includes unconfirmed time (counted separately). */
export function fieldDayTotals(rows: FieldTimeRow[]): Map<string, FieldDayTotals> {
  const out = new Map<string, FieldDayTotals>();
  for (const r of rows) {
    const d = out.get(r.work_date) ?? { date: r.work_date, onSite: 0, parts: 0, dump: 0, inspection: 0, drive: 0, shop: 0, other: 0, unlabeled: 0, breaks: 0, unconfirmed: 0, technicians: [] };
    const m = minutesOf(r);
    if (needsInput(r)) d.unlabeled += m;
    else if (r.kind === 'on_site') d.onSite += m;
    else if (r.kind === 'parts_run') d.parts += m;
    else if (r.kind === 'dump_run') d.dump += m;
    else if (r.kind === 'inspection') d.inspection += m;
    else if (r.kind === 'drive') d.drive += m;
    else if (r.kind === 'shop') d.shop += m;
    else if (r.kind === 'break') d.breaks += m;
    else d.other += m;
    if (r.state === 'suggested') d.unconfirmed += m;
    if (!d.technicians.includes(r.technician)) d.technicians.push(r.technician);
    out.set(r.work_date, d);
  }
  return out;
}
