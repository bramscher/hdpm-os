/**
 * Ops Brief — pure logic. Brief E, Agent #7 in
 * docs/agent-os/00-DRAFT-master-plan.md.
 *
 * Weekday 5 PM short brief + Monday 8 AM deep brief for Brody + Matt: the
 * supervision surface for the agent team. Replaces the never-enabled digest
 * with something that ends in decisions — at most NEEDS_CRAIG_CAP
 * unacknowledged escalations, each with one [Acknowledge] button (on
 * Brody's copy; Matt's is read-only v1).
 *
 * Hard rule inherited from the data model: NEVER a dollar figure — estimate
 * and unbilled amounts do not exist in any reachable API; everything is
 * counts and ages.
 *
 * DB-free and fetch-free; orchestration lives in ops-brief-run.ts.
 */

export const OPS_BRIEF_AGENT = 'ops_brief';
export const SEND_BRIEF_ACTION = 'send_brief';
export const NEEDS_CRAIG_CAP = 3;
/** The Phase 1 adoption gate: human actions/week through agent surfaces. */
export const GATE_TARGET_PER_WEEK = 25;

// ============================================
// Deltas
// ============================================

export interface DeltaInfo {
  direction: 'up' | 'down' | 'flat';
  label: string; // e.g. "↓ 14 vs yesterday"
}

/** Null-safe numeric delta. Null when either side is missing. */
export function deltaVs(
  current: number | null | undefined,
  prior: number | null | undefined,
  vs: string
): DeltaInfo | null {
  if (typeof current !== 'number' || typeof prior !== 'number') return null;
  const diff = current - prior;
  if (diff === 0) return { direction: 'flat', label: `flat vs ${vs}` };
  const arrow = diff > 0 ? '↑' : '↓';
  const n = Math.abs(Number.isInteger(diff) ? diff : Number(diff.toFixed(1)));
  return { direction: diff > 0 ? 'up' : 'down', label: `${arrow} ${n} vs ${vs}` };
}

/** "(↓ 14 vs yesterday)" or empty string. */
export function deltaSuffix(delta: DeltaInfo | null): string {
  return delta ? ` (${delta.label})` : '';
}

// ============================================
// Per-agent proposal stats
// ============================================

export interface AgentStat {
  agent: string;
  made: number;
  applied: number; // approved + auto_applied — the "acted on / delivered" bucket
  edited: number;
  rejected: number;
}

export function perAgentStats(
  proposals: { agent: string; status: string }[]
): AgentStat[] {
  const byAgent = new Map<string, AgentStat>();
  for (const p of proposals) {
    const s =
      byAgent.get(p.agent) ??
      ({ agent: p.agent, made: 0, applied: 0, edited: 0, rejected: 0 } as AgentStat);
    s.made++;
    if (p.status === 'approved' || p.status === 'auto_applied') s.applied++;
    else if (p.status === 'edited') s.edited++;
    else if (p.status === 'rejected') s.rejected++;
    byAgent.set(p.agent, s);
  }
  return [...byAgent.values()].sort((a, b) => b.made - a.made);
}

// ============================================
// ob:* action ids (Slack interactivity namespace for the brief)
// ============================================

export type ObActionKind = 'ack';

export function encodeObActionId(kind: ObActionKind, proposalId: string): string {
  return `ob:${kind}:${proposalId}`;
}

export function parseObActionId(
  actionId: string
): { kind: ObActionKind; proposalId: string } | null {
  const m = actionId.match(/^ob:(ack):(.+)$/);
  if (!m || !m[2]) return null;
  return { kind: m[1] as ObActionKind, proposalId: m[2] };
}

// ============================================
// Brief data model
// ============================================

export interface EscalationBriefItem {
  proposalId: string;
  woRef: string;
  reason: 'chased_3x' | 'aged_45d' | string;
  chaseCount: number;
  ageCalendarDays: number;
  appfolioLink: string | null;
  acknowledgedBy?: string;
}

export interface OpsBriefData {
  briefDate: string;
  deep: boolean;
  exceptions: {
    total: number | null;
    needsDate: number | null;
    vsYesterday: DeltaInfo | null;
    vsBaseline: DeltaInfo | null;
  };
  gate: {
    last7Days: number | null;
    byActorTop: [string, number][];
  };
  estimates: {
    openCount: number | null;
    medianOpenAgeDays: number | null;
    medianDaysToDecision: number | null;
    openDelta: DeltaInfo | null;
  };
  agentStats: AgentStat[];
  today: { drafts: number; smsProposed: number; escalationsRaised: number };
  needsCraig: EscalationBriefItem[];
  deepSections?: {
    vendorTop: { name: string; score: number | null }[];
    offenders: { vendorName: string; item: string; ageDays: number }[];
    vendorStuck: {
      acceptedUnworkedCount: number | null;
      scheduledDatePassedCount: number | null;
      vsLastWeek: DeltaInfo | null;
    };
    unbilled: { count: number; oldestDays: number | null };
    turns: { openTurns: number | null; medianDaysVacant: number | null };
    retype: { last7Days: number | null; weeklyTarget: number };
    baseline: { label: string; before: string; now: string }[];
  };
}

// ============================================
// Block builders
// ============================================

function mrkdwn(text: string): unknown {
  return { type: 'section', text: { type: 'mrkdwn', text } };
}

function context(text: string): unknown {
  return { type: 'context', elements: [{ type: 'mrkdwn', text }] };
}

const DIVIDER = { type: 'divider' };

function n(v: number | null | undefined): string {
  return typeof v === 'number' ? String(v) : '—';
}

function reasonLine(item: EscalationBriefItem): string {
  return item.reason === 'chased_3x'
    ? `chased ${item.chaseCount}× with no movement`
    : `${item.ageCalendarDays} days stuck`;
}

function escalationBlock(item: EscalationBriefItem, interactive: boolean): unknown {
  const link = item.appfolioLink ? ` · <${item.appfolioLink}|AppFolio>` : '';
  const text = `*${item.woRef}*\n${reasonLine(item)}${link}`;
  if (item.acknowledgedBy) {
    return {
      type: 'section',
      block_id: `ob-item:${item.proposalId}`,
      text: { type: 'mrkdwn', text: `${text}\n✓ Acknowledged by ${item.acknowledgedBy}` },
    };
  }
  const base: Record<string, unknown> = {
    type: 'section',
    block_id: `ob-item:${item.proposalId}`,
    text: { type: 'mrkdwn', text },
  };
  if (interactive) {
    base.accessory = {
      type: 'button',
      action_id: encodeObActionId('ack', item.proposalId),
      text: { type: 'plain_text', text: '✓ Acknowledge' },
      value: item.proposalId,
    };
  }
  return base;
}

/**
 * Mark one escalation block acknowledged in an already-rendered block list.
 * Pure — used by the tap handler to patch the stored blocks without a
 * full re-gather. Returns null when the block isn't present.
 */
export function applyAckToBlocks(
  blocks: unknown[],
  escalationProposalId: string,
  actor: string,
  time: string
): unknown[] | null {
  const id = `ob-item:${escalationProposalId}`;
  let found = false;
  const out = blocks.map((b) => {
    const block = b as { block_id?: string; text?: { text?: string } };
    if (block.block_id !== id) return b;
    found = true;
    const baseText = (block.text?.text ?? '').split('\n✓ Acknowledged')[0];
    return {
      type: 'section',
      block_id: id,
      text: { type: 'mrkdwn', text: `${baseText}\n✓ Acknowledged by ${actor} ${time}` },
    };
  });
  return found ? out : null;
}

export function buildOpsBriefBlocks(
  data: OpsBriefData,
  opts: { readOnly: boolean }
): { text: string; blocks: unknown[] } {
  const title = data.deep
    ? `📊 Monday Ops Brief — ${data.briefDate}`
    : `📊 Ops Brief — ${data.briefDate}`;
  const openCount = data.needsCraig.filter((i) => !i.acknowledgedBy).length;
  const text = `${title}: ${n(data.exceptions.total)} open exceptions · ${openCount} need${openCount === 1 ? 's' : ''} a decision`;

  const blocks: unknown[] = [mrkdwn(`*${title}*`)];

  // 1. Pulse
  blocks.push(
    mrkdwn(
      `*Exceptions:* ${n(data.exceptions.total)} open${deltaSuffix(data.exceptions.vsYesterday)}${deltaSuffix(data.exceptions.vsBaseline)} · ${n(data.exceptions.needsDate)} need a date`
    )
  );

  // 2. Phase-1 gate
  const gateState =
    typeof data.gate.last7Days === 'number'
      ? data.gate.last7Days >= GATE_TARGET_PER_WEEK
        ? '✅ over target'
        : '⏳ below target'
      : '—';
  const actors = data.gate.byActorTop.map(([who, count]) => `${who} ${count}`).join(' · ');
  blocks.push(
    mrkdwn(
      `*Adoption gate:* ${n(data.gate.last7Days)} staff actions in 7 days (target ${GATE_TARGET_PER_WEEK}/week) ${gateState}${actors ? `\n${actors}` : ''}`
    )
  );

  // 3. Estimate pool
  blocks.push(
    mrkdwn(
      `*Stuck estimates:* ${n(data.estimates.openCount)} open${deltaSuffix(data.estimates.openDelta)} · median ${n(data.estimates.medianOpenAgeDays)}d stuck · decisions take ${n(data.estimates.medianDaysToDecision)}d median`
    )
  );

  // 4. Agent team
  if (data.agentStats.length > 0) {
    const lines = data.agentStats
      .map(
        (s) =>
          `• *${s.agent}*: ${s.made} made · ${s.applied} applied · ${s.edited} edited · ${s.rejected} rejected`
      )
      .join('\n');
    blocks.push(mrkdwn(`*Agent team (7 days):*\n${lines}`));
  }

  // 5. Today
  blocks.push(
    context(
      `Today: ${data.today.drafts} drafts written · ${data.today.smsProposed} texts proposed · ${data.today.escalationsRaised} escalations raised`
    )
  );

  // 6. Needs Craig
  const unacked = data.needsCraig.filter((i) => !i.acknowledgedBy);
  const shown = data.needsCraig.slice(0, NEEDS_CRAIG_CAP);
  blocks.push(DIVIDER);
  if (unacked.length === 0) {
    blocks.push(mrkdwn('*Needs decision:* nothing 🎉'));
  } else {
    blocks.push(mrkdwn(`*Needs decision (${unacked.length}):*`));
    for (const item of shown) {
      blocks.push(escalationBlock(item, !opts.readOnly));
    }
    if (data.needsCraig.length > NEEDS_CRAIG_CAP) {
      blocks.push(context(`+${data.needsCraig.length - NEEDS_CRAIG_CAP} more on the exceptions board`));
    }
  }

  // Deep sections
  if (data.deep && data.deepSections) {
    const d = data.deepSections;
    blocks.push(DIVIDER);
    if (d.vendorTop.length > 0) {
      const top = d.vendorTop
        .map((v) => `${v.name} ${v.score === null ? '—' : v.score.toFixed(2)}`)
        .join(' · ');
      blocks.push(mrkdwn(`*Vendor scoreboard (90d):* ${top}`));
    }
    if (d.offenders.length > 0) {
      const lines = d.offenders
        .map((o) => `• ${o.vendorName} — ${o.item} (${o.ageDays}d accepted, unworked)`)
        .join('\n');
      blocks.push(mrkdwn(`*Sitting on accepted work:*\n${lines}`));
    }
    blocks.push(
      mrkdwn(
        `*Vendor stuck pools:* ${n(d.vendorStuck.acceptedUnworkedCount)} accepted-unworked${deltaSuffix(d.vendorStuck.vsLastWeek)} · ${n(d.vendorStuck.scheduledDatePassedCount)} past scheduled date`
      )
    );
    blocks.push(
      mrkdwn(
        `*Unbilled completed work:* ${d.unbilled.count} WOs${d.unbilled.oldestDays !== null ? ` · oldest ${d.unbilled.oldestDays}d` : ''} — *Turns:* ${n(d.turns.openTurns)} open · ${n(d.turns.medianDaysVacant)}d median vacant — *Retype touches:* ${n(d.retype.last7Days)}/wk (Write-API threshold ${d.retype.weeklyTarget})`
      )
    );
    if (d.baseline.length > 0) {
      const lines = d.baseline.map((b) => `• ${b.label}: ${b.before} → ${b.now}`).join('\n');
      blocks.push(mrkdwn(`*Since the baseline freeze:*\n${lines}`));
    }
  }

  blocks.push(
    context(
      data.deep
        ? 'Monday deep brief · sent by the Ops Brief agent (L3 self-reporting)'
        : 'Daily brief · sent by the Ops Brief agent (L3 self-reporting)'
    )
  );

  return { text, blocks };
}
