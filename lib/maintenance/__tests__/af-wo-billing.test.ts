import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/appfolio-reports', () => ({ runReport: vi.fn() }));
const { afInvoiceReceived, summarizeAfBilling } = await import('../af-wo-billing');

describe('AppFolio work order billing summary', () => {
  const rows = summarizeAfBilling(
    [
      { work_order_id: 101, work_order_number: '4512-1', vendor_portal_invoices: 1 },
      { work_order_id: 102, work_order_number: '4513-1', vendor_portal_invoices: 0 },
      { work_order_id: 103, work_order_number: '4514-1', vendor_portal_invoices: '0' },
      { work_order_id: 104, work_order_number: '', vendor_portal_invoices: 3 },
    ],
    [
      { work_order: '4513-1', paid: '250.00', unpaid: '0.00', bill_date: '2026-09-02' },
      { work_order: '4513-1', paid: '0', unpaid: '$1,100.50', bill_date: '2026-09-20' },
      { work_order: '4599-1', paid: '80', unpaid: '0', bill_date: '2026-08-01' },
      { work_order: null, paid: '999', unpaid: '0', bill_date: '2026-08-01' },
    ]
  );
  const by = Object.fromEntries(rows.map((r) => [r.wo_number, r]));

  it('counts uploaded invoices per work order', () => {
    expect(by['4512-1']).toMatchObject({ af_work_order_id: 101, invoice_count: 1, bill_lines: 0, billed_amount: 0 });
  });

  it('adds up bill lines, paid and unpaid, and keeps the latest bill date', () => {
    expect(by['4513-1']).toMatchObject({ invoice_count: 0, bill_lines: 2, paid_amount: 250, unpaid_amount: 1100.5, billed_amount: 1350.5, last_bill_date: '2026-09-20' });
  });

  it('keeps work orders with nothing yet (checked, none found)', () => {
    expect(by['4514-1']).toMatchObject({ invoice_count: 0, bill_lines: 0 });
  });

  it('includes bills for work orders outside the report window, and skips rows with no number', () => {
    expect(by['4599-1']).toMatchObject({ bill_lines: 1, billed_amount: 80, af_work_order_id: null, in_report: false });
    expect(by['4513-1'].in_report).toBe(true);
    expect(rows.some((r) => r.wo_number === '')).toBe(false);
    expect(rows).toHaveLength(4);
  });

  it('counts as received with an uploaded invoice or any bill', () => {
    expect(afInvoiceReceived(by['4512-1'])).toBe(true);
    expect(afInvoiceReceived(by['4513-1'])).toBe(true);
    expect(afInvoiceReceived(by['4514-1'])).toBe(false);
    expect(afInvoiceReceived(null)).toBe(false);
  });
});
