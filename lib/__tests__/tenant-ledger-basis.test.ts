import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ invoice: null as Record<string, unknown> | null, update: vi.fn() }));
vi.mock('@/lib/require-role', () => ({ requireRole: async () => ({ ok: true, email: 'office@highdesertpm.com', role: 'finance' }) }));
vi.mock('@/lib/auth', () => ({ auth: async () => ({ user: { email: 'office@highdesertpm.com' } }) }));
vi.mock('@/lib/invoices', () => ({ getInvoiceById: async () => mocks.invoice, updateInvoice: mocks.update }));
import { POST } from '@/app/api/invoices/[id]/tenant-ledger/route';

const call = (body: unknown) => POST(new NextRequest('https://os.example.com/api/invoices/i1/tenant-ledger', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'i1' }) });
const techInvoice = { id: 'i1', status: 'generated', charge_to: 'tenant', tenant_name: 'Pat Lee', tenant_unit: '#7', tenant_charge_note: 'Broken door', tenant_charge_reason: null, lease_clause: null };

describe('posting a tenant charge the tech left without a reason', () => {
  beforeEach(() => { mocks.update.mockReset(); mocks.update.mockImplementation(async (_id: string, patch: object) => ({ ...mocks.invoice, ...patch })); mocks.invoice = { ...techInvoice }; });

  it('asks for the reason before posting', async () => {
    const res = await call({ posted: true });
    expect(res.status).toBe(400);
    expect((await res.json()).needs_basis).toBe(true);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('asks for the lease clause on a lease fee', async () => {
    const res = await call({ posted: true, tenant_charge_reason: 'lease_fee' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/lease clause/);
  });
  it('saves the reason with the posting', async () => {
    const res = await call({ posted: true, tenant_charge_reason: 'tenant_damage' });
    expect(res.status).toBe(200);
    expect(mocks.update.mock.calls[0][1]).toMatchObject({ tenant_charge_reason: 'tenant_damage', tenant_ledger_posted_by: 'office@highdesertpm.com' });
  });
  it('never rewrites a reason the invoice already has', async () => {
    mocks.invoice = { ...techInvoice, tenant_charge_reason: 'other' };
    await call({ posted: true, tenant_charge_reason: 'tenant_damage' });
    expect(mocks.update.mock.calls[0][1]).not.toHaveProperty('tenant_charge_reason');
  });
});
