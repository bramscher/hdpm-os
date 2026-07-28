import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { receptionDailyReport } from '@/lib/reception';

/**
 * GET /api/reception/report?days=14
 *
 * Daily reception breakdown from reception_call: main-line calls answered by
 * Ashley vs Haven AI (direct/overflow) vs missed, plus Haven→human transfers
 * split by intent (leasing / maintenance / human requested / direct staff).
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const days = Math.min(
      Math.max(parseInt(new URL(request.url).searchParams.get('days') || '14', 10) || 14, 1),
      90
    );
    const supabase = getSupabaseAdmin();
    const daily = await receptionDailyReport(supabase, days);
    return NextResponse.json(
      { days, daily },
      { headers: { 'Cache-Control': 'private, max-age=300' } }
    );
  } catch (error) {
    console.error('[reception/report] error:', error);
    const message = error instanceof Error ? error.message : 'Failed to load reception report';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
