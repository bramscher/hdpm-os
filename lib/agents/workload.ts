/**
 * Per-agent live workload for the /agents supervision surface: the real-world
 * pool each agent watches (count + aging, from metrics_snapshot) plus its own
 * still-`proposed` backlog. Pure + DB-free so it unit-tests like the other
 * lib/agents helpers; the page passes in data it already loaded.
 */

import type { AgentConfigRow, AgentProposal } from './types';

export interface AgentWorkload {
  poolCount: number | null;
  poolLabel: string | null;
  poolAging: string | null;
  pending: number;
  oldestDays: number | null;
}

type MetricValue = Record<string, unknown>;
export type LatestMetrics = Map<string, { value: MetricValue; captured_at: string }>;

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function roundDays(d: unknown): number | null {
  return typeof d === 'number' && Number.isFinite(d) ? Math.round(d) : null;
}

/**
 * The pool an agent watches, from the metrics_snapshot `latest` map. Returns
 * null when the agent has no mapped metric (or it hasn't been captured yet) —
 * the card then shows only its proposal backlog, never a fabricated number.
 */
export function agentPool(
  agent: string,
  latest: LatestMetrics
): { count: number; label: string; aging: string | null } | null {
  const v = (metric: string) => latest.get(metric)?.value;
  switch (agent) {
    case 'estimate_chaser': {
      const m = v('estimate_approval_latency');
      const count = num(m?.openCount);
      if (count == null) return null;
      const age = roundDays(m?.medianOpenAgeDays);
      return { count, label: 'open estimates', aging: age != null ? `median ${age}d` : null };
    }
    case 'morning_card': {
      const m = v('open_exceptions');
      const count = num(m?.total);
      if (count == null) return null;
      return { count, label: 'open exceptions', aging: null };
    }
    case 'intake_triage': {
      const m = v('triage_acceptance');
      const count = num(m?.pending);
      if (count == null) return null;
      return { count, label: 'awaiting triage', aging: null };
    }
    case 'vendor_chaser': {
      const m = v('vendor_stuck_pools');
      const count = num(m?.scheduledDatePassedCount);
      if (count == null) return null;
      const age = roundDays(m?.acceptedUnworkedMedianAgeDays);
      return { count, label: 'past scheduled date', aging: age != null ? `median ${age}d` : null };
    }
    default:
      return null;
  }
}

/** Per-agent backlog of still-`proposed` items + the oldest one's age in days. */
export function proposalBacklog(
  proposals: AgentProposal[],
  now = Date.now()
): Map<string, { pending: number; oldestDays: number | null }> {
  const acc = new Map<string, { pending: number; oldestAt: number | null }>();
  for (const p of proposals) {
    if (p.status !== 'proposed') continue;
    const cur = acc.get(p.agent) ?? { pending: 0, oldestAt: null };
    cur.pending++;
    const t = p.created_at ? new Date(p.created_at).getTime() : null;
    if (t != null && (cur.oldestAt == null || t < cur.oldestAt)) cur.oldestAt = t;
    acc.set(p.agent, cur);
  }
  const out = new Map<string, { pending: number; oldestDays: number | null }>();
  for (const [agent, cur] of acc) {
    out.set(agent, {
      pending: cur.pending,
      oldestDays: cur.oldestAt != null ? Math.floor((now - cur.oldestAt) / 86_400_000) : null,
    });
  }
  return out;
}

/** Assemble the workload map the AutonomyMatrix renders, keyed by agent. */
export function buildWorkload(
  config: AgentConfigRow[],
  latest: LatestMetrics,
  proposals: AgentProposal[],
  now = Date.now()
): Record<string, AgentWorkload> {
  const backlog = proposalBacklog(proposals, now);
  const out: Record<string, AgentWorkload> = {};
  for (const agent of new Set(config.filter((c) => c.agent !== '*').map((c) => c.agent))) {
    const pool = agentPool(agent, latest);
    const bl = backlog.get(agent);
    out[agent] = {
      poolCount: pool?.count ?? null,
      poolLabel: pool?.label ?? null,
      poolAging: pool?.aging ?? null,
      pending: bl?.pending ?? 0,
      oldestDays: bl?.oldestDays ?? null,
    };
  }
  return out;
}
