import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { buildHdmsReconciliation } from '@/lib/maintenance/hdms-reconcile';

export const maxDuration = 120;

// HDMS work-order → invoice reconciliation — which HDMS jobs got billed, which
// leaked (done, not billed) and which are still in progress. Admin only, same
// gate as the other profit/markup reports. Supabase-only, no AppFolio Reports.
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email || session.user.isAdmin !== true) {
      return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
    }

    const raw = Number(request.nextUrl.searchParams.get('windowDays'));
    const windowDays = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 730) : 180;

    const reconciliation = await buildHdmsReconciliation({ windowDays });
    return NextResponse.json({ reconciliation });
  } catch (error) {
    console.error('HDMS reconciliation error:', error);
    const message = error instanceof Error ? error.message : 'Reconciliation failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
