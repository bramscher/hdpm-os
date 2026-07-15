import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { attachInvoices, detachInvoices } from '@/lib/payments';

async function requireAuth() {
  const session = await getServerSession();
  if (!session?.user?.email?.endsWith('@highdesertpm.com')) return null;
  return session;
}

// Attach invoices to an existing payment (reconcile against a captured payment).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!(await requireAuth())) {
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in with your company Microsoft account.' },
        { status: 401 }
      );
    }

    const { id } = await params;
    const body = await request.json();
    const invoiceIds = body.invoice_ids;
    if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      return NextResponse.json({ error: 'No invoices provided' }, { status: 400 });
    }

    const payment = await attachInvoices(id, invoiceIds);
    return NextResponse.json({ payment });
  } catch (error) {
    console.error('Attach invoices error:', error);
    const message = error instanceof Error ? error.message : 'Failed to attach invoices';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Detach invoices from a payment (they revert to unpaid).
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!(await requireAuth())) {
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in with your company Microsoft account.' },
        { status: 401 }
      );
    }

    const { id } = await params;
    const body = await request.json();
    const invoiceIds = body.invoice_ids;
    if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      return NextResponse.json({ error: 'No invoices provided' }, { status: 400 });
    }

    const payment = await detachInvoices(id, invoiceIds);
    return NextResponse.json({ payment });
  } catch (error) {
    console.error('Detach invoices error:', error);
    const message = error instanceof Error ? error.message : 'Failed to detach invoices';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
