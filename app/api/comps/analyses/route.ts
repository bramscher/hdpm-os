import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listRentAnalyses } from '@/lib/rent-analyses';

/**
 * GET /api/comps/analyses
 * List all saved rent analyses (most recent first)
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const analyses = await listRentAnalyses();
    return NextResponse.json({ analyses });
  } catch (error) {
    console.error('[Analyses] List error:', error);
    const message = error instanceof Error ? error.message : 'Failed to list analyses';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
