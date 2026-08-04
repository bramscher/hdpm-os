import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { buildInhouseAnalysis } from '@/lib/inhouse-analysis';
import { reportsApiConfigured } from '@/lib/appfolio-reports';

export const maxDuration = 120;

// In-house vs vendor analysis — vendor spend + margin strategy, admin only.
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email || session.user.isAdmin !== true) {
      return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
    }
    if (!reportsApiConfigured()) {
      return NextResponse.json(
        { error: 'AppFolio Reports API credentials not configured.' },
        { status: 503 }
      );
    }

    const params = request.nextUrl.searchParams;
    const to = params.get('to') || new Date().toISOString().split('T')[0];
    const from = params.get('from') || '2026-01-01';

    const analysis = await buildInhouseAnalysis(from, to);
    return NextResponse.json({ analysis });
  } catch (error) {
    console.error('In-house analysis error:', error);
    const message = error instanceof Error ? error.message : 'Analysis failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
