import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getInvoiceById, getInvoicePdfSignedUrl } from '@/lib/invoices';

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

    if (!invoice.pdf_path) {
      return NextResponse.json({ error: 'No PDF has been generated for this invoice' }, { status: 404 });
    }

    const downloadUrl = await getInvoicePdfSignedUrl(invoice.pdf_path);
    return NextResponse.json({ downloadUrl, invoice_code: invoice.invoice_code });
  } catch (error) {
    console.error('Download invoice error:', error);
    const message = error instanceof Error ? error.message : 'Failed to get download URL';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
