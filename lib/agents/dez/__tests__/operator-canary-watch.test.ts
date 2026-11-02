import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { alert, result, startRun } = vi.hoisted(() => ({
  alert: vi.fn(),
  result: { current: { data: null as unknown, error: null as unknown } },
  startRun: vi.fn(),
}));

vi.mock('@/lib/agents/dez/operator-alert', () => ({ alertOperatorFailure: alert }));
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit', 'update']) chain[m] = () => chain;
    chain.insert = () => {
      startRun();
      return { select: () => ({ single: async () => ({ data: { id: 'watch-run' }, error: null }) }) };
    };
    chain.maybeSingle = async () => result.current;
    chain.then = (resolve: (v: unknown) => void) => resolve({ error: null });
    return { from: () => chain };
  },
}));

import { GET } from '@/app/api/agents/cron/operator-canary-watch/route';
import { canaryProblem } from '@/lib/agents/dez/operator';

const NOW = Date.parse('2026-11-09T16:20:00Z');
const started = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();
const call = (auth = 'Bearer test-secret') =>
  GET(new NextRequest('https://os.example/api/agents/cron/operator-canary-watch', { headers: { authorization: auth } }));

describe('canaryProblem', () => {
  const at = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();

  it('flags a run still running after 15 minutes', () => {
    expect(canaryProblem({ status: 'running', started_at: at(20) }, NOW)).toMatch(/never finished/);
  });
  it('flags a missing or old run as never started', () => {
    expect(canaryProblem(null, NOW)).toMatch(/never started/);
    expect(canaryProblem({ status: 'ok', started_at: at(7 * 24 * 60) }, NOW)).toMatch(/never started/);
  });
  it('stays quiet for a finished run and one still within its time', () => {
    for (const status of ['ok', 'error', 'skipped', 'halted']) {
      expect(canaryProblem({ status, started_at: at(20) }, NOW)).toBeNull();
    }
    expect(canaryProblem({ status: 'running', started_at: at(5) }, NOW)).toBeNull();
  });
});

describe('operator-canary-watch route', () => {
  beforeEach(() => {
    alert.mockReset();
    startRun.mockReset();
    vi.stubEnv('CRON_SECRET', 'test-secret');
    vi.stubEnv('DEZ_OPERATOR_URL', 'https://worker.example');
    result.current = { data: null, error: null };
  });

  it('alerts on a raw running row', async () => {
    result.current = { data: { status: 'running', started_at: started(20) }, error: null };
    const body = await (await call()).json();
    expect(body.ok).toBe(false);
    expect(alert).toHaveBeenCalledWith(expect.objectContaining({ context: 'canary_stuck' }));
  });
  it('does not alert when the canary finished, even if it failed', async () => {
    result.current = { data: { status: 'error', started_at: started(20) }, error: null };
    expect((await (await call()).json()).ok).toBe(true);
    expect(alert).not.toHaveBeenCalled();
  });
  it('does not call a read failure "never started"', async () => {
    result.current = { data: null, error: { message: 'db down' } };
    expect((await (await call()).json()).error).toBe('db down');
    expect(alert).not.toHaveBeenCalled();
  });
  it('skips when the operator is not configured', async () => {
    vi.stubEnv('DEZ_OPERATOR_URL', '');
    expect((await (await call()).json()).skipped).toBeTruthy();
    expect(alert).not.toHaveBeenCalled();
  });
  it('rejects a caller without the cron secret', async () => {
    expect((await call('Bearer wrong')).status).toBe(401);
    expect(alert).not.toHaveBeenCalled();
  });
});
