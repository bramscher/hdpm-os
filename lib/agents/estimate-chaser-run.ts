/**
 * Estimate Chaser — orchestration (DB + channels). Pure logic lives in
 * estimate-chaser.ts; this file gathers the TW11 pool, applies chase
 * history/cooldowns/caps, creates agent_proposal rows, delivers Outlook
 * drafts through the outbox (outlook_draft channel), and sends the interim
 * Craig escalation DM.
 *
 * Chase history IS the proposal trail: cooldowns key off proposal existence
 * (not draft delivery success), which is deliberately conservative for
 * external comms and makes the cron idempotent — a same-day second run sees
 * the first run's proposals and skips everything on cooldown.
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import { loadTripwireSnapshot } from '@/lib/maintenance/tripwire-engine';
import { tripwire11, statusSinceFor } from '@/lib/maintenance/tripwires';
import { daysBetween } from '@/lib/maintenance/business-days';
import { getDashboardConfig } from '@/lib/dashboard-config';
import { fetchAppFolioVendorContacts } from '@/lib/appfolio';
import { getAgentConfig, effectiveLevel, isGloballyKilled, isWithinQuietHours } from './config';
import { createProposal } from './proposals';
import { enqueueOutbox, dispatchOutbox } from './outbox';
import { resolveStaffByPersonOrEmail } from './staff';
import { todayPacific } from './morning-card';
import type { SendOutcome } from './channels';
import type { AgentConfigRow } from './types';
import {
  ESTIMATE_CHASER_AGENT,
  VENDOR_CHASE_ACTION,
  OWNER_APPROVAL_ACTION,
  ESCALATE_ACTION,
  classifyPool,
  decideChase,
  buildVendorChaseDraft,
  buildOwnerApprovalDraft,
  buildEscalationSlack,
  type ChaseCandidate,
  type ChaseHistory,
  type ChaseKind,
  type EscalationItem,
} from './estimate-chaser';

const PROPOSAL_EXPIRY_DAYS = 7;

export interface EstimateChaserRunResult {
  halted?: string;
  dryRun: boolean;
  /** TW11 candidates considered (after internal-vendor exclusion). */
  pool: number;
  vendorDrafts: number;
  ownerDrafts: number;
  skippedCooldown: number;
  skippedInternal: number;
  skippedCap: { vendor_chase: number; owner_approval: number };
  /** Action types suppressed this run (disabled config or quiet hours). */
  disabled: string[];
  /** WO refs drafted with a blank To: line for Cheryl to fill. */
  missingVendorEmail: string[];
  drafts: { sent: number; failed: number; skipped: number };
  escalations: number;
  escalationSlack?: SendOutcome;
  backfilled: number;
  expired: number;
}

interface HistoryRow {
  id: string;
  subject_id: string | null;
  action_type: string;
  status: string;
  created_at: string;
}

function historyFor(rows: HistoryRow[], woId: string, kind: ChaseKind): ChaseHistory {
  const mine = rows.filter((r) => r.subject_id === woId);
  const chases = mine.filter(
    (r) => r.action_type === VENDOR_CHASE_ACTION || r.action_type === OWNER_APPROVAL_ACTION
  );
  const lastChase = chases.map((r) => r.created_at).sort().at(-1);
  const lastEscalate = mine
    .filter((r) => r.action_type === ESCALATE_ACTION)
    .map((r) => r.created_at)
    .sort()
    .at(-1);
  return {
    // Expired = the draft never materialized; it shouldn't count toward 3×.
    chaseCount: chases.filter((r) => r.action_type === kind && r.status !== 'expired').length,
    lastChaseAt: lastChase ? new Date(lastChase) : null,
    lastEscalateAt: lastEscalate ? new Date(lastEscalate) : null,
  };
}

export async function runEstimateChaser(opts: {
  dryRun?: boolean;
  now?: Date;
} = {}): Promise<EstimateChaserRunResult> {
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun === true;
  const chaseDate = todayPacific(now);
  const result: EstimateChaserRunResult = {
    dryRun,
    pool: 0,
    vendorDrafts: 0,
    ownerDrafts: 0,
    skippedCooldown: 0,
    skippedInternal: 0,
    skippedCap: { vendor_chase: 0, owner_approval: 0 },
    disabled: [],
    missingVendorEmail: [],
    drafts: { sent: 0, failed: 0, skipped: 0 },
    escalations: 0,
    backfilled: 0,
    expired: 0,
  };

  // Guards: kill switch + per-action autonomy (missing/disabled row → L0).
  if (await isGloballyKilled()) {
    console.log('[Agents] estimate chaser halted: kill switch');
    return { ...result, halted: 'kill switch' };
  }
  const [vendorCfg, ownerCfg, escalateCfg] = await Promise.all([
    getAgentConfig(ESTIMATE_CHASER_AGENT, VENDOR_CHASE_ACTION),
    getAgentConfig(ESTIMATE_CHASER_AGENT, OWNER_APPROVAL_ACTION),
    getAgentConfig(ESTIMATE_CHASER_AGENT, ESCALATE_ACTION),
  ]);
  const actionEnabled = (cfg: AgentConfigRow | null, minLevel: number, name: string): boolean => {
    if (effectiveLevel(cfg) < minLevel) {
      result.disabled.push(`${name}: ${cfg ? `autonomy ${effectiveLevel(cfg)}` : 'no agent_config row'}`);
      return false;
    }
    if (cfg && isWithinQuietHours(cfg, now)) {
      result.disabled.push(`${name}: quiet hours`);
      return false;
    }
    return true;
  };
  const vendorEnabled = actionEnabled(vendorCfg, 1, VENDOR_CHASE_ACTION);
  const ownerEnabled = actionEnabled(ownerCfg, 1, OWNER_APPROVAL_ACTION);
  // Escalation self-sends, so it needs L3 (act-then-notify) — its seeded level.
  const escalateEnabled = actionEnabled(escalateCfg, 3, ESCALATE_ACTION);
  if (!vendorEnabled && !ownerEnabled && !escalateEnabled) {
    return { ...result, halted: 'all action types disabled' };
  }

  const supabase = getSupabaseAdmin();

  // Housekeeping (skip on dryRun): stamp proposals whose draft was sent by a
  // later retry dispatch, then expire stale ones that never materialized.
  if (!dryRun) {
    const { data: pendingRows } = await supabase
      .from('agent_proposal')
      .select('id')
      .eq('agent', ESTIMATE_CHASER_AGENT)
      .eq('status', 'proposed');
    const pendingIds = (pendingRows ?? []).map((r) => r.id);
    if (pendingIds.length > 0) {
      const { data: sentRows } = await supabase
        .from('agent_outbox')
        .select('proposal_id, message_id')
        .eq('status', 'sent')
        .in('proposal_id', pendingIds);
      for (const row of sentRows ?? []) {
        if (!row.proposal_id) continue;
        await supabase
          .from('agent_proposal')
          .update({ status: 'auto_applied', channel_message_id: row.message_id })
          .eq('id', row.proposal_id)
          .eq('status', 'proposed');
        result.backfilled++;
      }
    }

    // 'expired' is a system status — not decideProposal, which needs a human.
    const cutoff = new Date(now.getTime() - PROPOSAL_EXPIRY_DAYS * 86_400_000).toISOString();
    const { data: expiredRows } = await supabase
      .from('agent_proposal')
      .update({ status: 'expired' })
      .eq('agent', ESTIMATE_CHASER_AGENT)
      .eq('status', 'proposed')
      .lt('created_at', cutoff)
      .select('id');
    result.expired = expiredRows?.length ?? 0;
  }

  // Gather the TW11 pool. tripwire11 runs off the same snapshot the
  // exceptions board uses; snapshot.openWorkOrders carries the full mirror
  // rows, so no re-fetch is needed.
  const snapshot = await loadTripwireSnapshot();
  const exceptions = tripwire11(snapshot);
  const wosById = new Map(snapshot.openWorkOrders.map((wo) => [wo.id, wo]));
  const calendarAgeByWo = new Map(
    snapshot.openWorkOrders.map((wo) => [wo.id, daysBetween(statusSinceFor(wo, snapshot), now)])
  );
  const dashConfig = await getDashboardConfig();
  const { candidates, skippedInternal } = classifyPool(
    exceptions,
    wosById,
    dashConfig.internalVendorIds,
    calendarAgeByWo
  );
  result.pool = candidates.length;
  result.skippedInternal = skippedInternal.length;

  // Chase history + today's counts (for max_per_day) in two reads.
  const woIds = candidates.map((c) => c.workOrderId);
  let historyRows: HistoryRow[] = [];
  if (woIds.length > 0) {
    // Direct query, not listProposals — its 100-row default limit truncates.
    const { data, error } = await supabase
      .from('agent_proposal')
      .select('id, subject_id, action_type, status, created_at')
      .eq('agent', ESTIMATE_CHASER_AGENT)
      .in('subject_id', woIds);
    if (error) throw new Error(`Chase history read failed: ${error.message}`);
    historyRows = (data ?? []) as HistoryRow[];
  }
  const { data: todayRows } = await supabase
    .from('agent_proposal')
    .select('id, action_type')
    .eq('agent', ESTIMATE_CHASER_AGENT)
    .gte('created_at', `${chaseDate}T00:00:00-07:00`);
  const todayCount = (action: string) =>
    (todayRows ?? []).filter((r) => r.action_type === action).length;

  // Decisions.
  const toChase: { candidate: ChaseCandidate; history: ChaseHistory }[] = [];
  const toEscalate: EscalationItem[] = [];
  for (const candidate of candidates) {
    const kindEnabled = candidate.kind === VENDOR_CHASE_ACTION ? vendorEnabled : ownerEnabled;
    const history = historyFor(historyRows, candidate.workOrderId, candidate.kind);
    const decision = decideChase(candidate, history, now);
    if (decision.action === 'escalate') {
      toEscalate.push({ candidate, reason: decision.reason, chaseCount: history.chaseCount });
    } else if (decision.action === 'skip') {
      if (decision.reason === 'cooldown') result.skippedCooldown++;
    } else if (kindEnabled) {
      toChase.push({ candidate, history });
    }
  }

  // Per-action daily caps: oldest (most business days stuck) first.
  const capped: typeof toChase = [];
  for (const kind of [VENDOR_CHASE_ACTION, OWNER_APPROVAL_ACTION] as const) {
    const cfg = kind === VENDOR_CHASE_ACTION ? vendorCfg : ownerCfg;
    const remaining = Math.max(0, (cfg?.max_per_day ?? Infinity) - todayCount(kind));
    const ofKind = toChase
      .filter((t) => t.candidate.kind === kind)
      .sort((a, b) => b.candidate.ageBusinessDays - a.candidate.ageBusinessDays);
    capped.push(...ofKind.slice(0, remaining));
    result.skippedCap[kind] = Math.max(0, ofKind.length - remaining);
  }

  // Vendor emails: zoom_contact_map first (bulk), one guarded live AppFolio
  // sweep for the misses. Still-missing → draft with a blank To: line.
  const vendorEmailById = new Map<string, string>();
  const vendorIds = [
    ...new Set(
      capped
        .filter((t) => t.candidate.kind === VENDOR_CHASE_ACTION && t.candidate.vendorId)
        .map((t) => t.candidate.vendorId!)
    ),
  ];
  if (vendorIds.length > 0) {
    const { data: contacts } = await supabase
      .from('zoom_contact_map')
      .select('appfolio_id, email')
      .eq('contact_type', 'vendor')
      .eq('active', true)
      .in('appfolio_id', vendorIds);
    for (const c of contacts ?? []) {
      if (c.email) vendorEmailById.set(c.appfolio_id, c.email);
    }
    const misses = vendorIds.filter((id) => !vendorEmailById.has(id));
    if (misses.length > 0 && !dryRun) {
      try {
        const live = await fetchAppFolioVendorContacts();
        for (const c of live) {
          if (c.email && misses.includes(c.appfolioId)) vendorEmailById.set(c.appfolioId, c.email);
        }
      } catch (err) {
        console.error(
          '[Agents] vendor contact fallback failed:',
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  }

  const escalations = escalateEnabled ? toEscalate : [];
  result.escalations = escalations.length;

  if (dryRun) {
    result.vendorDrafts = capped.filter((t) => t.candidate.kind === VENDOR_CHASE_ACTION).length;
    result.ownerDrafts = capped.filter((t) => t.candidate.kind === OWNER_APPROVAL_ACTION).length;
    return result;
  }

  // Drafts land in Cheryl's mailbox — no email on file means nothing to do.
  const cheryl = await resolveStaffByPersonOrEmail('Cheryl');
  if (!cheryl?.email && capped.length > 0) {
    return { ...result, halted: 'Cheryl has no email in staff' };
  }

  // One proposal + one outlook_draft outbox row per chase.
  const outboxToProposal = new Map<string, string>();
  for (const { candidate, history } of capped) {
    const chaseRound = history.chaseCount + 1;
    const vendorEmail =
      candidate.kind === VENDOR_CHASE_ACTION && candidate.vendorId
        ? (vendorEmailById.get(candidate.vendorId) ?? null)
        : null;
    const draft =
      candidate.kind === VENDOR_CHASE_ACTION
        ? buildVendorChaseDraft(candidate, vendorEmail, chaseRound)
        : buildOwnerApprovalDraft(candidate, chaseRound);

    if (candidate.kind === VENDOR_CHASE_ACTION && !vendorEmail) {
      result.missingVendorEmail.push(candidate.woNumber ?? candidate.workOrderId);
    }

    const proposal = await createProposal({
      agent: ESTIMATE_CHASER_AGENT,
      subject_type: 'work_order',
      subject_id: candidate.workOrderId,
      action_type: candidate.kind,
      payload: {
        chase_date: chaseDate,
        chase_round: chaseRound,
        wo_number: candidate.woNumber,
        property_name: candidate.propertyName,
        property_address: candidate.propertyAddress,
        unit_name: candidate.unitName,
        vendor_id: candidate.vendorId,
        vendor_name: candidate.vendorName,
        vendor_email: vendorEmail,
        ...(candidate.kind === VENDOR_CHASE_ACTION && !vendorEmail
          ? { vendor_email_missing: true }
          : {}),
        age_business_days: candidate.ageBusinessDays,
        age_calendar_days: candidate.ageCalendarDays,
        appfolio_link: candidate.appfolioLink,
        subject: draft.subject,
      },
      rationale:
        candidate.kind === VENDOR_CHASE_ACTION
          ? `Vendor bid outstanding ${candidate.ageBusinessDays} business days — chase round ${chaseRound}`
          : `Approval pending ${candidate.ageBusinessDays} business days — chase round ${chaseRound}`,
    });

    const outboxRow = await enqueueOutbox({
      proposal_id: proposal.id,
      channel: 'outlook_draft',
      recipient_person: 'Cheryl',
      recipient_address: cheryl!.email,
      subject: draft.subject,
      body: draft.text,
      payload: {
        html: draft.html,
        to_recipients: draft.toRecipients,
        work_order_id: candidate.workOrderId,
        action_type: candidate.kind,
        chase_round: chaseRound,
      },
    });
    outboxToProposal.set(outboxRow.id, proposal.id);

    if (candidate.kind === VENDOR_CHASE_ACTION) result.vendorDrafts++;
    else result.ownerDrafts++;
  }

  if (outboxToProposal.size > 0) {
    await dispatchOutbox({ channel: 'outlook_draft', now });

    // Stamp delivered proposals: at L1 the sanctioned action IS "create a
    // draft", so a created draft = auto_applied (Cheryl's real decision
    // happens in Outlook and is unobservable). Failures stay 'proposed' for
    // the retry/backfill path.
    const { data: sentRows } = await supabase
      .from('agent_outbox')
      .select('id, status, message_id')
      .in('id', [...outboxToProposal.keys()]);
    for (const row of sentRows ?? []) {
      if (row.status === 'sent') {
        result.drafts.sent++;
        await supabase
          .from('agent_proposal')
          .update({ status: 'auto_applied', channel_message_id: row.message_id })
          .eq('id', outboxToProposal.get(row.id)!);
      } else if (row.status === 'skipped') {
        result.drafts.skipped++;
      } else {
        result.drafts.failed++;
      }
    }
  }

  // Interim escalation: proposal per WO (the queryable record Brief E's Ops
  // Brief will fold in) + one Slack DM digest to Craig.
  if (escalations.length > 0) {
    const escalateProposalIds: string[] = [];
    for (const item of escalations) {
      const proposal = await createProposal({
        agent: ESTIMATE_CHASER_AGENT,
        subject_type: 'work_order',
        subject_id: item.candidate.workOrderId,
        action_type: ESCALATE_ACTION,
        payload: {
          chase_date: chaseDate,
          reason: item.reason,
          chase_count: item.chaseCount,
          wo_number: item.candidate.woNumber,
          property_name: item.candidate.propertyName,
          property_address: item.candidate.propertyAddress,
          unit_name: item.candidate.unitName,
          vendor_name: item.candidate.vendorName,
          kind: item.candidate.kind,
          age_business_days: item.candidate.ageBusinessDays,
          age_calendar_days: item.candidate.ageCalendarDays,
          appfolio_link: item.candidate.appfolioLink,
        },
        rationale:
          item.reason === 'chased_3x'
            ? `Chased ${item.chaseCount}× with no movement — needs Craig`
            : `${item.candidate.ageCalendarDays} calendar days stuck — needs Craig`,
      });
      escalateProposalIds.push(proposal.id);
    }

    const craig = await resolveStaffByPersonOrEmail('Craig');
    if (craig?.slack_user_id) {
      const dm = buildEscalationSlack(escalations, chaseDate);
      const outboxRow = await enqueueOutbox({
        channel: 'slack',
        recipient_person: 'Craig',
        recipient_address: craig.slack_user_id,
        subject: 'Estimate Chaser escalations',
        body: dm.text,
        payload: { blocks: dm.blocks, chase_date: chaseDate },
      });
      await dispatchOutbox({ channel: 'slack', now });
      const { data: sentRow } = await supabase
        .from('agent_outbox')
        .select('status, message_id, error')
        .eq('id', outboxRow.id)
        .maybeSingle();
      result.escalationSlack = {
        status: (sentRow?.status as SendOutcome['status']) ?? 'failed',
        message_id: sentRow?.message_id ?? null,
        error: sentRow?.error ?? null,
      };
      if (sentRow?.status === 'sent') {
        await supabase
          .from('agent_proposal')
          .update({ status: 'auto_applied', channel_message_id: sentRow.message_id })
          .in('id', escalateProposalIds);
      }
    } else {
      result.escalationSlack = { status: 'skipped', error: 'Craig has no slack_user_id in staff' };
    }
  }

  return result;
}
