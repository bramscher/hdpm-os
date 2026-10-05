import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const guard = vi.fn();
const webAdminFetch = vi.fn();
vi.mock('@/lib/require-role', () => ({ requireRole: () => guard() }));
vi.mock('@/lib/hdpm-web-admin', () => ({ webAdminFetch: (...args: unknown[]) => webAdminFetch(...args) }));

import { GET, POST, PATCH } from '@/app/api/admin/leads/[...path]/route';

const ctx = (path: string) => ({ params: Promise.resolve({ path: path.split('/') }) });
const req = (method: string, url: string, body?: string) => new NextRequest(`https://os.example.com${url}`, { method, body });

describe('leads admin proxy', () => {
  beforeEach(() => {
    guard.mockResolvedValue({ ok: true, email: 'lisa@highdesertpm.com', role: 'admin' });
    webAdminFetch.mockReset();
    webAdminFetch.mockResolvedValue(Response.json({ ok: true }));
  });

  it('requires an admin', async () => {
    guard.mockResolvedValue({ ok: false, response: Response.json({ error: 'no' }, { status: 403 }) });
    expect((await GET(req('GET', '/api/admin/leads/list'), ctx('list'))).status).toBe(403);
    expect(webAdminFetch).not.toHaveBeenCalled();
  });

  it('forwards list filters and allowlisted writes as the acting admin', async () => {
    await GET(req('GET', '/api/admin/leads/list?view=open&q=ana&evil=1'), ctx('list'));
    expect(webAdminFetch).toHaveBeenLastCalledWith('/leads?view=open&q=ana', 'lisa@highdesertpm.com', { method: 'GET', body: undefined });
    await POST(req('POST', '/api/admin/leads/9/notes', '{"body":"hi"}'), ctx('9/notes'));
    expect(webAdminFetch).toHaveBeenLastCalledWith('/leads/9/notes', 'lisa@highdesertpm.com', { method: 'POST', body: '{"body":"hi"}' });
  });

  it('rejects unknown paths and methods', async () => {
    for (const [handler, method, path] of [[GET, 'GET', '../hiring'], [PATCH, 'PATCH', 'list'], [POST, 'POST', '9'], [GET, 'GET', 'x/notes']] as const) {
      expect((await handler(req(method, '/api/admin/leads/x'), ctx(path))).status).toBe(404);
    }
    expect(webAdminFetch).not.toHaveBeenCalled();
  });
});
