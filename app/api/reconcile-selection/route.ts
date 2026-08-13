import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import {
  getReconcileSelection,
  saveReconcileSelection,
  deleteReconcileSelection,
} from '@/lib/reconcile-selection';

/**
 * Persisted reconcile checkbox selection for the signed-in user, keyed by the
 * reconcile view's date-range period.
 *   GET    /api/reconcile-selection?from=&to=   → { selection: { invoice_ids, filters } | null }
 *   PUT    /api/reconcile-selection             → body { from, to, invoice_ids, filters? }
 *   DELETE /api/reconcile-selection?from=&to=   → cleared once reconciliation is done
 */
async function requireEmail() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email?.endsWith('@highdesertpm.com')) return null;
  return email;
}

export async function GET(request: NextRequest) {
  const email = await requireEmail();
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { searchParams } = new URL(request.url);
    const selection = await getReconcileSelection(
      email,
      searchParams.get('from') || '',
      searchParams.get('to') || ''
    );
    return NextResponse.json({ selection });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load selection';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const email = await requireEmail();
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await request.json();
    const invoiceIds = Array.isArray(body.invoice_ids) ? body.invoice_ids.map(String) : [];
    await saveReconcileSelection(
      email,
      body.from || '',
      body.to || '',
      invoiceIds,
      body.filters ?? null
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save selection';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const email = await requireEmail();
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { searchParams } = new URL(request.url);
    await deleteReconcileSelection(
      email,
      searchParams.get('from') || '',
      searchParams.get('to') || ''
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete selection';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
