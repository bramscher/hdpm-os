import { describe, expect, it, vi } from 'vitest';
import {
  chargeFieldsFrom,
  chargeLabel,
  chargeProblems,
  ChargeValidationError,
  mergeChargeUpdate,
  normalizeChargeFields,
  pickChargeFields,
} from '../invoice-charge';
import { createInvoice, type HdmsInvoice } from '../invoices';
import { generateInvoicePdf } from '../invoice-pdf-template';

const { insert } = vi.hoisted(() => ({ insert: vi.fn() }));
vi.mock('../supabase', () => ({
  getSupabaseAdmin: () => ({ from: () => ({ insert }) }),
}));

const tenant = {
  charge_to: 'tenant' as const,
  tenant_name: 'Jane Doe',
  tenant_unit: '4',
  tenant_charge_reason: 'tenant_damage' as const,
  tenant_charge_note: 'Broken bathroom door; photos on the WO',
  lease_clause: null,
};

describe('who pays: owner or tenant, never both', () => {
  it('clears every tenant field when the invoice is an owner charge', () => {
    expect(normalizeChargeFields({ ...tenant, charge_to: 'owner' })).toEqual({
      charge_to: 'owner', tenant_name: null, tenant_unit: null, tenant_charge_reason: null, tenant_charge_note: null, lease_clause: null,
    });
  });

  it('rejects an unknown payer or reason', () => {
    expect(() => normalizeChargeFields({ charge_to: 'both' })).toThrow(ChargeValidationError);
    expect(() => normalizeChargeFields({ charge_to: 'tenant', tenant_charge_reason: 'vibes' })).toThrow(ChargeValidationError);
  });

  it('lets a tenant draft be incomplete but needs the full basis to generate', () => {
    const draft = { charge_to: 'tenant' as const, tenant_name: 'Jane Doe' };
    expect(chargeProblems(draft, { finalizing: false })).toEqual([]);
    const problems = chargeProblems(draft, { finalizing: true });
    expect(problems.join(' ')).toContain('name and unit');
    expect(problems.join(' ')).toContain('Choose why');
    expect(problems.join(' ')).toContain('note');
    expect(chargeProblems(tenant, { finalizing: true })).toEqual([]);
    expect(chargeProblems({ charge_to: 'owner' }, { finalizing: true })).toEqual([]);
  });

  it('needs the lease clause for a lease fee', () => {
    const fee = { ...tenant, tenant_charge_reason: 'lease_fee' as const };
    expect(chargeProblems(fee, { finalizing: true }).join(' ')).toContain('lease clause');
    expect(chargeProblems({ ...fee, lease_clause: 'Section 14' }, { finalizing: true })).toEqual([]);
  });

  it('merges a partial edit so an owner invoice never keeps tenant fields', () => {
    expect(mergeChargeUpdate({ charge_to: 'owner' }, {})).toEqual({});
    // Switching a tenant invoice back to owner wipes the tenant details.
    expect(mergeChargeUpdate(tenant, { charge_to: 'owner' })).toMatchObject({ charge_to: 'owner', tenant_name: null, tenant_charge_note: null });
    // Editing one tenant field keeps the rest.
    expect(mergeChargeUpdate(tenant, { tenant_unit: ' 5 ' })).toMatchObject({ charge_to: 'tenant', tenant_name: 'Jane Doe', tenant_unit: '5' });
    // Tenant fields sent for an owner invoice are dropped.
    expect(mergeChargeUpdate({ charge_to: 'owner' }, { tenant_name: 'Someone' })).toMatchObject({ charge_to: 'owner', tenant_name: null });
  });

  it('only picks payer keys the request actually sent', () => {
    expect(pickChargeFields({ property_name: 'X' })).toEqual({});
    expect(pickChargeFields({ charge_to: 'tenant', tenant_name: '  Jane ' })).toEqual({ charge_to: 'tenant', tenant_name: 'Jane' });
  });

  it('labels invoices for lists and the PDF', () => {
    expect(chargeLabel({})).toBe('Owner charge');
    expect(chargeLabel(tenant)).toBe('Tenant charge · Jane Doe, unit 4');
    expect(chargeFieldsFrom({ charge_to: 'tenant', tenant_name: 'Jane' })).toMatchObject({ charge_to: 'tenant', tenant_name: 'Jane', tenant_unit: null });
    expect(chargeFieldsFrom({})).toMatchObject({ charge_to: 'owner', tenant_name: null });
  });

  it('writes the payer on create, defaulting to owner', async () => {
    insert.mockImplementation((row) => ({ select: () => ({ single: async () => ({ data: { ...row, invoice_code: 'HDMS-INV-1', created_at: '2026-10-02T12:00:00Z' }, error: null }) }) }));
    const base = { property_name: 'P', property_address: '1 Main', description: 'Repair', labor_amount: 95, materials_amount: 0, total_amount: 95, created_by: 'test@example.com' };
    expect(await createInvoice(base)).toMatchObject({ charge_to: 'owner', tenant_name: null });
    expect(await createInvoice({ ...base, ...tenant })).toMatchObject({ charge_to: 'tenant', tenant_name: 'Jane Doe', tenant_unit: '4' });
  });

  it('prints OWNER CHARGE or TENANT CHARGE with the tenant basis', () => {
    const inv = {
      id: 'i', invoice_code: 'HDMS-INV-000099', doc_type: 'invoice', status: 'draft', property_name: 'Sample Apartments', property_address: '1 Main St, Bend',
      wo_reference: '123', completed_date: '2026-10-01', description: 'Door repair', labor_amount: 95, materials_amount: 0, total_amount: 95,
      line_items: [{ description: 'Door repair', type: 'labor', qty: 1, unit_price: 95, amount: 95 }],
    } as unknown as HdmsInvoice;
    expect(generateInvoicePdf(inv).toString('latin1')).toContain('OWNER CHARGE');
    const tenantPdf = generateInvoicePdf({ ...inv, ...tenant, tenant_charge_reason: 'lease_fee', lease_clause: 'Section 14' }).toString('latin1');
    expect(tenantPdf).toContain('TENANT CHARGE');
    expect(tenantPdf).toContain('CHARGED TO TENANT');
    expect(tenantPdf).toContain('Jane Doe');
    expect(tenantPdf).toContain('Section 14');
    expect(tenantPdf).not.toContain('photos on the WO'); // the note stays internal
  });
});
