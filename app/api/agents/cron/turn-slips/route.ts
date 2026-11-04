import { NextRequest, NextResponse } from 'next/server';
import { getAgentConfig, isGloballyKilled } from '@/lib/agents/config';
import { sendSlackMessage } from '@/lib/agents/channels/slack';
import { logDezActivity } from '@/lib/agents/dez/activity';
import { resolveStaffByPersonOrEmail } from '@/lib/agents/staff';
import { isCronRequest, withCronRun } from '@/lib/cron/run';
import { getSupabaseAdmin } from '@/lib/supabase';
import { todayPacific } from '@/lib/turnover/model';
import { loadSlips } from '@/lib/turnover/server';
import { buildSlipBlocks } from '@/lib/turnover/slip-message';
import { sortSlips, type Slip } from '@/lib/turnover/slips';

export const maxDuration = 120;
const DEFAULT_COORDINATOR = 'Brody';

/**
 * GET /api/agents/cron/turn-slips
 *
 * Weekday morning list of late unit turn steps. One Slack DM per coordinator, nothing on a
 * clean day. Until agent_config turn_slips/daily_list is enabled, only Craig gets it.
 */
async function handleGET(request: NextRequest): Promise<NextResponse> {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (await isGloballyKilled()) return NextResponse.json({ ok: true, skipped: 'global kill switch' });

  const config = await getAgentConfig('turn_slips', 'daily_list');
  const preview = !config?.enabled;
  const { slips, onChaseBoard } = await loadSlips(getSupabaseAdmin(), todayPacific());
  if (slips.length === 0) return NextResponse.json({ ok: true, slips: 0, sent: 0 });

  const byPerson = new Map<string, Slip[]>();
  const add = (person: string, list: Slip[]) => byPerson.set(person, [...(byPerson.get(person) ?? []), ...list]);
  if (preview) add('Craig', slips);
  else {
    for (const s of slips) add(s.coordinator || DEFAULT_COORDINATOR, [s]);
    const overdue = slips.filter((s) => s.escalate && s.coordinator !== 'Craig');
    if (overdue.length) add('Craig', overdue);
  }

  let sent = 0;
  const failed: string[] = [];
  for (const [person, list] of byPerson) {
    const staff = await resolveStaffByPersonOrEmail(person);
    if (!staff?.slack_user_id) {
      failed.push(`${person}: no Slack ID`);
      continue;
    }
    const message = buildSlipBlocks(sortSlips(list), { preview, onChaseBoard });
    const result = await sendSlackMessage({ channel: staff.slack_user_id, ...message });
    if (result.status === 'sent') sent++;
    else failed.push(`${person}: ${result.error ?? result.status}`);
  }

  await logDezActivity({
    kind: 'routine',
    surface: 'cron',
    scope: 'turn_slips',
    summary: `Unit turn late steps: ${slips.length}, sent to ${sent}${preview ? ' (preview)' : ''}`,
    detail: { slips: slips.length, preview, failed, byKind: slips.reduce<Record<string, number>>((n, s) => ({ ...n, [s.kind]: (n[s.kind] ?? 0) + 1 }), {}) },
  });
  return NextResponse.json({ ok: failed.length === 0, slips: slips.length, sent, preview, failed }, { status: 200 });
}

export const GET = withCronRun(handleGET);
