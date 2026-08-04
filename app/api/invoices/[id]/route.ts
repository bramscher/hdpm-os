import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getInvoiceById, updateInvoice, deleteInvoice } from '@/lib/invoices';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in with your company Microsoft account.' },
        { status: 401 }
      );
    }

    const { id } = await params;
    const invoice = await getInvoiceById(id);

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    return NextResponse.json({ invoice });
  } catch (error) {
    console.error('Get invoice error:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch invoice';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in with your company Microsoft account.' },
        { status: 401 }
      );
    }

    const { id } = await params;
    const body = await request.json();

    const existing = await getInvoiceById(id);
    if (!existing) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    if (existing.status === 'void') {
      return NextResponse.json({ error: 'Cannot edit a voided invoice' }, { status: 400 });
    }

    // If editing a generated invoice, reset status to draft so they can re-generate
    if (existing.status === 'generated' || existing.status === 'attached') {
      body.status = 'draft';
      body.pdf_path = null;
    }

    const invoice = await updateInvoice(id, body);
    return NextResponse.json({ invoice });
  } catch (error) {
    console.error('Update invoice error:', error);
    const message = error instanceof Error ? error.message : 'Failed to update invoice';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in with your company Microsoft account.' },
        { status: 401 }
      );
    }

    const { id } = await params;
    await deleteInvoice(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete invoice error:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete invoice';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
