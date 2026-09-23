import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../../app/api/invoices/route';

const { insert } = vi.hoisted(() => ({ insert: vi.fn() }));
vi.mock('../supabase', () => ({ getSupabaseAdmin: () => ({ from: () => ({ insert }) }) }));
vi.mock('../auth', () => ({ auth: async () => ({ user: { email: 'test@highdesertpm.com' } }) }));
vi.mock('../require-invoice-author', () => ({ requireInvoiceAuthor: async () => ({ ok: true, role: 'admin' }) }));
vi.mock('../af-bills', () => ({ attachAfBillsToInvoices: vi.fn() }));

function request(amount: number) {
  return new NextRequest('https://example.com/api/invoices', { method: 'POST', body: JSON.stringify({
    doc_type: 'credit', property_name: 'Test', property_address: '123 Test Street', description: 'Adjustment', credits_invoice_id: 'original',
    line_items: [{ description: 'Labor', type: 'labor', amount }, { description: 'Materials', type: 'materials', amount: 15 }],
  }) });
}

describe('Create credit request', () => {
  it('creates a linked itemized credit through the actual POST handler', async () => {
    insert.mockImplementation(row => ({ select: () => ({ single: async () => ({ data: { id: 'credit', ...row }, error: null }) }) }));
    const response = await POST(request(85));
    expect(response.status).toBe(201);
    expect((await response.json()).invoice).toMatchObject({ doc_type: 'credit', credits_invoice_id: 'original', total_amount: -100, labor_amount: -85, materials_amount: -15 });
  });
  it('returns actionable validation errors without saving', async () => {
    insert.mockClear();
    const response = await POST(request(0));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('credit item 1');
    expect(insert).not.toHaveBeenCalled();
  });
});
