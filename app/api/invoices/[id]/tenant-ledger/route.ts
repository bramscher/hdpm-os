import { requireRole } from '@/lib/require-role';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getInvoiceById, updateInvoice } from '@/lib/invoices';
import { isTenantReason, ledgerProblems } from '@/lib/invoice-charge';

/**
 * POST /api/invoices/:id/tenant-ledger — record (or undo) that a tenant
 * charge has been posted to the tenant's AppFolio ledger to reimburse the
 * owner. Kept apart from the invoice PATCH, which would send a generated
 * invoice back to draft. Office roles only, like status changes.
 *
 * Body: { posted?: boolean, tenant_charge_reason?, lease_clause? }. Techs may
 * generate a tenant charge without a reason/lease clause; the office supplies
 * any that are missing here, and posting requires them (needs_basis: true).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const roleGuard = await requireRole('finance', 'maintenance', 'pm', 'manager');
    if (!roleGuard.ok) return roleGuard.response;
    const session = await auth();
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json({ error: 'Unauthorized. Please sign in with your company Microsoft account.' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const posted = body.posted !== false;

    const invoice = await getInvoiceById(id);
    if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    if (invoice.charge_to !== 'tenant') {
      return NextResponse.json({ error: 'This is an owner charge; there is no tenant ledger charge to post.' }, { status: 400 });
    }
    if (invoice.status !== 'generated' && invoice.status !== 'attached') {
      return NextResponse.json({ error: 'Generate the invoice before recording the tenant ledger charge.' }, { status: 400 });
    }

    if (!posted) {
      const undone = await updateInvoice(id, { tenant_ledger_posted_at: null, tenant_ledger_posted_by: null });
      return NextResponse.json({ invoice: undone });
    }
    // Fill in only what the invoice doesn't have yet; a recorded basis is never rewritten here.
    const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const basis: { tenant_charge_reason?: 'tenant_damage' | 'lease_fee' | 'other'; lease_clause?: string } = {};
    if (!invoice.tenant_charge_reason && isTenantReason(body.tenant_charge_reason)) basis.tenant_charge_reason = body.tenant_charge_reason;
    if (!invoice.lease_clause && clean(body.lease_clause)) basis.lease_clause = clean(body.lease_clause)!;
    const problems = ledgerProblems({ ...invoice, ...basis });
    if (problems.length) {
      return NextResponse.json({ error: problems.join(' '), needs_basis: true, reason: basis.tenant_charge_reason ?? invoice.tenant_charge_reason ?? null }, { status: 400 });
    }
    const updated = await updateInvoice(id, { ...basis, tenant_ledger_posted_at: new Date().toISOString(), tenant_ledger_posted_by: session.user.email });
    return NextResponse.json({ invoice: updated });
  } catch (error) {
    console.error('Tenant ledger update error:', error);
    const message = error instanceof Error ? error.message : 'Failed to record the tenant ledger charge';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
