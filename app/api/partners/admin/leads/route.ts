import { NextRequest, NextResponse } from 'next/server';
import { requireReferralAdmin } from '@/lib/referrals/admin';
import { listLeads } from '@/lib/referrals/leads';
import { isLeadStage, type LeadSource, type LeadStage } from '@/lib/referrals/types';

/** GET /api/partners/admin/leads?stage=&source= — the pipeline. */
export async function GET(request: NextRequest) {
  const guard = await requireReferralAdmin();
  if (!guard.ok) return guard.response;
  const { searchParams } = new URL(request.url);
  const stage = searchParams.get('stage');
  const source = searchParams.get('source');
  try {
    const leads = await listLeads({
      stage: stage && isLeadStage(stage) ? (stage as LeadStage) : undefined,
      source: source === 'referral' || source === 'organic' ? (source as LeadSource) : undefined,
    });
    return NextResponse.json({ leads });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
