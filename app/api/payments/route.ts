import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createPayment, getPayments } from '@/lib/payments';

export async function GET() {
  try {
    const session = await getServerSession();
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in with your company Microsoft account.' },
        { status: 401 }
      );
    }

    const payments = await getPayments();
    return NextResponse.json({ payments });
  } catch (error) {
    console.error('Get payments error:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch payments';
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
    const { paid_on, invoice_ids } = body;

    if (!paid_on) {
      return NextResponse.json({ error: 'Payment date is required' }, { status: 400 });
    }
    const amount = parseFloat(body.amount);
    if (!Number.isFinite(amount)) {
      return NextResponse.json({ error: 'A valid payment amount is required' }, { status: 400 });
    }
    if (!Array.isArray(invoice_ids) || invoice_ids.length === 0) {
      return NextResponse.json(
        { error: 'Select at least one invoice to reconcile' },
        { status: 400 }
      );
    }

    const payment = await createPayment({
      paid_on,
      amount,
      reference: body.reference?.trim() || undefined,
      method: body.method?.trim() || undefined,
      memo: body.memo?.trim() || undefined,
      invoice_ids,
      created_by: session.user.email!,
    });

    return NextResponse.json({ payment }, { status: 201 });
  } catch (error) {
    console.error('Create payment error:', error);
    const message = error instanceof Error ? error.message : 'Failed to create payment';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
