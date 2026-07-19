import { NextRequest, NextResponse } from 'next/server';
import { requireStaffOrService } from '@/lib/maintenance/api-auth';
import { isGloballyKilled, listAgentConfig } from '@/lib/agents/config';

/**
 * GET /api/agents/config — the autonomy matrix + kill-switch state.
 * Read-only in Brief B: autonomy changes are manual row updates by design.
 */
export async function GET(request: NextRequest) {
  const caller = await requireStaffOrService(request);
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const [config, killed] = await Promise.all([listAgentConfig(), isGloballyKilled()]);
    return NextResponse.json({ config, killed });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Agents] config read failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
