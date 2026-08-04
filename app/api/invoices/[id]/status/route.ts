import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getInvoiceById, updateInvoice } from '@/lib/invoices';

const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ['void'],
  generated: ['attached', 'void'],
  attached: ['void'],
  void: [],
};

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
    const { status } = body;

    if (!status || !['draft', 'generated', 'attached', 'void'].includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status. Must be: draft, generated, attached, or void' },
        { status: 400 }
      );
    }

    const invoice = await getInvoiceById(id);
    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const allowedTransitions = VALID_TRANSITIONS[invoice.status] || [];
    if (!allowedTransitions.includes(status)) {
      return NextResponse.json(
        { error: `Cannot change status from "${invoice.status}" to "${status}"` },
        { status: 400 }
      );
    }

    const updated = await updateInvoice(id, { status });
    return NextResponse.json({ invoice: updated });
  } catch (error) {
    console.error('Update status error:', error);
    const message = error instanceof Error ? error.message : 'Failed to update status';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
