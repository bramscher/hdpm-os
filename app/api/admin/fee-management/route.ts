import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { fetchFeeFacts } from '@/lib/fee-management/appfolio';
import {
  DEFAULT_DOOR_SCHEDULE,
  DEFAULT_RAISE_FLOOR,
  DEFAULT_WEIGHTS,
  parseDoorSchedule,
  parseRaiseFloor,
  parseWeights,
  type Agreement,
  type CampaignEntry,
  type CampaignStatus,
  type FeeFacts,
} from '@/lib/fee-management/model';
import { DEFAULT_FEE_SCHEDULE, parseFeeSchedule } from '@/lib/fee-management/fee-schedule';

export const maxDuration = 120;

const ORG = 'hdpm';
const FACTS_KEY = 'fee_management_facts';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * GET /api/admin/fee-management[?refresh=1]
 * AppFolio facts (cached daily in kpi_snapshots; ?refresh=1 re-pulls) plus
 * the app-owned config, agreement overrides and campaign rows.
 */
export async function GET(request: NextRequest) {
  const guard = await requireRole('admin');
  if (!guard.ok) return guard.response;
  const db = getSupabaseAdmin();
  const refresh = request.nextUrl.searchParams.get('refresh') === '1';

  let facts: FeeFacts | null = null;
  let capturedAt: string | null = null;
  if (!refresh) {
    const { data } = await db
      .from('kpi_snapshots')
      .select('value, captured_at')
      .eq('kpi_name', FACTS_KEY)
      .order('captured_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data && Date.now() - new Date(data.captured_at).getTime() < MAX_AGE_MS) {
      facts = data.value as FeeFacts;
      capturedAt = data.captured_at;
    }
  }
  if (!facts) {
    try {
      facts = await fetchFeeFacts();
    } catch (err) {
      console.error('[fee-management] AppFolio pull failed:', err);
      return NextResponse.json({ error: 'Could not load AppFolio data. Try again in a minute.' }, { status: 502 });
    }
    const { data } = await db
      .from('kpi_snapshots')
      .insert({ kpi_name: FACTS_KEY, value: facts })
      .select('captured_at')
      .single();
    capturedAt = data?.captured_at ?? new Date().toISOString();
    // Owner contact info lives in this payload — keep only the latest copy.
    if (data) await db.from('kpi_snapshots').delete().eq('kpi_name', FACTS_KEY).lt('captured_at', data.captured_at);
  }

  const [config, agreements, campaign] = await Promise.all([
    db.from('fee_campaign_config').select('key, value').eq('org_id', ORG),
    db.from('property_agreement').select('*').eq('org_id', ORG),
    db.from('fee_campaign').select('*').eq('org_id', ORG),
  ]);
  const err = config.error || agreements.error || campaign.error;
  if (err) {
    console.error('[fee-management] Supabase read failed:', err);
    return NextResponse.json({ error: 'Could not load fee management tables' }, { status: 503 });
  }
  const cfg = new Map((config.data ?? []).map((r) => [r.key as string, r.value]));

  return NextResponse.json({
    facts,
    capturedAt,
    schedule: parseDoorSchedule(cfg.get('door_schedule')) ?? DEFAULT_DOOR_SCHEDULE,
    raiseFloor: parseRaiseFloor(cfg.get('raise_floor')) ?? DEFAULT_RAISE_FLOOR,
    feeSchedule: parseFeeSchedule(cfg.get('fee_schedule')) ?? DEFAULT_FEE_SCHEDULE,
    weights: parseWeights(cfg.get('priority_weights')) ?? DEFAULT_WEIGHTS,
    agreements: (agreements.data ?? []).map(
      (a): Agreement => ({
        propertyId: a.appfolio_property_id,
        startDate: a.start_date,
        endDate: a.end_date,
        autoRenew: a.auto_renew,
        noticeDays: a.notice_days,
        notes: a.notes,
      })
    ),
    campaign: (campaign.data ?? []).map(
      (c): CampaignEntry => ({
        ownerSetKey: c.owner_set_key,
        status: c.status as CampaignStatus,
        newFeePct: c.new_fee_pct != null ? Number(c.new_fee_pct) : null,
        effectiveDate: c.effective_date,
        assignedTo: c.assigned_to,
        notes: c.notes,
        updatedAt: c.updated_at,
      })
    ),
  });
}
