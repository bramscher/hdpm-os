import { describe, expect, it, vi } from 'vitest';
import { creditItemsForInvoice, normalizeCreditItems, creditBalancePreview } from '../invoice-credit';
import { createCredit, type HdmsInvoice } from '../invoices';
import { generateInvoicePdf } from '../invoice-pdf-template';

const { insert } = vi.hoisted(() => ({ insert: vi.fn() }));
vi.mock('../supabase', () => ({
  getSupabaseAdmin: () => ({ from: () => ({ insert }) }),
}));

const items = [
  { description: 'Labor adjustment', type: 'labor', amount: 100 },
  { description: 'Returned materials', type: 'materials', amount: 25 },
  { description: 'Appliance adjustment', type: 'appliance', amount: 10 },
  { description: 'Other adjustment', type: 'other', amount: 5 },
];

describe('itemized credit memos', () => {
  it('combines categories into one credit with accurate subtotals', () => {
    expect(normalizeCreditItems(items)).toMatchObject({ total_amount: 140, labor_amount: 100, materials_amount: 35 });
    expect(normalizeCreditItems(items.slice(0, 2)).line_items).toHaveLength(2);
  });

  it('adds currency in cents', () => {
    expect(normalizeCreditItems(items.slice(0, 2).map((item, index) => ({ ...item, amount: index ? 0.2 : 0.1 }))).total_amount).toBe(0.3);
  });

  it.each([0, -10, NaN, Infinity, 0.001])('rejects invalid amount %s', amount => {
    expect(() => normalizeCreditItems([{ ...items[0], amount }])).toThrow('greater than zero');
  });

  it('requires at least one item, a description, and a valid category', () => {
    expect(() => normalizeCreditItems([])).toThrow('at least one');
    expect(() => normalizeCreditItems([{ ...items[0], description: ' ' }])).toThrow('description');
    expect(() => normalizeCreditItems([{ ...items[0], type: 'invalid' }])).toThrow('valid type');
  });

  it('prefills a linked invoice with editable category-specific credit items', () => {
    expect(creditItemsForInvoice({ invoice_code: 'INV-1', total_amount: 125, line_items: items.slice(0, 2) as NonNullable<HdmsInvoice['line_items']> })).toEqual([
      { description: 'Credit: Labor adjustment', type: 'labor', amount: 100 },
      { description: 'Credit: Returned materials', type: 'materials', amount: 25 },
    ]);
  });

  it('preserves the full amount when linked invoice details do not match its total', () => {
    expect(creditItemsForInvoice({ invoice_code: 'INV-1', total_amount: 150, line_items: items.slice(0, 2) as NonNullable<HdmsInvoice['line_items']> })).toEqual([
      { description: 'Credit for INV-1', type: 'other', amount: 150 },
    ]);
  });

  it('stores every line and derives negative totals even if caller summaries are wrong', async () => {
    insert.mockImplementation(row => ({ select: () => ({ single: async () => ({ data: { ...row, invoice_code: 'CR-1', created_at: '2026-09-23T12:00:00Z' }, error: null }) }) }));
    const saved = await createCredit({
      property_name: 'Test property', property_address: '123 Test Street', description: 'Billing correction', created_by: 'test@example.com',
      labor_amount: 999, materials_amount: 999, total_amount: 999,
      line_items: items.slice(0, 2) as NonNullable<HdmsInvoice['line_items']>,
    });
    expect(saved).toMatchObject({ doc_type: 'credit', labor_amount: -100, materials_amount: -25, total_amount: -125 });
    expect(saved.line_items?.map(item => item.amount)).toEqual([-100, -25]);
    const pdf = generateInvoicePdf(saved).toString('latin1');
    expect(pdf).toContain('Labor adjustment');
    expect(pdf).toContain('Returned materials');
    expect(pdf).toContain('125.00');
  });
});


describe('credit balance preview', () => {
  it('shows the original invoice less the proposed credit in cents', () => {
    expect(creditBalancePreview({ id: 'invoice', total_amount: 222.33 }, [], 100)).toEqual({ original: 222.33, existingCredits: 0, net: 122.33 });
  });
  it('deducts existing linked credits but excludes void and unrelated documents', () => {
    const credit = { doc_type: 'credit' as const, credits_invoice_id: 'invoice', status: 'generated' as const, total_amount: -20 };
    expect(creditBalancePreview({ id: 'invoice', total_amount: 222.33 }, [credit, { ...credit, status: 'void' }, { ...credit, credits_invoice_id: 'other' }], 100).net).toBe(102.33);
  });
  it('retains all three original credit items', () => {
    const rows = [{ description: 'Labor', type: 'labor' as const, amount: 170 }, { description: 'Smoke detector', type: 'materials' as const, amount: 37.33 }, { description: 'Paint disposables', type: 'materials' as const, amount: 15 }];
    expect(creditItemsForInvoice({ invoice_code: 'INV-315', total_amount: 222.33, line_items: rows }).map(row => row.amount)).toEqual([170, 37.33, 15]);
  });
});
