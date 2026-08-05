import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { matchAfBill, unmatchAfBill } from '@/lib/af-bills';

async function authorize() {
  const session = await auth();
  if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
    return NextResponse.json(
      { error: 'Unauthorized. Please sign in with your company Microsoft account.' },
      { status: 401 }
    );
  }
  return null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const unauthorized = await authorize();
    if (unauthorized) return unauthorized;

    const { id } = await params;
    const body = await request.json();
    const invoiceId = body?.invoice_id;
    if (!invoiceId || typeof invoiceId !== 'string') {
      return NextResponse.json({ error: 'invoice_id is required' }, { status: 400 });
    }

    await matchAfBill(id, invoiceId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Match AF bill error:', error);
    const message = error instanceof Error ? error.message : 'Failed to match bill';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const unauthorized = await authorize();
    if (unauthorized) return unauthorized;

    const { id } = await params;
    await unmatchAfBill(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Unmatch AF bill error:', error);
    const message = error instanceof Error ? error.message : 'Failed to unmatch bill';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
