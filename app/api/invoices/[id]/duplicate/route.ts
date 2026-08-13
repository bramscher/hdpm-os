import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { duplicateInvoice } from '@/lib/invoices';

/**
 * POST /api/invoices/[id]/duplicate
 *
 * Create a draft duplicate of an invoice: same number with the next free suffix
 * (…-1, …-2), copying its content. Returns the new draft so the UI can open it
 * in the editor.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in with your company Microsoft account.' },
        { status: 401 }
      );
    }

    const { id } = await params;
    const invoice = await duplicateInvoice(id, session.user.email);
    return NextResponse.json({ invoice }, { status: 201 });
  } catch (error) {
    console.error('Duplicate invoice error:', error);
    const message = error instanceof Error ? error.message : 'Failed to duplicate invoice';
    const status = message === 'Invoice not found' ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
