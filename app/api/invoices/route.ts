import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createInvoice, getInvoices } from '@/lib/invoices';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in with your company Microsoft account.' },
        { status: 401 }
      );
    }

    // The billable report needs the full set, not just the default page.
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10) || 50, 5000);
    const offset = parseInt(searchParams.get('offset') || '0', 10) || 0;

    const invoices = await getInvoices(limit, offset);
    return NextResponse.json({ invoices });
  } catch (error) {
    console.error('Get invoices error:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch invoices';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in with your company Microsoft account.' },
        { status: 401 }
      );
    }

    const body = await request.json();

    // Validate required fields
    const { property_name, property_address, description } = body;
    if (!property_name || !property_address || !description) {
      return NextResponse.json(
        { error: 'Property name, address, and description are required' },
        { status: 400 }
      );
    }

    const labor = parseFloat(body.labor_amount) || 0;
    const materials = parseFloat(body.materials_amount) || 0;
    const total = body.total_amount != null ? parseFloat(body.total_amount) : labor + materials;

    const invoice = await createInvoice({
      property_name: property_name.trim(),
      property_address: property_address.trim(),
      wo_reference: body.wo_reference?.trim() || undefined,
      work_order_id: body.work_order_id?.trim() || undefined,
      completed_date: body.completed_date || undefined,
      description: description.trim(),
      labor_amount: labor,
      materials_amount: materials,
      total_amount: total,
      line_items: body.line_items?.length ? body.line_items : undefined,
      internal_notes: body.internal_notes?.trim() || undefined,
      created_by: session.user.email!,
    });

    return NextResponse.json({ invoice }, { status: 201 });
  } catch (error) {
    console.error('Create invoice error:', error);
    const message = error instanceof Error ? error.message : 'Failed to create invoice';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
