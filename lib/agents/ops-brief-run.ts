/**
 * Ops Brief — orchestration (DB + channels). Pure logic lives in
 * ops-brief.ts; this file gathers metric deltas, agent stats, and open
 * escalations, renders the brief, and self-sends it to Brody + Matt
 * (L3 — one of the two sanctioned self-reporting exceptions).
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import { loadTripwireSnapshot } from '@/lib/maintenance/tripwire-engine';
import { tripwire8 } from '@/lib/maintenance/tripwires';
import { computeVendorScores } from '@/lib/maintenance/vendors';
import { daysBetween } from '@/lib/maintenance/business-days';
import { getDashboardConfig } from '@/lib/dashboard-config';
import { getAgentConfig, effectiveLevel, isGloballyKilled, isWithinQuietHours } from './config';
import { createProposal } from './proposals';
import { enqueueOutbox, dispatchOutbox } from './outbox';
import { resolveStaffByPersonOrEmail } from './staff';
import { todayPacific } from './morning-card';
import { readLatestMetrics, readMetricsAsOf, readBaselineFreeze, type MetricMap } from './metrics-history';
import type { SendOutcome } from './channels';
import type { AgentProposal } from './types';
import {
  OPS_BRIEF_AGENT,
  SEND_BRIEF_ACTION,
  buildOpsBriefBlocks,
  deltaVs,
  perAgentStats,
  type EscalationBriefItem,
  type OpsBriefData,
} from './ops-brief';
import {
  ESTIMATE_CHASER_AGENT,
  VENDOR_CHASE_ACTION,
  VENDOR_CHASE_SMS_ACTION,
  OWNER_APPROVAL_ACTION,
  ESCALATE_ACTION,
} from './estimate-chaser';

const METRIC_NAMES = [
  'open_exceptions',
  'staff_actions',
  'estimate_approval_latency',
  'vendor_stuck_pools',
  'turns',
  'appfolio_retype_touches',
];

const INTERNAL_VENDOR_NAME_RE = /high desert maintenance/i;

export interface OpsBriefRunResult {
  halted?: string;
  dryRun: boolean;
  deep: boolean;
  briefDate: string;
  needsCraig: number;
  unacked: number;
  agentsReported: number;
  slack: { brody?: SendOutcome; matt?: SendOutcome };
}

function num(map: MetricMap, metric: string, field: string): number | null {
  const v = map.get(metric)?.value?.[field];
  return typeof v === 'number' ? v : null;
}

/** payload → brief item; woRef composed the same way the chaser renders it. */
function escalationItem(p: AgentProposal): EscalationBriefItem {
  const pl = p.payload as Record<string, unknown>;
  const where =
    (typeof pl.property_address === 'string' && pl.property_address) ||
    (typeof pl.property_name === 'string' && pl.property_name) ||
    'property';
  const unit = typeof pl.unit_name === 'string' && pl.unit_name ? `, Unit ${pl.unit_name}` : '';
  const woNumber = typeof pl.wo_number === 'string' ? pl.wo_number : null;
  return {
    proposalId: p.id,
    woRef: `${woNumber ? `WO #${woNumber} — ` : ''}${where}${unit}`,
    reason: typeof pl.reason === 'string' ? pl.reason : 'aged_45d',
    chaseCount: typeof pl.chase_count === 'number' ? pl.chase_count : 0,
    ageCalendarDays: typeof pl.age_calendar_days === 'number' ? pl.age_calendar_days : 0,
    appfolioLink: typeof pl.appfolio_link === 'string' ? pl.appfolio_link : null,
    acknowledgedBy: typeof pl.acknowledged_by === 'string' ? pl.acknowledged_by : undefined,
  };
}

export async function runOpsBrief(opts: {
  deep?: boolean;
  dryRun?: boolean;
  now?: Date;
} = {}): Promise<OpsBriefRunResult> {
  const now = opts.now ?? new Date();
  const deep = opts.deep === true;
  const dryRun = opts.dryRun === true;
  const briefDate = todayPacific(now);
  const result: OpsBriefRunResult = {
    dryRun,
    deep,
    briefDate,
    needsCraig: 0,
    unacked: 0,
    agentsReported: 0,
    slack: {},
  };

  if (await isGloballyKilled()) {
    console.log('[Agents] ops brief halted: kill switch');
    return { ...result, halted: 'kill switch' };
  }
  const cfg = await getAgentConfig(OPS_BRIEF_AGENT, SEND_BRIEF_ACTION);
  if (effectiveLevel(cfg) < 3) {
    const reason = cfg ? `autonomy level ${effectiveLevel(cfg)}` : 'no agent_config row';
    console.log(`[Agents] ops brief halted: ${reason}`);
    return { ...result, halted: reason };
  }
  if (cfg && isWithinQuietHours(cfg, now)) {
    return { ...result, halted: 'quiet hours' };
  }

  const supabase = getSupabaseAdmin();

  // ── Metrics + deltas ──
  const todayMidnightPacific = new Date(`${briefDate}T00:00:00-07:00`);
  const weekAgo = new Date(now.getTime() - 6 * 86_400_000);
  const [current, yesterday, lastWeek, baseline] = await Promise.all([
    readLatestMetrics(METRIC_NAMES),
    readMetricsAsOf(METRIC_NAMES, todayMidnightPacific),
    readMetricsAsOf(METRIC_NAMES, weekAgo),
    readBaselineFreeze(),
  ]);

  // ── Agent proposal stats (7 days) + today's activity ──
  const weekAgoIso = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const { data: recentRows } = await supabase
    .from('agent_proposal')
    .select('agent, status, action_type, created_at')
    .gte('created_at', weekAgoIso);
  const recent = (recentRows ?? []) as {
    agent: string;
    status: string;
    action_type: string;
    created_at: string;
  }[];
  const stats = perAgentStats(recent.filter((r) => r.agent !== OPS_BRIEF_AGENT));
  result.agentsReported = stats.length;

  const todayStart = todayMidnightPacific.toISOString();
  const todays = recent.filter((r) => r.created_at >= todayStart);
  const todayCounts = {
    drafts: todays.filter(
      (r) =>
        r.agent === ESTIMATE_CHASER_AGENT &&
        (r.action_type === VENDOR_CHASE_ACTION || r.action_type === OWNER_APPROVAL_ACTION)
    ).length,
    smsProposed: todays.filter(
      (r) => r.agent === ESTIMATE_CHASER_AGENT && r.action_type === VENDOR_CHASE_SMS_ACTION
    ).length,
    escalationsRaised: todays.filter(
      (r) => r.agent === ESTIMATE_CHASER_AGENT && r.action_type === ESCALATE_ACTION
    ).length,
  };

  // ── Open escalations: latest per WO, unacknowledged first ──
  const { data: escRows } = await supabase
    .from('agent_proposal')
    .select('*')
    .eq('agent', ESTIMATE_CHASER_AGENT)
    .eq('action_type', ESCALATE_ACTION)
    .order('created_at', { ascending: false });
  const latestPerWo = new Map<string, AgentProposal>();
  for (const row of (escRows ?? []) as AgentProposal[]) {
    const key = row.subject_id ?? row.id;
    if (!latestPerWo.has(key)) latestPerWo.set(key, row);
  }
  const needsCraig = [...latestPerWo.values()]
    .map(escalationItem)
    .filter((i) => !i.acknowledgedBy)
    .sort((a, b) => b.ageCalendarDays - a.ageCalendarDays);
  result.needsCraig = needsCraig.length;
  result.unacked = needsCraig.length;

  // ── Assemble ──
  const byActor = (current.get('staff_actions')?.value?.byActor7Days ?? {}) as Record<
    string,
    number
  >;
  const data: OpsBriefData = {
    briefDate,
    deep,
    exceptions: {
      total: num(current, 'open_exceptions', 'total'),
      needsDate: num(current, 'open_exceptions', 'needsDateCount'),
      vsYesterday: deltaVs(
        num(current, 'open_exceptions', 'total'),
        num(yesterday, 'open_exceptions', 'total'),
        'yesterday'
      ),
      vsBaseline: deltaVs(
        num(current, 'open_exceptions', 'total'),
        typeof baseline?.open_exceptions?.total === 'number'
          ? (baseline.open_exceptions.total as number)
          : null,
        'baseline'
      ),
    },
    gate: {
      last7Days: num(current, 'staff_actions', 'last7Days'),
      byActorTop: Object.entries(byActor)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3),
    },
    estimates: {
      openCount: num(current, 'estimate_approval_latency', 'openCount'),
      medianOpenAgeDays: num(current, 'estimate_approval_latency', 'medianOpenAgeDays'),
      medianDaysToDecision: num(current, 'estimate_approval_latency', 'medianDaysToDecision'),
      openDelta: deltaVs(
        num(current, 'estimate_approval_latency', 'openCount'),
        num(deep ? lastWeek : yesterday, 'estimate_approval_latency', 'openCount'),
        deep ? 'last week' : 'yesterday'
      ),
    },
    agentStats: stats,
    today: todayCounts,
    needsCraig,
  };

  // ── Deep sections (Monday) ──
  if (deep) {
    const snapshot = await loadTripwireSnapshot();
    const dashConfig = await getDashboardConfig();
    const scores = computeVendorScores(snapshot.vendors, snapshot.assignments, now).filter(
      (s) => !INTERNAL_VENDOR_NAME_RE.test(s.name)
    );
    const vendorById = new Map(snapshot.vendors.map((v) => [v.id, v]));
    const openWoById = new Map(snapshot.openWorkOrders.map((wo) => [wo.id, wo]));
    const offenders = snapshot.assignments
      .filter((a) => a.accepted_at && !a.completed_at && openWoById.has(a.work_order_id))
      .map((a) => {
        const vendor = vendorById.get(a.vendor_id);
        const wo = openWoById.get(a.work_order_id)!;
        return {
          vendorName: vendor?.name ?? 'Unknown vendor',
          isInternal:
            !!vendor &&
            (INTERNAL_VENDOR_NAME_RE.test(vendor.name) ||
              (vendor.appfolio_vendor_id
                ? dashConfig.internalVendorIds.includes(vendor.appfolio_vendor_id)
                : false)),
          item: `${wo.description.slice(0, 50)} — ${wo.property_name}`,
          ageDays: daysBetween(new Date(a.accepted_at!), now),
        };
      })
      .filter((o) => !o.isInternal)
      .sort((a, b) => b.ageDays - a.ageDays)
      .slice(0, 3);
    const unbilled = tripwire8(snapshot);

    data.deepSections = {
      vendorTop: scores.slice(0, 3).map((s) => ({ name: s.name, score: s.score })),
      offenders: offenders.map(({ vendorName, item, ageDays }) => ({ vendorName, item, ageDays })),
      vendorStuck: {
        acceptedUnworkedCount: num(current, 'vendor_stuck_pools', 'acceptedUnworkedCount'),
        scheduledDatePassedCount: num(current, 'vendor_stuck_pools', 'scheduledDatePassedCount'),
        vsLastWeek: deltaVs(
          num(current, 'vendor_stuck_pools', 'acceptedUnworkedCount'),
          num(lastWeek, 'vendor_stuck_pools', 'acceptedUnworkedCount'),
          'last week'
        ),
      },
      unbilled: {
        count: unbilled.length,
        oldestDays: unbilled.length
          ? Math.max(...unbilled.map((e) => e.ageDays ?? 0))
          : null,
      },
      turns: {
        openTurns: num(current, 'turns', 'openTurns'),
        medianDaysVacant: num(current, 'turns', 'medianDaysVacant'),
      },
      retype: {
        last7Days: num(current, 'appfolio_retype_touches', 'last7Days'),
        weeklyTarget: num(current, 'appfolio_retype_touches', 'weeklyTarget') ?? 40,
      },
      baseline: baseline
        ? [
            {
              label: 'Open exceptions',
              before: String(baseline.open_exceptions?.total ?? '—'),
              now: String(num(current, 'open_exceptions', 'total') ?? '—'),
            },
            {
              label: 'Stuck estimates (open)',
              before: String(baseline.estimate_approval_latency?.openCount ?? '—'),
              now: String(num(current, 'estimate_approval_latency', 'openCount') ?? '—'),
            },
            {
              label: 'Staff actions / week',
              before: String(baseline.staff_actions?.last7Days ?? '—'),
              now: String(num(current, 'staff_actions', 'last7Days') ?? '—'),
            },
          ]
        : [],
    };
  }

  if (dryRun) {
    return result;
  }

  // ── Send: proposal first (audit), then Craig (interactive) + Matt (read-only) ──
  const interactive = buildOpsBriefBlocks(data, { readOnly: false });
  const readOnly = buildOpsBriefBlocks(data, { readOnly: true });

  const proposal = await createProposal({
    agent: OPS_BRIEF_AGENT,
    subject_type: 'brief',
    subject_id: `${briefDate}${deep ? ':deep' : ''}`,
    action_type: SEND_BRIEF_ACTION,
    payload: {
      brief_date: briefDate,
      deep,
      escalation_ids: needsCraig.map((i) => i.proposalId),
      blocks: interactive.blocks,
      summary: {
        exceptions: data.exceptions.total,
        gate: data.gate.last7Days,
        needs_craig: needsCraig.length,
      },
    },
    rationale: `${deep ? 'Monday deep' : 'Daily'} ops brief — ${needsCraig.length} needs-decision item(s)`,
  });

  const [brody, matt] = await Promise.all([
    resolveStaffByPersonOrEmail('Brody'),
    resolveStaffByPersonOrEmail('Matt'),
  ]);

  let brodyOutboxId: string | null = null;
  if (brody?.slack_user_id) {
    const row = await enqueueOutbox({
      proposal_id: proposal.id,
      channel: 'slack',
      recipient_person: 'Brody',
      recipient_address: brody.slack_user_id,
      subject: 'Ops Brief',
      body: interactive.text,
      payload: { blocks: interactive.blocks, brief_date: briefDate },
    });
    brodyOutboxId = row.id;
  } else {
    result.slack.brody = { status: 'skipped', error: 'Brody has no slack_user_id in staff' };
  }
  if (matt?.slack_user_id) {
    await enqueueOutbox({
      proposal_id: proposal.id,
      channel: 'slack',
      recipient_person: 'Matt',
      recipient_address: matt.slack_user_id,
      subject: 'Ops Brief (copy)',
      body: readOnly.text,
      payload: { blocks: readOnly.blocks, brief_date: briefDate },
    });
  } else {
    result.slack.matt = { status: 'skipped', error: 'Matt has no slack_user_id in staff' };
  }

  await dispatchOutbox({ channel: 'slack', now });

  if (brodyOutboxId) {
    const { data: sentRow } = await supabase
      .from('agent_outbox')
      .select('status, message_id, error')
      .eq('id', brodyOutboxId)
      .maybeSingle();
    result.slack.brody = {
      status: (sentRow?.status as SendOutcome['status']) ?? 'failed',
      message_id: sentRow?.message_id ?? null,
      error: sentRow?.error ?? null,
    };
    if (sentRow?.status === 'sent') {
      await supabase
        .from('agent_proposal')
        .update({ status: 'auto_applied', channel_message_id: sentRow.message_id })
        .eq('id', proposal.id);
    }
  }
  if (matt?.slack_user_id && result.slack.matt === undefined) {
    result.slack.matt = { status: 'sent' };
  }

  return result;
}
