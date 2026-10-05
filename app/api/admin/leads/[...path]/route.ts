import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/require-role';
import { webAdminFetch } from '@/lib/hdpm-web-admin';

/**
 * Admin proxy to the website's CRM lead endpoints. Only these shapes pass:
 *   GET   /api/admin/leads/list?view=&type=&q=&page=
 *   GET   /api/admin/leads/:id
 *   PATCH /api/admin/leads/:id          (status, follow-up, owner)
 *   POST  /api/admin/leads/:id/notes
 */
const ROUTES: { method: string; pattern: RegExp; target: (m: RegExpMatchArray) => string }[] = [
  { method: 'GET', pattern: /^list$/, target: () => '/leads' },
  { method: 'GET', pattern: /^(\d+)$/, target: (m) => `/leads/${m[1]}` },
  { method: 'PATCH', pattern: /^(\d+)$/, target: (m) => `/leads/${m[1]}` },
  { method: 'POST', pattern: /^(\d+)\/notes$/, target: (m) => `/leads/${m[1]}/notes` },
];
const LIST_PARAMS = ['view', 'type', 'q', 'page'];

async function handle(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const guard = await requireRole('admin');
  if (!guard.ok) return guard.response;

  const path = (await params).path.join('/');
  let target: string | null = null;
  for (const route of ROUTES) {
    const match = request.method === route.method ? path.match(route.pattern) : null;
    if (match) {
      target = route.target(match);
      break;
    }
  }
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (path === 'list') {
    const query = new URLSearchParams();
    for (const key of LIST_PARAMS) {
      const value = request.nextUrl.searchParams.get(key);
      if (value) query.set(key, value.slice(0, 100));
    }
    if (query.size) target += `?${query}`;
  }

  const body = request.method === 'GET' ? undefined : await request.text();
  const res = await webAdminFetch(target, guard.email, { method: request.method, body: body || undefined });
  const data = await res.json().catch(() => ({ error: 'Unexpected response from the website' }));
  return NextResponse.json(data, { status: res.status });
}

export { handle as GET, handle as POST, handle as PATCH };
