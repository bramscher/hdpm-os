import { NextRequest, NextResponse } from 'next/server';
import { requireSection } from '@/lib/require-role';
import { webAdminFetch } from '@/lib/hdpm-web-admin';

// Resending applications since a date emails each one in turn on the website.
export const maxDuration = 300;

/**
 * Admin proxy to the website's hiring endpoints. Only these shapes pass:
 *   GET   /api/admin/hiring/overview
 *   PATCH /api/admin/hiring/settings
 *   GET   /api/admin/hiring/applications/:id?kind=resume|video   (private file link)
 *   POST  /api/admin/hiring/applications/:id                     (resend email)
 *   PATCH /api/admin/hiring/jobs/:id                             (availability)
 */
const ROUTES: { method: string; pattern: RegExp; target: (m: RegExpMatchArray) => string }[] = [
  { method: 'GET', pattern: /^overview$/, target: () => '/hiring' },
  { method: 'PATCH', pattern: /^settings$/, target: () => '/hiring/settings' },
  { method: 'GET', pattern: /^applications\/(\d+)$/, target: (m) => `/hiring/applications/${m[1]}` },
  { method: 'POST', pattern: /^applications\/(\d+)$/, target: (m) => `/hiring/applications/${m[1]}` },
  { method: 'PATCH', pattern: /^jobs\/(\d+)$/, target: (m) => `/hiring/jobs/${m[1]}` },
];

async function handle(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const guard = await requireSection('hiring');
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

  const kind = request.nextUrl.searchParams.get('kind');
  if (kind === 'resume' || kind === 'video') target += `?kind=${kind}`;

  const body = request.method === 'GET' ? undefined : await request.text();
  const res = await webAdminFetch(target, guard.email, { method: request.method, body: body || undefined });
  const data = await res.json().catch(() => ({ error: 'Unexpected response from the website' }));
  return NextResponse.json(data, { status: res.status });
}

export { handle as GET, handle as POST, handle as PATCH };
