import { NextResponse } from 'next/server';
import { requireSection } from '@/lib/require-role';
import { loadGrowthSummary } from '@/lib/growth/data';

export const dynamic = 'force-dynamic';

/** GET /api/growth/summary: everything the /growth dashboard draws. Read-only. */
export async function GET() {
  const guard = await requireSection('growth');
  if (!guard.ok) return guard.response;
  return NextResponse.json(await loadGrowthSummary(guard.email));
}
