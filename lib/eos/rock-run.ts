/**
 * Rocks — Friday self-report cards (Phase 2, Brief 2E). Rides the Friday
 * scorecard cron: each owner of active-quarter Rocks (on/off) gets ONE
 * consolidated Slack card with one-tap On/Off buttons per Rock. Taps land
 * in /api/agents/slack/interact (rock:* namespace). No follow-up, no
 * pressure — off-track Rocks get discussed in the meeting (doc 06 §5).
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import { enqueueOutbox, dispatchOutbox } from '@/lib/agents/outbox';
import { resolveStaffByPersonOrEmail } from '@/lib/agents/staff';
import { currentQuarter, buildRockCardBlocks } from './rock';
import type { Rock } from './types';

export interface RockWeekResult {
  quarter: string;
  activeRocks: number;
  cardsSent: number;
  ownersSkipped: number;
  dryRun: boolean;
}

export async function runRockWeek(opts: { dryRun?: boolean; now?: Date } = {}): Promise<RockWeekResult> {
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun === true;
  const supabase = getSupabaseAdmin();
  const quarter = currentQuarter(now);
  const result: RockWeekResult = {
    quarter,
    activeRocks: 0,
    cardsSent: 0,
    ownersSkipped: 0,
    dryRun,
  };

  const { data, error } = await supabase
    .from('rock')
    .select('*')
    .eq('org_id', 'hdpm')
    .eq('quarter', quarter)
    .in('status', ['on', 'off'])
    .not('owner_person', 'is', null)
    .order('due_on', { ascending: true, nullsFirst: false });
  if (error) throw new Error(`rock read failed: ${error.message}`);
  const rocks = (data ?? []) as Rock[];
  result.activeRocks = rocks.length;
  if (rocks.length === 0) return result;

  const byOwner = new Map<string, Rock[]>();
  for (const r of rocks) {
    const owner = r.owner_person as string;
    if (!byOwner.has(owner)) byOwner.set(owner, []);
    byOwner.get(owner)!.push(r);
  }

  for (const [owner, ownerRocks] of byOwner) {
    if (dryRun) {
      result.cardsSent++;
      continue;
    }
    const staff = await resolveStaffByPersonOrEmail(owner);
    if (!staff?.slack_user_id) {
      result.ownersSkipped++;
      console.warn(`[rocks] no slack_user_id for ${owner} — card skipped`);
      continue;
    }
    const { text, blocks } = buildRockCardBlocks(ownerRocks, quarter);
    await enqueueOutbox({
      channel: 'slack',
      recipient_person: owner,
      recipient_address: staff.slack_user_id,
      subject: 'Friday Rock check',
      body: text,
      payload: { blocks, quarter, rock_ids: ownerRocks.map((r) => r.id) },
    });
    result.cardsSent++;
  }
  if (!dryRun && result.cardsSent > 0) {
    await dispatchOutbox({ channel: 'slack', now });
  }

  console.log('[rocks]', JSON.stringify(result));
  return result;
}
