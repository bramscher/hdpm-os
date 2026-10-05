import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const guard = vi.fn();
const webAdminFetch = vi.fn();
vi.mock('@/lib/require-role', () => ({ requireRole: () => guard() }));
vi.mock('@/lib/hdpm-web-admin', () => ({ webAdminFetch: (...args: unknown[]) => webAdminFetch(...args) }));

import { GET, POST, PATCH } from '@/app/api/admin/hiring/[...path]/route';

const ctx = (path: string) => ({ params: Promise.resolve({ path: path.split('/') }) });
const req = (method: string, url: string, body?: string) => new NextRequest(`https://os.example.com${url}`, { method, body });

describe('hiring admin proxy', () => {
  beforeEach(() => {
    guard.mockResolvedValue({ ok: true, email: 'craig@highdesertpm.com', role: 'admin' });
    webAdminFetch.mockResolvedValue(Response.json({ ok: true }));
  });

  it('requires an admin before touching the website', async () => {
    guard.mockResolvedValue({ ok: false, response: Response.json({ error: 'no' }, { status: 403 }) });
    const res = await GET(req('GET', '/api/admin/hiring/overview'), ctx('overview'));
    expect(res.status).toBe(403);
    expect(webAdminFetch).not.toHaveBeenCalled();
  });

  it('forwards only allowlisted routes, with the acting admin', async () => {
    await GET(req('GET', '/api/admin/hiring/applications/7?kind=video'), ctx('applications/7'));
    expect(webAdminFetch).toHaveBeenLastCalledWith('/hiring/applications/7?kind=video', 'craig@highdesertpm.com', { method: 'GET', body: undefined });
    await PATCH(req('PATCH', '/api/admin/hiring/jobs/3', '{"status":"open"}'), ctx('jobs/3'));
    expect(webAdminFetch).toHaveBeenLastCalledWith('/hiring/jobs/3', 'craig@highdesertpm.com', { method: 'PATCH', body: '{"status":"open"}' });
  });

  it('rejects unknown paths, wrong methods and path tricks', async () => {
    webAdminFetch.mockClear();
    for (const [method, path] of [['GET', '../crm'], ['POST', 'overview'], ['GET', 'applications/abc'], ['PATCH', 'jobs/1/../../x']] as const) {
      const handler = method === 'GET' ? GET : method === 'POST' ? POST : PATCH;
      const res = await handler(req(method, `/api/admin/hiring/x`), ctx(path));
      expect(res.status).toBe(404);
    }
    expect(webAdminFetch).not.toHaveBeenCalled();
  });
});
