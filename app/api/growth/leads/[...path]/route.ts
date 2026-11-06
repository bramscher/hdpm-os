import { NextRequest, NextResponse } from 'next/server';
import { requireSection } from '@/lib/require-role';
import { webAdminFetch } from '@/lib/hdpm-web-admin';
import { BOARD_FEED_PATH } from '@/lib/growth/lead-api';

/**
 * Growth board proxy to the website's owner-lead endpoints. Only these pass:
 *   GET   /api/growth/leads/board        → owner leads in board stages
 *   GET   /api/growth/leads/:id          → lead detail + activity history
 *   PATCH /api/growth/leads/:id          → status, expected doors, assignee, follow-up
 *   POST  /api/growth/leads/:id/notes    → add a note
 * The website enforces which status moves are allowed; its error passes through.
 */
const ROUTES: { method: string; pattern: RegExp; target: (m: RegExpMatchArray) => string }[] = [
  { method: 'GET', pattern: /^board$/, target: () => BOARD_FEED_PATH },
  { method: 'GET', pattern: /^(\d+)$/, target: (m) => `/leads/${m[1]}` },
  { method: 'PATCH', pattern: /^(\d+)$/, target: (m) => `/leads/${m[1]}` },
  { method: 'POST', pattern: /^(\d+)\/notes$/, target: (m) => `/leads/${m[1]}/notes` },
];

async function handle(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const guard = await requireSection('growth');
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

  const body = request.method === 'GET' ? undefined : await request.text();
  const res = await webAdminFetch(target, guard.email, { method: request.method, body: body || undefined });
  const data = await res.json().catch(() => ({ error: 'Unexpected response from the website' }));
  return NextResponse.json(data, { status: res.status });
}

export { handle as GET, handle as POST, handle as PATCH };
