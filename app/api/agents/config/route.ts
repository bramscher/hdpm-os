import { NextRequest, NextResponse } from 'next/server';
import { requireStaffOrService } from '@/lib/maintenance/api-auth';
import { requireAdmin } from '@/lib/require-admin';
import { getSupabaseAdmin } from '@/lib/supabase';
import { isGloballyKilled, listAgentConfig } from '@/lib/agents/config';
import type { AgentConfigRow } from '@/lib/agents/types';
import { TIERS, tierToLevel, type AutonomyTier } from '@/lib/agents/tiers';

/**
 * GET /api/agents/config — the autonomy matrix + kill-switch state.
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

/**
 * PATCH /api/agents/config — set an agent action's autonomy tier and/or enabled
 * flag. Admin-only (autonomy is granted deliberately, never self-service).
 *
 * Body: { agent, action_type, tier?: 'supervised'|'assisted'|'autonomous', enabled?: boolean }
 *
 * The tier is translated to an autonomy_level CLAMPED to the row's own
 * ceiling_level (read here, never taken from the client) — so owner/tenant
 * actions stay ≤ L2 whatever tier is chosen. Ceilings themselves are policy and
 * are not editable through this route.
 */
export async function PATCH(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  let body: { agent?: unknown; action_type?: unknown; tier?: unknown; enabled?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const agent = typeof body.agent === 'string' ? body.agent : null;
  const actionType = typeof body.action_type === 'string' ? body.action_type : null;
  if (!agent || !actionType) {
    return NextResponse.json({ error: 'agent and action_type are required' }, { status: 400 });
  }

  const tier = body.tier;
  if (tier !== undefined && !TIERS.includes(tier as AutonomyTier)) {
    return NextResponse.json({ error: `tier must be one of ${TIERS.join(', ')}` }, { status: 400 });
  }
  const enabled = typeof body.enabled === 'boolean' ? body.enabled : undefined;
  if (tier === undefined && enabled === undefined) {
    return NextResponse.json({ error: 'nothing to update (provide tier and/or enabled)' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  try {
    // Read the row for its ceiling — the clamp source, never trusted from the client.
    const { data: current, error: readErr } = await supabase
      .from('agent_config')
      .select('*')
      .eq('agent', agent)
      .eq('action_type', actionType)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!current) {
      return NextResponse.json({ error: `no agent_config row for ${agent}/${actionType}` }, { status: 404 });
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (tier !== undefined) {
      patch.autonomy_level = tierToLevel(tier as AutonomyTier, (current as AgentConfigRow).ceiling_level);
    }
    if (enabled !== undefined) patch.enabled = enabled;

    const { data: updated, error: writeErr } = await supabase
      .from('agent_config')
      .update(patch)
      .eq('agent', agent)
      .eq('action_type', actionType)
      .select('*')
      .single();
    if (writeErr) throw writeErr;

    console.log(
      `[Agents] ${guard.email} set ${agent}/${actionType} →`,
      tier !== undefined ? `tier=${tier} (L${patch.autonomy_level})` : '',
      enabled !== undefined ? `enabled=${enabled}` : ''
    );
    return NextResponse.json({ row: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Agents] config write failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
