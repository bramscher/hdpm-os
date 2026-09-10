import { NextRequest, NextResponse } from 'next/server';
import { requireReferralAdmin } from '@/lib/referrals/admin';
import { getLeadWithEvents, setLeadStage, resolveDedupe, linkAppFolio } from '@/lib/referrals/leads';
import { isLeadStage, type LeadStage } from '@/lib/referrals/types';

/** GET /api/partners/admin/leads/:id — lead + full event history. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireReferralAdmin();
  if (!guard.ok) return guard.response;
  try {
    const { id } = await params;
    const result = await getLeadWithEvents(id);
    if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

/**
 * PATCH /api/partners/admin/leads/:id — one of:
 *   { action: 'stage', stage }
 *   { action: 'dedupe', decision: 'confirmed'|'cleared', reason? }
 *   { action: 'link_appfolio', appfolio_owner_id?, appfolio_property_ids?, doors_under_mgmt? }
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireReferralAdmin();
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const { id } = await params;
    switch (body.action) {
      case 'stage': {
        if (!isLeadStage(body.stage)) return NextResponse.json({ error: 'invalid stage' }, { status: 400 });
        const lead = await setLeadStage(id, body.stage as LeadStage, guard.email);
        return NextResponse.json({ lead });
      }
      case 'dedupe': {
        if (body.decision !== 'confirmed' && body.decision !== 'cleared') {
          return NextResponse.json({ error: 'decision must be confirmed or cleared' }, { status: 400 });
        }
        await resolveDedupe(id, body.decision, guard.email, typeof body.reason === 'string' ? body.reason : undefined);
        return NextResponse.json({ ok: true });
      }
      case 'link_appfolio': {
        await linkAppFolio(
          id,
          {
            appfolio_owner_id: typeof body.appfolio_owner_id === 'string' ? body.appfolio_owner_id : null,
            appfolio_property_ids: Array.isArray(body.appfolio_property_ids)
              ? (body.appfolio_property_ids.filter((x) => typeof x === 'string') as string[])
              : null,
            doors_under_mgmt: typeof body.doors_under_mgmt === 'number' ? body.doors_under_mgmt : null,
          },
          guard.email
        );
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: 'unknown action' }, { status: 400 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[referrals] lead PATCH failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
