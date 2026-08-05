import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getInvoiceById, updateInvoice, uploadInvoicePdf } from '@/lib/invoices';
import { generateInvoicePdf } from '@/lib/invoice-pdf-template';

export const maxDuration = 30;

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
    const invoice = await getInvoiceById(id);

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    if (invoice.status === 'void') {
      return NextResponse.json({ error: 'Cannot generate PDF for a voided invoice' }, { status: 400 });
    }

    // Ensure numeric fields are numbers (Supabase may return strings)
    const safeInvoice = {
      ...invoice,
      labor_amount: Number(invoice.labor_amount) || 0,
      materials_amount: Number(invoice.materials_amount) || 0,
      total_amount: Number(invoice.total_amount) || 0,
      wo_reference: invoice.wo_reference ? String(invoice.wo_reference) : null,
      property_name: String(invoice.property_name || ''),
      property_address: String(invoice.property_address || ''),
      description: String(invoice.description || ''),
      invoice_code: String(invoice.invoice_code || ''),
      completed_date: invoice.completed_date ? String(invoice.completed_date) : null,
    };

    // Generate PDF using jsPDF (pure JS, no React dependency)
    const pdfBuffer = generateInvoicePdf(safeInvoice);

    // Upload to Supabase Storage
    const pdfPath = await uploadInvoicePdf(pdfBuffer, invoice);

    // Update invoice record
    const updatedInvoice = await updateInvoice(id, {
      pdf_path: pdfPath,
      status: 'generated',
    });

    return NextResponse.json({ invoice: updatedInvoice });
  } catch (error) {
    console.error('Generate PDF error:', error);
    const message = error instanceof Error ? error.message : 'Failed to generate PDF';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
