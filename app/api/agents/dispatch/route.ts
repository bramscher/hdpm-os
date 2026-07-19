import { NextRequest, NextResponse } from 'next/server';
import { requireStaffOrService } from '@/lib/maintenance/api-auth';
import { dispatchOutbox } from '@/lib/agents/outbox';
import { AGENT_CHANNELS, type AgentChannel } from '@/lib/agents/types';

export const maxDuration = 300;

/**
 * POST /api/agents/dispatch — drain queued agent_outbox rows through the
 * channel adapters. Body: {channel?, limit?, dryRun?}. Smoke-test surface
 * now; the cron hook once agents produce messages (Briefs C+).
 */
export async function POST(request: NextRequest) {
  const caller = await requireStaffOrService(request);
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json().catch(() => ({}));
    const channel =
      body.channel && AGENT_CHANNELS.includes(body.channel) ? (body.channel as AgentChannel) : undefined;
    const summary = await dispatchOutbox({
      channel,
      limit: typeof body.limit === 'number' ? body.limit : undefined,
      dryRun: body.dryRun === true,
    });
    return NextResponse.json(summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Agents] dispatch failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
