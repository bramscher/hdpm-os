/**
 * Morning Action Card — orchestration (DB + channels). Pure logic lives in
 * morning-card.ts; this file gathers data, creates the per-item
 * agent_proposal rows, sends the Slack cards + email mirror through the
 * outbox, and rebuilds the card from proposal state for the interaction
 * endpoint.
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import { loadTripwireSnapshot, runTripwires } from '@/lib/maintenance/tripwire-engine';
import { proposalCounts } from '@/lib/maintenance/triage-batch';
import { getAgentConfig, effectiveLevel, isGloballyKilled, getNotifyRecipients } from './config';
import { createProposal, listProposals } from './proposals';
import { enqueueOutbox, dispatchOutbox } from './outbox';
import type { SendOutcome } from './channels';
import type { AgentProposal } from './types';
import {
  MORNING_CARD_AGENT,
  MORNING_CARD_ACTION,
  buildCardBlocks,
  buildCardEmailHtml,
  buildNudge,
  pickDailySeven,
  todayPacific,
  buildCardExclusions,
  applyCardExclusions,
  type PriorCardDecision,
  type CardHeader,
  type CardItem,
} from './morning-card';

// ============================================
// Helpers
// ============================================

/** Merge extra keys into a proposal's payload (e.g. snooze reason, resolution). */
export async function annotateProposalPayload(
  id: string,
  extra: Record<string, unknown>
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('agent_proposal')
    .select('payload')
    .eq('id', id)
    .maybeSingle();
  const payload = { ...((data?.payload ?? {}) as Record<string, unknown>), ...extra };
  const { error } = await supabase.from('agent_proposal').update({ payload }).eq('id', id);
  if (error) console.error('[Agents] payload annotate failed:', error.message);
}

function proposalToCardItem(p: AgentProposal): CardItem {
  const pl = p.payload as Record<string, unknown>;
  return {
    proposalId: p.id,
    workOrderId: p.subject_id ?? '',
    rank: typeof pl.rank === 'number' ? pl.rank : 99,
    tripwire: typeof pl.tripwire === 'number' ? pl.tripwire : 0,
    label: typeof pl.label === 'string' ? pl.label : '',
    item: typeof pl.item === 'string' ? pl.item : '',
    fixRequired: typeof pl.fixRequired === 'string' ? pl.fixRequired : '',
    ageDays: typeof pl.ageDays === 'number' ? pl.ageDays : undefined,
    status: p.status,
    resolution: typeof pl.resolution === 'string' ? pl.resolution : undefined,
    nextActionDate: typeof pl.nextActionDate === 'string' ? pl.nextActionDate : null,
    appfolioLink: typeof pl.appfolioLink === 'string' ? pl.appfolioLink : null,
  };
}

async function todaysCardProposals(cardDate: string): Promise<AgentProposal[]> {
  const all = await listProposals({ agent: MORNING_CARD_AGENT, limit: 100 });
  return all
    .filter(
      (p) =>
        p.action_type === MORNING_CARD_ACTION &&
        (p.payload as Record<string, unknown>).card_date === cardDate
    )
    .sort((a, b) => {
      const ra = (a.payload as Record<string, unknown>).rank as number;
      const rb = (b.payload as Record<string, unknown>).rank as number;
      return (ra ?? 99) - (rb ?? 99);
    });
}

/**
 * Rebuild the interactive card from proposal state — the single source of
 * truth for re-renders after a tap. `transientError` decorates one item for
 * this render only and is never persisted.
 */
export async function rebuildCard(
  cardDate: string,
  transientError?: { proposalId: string; message: string }
): Promise<{ text: string; blocks: unknown[] } | null> {
  const proposals = await todaysCardProposals(cardDate);
  if (proposals.length === 0) return null;

  const headerPayload = (proposals[0].payload as Record<string, unknown>).header;
  const header = (headerPayload ?? {
    dateStr: cardDate,
    totalExceptions: 0,
    needsDateCount: 0,
    pendingTriage: 0,
    routeSummary: null,
  }) as CardHeader;

  const items = proposals.map((p) => {
    const item = proposalToCardItem(p);
    if (transientError && p.id === transientError.proposalId) {
      item.error = transientError.message;
    }
    return item;
  });

  return {
    text: `Morning Action Card — ${cardDate}`,
    blocks: buildCardBlocks({ header, items, readOnly: false }),
  };
}

// ============================================
// The run
// ============================================

export interface MorningCardRunResult {
  halted?: string;
  expired: number;
  items: number;
  /** keyed by lowercased recipient person name (configurable via agent_config) */
  slack: Record<string, SendOutcome>;
  email?: SendOutcome;
  nudge?: 'sent' | 'not_needed' | 'no_card';
  dryRun: boolean;
}

export async function runMorningCard(opts: {
  nudge?: boolean;
  dryRun?: boolean;
  now?: Date;
} = {}): Promise<MorningCardRunResult> {
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun === true;
  const result: MorningCardRunResult = { expired: 0, items: 0, slack: {}, dryRun };
  const cardDate = todayPacific(now);

  // Guards: kill switch + autonomy level.
  if (await isGloballyKilled()) {
    console.log('[Agents] morning card halted: kill switch');
    return { ...result, halted: 'kill switch' };
  }
  const cfg = await getAgentConfig(MORNING_CARD_AGENT, MORNING_CARD_ACTION);
  if (effectiveLevel(cfg) < 2) {
    const reason = cfg ? `autonomy level ${effectiveLevel(cfg)}` : 'no agent_config row';
    console.log(`[Agents] morning card halted: ${reason}`);
    return { ...result, halted: reason };
  }

  if (opts.nudge) {
    return runNudge(cardDate, result);
  }

  const supabase = getSupabaseAdmin();

  // Expire yesterday's untouched card rows ('expired' is a system status —
  // not decideProposal, which requires a human actor).
  if (!dryRun) {
    const { data: expiredRows } = await supabase
      .from('agent_proposal')
      .update({ status: 'expired' })
      .eq('agent', MORNING_CARD_AGENT)
      .eq('action_type', MORNING_CARD_ACTION)
      .eq('status', 'proposed')
      .lt('created_at', `${cardDate}T00:00:00-07:00`)
      .select('id');
    result.expired = expiredRows?.length ?? 0;
  }

  // Gather: exceptions, triage backlog, today's route.
  const snapshot = await loadTripwireSnapshot();
  const tripwireResult = runTripwires(snapshot);
  const counts = await proposalCounts();

  let routeSummary: string | null = null;
  try {
    const { data: plans } = await supabase
      .from('maint_route_plan')
      .select('id, assigned_tech, stop_count')
      .eq('route_date', cardDate)
      .eq('status', 'published');
    if (plans && plans.length > 0) {
      const stops = plans.reduce((sum, p) => sum + (p.stop_count ?? 0), 0);
      const techs = plans.map((p) => p.assigned_tech).filter(Boolean).join(', ');
      routeSummary = `${plans.length} route${plans.length > 1 ? 's' : ''} · ${stops} stops${techs ? ` (${techs})` : ''}`;
    }
  } catch (err) {
    console.error('[Agents] route summary failed:', err instanceof Error ? err.message : String(err));
  }

  // Cool-off: recent card decisions suppress the same (WO, tripwire) pair —
  // snoozes until their snooze date, Done/date/reassign for 3 business days.
  // Survivors past the window return tagged "still unresolved".
  const priorProposals = await listProposals({ agent: MORNING_CARD_AGENT, limit: 200 });
  const priorDecisions: PriorCardDecision[] = priorProposals
    .filter(
      (p) =>
        p.action_type === MORNING_CARD_ACTION &&
        (p.status === 'approved' || p.status === 'edited') &&
        p.subject_id
    )
    .map((p) => {
      const pl = p.payload as Record<string, unknown>;
      return {
        workOrderId: p.subject_id!,
        tripwire: typeof pl.tripwire === 'number' ? pl.tripwire : 0,
        status: p.status,
        decidedAt: p.decided_at ?? p.created_at,
        snoozedTo: typeof pl.snoozed_to === 'string' ? pl.snoozed_to : null,
        resolution: typeof pl.resolution === 'string' ? pl.resolution : null,
      };
    });
  const exclusions = buildCardExclusions(priorDecisions);
  const eligible = applyCardExclusions(tripwireResult.exceptions, exclusions, cardDate);

  const seven = pickDailySeven(eligible);
  const header: CardHeader = {
    dateStr: cardDate,
    totalExceptions: tripwireResult.exceptions.length,
    needsDateCount: tripwireResult.needsDateCount,
    pendingTriage: counts.pending,
    routeSummary,
  };

  if (dryRun) {
    return { ...result, items: seven.length };
  }

  // Current owner/date per WO (datepicker initial_date + owner backfill
  // info) + the AppFolio deep link for the card's Open button.
  const woIds = seven.map((ex) => ex.workOrderId!);
  const woById = new Map<string, { next_action_date: string | null; appfolio_link: string | null }>();
  if (woIds.length > 0) {
    const { data: wos } = await supabase
      .from('work_orders')
      .select('id, next_action_date, appfolio_link')
      .in('id', woIds);
    for (const wo of wos ?? []) woById.set(wo.id, wo);
  }

  // One proposal per card item.
  const items: CardItem[] = [];
  for (let i = 0; i < seven.length; i++) {
    const ex = seven[i];
    const proposal = await createProposal({
      agent: MORNING_CARD_AGENT,
      subject_type: 'work_order',
      subject_id: ex.workOrderId!,
      action_type: MORNING_CARD_ACTION,
      payload: {
        card_date: cardDate,
        rank: i + 1,
        tripwire: ex.tripwire,
        label: ex.label,
        item: ex.item,
        fixRequired: ex.fixRequired,
        ageDays: ex.ageDays,
        nextActionDate: woById.get(ex.workOrderId!)?.next_action_date ?? null,
        appfolioLink: woById.get(ex.workOrderId!)?.appfolio_link ?? null,
        header,
      },
      rationale: ex.fixRequired,
    });
    items.push(proposalToCardItem(proposal));
  }
  result.items = items.length;

  // Slack recipients are configurable per-agent (agent_config.slack_recipients
  // for morning_card/daily_card); [0] is the interactive card (its proposals get
  // the channel_message_id stamp for later chat.update), the rest get read-only
  // copies. Defaults to Cheryl (interactive), Brody + Matt (copies).
  const recipients = await getNotifyRecipients(MORNING_CARD_AGENT, MORNING_CARD_ACTION, [
    'Cheryl',
    'Brody',
    'Matt',
  ]);
  const [primary, ...copies] = recipients;

  const fallbackText = `Morning Action Card — ${cardDate}: ${items.length} items`;
  let primaryOutboxId: string | null = null;

  if (primary) {
    const row = await enqueueOutbox({
      channel: 'slack',
      recipient_person: primary.person,
      recipient_address: primary.slack_user_id!,
      subject: 'Morning Action Card',
      body: fallbackText,
      payload: { blocks: buildCardBlocks({ header, items, readOnly: false }), card_date: cardDate },
    });
    primaryOutboxId = row.id;
  } else {
    result.slack.primary = { status: 'skipped', error: 'no morning_card recipient with a slack_user_id' };
  }

  for (const staff of copies) {
    await enqueueOutbox({
      channel: 'slack',
      recipient_person: staff.person,
      recipient_address: staff.slack_user_id!,
      subject: 'Morning Action Card (copy)',
      body: fallbackText,
      payload: { blocks: buildCardBlocks({ header, items, readOnly: true }), card_date: cardDate },
    });
  }

  await dispatchOutbox({ channel: 'slack' });

  // Read back the primary's send result; stamp channel_message_id on the
  // proposals so later code can chat.update the card without a response_url.
  if (primaryOutboxId && primary) {
    const { data: sentRow } = await supabase
      .from('agent_outbox')
      .select('status, message_id, error')
      .eq('id', primaryOutboxId)
      .maybeSingle();
    result.slack[primary.person.toLowerCase()] = {
      status: (sentRow?.status as SendOutcome['status']) ?? 'failed',
      message_id: sentRow?.message_id ?? null,
      error: sentRow?.error ?? null,
    };
    if (sentRow?.status === 'sent' && sentRow.message_id && items.length > 0) {
      await supabase
        .from('agent_proposal')
        .update({ channel_message_id: sentRow.message_id })
        .in('id', items.map((i) => i.proposalId));
    }
  }
  for (const staff of copies) {
    if (result.slack[staff.person.toLowerCase()] === undefined) {
      result.slack[staff.person.toLowerCase()] = { status: 'sent' };
    }
  }

  // Email mirror to the primary (interactive) recipient.
  const emailTo = primary?.email ?? null;
  if (emailTo && primary) {
    const baseUrl = process.env.NEXTAUTH_URL || 'https://hdpmchat.highdesertpm.com';
    const mail = buildCardEmailHtml(header, items, baseUrl);
    await enqueueOutbox({
      channel: 'email',
      recipient_person: primary.person,
      recipient_address: emailTo,
      subject: mail.subject,
      body: mail.text,
      payload: { html: mail.html, card_date: cardDate },
    });
    await dispatchOutbox({ channel: 'email' });
    result.email = { status: 'sent' };
  } else {
    result.email = { status: 'skipped', error: 'primary recipient has no email in staff' };
  }

  return result;
}

async function runNudge(
  cardDate: string,
  result: MorningCardRunResult
): Promise<MorningCardRunResult> {
  const proposals = await todaysCardProposals(cardDate);
  if (proposals.length === 0) return { ...result, nudge: 'no_card' };

  const untouched = proposals.every((p) => p.status === 'proposed');
  if (!untouched) return { ...result, nudge: 'not_needed' };

  const items = proposals.map(proposalToCardItem);
  const header = ((proposals[0].payload as Record<string, unknown>).header ?? {
    dateStr: cardDate,
    totalExceptions: 0,
    needsDateCount: 0,
    pendingTriage: 0,
    routeSummary: null,
  }) as CardHeader;

  // Nudge the interactive owner (primary recipient) if the card is untouched.
  const [primary] = await getNotifyRecipients(MORNING_CARD_AGENT, MORNING_CARD_ACTION, ['Cheryl']);
  if (!primary?.slack_user_id) {
    return { ...result, nudge: 'no_card' };
  }

  const nudge = buildNudge(items, header);
  await enqueueOutbox({
    channel: 'slack',
    recipient_person: primary.person,
    recipient_address: primary.slack_user_id,
    subject: 'Morning card nudge',
    body: nudge.text,
    payload: { blocks: nudge.blocks, card_date: cardDate },
  });
  await dispatchOutbox({ channel: 'slack' });
  return { ...result, nudge: 'sent' };
}
