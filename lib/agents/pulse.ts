/**
 * Agent cards for the /agents hero: one card per catalog agent that has a
 * schedule, combining its routines (last/next run, recipients) with its
 * agent_config rows (autonomy level on the L0–L4 ladder). Pure; unit-tested.
 */

import { AGENT_CATALOG } from './catalog';
import type { AgentConfigRow } from './types';
import type { RoutineView } from '@/lib/routines/status';

export interface AgentPulse {
  id: string;
  name: string;
  /** ok | warn | error | running | never — from the newest run across the agent's routines. */
  color: 'ok' | 'warn' | 'error' | 'running' | 'never';
  statusText: string;
  level: number | null;
  ceiling: number | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  recipients: string[];
}

const STATUS_TEXT: Record<string, string> = {
  ok: 'Last run OK',
  halted: 'Halted',
  skipped: 'Skipped',
  error: 'Last run failed',
  running: 'Running now',
};

export function buildPulses(routines: RoutineView[], config: AgentConfigRow[], killed: boolean): AgentPulse[] {
  const out: AgentPulse[] = [];
  for (const agent of AGENT_CATALOG) {
    const mine = routines.filter((r) => r.catalogId === agent.id);
    if (mine.length === 0) continue;

    const runs = mine.flatMap((r) => (r.lastRun ? [r.lastRun] : [])).sort((a, b) => b.started_at.localeCompare(a.started_at));
    const last = runs[0] ?? null;
    const status = last?.status ?? null;
    const color: AgentPulse['color'] =
      status === 'ok' ? 'ok' : status === 'error' ? 'error' : status === 'running' ? 'running' : status ? 'warn' : 'never';

    const rows = agent.config
      ? config.filter((c) => c.agent === agent.config!.agent && (!agent.config!.actions || agent.config!.actions.includes(c.action_type)))
      : [];
    const enabled = rows.filter((r) => r.enabled);
    const level = killed && rows.length ? 0 : enabled.length ? Math.max(...enabled.map((r) => r.autonomy_level)) : rows.length ? 0 : null;
    const ceiling = rows.length ? Math.max(...rows.map((r) => r.ceiling_level)) : null;

    const reason = last?.halt_reason || last?.error;
    const statusText = killed && rows.length
      ? 'Paused by the kill switch'
      : status
        ? `${STATUS_TEXT[status] ?? status}${reason ? `: ${reason}` : ''}`
        : 'No run recorded yet';

    out.push({
      id: agent.id,
      name: agent.name,
      color,
      statusText,
      level,
      ceiling,
      lastRunAt: last?.started_at ?? null,
      nextRunAt: mine.map((r) => r.nextRunAt).sort()[0] ?? null,
      recipients: [...new Set(mine.flatMap((r) => r.recipientNames))],
    });
  }
  return out;
}
