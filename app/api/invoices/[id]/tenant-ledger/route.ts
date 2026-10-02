import { requireRole } from '@/lib/require-role';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getInvoiceById, updateInvoice } from '@/lib/invoices';

/**
 * POST /api/invoices/:id/tenant-ledger — record (or undo) that a tenant
 * charge has been posted to the tenant's AppFolio ledger to reimburse the
 * owner. Kept apart from the invoice PATCH, which would send a generated
 * invoice back to draft. Office roles only, like status changes.
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

    const updated = await updateInvoice(id, posted
      ? { tenant_ledger_posted_at: new Date().toISOString(), tenant_ledger_posted_by: session.user.email }
      : { tenant_ledger_posted_at: null, tenant_ledger_posted_by: null });
    return NextResponse.json({ invoice: updated });
  } catch (error) {
    console.error('Tenant ledger update error:', error);
    const message = error instanceof Error ? error.message : 'Failed to record the tenant ledger charge';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
