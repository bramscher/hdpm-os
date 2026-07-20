/**
 * Estimate Chaser — orchestration (DB + channels). Pure logic lives in
 * estimate-chaser.ts; this file gathers the TW11 pool, applies chase
 * history/cooldowns/caps, creates agent_proposal rows, delivers the chases,
 * and sends the interim Craig escalation DM.
 *
 * Channel policy (Brief D.5, Craig 2026-07-20): vendor chases are SMS-FIRST —
 * a vendor with a known phone gets a proposed text on Cheryl's Slack "Text
 * chase queue" card (L2: her tap sends it from her Zoom line); no phone →
 * the L1 Outlook draft path from Brief D. Owner approvals are email-only.
 *
 * Chase history IS the proposal trail: cooldowns key off proposal existence
 * (not delivery success) across BOTH vendor channels, which is deliberately
 * conservative for external comms and makes the cron idempotent — a same-day
 * second run sees the first run's proposals and skips everything on cooldown.
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import { loadTripwireSnapshot } from '@/lib/maintenance/tripwire-engine';
import { tripwire11, statusSinceFor } from '@/lib/maintenance/tripwires';
import { daysBetween } from '@/lib/maintenance/business-days';
import { getDashboardConfig } from '@/lib/dashboard-config';
import { fetchAppFolioVendorContacts } from '@/lib/appfolio';
import { normalizePhone } from '@/lib/zoom-sync';
import { getAgentConfig, effectiveLevel, isGloballyKilled, isWithinQuietHours } from './config';
import { createProposal } from './proposals';
import { enqueueOutbox, dispatchOutbox } from './outbox';
import { resolveStaffByPersonOrEmail } from './staff';
import { todayPacific } from './morning-card';
import type { SendOutcome } from './channels';
import type { AgentConfigRow, AgentProposal } from './types';
import {
  ESTIMATE_CHASER_AGENT,
  VENDOR_CHASE_ACTION,
  VENDOR_CHASE_SMS_ACTION,
  OWNER_APPROVAL_ACTION,
  ESCALATE_ACTION,
  classifyPool,
  decideChase,
  buildVendorChaseDraft,
  buildOwnerApprovalDraft,
  buildVendorChaseSms,
  buildSmsQueueCard,
  buildEscalationSlack,
  type ChaseCandidate,
  type ChaseHistory,
  type EscalationItem,
  type SmsQueueItem,
} from './estimate-chaser';

const PROPOSAL_EXPIRY_DAYS = 7;

export interface EstimateChaserRunResult {
  halted?: string;
  dryRun: boolean;
  /** TW11 candidates considered (after internal-vendor exclusion). */
  pool: number;
  vendorDrafts: number;
  ownerDrafts: number;
  /** SMS chase proposals put on Cheryl's Text chase queue card. */
  smsProposed: number;
  smsCard?: SendOutcome;
  skippedCooldown: number;
  skippedInternal: number;
  /** Vendor chases droppable to no channel (no phone + email path disabled). */
  skippedNoChannel: number;
  skippedCap: { vendor_chase: number; vendor_chase_sms: number; owner_approval: number };
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

const CHASE_ACTIONS = [VENDOR_CHASE_ACTION, VENDOR_CHASE_SMS_ACTION, OWNER_APPROVAL_ACTION];
const VENDOR_ACTIONS = [VENDOR_CHASE_ACTION, VENDOR_CHASE_SMS_ACTION];

function historyFor(rows: HistoryRow[], woId: string, kind: string): ChaseHistory {
  const mine = rows.filter((r) => r.subject_id === woId);
  const chases = mine.filter((r) => CHASE_ACTIONS.includes(r.action_type));
  const lastChase = chases.map((r) => r.created_at).sort().at(-1);
  const lastEscalate = mine
    .filter((r) => r.action_type === ESCALATE_ACTION)
    .map((r) => r.created_at)
    .sort()
    .at(-1);
  // A vendor chase is a vendor chase whether it went by email or text — the
  // 3x escalation counts them together. Expired = never materialized.
  const countActions = VENDOR_ACTIONS.includes(kind) ? VENDOR_ACTIONS : [kind];
  return {
    chaseCount: chases.filter(
      (r) => countActions.includes(r.action_type) && r.status !== 'expired'
    ).length,
    lastChaseAt: lastChase ? new Date(lastChase) : null,
    lastEscalateAt: lastEscalate ? new Date(lastEscalate) : null,
  };
}

/**
 * Rebuild the Text chase queue card from proposal state — the single source
 * of truth for re-renders after a tap (same pattern as rebuildCard).
 */
export async function rebuildSmsQueueCard(
  chaseDate: string,
  transientError?: { proposalId: string; message: string }
): Promise<{ text: string; blocks: unknown[] } | null> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('agent_proposal')
    .select('*')
    .eq('agent', ESTIMATE_CHASER_AGENT)
    .eq('action_type', VENDOR_CHASE_SMS_ACTION)
    .order('created_at', { ascending: true });
  const proposals = ((data ?? []) as AgentProposal[]).filter(
    (p) => (p.payload as Record<string, unknown>).chase_date === chaseDate
  );
  if (proposals.length === 0) return null;

  const items: SmsQueueItem[] = proposals.map((p) => {
    const pl = p.payload as Record<string, unknown>;
    const item: SmsQueueItem = {
      proposalId: p.id,
      status: p.status,
      vendorName: typeof pl.vendor_name === 'string' ? pl.vendor_name : null,
      vendorPhone: typeof pl.vendor_phone === 'string' ? pl.vendor_phone : '',
      woRef: typeof pl.wo_ref === 'string' ? pl.wo_ref : '',
      smsText: typeof pl.sms_text === 'string' ? pl.sms_text : '',
      resolution: typeof pl.resolution === 'string' ? pl.resolution : undefined,
    };
    if (transientError && p.id === transientError.proposalId) {
      item.error = transientError.message;
    }
    return item;
  });

  return buildSmsQueueCard(items, chaseDate);
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
    smsProposed: 0,
    skippedCooldown: 0,
    skippedInternal: 0,
    skippedNoChannel: 0,
    skippedCap: { vendor_chase: 0, vendor_chase_sms: 0, owner_approval: 0 },
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
  const [vendorCfg, smsCfg, ownerCfg, escalateCfg] = await Promise.all([
    getAgentConfig(ESTIMATE_CHASER_AGENT, VENDOR_CHASE_ACTION),
    getAgentConfig(ESTIMATE_CHASER_AGENT, VENDOR_CHASE_SMS_ACTION),
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
  // Send-on-tap needs L2 (its seeded level); its config row ships in Brief D.5's migration.
  const smsEnabled = actionEnabled(smsCfg, 2, VENDOR_CHASE_SMS_ACTION);
  const ownerEnabled = actionEnabled(ownerCfg, 1, OWNER_APPROVAL_ACTION);
  // Escalation self-sends, so it needs L3 (act-then-notify) — its seeded level.
  const escalateEnabled = actionEnabled(escalateCfg, 3, ESCALATE_ACTION);
  if (!vendorEnabled && !smsEnabled && !ownerEnabled && !escalateEnabled) {
    return { ...result, halted: 'all action types disabled' };
  }

  const supabase = getSupabaseAdmin();

  // Housekeeping (skip on dryRun): stamp proposals whose draft was sent by a
  // later retry dispatch, expire stale ones that never materialized, and
  // drain any queued SMS rows left by a failed tap (retry path).
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

    await dispatchOutbox({ channel: 'sms_zoom', now });
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

  // Decisions. Vendor candidates are eligible when either vendor channel is
  // enabled; the channel (and thus action_type) is assigned after the
  // contact lookup below.
  const toChase: { candidate: ChaseCandidate; history: ChaseHistory }[] = [];
  const toEscalate: EscalationItem[] = [];
  for (const candidate of candidates) {
    const kindEnabled =
      candidate.kind === VENDOR_CHASE_ACTION ? vendorEnabled || smsEnabled : ownerEnabled;
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

  // Vendor contacts (email + phone) for all vendor-kind chases: bulk from
  // zoom_contact_map, one guarded live AppFolio sweep for the misses.
  const vendorEmailById = new Map<string, string>();
  const vendorPhoneById = new Map<string, string>();
  const vendorIds = [
    ...new Set(
      toChase
        .filter((t) => t.candidate.kind === VENDOR_CHASE_ACTION && t.candidate.vendorId)
        .map((t) => t.candidate.vendorId!)
    ),
  ];
  if (vendorIds.length > 0) {
    const { data: contacts } = await supabase
      .from('zoom_contact_map')
      .select('appfolio_id, email, phone')
      .eq('contact_type', 'vendor')
      .eq('active', true)
      .in('appfolio_id', vendorIds);
    for (const c of contacts ?? []) {
      if (c.email) vendorEmailById.set(c.appfolio_id, c.email);
      if (c.phone) vendorPhoneById.set(c.appfolio_id, c.phone);
    }
    const misses = vendorIds.filter(
      (id) => !vendorEmailById.has(id) || !vendorPhoneById.has(id)
    );
    if (misses.length > 0 && !dryRun) {
      try {
        const live = await fetchAppFolioVendorContacts();
        for (const c of live) {
          if (!misses.includes(c.appfolioId)) continue;
          if (c.email && !vendorEmailById.has(c.appfolioId)) {
            vendorEmailById.set(c.appfolioId, c.email);
          }
          const phone = normalizePhone(c.phoneRaw);
          if (phone && !vendorPhoneById.has(c.appfolioId)) {
            vendorPhoneById.set(c.appfolioId, phone);
          }
        }
      } catch (err) {
        console.error(
          '[Agents] vendor contact fallback failed:',
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  }

  // Channel assignment (SMS-first for vendors) + per-action daily caps,
  // oldest (most business days stuck) first.
  type PlannedChase = {
    candidate: ChaseCandidate;
    history: ChaseHistory;
    action: string; // final action_type
    vendorEmail: string | null;
    vendorPhone: string | null;
  };
  const planned: PlannedChase[] = [];
  for (const { candidate, history } of toChase) {
    if (candidate.kind === OWNER_APPROVAL_ACTION) {
      planned.push({ candidate, history, action: OWNER_APPROVAL_ACTION, vendorEmail: null, vendorPhone: null });
      continue;
    }
    const phone = candidate.vendorId ? (vendorPhoneById.get(candidate.vendorId) ?? null) : null;
    const email = candidate.vendorId ? (vendorEmailById.get(candidate.vendorId) ?? null) : null;
    if (smsEnabled && phone) {
      planned.push({ candidate, history, action: VENDOR_CHASE_SMS_ACTION, vendorEmail: email, vendorPhone: phone });
    } else if (vendorEnabled) {
      planned.push({ candidate, history, action: VENDOR_CHASE_ACTION, vendorEmail: email, vendorPhone: phone });
    } else {
      result.skippedNoChannel++;
    }
  }

  const capped: PlannedChase[] = [];
  const capFor: Record<string, AgentConfigRow | null> = {
    [VENDOR_CHASE_ACTION]: vendorCfg,
    [VENDOR_CHASE_SMS_ACTION]: smsCfg,
    [OWNER_APPROVAL_ACTION]: ownerCfg,
  };
  for (const action of [VENDOR_CHASE_SMS_ACTION, VENDOR_CHASE_ACTION, OWNER_APPROVAL_ACTION]) {
    const cfg = capFor[action];
    const remaining = Math.max(0, (cfg?.max_per_day ?? Infinity) - todayCount(action));
    const ofAction = planned
      .filter((p) => p.action === action)
      .sort((a, b) => b.candidate.ageBusinessDays - a.candidate.ageBusinessDays);
    capped.push(...ofAction.slice(0, remaining));
    result.skippedCap[action as keyof typeof result.skippedCap] = Math.max(
      0,
      ofAction.length - remaining
    );
  }

  const escalations = escalateEnabled ? toEscalate : [];
  result.escalations = escalations.length;

  if (dryRun) {
    result.vendorDrafts = capped.filter((p) => p.action === VENDOR_CHASE_ACTION).length;
    result.smsProposed = capped.filter((p) => p.action === VENDOR_CHASE_SMS_ACTION).length;
    result.ownerDrafts = capped.filter((p) => p.action === OWNER_APPROVAL_ACTION).length;
    return result;
  }

  const cheryl = await resolveStaffByPersonOrEmail('Cheryl');
  const emailChases = capped.filter((p) => p.action !== VENDOR_CHASE_SMS_ACTION);
  const smsChases = capped.filter((p) => p.action === VENDOR_CHASE_SMS_ACTION);

  // Drafts land in Cheryl's mailbox — no email on file means nothing to do.
  if (!cheryl?.email && emailChases.length > 0) {
    return { ...result, halted: 'Cheryl has no email in staff' };
  }

  // ── Email path (Brief D): one proposal + one outlook_draft row per chase ──
  const outboxToProposal = new Map<string, string>();
  for (const { candidate, history, action, vendorEmail } of emailChases) {
    const chaseRound = history.chaseCount + 1;
    const draft =
      action === VENDOR_CHASE_ACTION
        ? buildVendorChaseDraft(candidate, vendorEmail, chaseRound)
        : buildOwnerApprovalDraft(candidate, chaseRound);

    if (action === VENDOR_CHASE_ACTION && !vendorEmail) {
      result.missingVendorEmail.push(candidate.woNumber ?? candidate.workOrderId);
    }

    const proposal = await createProposal({
      agent: ESTIMATE_CHASER_AGENT,
      subject_type: 'work_order',
      subject_id: candidate.workOrderId,
      action_type: action,
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
        ...(action === VENDOR_CHASE_ACTION && !vendorEmail ? { vendor_email_missing: true } : {}),
        age_business_days: candidate.ageBusinessDays,
        age_calendar_days: candidate.ageCalendarDays,
        appfolio_link: candidate.appfolioLink,
        subject: draft.subject,
      },
      rationale:
        action === VENDOR_CHASE_ACTION
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
        action_type: action,
        chase_round: chaseRound,
      },
    });
    outboxToProposal.set(outboxRow.id, proposal.id);

    if (action === VENDOR_CHASE_ACTION) result.vendorDrafts++;
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

  // ── SMS path (Brief D.5): proposals + ONE Text chase queue card to Cheryl.
  // No sms_zoom outbox row yet — that's created by her tap in the Slack
  // interact route. The proposal rests at 'proposed' until tap/skip/expiry.
  if (smsChases.length > 0) {
    const smsItems: SmsQueueItem[] = [];
    const smsProposalIds: string[] = [];
    for (const { candidate, history, vendorPhone, vendorEmail } of smsChases) {
      const chaseRound = history.chaseCount + 1;
      const smsText = buildVendorChaseSms(candidate, chaseRound);
      const woRefStr = `${candidate.woNumber ? `WO #${candidate.woNumber} — ` : ''}${candidate.propertyAddress || candidate.propertyName || 'property'}${candidate.unitName ? `, Unit ${candidate.unitName}` : ''}`;
      const proposal = await createProposal({
        agent: ESTIMATE_CHASER_AGENT,
        subject_type: 'work_order',
        subject_id: candidate.workOrderId,
        action_type: VENDOR_CHASE_SMS_ACTION,
        payload: {
          chase_date: chaseDate,
          chase_round: chaseRound,
          wo_number: candidate.woNumber,
          wo_ref: woRefStr,
          property_name: candidate.propertyName,
          property_address: candidate.propertyAddress,
          unit_name: candidate.unitName,
          vendor_id: candidate.vendorId,
          vendor_name: candidate.vendorName,
          vendor_phone: vendorPhone,
          vendor_email: vendorEmail,
          sms_text: smsText,
          age_business_days: candidate.ageBusinessDays,
          age_calendar_days: candidate.ageCalendarDays,
          appfolio_link: candidate.appfolioLink,
        },
        rationale: `Vendor bid outstanding ${candidate.ageBusinessDays} business days — text chase round ${chaseRound} (send-on-tap)`,
      });
      smsProposalIds.push(proposal.id);
      smsItems.push({
        proposalId: proposal.id,
        status: proposal.status,
        vendorName: candidate.vendorName,
        vendorPhone: vendorPhone!,
        woRef: woRefStr,
        smsText,
      });
      result.smsProposed++;
    }

    if (cheryl?.slack_user_id) {
      const card = buildSmsQueueCard(smsItems, chaseDate);
      const cardRow = await enqueueOutbox({
        channel: 'slack',
        recipient_person: 'Cheryl',
        recipient_address: cheryl.slack_user_id,
        subject: 'Text chase queue',
        body: card.text,
        payload: { blocks: card.blocks, chase_date: chaseDate },
      });
      await dispatchOutbox({ channel: 'slack', now });
      const { data: sentRow } = await supabase
        .from('agent_outbox')
        .select('status, message_id, error')
        .eq('id', cardRow.id)
        .maybeSingle();
      result.smsCard = {
        status: (sentRow?.status as SendOutcome['status']) ?? 'failed',
        message_id: sentRow?.message_id ?? null,
        error: sentRow?.error ?? null,
      };
      // Stamp the card's message id on every SMS proposal so the interact
      // route can chat.update the card without a response_url.
      if (sentRow?.status === 'sent' && sentRow.message_id) {
        await supabase
          .from('agent_proposal')
          .update({ channel_message_id: sentRow.message_id })
          .in('id', smsProposalIds);
      }
    } else {
      result.smsCard = { status: 'skipped', error: 'Cheryl has no slack_user_id in staff' };
    }
  }

  // Interim escalation: proposal per WO (the queryable record Brief E's Ops
  // Brief will fold in) + one Slack DM to Craig.
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
