import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ inserts: [] as unknown[], updates: [] as unknown[], fail: false }));
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      insert: (row: unknown) => {
        db.inserts.push(row);
        return { select: () => ({ single: async () => (db.fail ? { data: null, error: { message: 'relation "routine_run" does not exist' } } : { data: { id: 'run-1' }, error: null }) }) };
      },
      update: (row: unknown) => {
        db.updates.push(row);
        return { eq: async () => ({ error: null }) };
      },
    }),
  }),
}));

import { classifyRun, isCronRequest, summarize, withCronRun } from '../run';

const req = (url: string, auth?: string) => new Request(`https://hdpm.test${url}`, { headers: auth ? { authorization: auth } : {} });

describe('classifyRun', () => {
  it('sorts halted, skipped and errors out of a 200', () => {
    expect(classifyRun(200, { halted: 'kill switch' })).toMatchObject({ status: 'halted', halt_reason: 'kill switch' });
    expect(classifyRun(200, { skipped: 'Outside 8 AM Pacific' })).toMatchObject({ status: 'skipped', halt_reason: 'Outside 8 AM Pacific' });
    expect(classifyRun(200, { ok: true, skipped: 'operator disabled' }).status).toBe('skipped');
    expect(classifyRun(200, { disabled: 'switched off' }).status).toBe('skipped');
    expect(classifyRun(200, { ok: false, error: 'worker 500' })).toMatchObject({ status: 'error', error: 'worker 500' });
    expect(classifyRun(500, { error: 'boom' })).toMatchObject({ status: 'error', error: 'boom' });
    expect(classifyRun(502, null)).toMatchObject({ status: 'error', error: 'HTTP 502' });
  });
  it('treats empty disabled lists and plain results as ok', () => {
    expect(classifyRun(200, { disabled: [], drafted: 3 }).status).toBe('ok');
    expect(classifyRun(200, { sent: false, reason: 'quiet day' }).status).toBe('ok');
    expect(classifyRun(200, { results: [], succeeded: 2, total: 2 })).toMatchObject({ status: 'ok', items: 2 });
  });
  it('prefers halted over skipped and picks up recipients', () => {
    expect(classifyRun(200, { halted: 'kill', skipped: 'x', recipients: ['Brody', 3] })).toMatchObject({ status: 'halted', recipients: ['Brody'] });
  });
});

describe('isCronRequest', () => {
  it('accepts only the exact bearer', () => {
    expect(isCronRequest(req('/x', 'Bearer s3cret'), 's3cret')).toBe(true);
    expect(isCronRequest(req('/x', 'Bearer s3cre'), 's3cret')).toBe(false);
    expect(isCronRequest(req('/x'), 's3cret')).toBe(false);
    expect(isCronRequest(req('/x', 'Bearer '), '')).toBe(false);
  });
});

describe('summarize', () => {
  it('keeps scalars and collapses objects and long arrays', () => {
    expect(summarize({ a: 1, b: 'x', c: { d: 1 }, e: [1, 2], f: Array(20).fill(1), g: [{}] })).toEqual({ a: 1, b: 'x', c: '{…}', e: [1, 2], f: '[20 items]', g: '[1 items]' });
  });
});

describe('withCronRun', () => {
  beforeEach(() => {
    db.inserts.length = 0;
    db.updates.length = 0;
    db.fail = false;
    process.env.CRON_SECRET = 's3cret';
  });

  it('logs a cron run and returns the handler response untouched', async () => {
    const GET = withCronRun(async () => Response.json({ halted: 'kill switch' }));
    const res = await GET(req('/api/agents/cron/estimate-chaser', 'Bearer s3cret'));
    expect(await res.json()).toEqual({ halted: 'kill switch' });
    expect(db.inserts).toEqual([{ routine_id: 'estimate_chaser', path: '/api/agents/cron/estimate-chaser' }]);
    expect(db.updates[0]).toMatchObject({ status: 'halted', halt_reason: 'kill switch' });
  });

  it('does not log manual (non-cron) calls', async () => {
    const GET = withCronRun(async () => Response.json({ ok: true }));
    await GET(req('/api/sync/keys'));
    expect(db.inserts).toEqual([]);
  });

  it('still runs the cron when routine_run is missing', async () => {
    db.fail = true;
    const handler = vi.fn(async () => Response.json({ ok: true }));
    const res = await withCronRun(handler)(req('/api/sync/keys', 'Bearer s3cret'));
    expect(handler).toHaveBeenCalledOnce();
    expect(res.status).toBe(200);
    expect(db.updates).toEqual([]);
  });

  it('records a thrown error and rethrows it', async () => {
    const GET = withCronRun(async () => { throw new Error('appfolio down'); });
    await expect(GET(req('/api/sync/appfolio', 'Bearer s3cret'))).rejects.toThrow('appfolio down');
    expect(db.updates[0]).toMatchObject({ status: 'error', error: 'appfolio down' });
  });
});
