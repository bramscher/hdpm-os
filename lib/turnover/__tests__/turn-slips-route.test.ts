import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({
  send: vi.fn(), killed: vi.fn(), config: vi.fn(), load: vi.fn(), log: vi.fn(),
}));
vi.mock('@/lib/agents/channels/slack', () => ({ sendSlackMessage: m.send }));
vi.mock('@/lib/agents/config', () => ({ isGloballyKilled: m.killed, getAgentConfig: m.config }));
vi.mock('@/lib/agents/dez/activity', () => ({ logDezActivity: m.log }));
vi.mock('@/lib/agents/staff', () => ({ resolveStaffByPersonOrEmail: async (p: string) => (p === 'Nobody' ? null : { slack_user_id: `U-${p}` }) }));
vi.mock('@/lib/turnover/server', () => ({ loadSlips: m.load }));
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => {
    const chain: Record<string, unknown> = {};
    for (const k of ['select', 'eq', 'order', 'limit', 'update']) chain[k] = () => chain;
    chain.insert = () => ({ select: () => ({ single: async () => ({ data: { id: 'run' }, error: null }) }) });
    chain.then = (resolve: (v: unknown) => void) => resolve({ error: null });
    return { from: () => chain };
  },
}));

import { GET } from '@/app/api/agents/cron/turn-slips/route';

const slip = (o = {}) => ({ key: 'keys', kind: 'keys', turnId: 't', unit: 'Elm', coordinator: 'Brody', text: 'Keys', daysLate: 1, ...o });
const call = (auth = 'Bearer test-secret') => GET(new NextRequest('https://os.example/api/agents/cron/turn-slips', { headers: { authorization: auth } }));
const channels = () => m.send.mock.calls.map((c) => c[0].channel).sort();

describe('turn-slips cron', () => {
  beforeEach(() => {
    for (const f of Object.values(m)) f.mockReset();
    vi.stubEnv('CRON_SECRET', 'test-secret');
    m.killed.mockResolvedValue(false);
    m.config.mockResolvedValue(null);
    m.send.mockResolvedValue({ status: 'sent' });
    m.load.mockResolvedValue({ slips: [slip()], onChaseBoard: 0 });
  });
  it('refuses without the cron secret', async () => {
    expect((await call('Bearer nope')).status).toBe(401);
    expect(m.send).not.toHaveBeenCalled();
  });
  it('sends nothing when the kill switch is on', async () => {
    m.killed.mockResolvedValue(true);
    await call();
    expect(m.load).not.toHaveBeenCalled();
    expect(m.send).not.toHaveBeenCalled();
  });
  it('goes only to Craig until enabled, marked as a preview', async () => {
    const res = await (await call()).json();
    expect(channels()).toEqual(['U-Craig']);
    expect(res.preview).toBe(true);
    expect(JSON.stringify(m.send.mock.calls[0][0].blocks)).toContain('Preview');
  });
  it('stays preview when the config is disabled', async () => {
    m.config.mockResolvedValue({ enabled: false });
    await call();
    expect(channels()).toEqual(['U-Craig']);
  });
  it('once enabled, goes to each coordinator, defaulting to Brody', async () => {
    m.config.mockResolvedValue({ enabled: true });
    m.load.mockResolvedValue({ slips: [slip({ coordinator: null }), slip({ coordinator: 'Lisa' })], onChaseBoard: 0 });
    await call();
    expect(channels()).toEqual(['U-Brody', 'U-Lisa']);
  });
  it('is silent on a clean day', async () => {
    m.load.mockResolvedValue({ slips: [], onChaseBoard: 3 });
    await call();
    expect(m.send).not.toHaveBeenCalled();
  });
  it('reports a coordinator it cannot reach', async () => {
    m.config.mockResolvedValue({ enabled: true });
    m.load.mockResolvedValue({ slips: [slip({ coordinator: 'Nobody' })], onChaseBoard: 0 });
    const res = await (await call()).json();
    expect(res.ok).toBe(false);
    expect(res.failed[0]).toContain('Nobody');
  });
});
