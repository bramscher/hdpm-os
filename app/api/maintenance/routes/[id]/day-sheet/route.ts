import { NextRequest, NextResponse } from 'next/server';
import { loadRoute, routeActor } from '@/lib/maintenance/route-server';
import { generateDaySheetPdf } from '@/lib/maintenance/day-sheet-pdf';
import { requireViewer } from '@/lib/maintenance/route-http';

/** GET — the printable day sheet for a published route. The scheduler or the route's own tech. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireViewer();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const found = await loadRoute(id);
  const actor = await routeActor(guard.email);
  // Same answer for "not found" and "not yours", so route ids can't be probed.
  if (!found || !(actor.office || actor.person.toLowerCase() === (found.plan.assigned_tech || '').toLowerCase())) {
    return NextResponse.json({ error: 'Route not found' }, { status: 404 });
  }
  const pdf = generateDaySheetPdf(found.route);
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="Day sheet ${found.route.tech} ${found.route.routeDate}.pdf"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
