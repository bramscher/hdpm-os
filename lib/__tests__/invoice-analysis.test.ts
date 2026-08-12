import { describe, it, expect } from 'vitest';
import { aggregate, chargedSplit } from '../invoice-analysis';
import type { HdmsInvoice } from '../invoices';

/** Minimal invoice factory — only the fields the analysis reads. */
function inv(over: Partial<HdmsInvoice>): HdmsInvoice {
  return {
    id: 'i',
    invoice_number: 1,
    invoice_code: 'HDMS-INV-000001',
    status: 'generated',
    doc_type: 'invoice',
    credits_invoice_id: null,
    property_name: 'P',
    property_address: 'A',
    wo_reference: null,
    work_order_id: null,
    assigned_tech: null,
    completed_date: null,
    description: '',
    labor_amount: 0,
    materials_amount: 0,
    total_amount: 0,
    line_items: null,
    internal_notes: null,
    pdf_path: null,
    payment_id: null,
    created_by: 't@highdesertpm.com',
    created_at: '2025-07-01',
    updated_at: '2025-07-01',
    ...over,
  };
}

describe('aggregate + chargedSplit', () => {
  it('splits a payment into labor / materials / appliance / other charged', () => {
    const invoices = [
      inv({
        total_amount: 200,
        line_items: [
          { description: 'labor', type: 'labor', amount: 120 },
          { description: 'parts', type: 'materials', amount: 50, cost: 40 },
          { description: 'stove', type: 'appliance', amount: 22, cost: 20 },
          { description: 'permit', type: 'other', amount: 8 },
        ],
      }),
    ];
    const split = chargedSplit(aggregate(invoices));
    expect(split.labor).toBe(120);
    expect(split.materials).toBe(50);
    expect(split.appliance).toBe(22);
    expect(split.other).toBe(8);
    expect(split.total).toBe(200);
    // The buckets must tie out to the invoice total exactly.
    expect(split.labor + split.materials + split.appliance + split.other).toBe(split.total);
  });

  it('excludes void invoices from every dollar figure but counts them', () => {
    const invoices = [
      inv({ id: 'a', total_amount: 100, line_items: [{ description: 'l', type: 'labor', amount: 100 }] }),
      inv({ id: 'b', status: 'void', total_amount: 999, line_items: [{ description: 'l', type: 'labor', amount: 999 }] }),
    ];
    const totals = aggregate(invoices);
    expect(totals.count).toBe(2);
    expect(totals.voidCount).toBe(1);
    expect(totals.grand).toBe(100);
    expect(chargedSplit(totals).total).toBe(100);
  });

  it('falls back to aggregate columns for legacy invoices with no line items', () => {
    const invoices = [inv({ total_amount: 150, labor_amount: 100, materials_amount: 50 })];
    const split = chargedSplit(aggregate(invoices));
    expect(split.labor).toBe(100);
    expect(split.materials).toBe(50);
    expect(split.appliance).toBe(0);
    expect(split.total).toBe(150);
  });

  it('sums the charged total across a batch to reconcile against a payment', () => {
    const invoices = [
      inv({ total_amount: 18000, line_items: [{ description: 'l', type: 'labor', amount: 18000 }] }),
      inv({ total_amount: 705.34, line_items: [{ description: 'm', type: 'materials', amount: 705.34, cost: 560 }] }),
    ];
    expect(chargedSplit(aggregate(invoices)).total).toBeCloseTo(18705.34, 2);
  });

  it('a credit nets the total down (over-bill correction reconciles)', () => {
    const invoices = [
      inv({ id: 'inv', total_amount: 500, line_items: [{ description: 'work', type: 'labor', amount: 500 }] }),
      // A $200 credit stored as negatives (as createCredit produces).
      inv({
        id: 'cr',
        doc_type: 'credit',
        invoice_code: 'HDMS-CR-000002',
        total_amount: -200,
        line_items: [{ description: 'over-bill correction', type: 'other', amount: -200 }],
      }),
    ];
    const t = aggregate(invoices);
    expect(t.grand).toBe(300); // 500 − 200
    expect(chargedSplit(t).total).toBe(300);
    expect(t.other).toBe(-200); // credit lands in the 'other' bucket, not labor
  });

  it('a void credit is excluded like any void', () => {
    const invoices = [
      inv({ id: 'inv', total_amount: 500, line_items: [{ description: 'work', type: 'labor', amount: 500 }] }),
      inv({ id: 'cr', doc_type: 'credit', status: 'void', total_amount: -200, line_items: [{ description: 'x', type: 'other', amount: -200 }] }),
    ];
    const t = aggregate(invoices);
    expect(t.voidCount).toBe(1);
    expect(t.grand).toBe(500); // void credit nets nothing
  });
});
