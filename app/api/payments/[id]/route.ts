import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { deletePayment, getPaymentById, updatePayment } from '@/lib/payments';

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
    const payment = await getPaymentById(id);

    if (!payment) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    }

    return NextResponse.json({ payment });
  } catch (error) {
    console.error('Get payment error:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch payment';
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

    // Amount, if present, must be a valid number or explicitly cleared to null.
    let amount: number | null | undefined;
    if (body.amount !== undefined) {
      const empty = body.amount === null || body.amount === '';
      amount = empty ? null : parseFloat(body.amount);
      if (!empty && !Number.isFinite(amount as number)) {
        return NextResponse.json({ error: 'Payment amount must be a valid number' }, { status: 400 });
      }
    }

    const payment = await updatePayment(id, {
      paid_on: body.paid_on,
      amount,
      payee: body.payee,
      reference: body.reference,
      method: body.method,
      memo: body.memo,
    });

    return NextResponse.json({ payment });
  } catch (error) {
    console.error('Update payment error:', error);
    const message = error instanceof Error ? error.message : 'Failed to update payment';
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
    await deletePayment(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete payment error:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete payment';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
