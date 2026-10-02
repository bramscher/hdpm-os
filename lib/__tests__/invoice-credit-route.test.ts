import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../../app/api/invoices/route';

const { insert } = vi.hoisted(() => ({ insert: vi.fn() }));
// The credited invoice is a tenant charge; the credit must inherit that, whatever the form sent.
const original = { charge_to: 'tenant', tenant_name: 'Jane Doe', tenant_unit: '4', tenant_charge_reason: 'tenant_damage', tenant_charge_note: 'Door', lease_clause: null };
const select = () => ({ eq: () => ({ maybeSingle: async () => ({ data: original, error: null }) }) });
vi.mock('../supabase', () => ({ getSupabaseAdmin: () => ({ from: () => ({ insert, select }) }) }));
vi.mock('../auth', () => ({ auth: async () => ({ user: { email: 'test@highdesertpm.com' } }) }));
vi.mock('../require-invoice-author', () => ({ requireInvoiceAuthor: async () => ({ ok: true, role: 'admin' }) }));
vi.mock('../af-bills', () => ({ attachAfBillsToInvoices: vi.fn() }));

function request(amount: number) {
  return new NextRequest('https://example.com/api/invoices', { method: 'POST', body: JSON.stringify({
    doc_type: 'credit', property_name: 'Test', property_address: '123 Test Street', description: 'Adjustment', credits_invoice_id: 'original',
    line_items: [{ description: 'Labor', type: 'labor', amount }, { description: 'Materials', type: 'materials', amount: 15 }],
  }) });
}

describe('Create invoice request: who pays', () => {
  it('rejects an invoice charged to both or to an unknown party', async () => {
    insert.mockClear();
    const response = await POST(new NextRequest('https://example.com/api/invoices', { method: 'POST', body: JSON.stringify({
      property_name: 'Test', property_address: '123 Test Street', description: 'Repair', charge_to: 'both',
    }) }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('Owner or Tenant');
    expect(insert).not.toHaveBeenCalled();
  });
});

describe('Create credit request', () => {
  it('creates a linked itemized credit through the actual POST handler', async () => {
    insert.mockImplementation(row => ({ select: () => ({ single: async () => ({ data: { id: 'credit', ...row }, error: null }) }) }));
    const response = await POST(request(85));
    expect(response.status).toBe(201);
    expect((await response.json()).invoice).toMatchObject({ doc_type: 'credit', credits_invoice_id: 'original', total_amount: -100, labor_amount: -85, materials_amount: -15, charge_to: 'tenant', tenant_name: 'Jane Doe' });
  });
  it('returns actionable validation errors without saving', async () => {
    insert.mockClear();
    const response = await POST(request(0));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('credit item 1');
    expect(insert).not.toHaveBeenCalled();
  });
});
