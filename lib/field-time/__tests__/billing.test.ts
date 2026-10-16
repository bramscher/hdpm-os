import { describe, expect, it } from 'vitest';
import { expectedMinutes, fieldBillingIssues, fieldDayTotals, type FieldBillingInput, type FieldTimeRow } from '../billing';

const row = (date: string, kind: FieldTimeRow['kind'], from: string, to: string, extra: Partial<FieldTimeRow> = {}): FieldTimeRow => ({
  technician: 'Alberto', work_date: date, kind, started_at: `${date}T${from}:00Z`, ended_at: `${date}T${to}:00Z`,
  allocations: [{ work_order_id: 'wo-1', percent: 100 }], label: null, state: 'confirmed', confirmed_at: `${date}T23:00:00Z`, ...extra,
});
const labor = (qty: number, extra: Record<string, unknown> = {}) => ({ type: 'labor', description: 'Repair', qty, unit_price: 95, amount: qty * 95, technician: 'Alberto', ...extra });
const invoice = (lines: unknown[], extra: Record<string, unknown> = {}) =>
  ({ id: 'inv-1', invoice_code: 'HDMS-INV-000480', status: 'generated', doc_type: 'invoice', work_order_id: 'wo-1', wo_reference: null, completed_date: '2026-10-08', created_at: '2026-10-08T20:00:00Z', line_items: lines, ...extra }) as never;
const WO = { id: 'wo-1', wo_number: '43343-1', property_name: 'Weinberger 284', completed_date: '2026-10-08', status: 'done', appfolio_status: 'Completed', stage: null };
const run = (extra: Partial<FieldBillingInput> = {}) =>
  fieldBillingIssues({ rows: [], from: '2026-10-01', to: '2026-10-15', today: '2026-10-16', invoices: [], workOrders: [WO], decisions: [], sample: false, hrefFor: (t, d) => `/f?technician=${t}&date=${d}`, ...extra });

describe('expected hours', () => {
  it('applies the 1-hour minimum to on-site time and adds parts runs on top, in 15-minute steps', () => {
    expect(expectedMinutes(20, 0)).toBe(60);
    expect(expectedMinutes(70, 0)).toBe(75);
    expect(expectedMinutes(190, 25)).toBe(225);
    expect(expectedMinutes(0, 50)).toBe(60);
    expect(expectedMinutes(0, 0)).toBe(0);
  });
});

describe('fieldBillingIssues', () => {
  it('flags a work order billed short across two days, with the minimum applied once', () => {
    const rows = [row('2026-10-07', 'on_site', '15:00', '17:00'), row('2026-10-08', 'on_site', '15:00', '16:10'), row('2026-10-08', 'parts_run', '16:10', '16:35')];
    const { issues } = run({ rows, invoices: [invoice([labor(2)])] });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ key: 'wo:wo-1:field_time', kind: 'field_time', title: 'Field time not fully billed', day: '2026-10-08', person: 'Alberto', woId: 'wo-1', href: '/f?technician=Alberto&date=2026-10-08' });
    expect(issues[0].detail).toContain('On site 3 h 10 m, parts runs 25 m (Oct 7, Oct 8; Alberto)');
    expect(issues[0].detail).toContain('Expected about 3 h 45 m');
    expect(issues[0].detail).toContain('HDMS-INV-000480 bills 2 h hourly');
    expect(issues[0].detail).toContain('About 1 h 45 m (~$166) is not billed.');
    expect(run({ rows: [row('2026-10-07', 'on_site', '15:00', '15:20'), row('2026-10-08', 'on_site', '15:00', '15:20')], invoices: [invoice([labor(1)])] }).issues).toEqual([]);
  });

  it('counts a parts-run share even with no on-site time', () => {
    const rows = [row('2026-10-07', 'parts_run', '15:00', '16:40', { allocations: [{ work_order_id: 'wo-1', percent: 50 }, { work_order_id: 'wo-2', percent: 50 }] })];
    const { issues } = run({ rows, invoices: [invoice([{ type: 'materials', description: 'Faucet', qty: 1, amount: 120 }])] });
    expect(issues[0].detail).toContain('Parts runs 50 m');
    expect(issues[0].detail).toContain('bills no hourly labor');
    expect(issues[0].detail).toContain('About 1 h (~$95) is not billed.');
  });

  it('treats flat-priced labor as covered', () => {
    const rows = [row('2026-10-07', 'on_site', '15:00', '18:00')];
    expect(run({ rows, invoices: [invoice([labor(1, { pricing_method: 'flat', unit_price: 129, amount: 129 })])] }).issues).toEqual([]);
  });

  it('stays quiet under half an hour short', () => {
    const rows = [row('2026-10-07', 'on_site', '15:00', '16:40')];
    expect(run({ rows, invoices: [invoice([labor(1.5)])] }).issues).toEqual([]);
    expect(run({ rows, invoices: [invoice([labor(1.25)])] }).issues).toHaveLength(1);
  });

  it('is silent for open work without an invoice and notes time on completed work without one', () => {
    const rows = [row('2026-10-07', 'on_site', '15:00', '17:00')];
    const open = run({ rows, workOrders: [{ ...WO, completed_date: null, status: 'open', appfolio_status: 'Assigned' }] });
    expect(open.issues).toEqual([]);
    expect(open.noInvoiceNotes.size).toBe(0);
    const done = run({ rows });
    expect(done.issues).toEqual([]);
    expect(done.noInvoiceNotes.get('wo-1')).toBe('Location time: on site 2 h (Oct 7; Alberto).');
  });

  it('keeps dump-run lines out of hours and flags a dump run with no charge', () => {
    const rows = [row('2026-10-07', 'on_site', '15:00', '17:00'), row('2026-10-07', 'dump_run', '17:00', '17:40')];
    expect(run({ rows, invoices: [invoice([labor(2), labor(1, { description: 'Dump run' })])] }).issues).toEqual([]);
    const missing = run({ rows, invoices: [invoice([labor(2)])] }).issues;
    expect(missing[0]).toMatchObject({ title: 'Dump run not on the invoice' });
    expect(missing[0].detail).toContain('Dump run on Oct 7 has no dump-run charge');
    // A disposal fee is the dump charge too (HDMS-INV-000482); "disposed" in a labor description is not.
    expect(run({ rows, invoices: [invoice([labor(2), { type: 'materials', description: 'Disposal fee', qty: 1, amount: 25 }])] }).issues).toEqual([]);
    expect(run({ rows, invoices: [invoice([labor(2, { description: 'Removed tenant items and disposed of them' })])] }).issues[0].title).toBe('Dump run not on the invoice');
    const masked = run({ rows: [row('2026-10-07', 'on_site', '15:00', '18:00')], invoices: [invoice([labor(1), labor(1, { description: 'Dump run' })])] }).issues;
    expect(masked[0].detail).toContain('bills 1 h hourly');
  });

  it('ignores unconfirmed time and time outside the period', () => {
    expect(run({ rows: [row('2026-10-07', 'on_site', '15:00', '19:00', { state: 'suggested' })], invoices: [invoice([labor(1)])] }).issues).toEqual([]);
    expect(run({ rows: [row('2026-09-20', 'on_site', '15:00', '19:00')], invoices: [invoice([labor(1)])] }).issues).toEqual([]);
  });

  it('keeps sample-day items separate and re-opens decisions when newer time is confirmed', () => {
    const rows = [row('2026-10-07', 'on_site', '15:00', '19:00')];
    expect(run({ rows, invoices: [invoice([labor(1)])], sample: true }).issues[0]).toMatchObject({ key: 'wo:wo-1:field_time_sample', kind: 'field_time_sample' });
    const decision = { issue_key: 'wo:wo-1:field_time', disposition: 'resolved', owner: 'Craig', review_on: '2026-10-30', note: 'ok', updated_at: '2026-10-09T00:00:00Z' };
    expect(run({ rows, invoices: [invoice([labor(1)])], decisions: [decision] }).issues[0].overdue).toBe(false);
    expect(run({ rows: [...rows, row('2026-10-10', 'on_site', '15:00', '16:00')], invoices: [invoice([labor(1)])], decisions: [decision] }).issues[0].overdue).toBe(true);
  });
});

describe('fieldDayTotals', () => {
  it('splits a day by kind and counts what still needs labeling', () => {
    const totals = fieldDayTotals([
      row('2026-10-07', 'on_site', '15:00', '17:00'),
      row('2026-10-07', 'parts_run', '17:00', '17:30', { allocations: [], state: 'suggested' }),
      row('2026-10-07', 'drive', '17:30', '17:45', { allocations: [] }),
      row('2026-10-07', 'stop', '17:45', '18:00', { allocations: [], label: 'personal' }),
      row('2026-10-07', 'no_data', '18:00', '18:20', { allocations: [], state: 'suggested' }),
    ]).get('2026-10-07')!;
    expect(totals).toMatchObject({ onSite: 120, parts: 0, drive: 15, other: 15, unlabeled: 50, unconfirmed: 50, technicians: ['Alberto'] });
  });
});
