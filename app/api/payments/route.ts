import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { capturePayment, createPayment, getPayments } from '@/lib/payments';

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
    // Amount is optional — capture by date now, fill it in later. But if a
    // non-empty value is sent, it must be a valid number.
    const hasAmount = body.amount !== undefined && body.amount !== null && body.amount !== '';
    const amount = hasAmount ? parseFloat(body.amount) : null;
    if (hasAmount && !Number.isFinite(amount as number)) {
      return NextResponse.json({ error: 'Payment amount must be a valid number' }, { status: 400 });
    }

    const common = {
      paid_on,
      amount,
      payee: body.payee?.trim() || undefined,
      reference: body.reference?.trim() || undefined,
      method: body.method?.trim() || undefined,
      memo: body.memo?.trim() || undefined,
      created_by: session.user.email!,
    };

    // With invoices → capture + reconcile in one shot; without → capture "open".
    const payment =
      Array.isArray(invoice_ids) && invoice_ids.length > 0
        ? await createPayment({ ...common, invoice_ids })
        : await capturePayment(common);

    return NextResponse.json({ payment }, { status: 201 });
  } catch (error) {
    console.error('Create payment error:', error);
    const message = error instanceof Error ? error.message : 'Failed to create payment';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
