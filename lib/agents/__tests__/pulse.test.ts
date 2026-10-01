import { describe, it, expect } from 'vitest';
import { buildPulses } from '../pulse';
import type { RoutineView } from '@/lib/routines/status';
import type { AgentConfigRow } from '../types';

const view = (over: Partial<RoutineView>): RoutineView => ({
  id: 'x', path: '/x', schedule: '0 0 * * *', name: 'x', category: 'agent', owner: 'Craig', cadence: 'scheduled',
  nextRunAt: '2026-10-06T00:00:00Z', lastRun: null, recipientNames: [], ...over,
});
const cfg = (over: Partial<AgentConfigRow>): AgentConfigRow => ({
  agent: 'ops_brief', action_type: 'send_brief', autonomy_level: 3, ceiling_level: 4, max_per_day: null, quiet_hours: null, owner_role: null,
  enabled: true, slack_recipients: null, updated_at: '', ...over,
});

describe('buildPulses', () => {
  const routines = [
    view({ id: 'ops_brief', catalogId: 'ops_brief', nextRunAt: '2026-10-07T00:00:00Z', recipientNames: ['Brody', 'Matt'], lastRun: { status: 'ok', started_at: '2026-10-05T00:00:00Z', finished_at: null, halt_reason: null, error: null, items: null } }),
    view({ id: 'ops_brief_deep', catalogId: 'ops_brief', nextRunAt: '2026-10-06T15:00:00Z', recipientNames: ['Matt', 'Craig'], lastRun: { status: 'halted', started_at: '2026-10-05T15:00:00Z', finished_at: null, halt_reason: 'kill switch', error: null, items: null } }),
    view({ id: 'kpi', catalogId: undefined }),
  ];

  it('combines an agent’s routines: newest run, soonest next run, merged recipients', () => {
    const [p] = buildPulses(routines, [cfg({})], false);
    expect(p).toMatchObject({
      id: 'ops_brief', color: 'warn', statusText: 'Halted: kill switch', level: 3, ceiling: 4,
      lastRunAt: '2026-10-05T15:00:00Z', nextRunAt: '2026-10-06T15:00:00Z', recipients: ['Brody', 'Matt', 'Craig'],
    });
  });

  it('skips catalog agents with no schedule', () => {
    expect(buildPulses(routines, [], false).map((p) => p.id)).toEqual(['ops_brief']);
  });

  it('shows L0 when every governing row is off or the kill switch is on', () => {
    expect(buildPulses(routines, [cfg({ enabled: false })], false)[0].level).toBe(0);
    expect(buildPulses(routines, [cfg({})], true)[0]).toMatchObject({ level: 0, statusText: 'Paused by the kill switch' });
  });

  it('has no ladder for agents without config rows', () => {
    expect(buildPulses(routines, [], false)[0].level).toBeNull();
  });
});
