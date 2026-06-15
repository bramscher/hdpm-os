import { NextRequest, NextResponse } from 'next/server';
import {
  getDashboardConfig,
  saveDashboardConfig,
  type DashboardConfig,
} from '@/lib/dashboard-config';
import { requireAdmin } from '@/lib/require-admin';

/**
 * GET  /api/config  → merged dashboard config (defaults + persisted overrides)
 * PUT  /api/config  → upsert a partial config patch, returns the merged result
 *
 * Protected by the global next-auth middleware (dashboard is behind login).
 */
export async function GET() {
  try {
    const guard = await requireAdmin();
    if (!guard.ok) return guard.response;
    return NextResponse.json(await getDashboardConfig());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to read config' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const guard = await requireAdmin();
    if (!guard.ok) return guard.response;
    const patch = (await request.json()) as Partial<DashboardConfig>;
    return NextResponse.json(await saveDashboardConfig(patch));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to save config' },
      { status: 500 }
    );
  }
}
