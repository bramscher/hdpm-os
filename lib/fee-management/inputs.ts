/**
 * Everything the fee math needs, loaded server-side: AppFolio facts (cached
 * daily), app-owned config, agreement overrides, campaign rows, and the
 * trailing-12-month volumes (cached daily). Shared by the Fee Management API
 * and the fee change risk list in Knowledge Capture.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { loadFeeFacts } from './facts-cache';
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
  type DoorBand,
  type FeeFacts,
  type PriorityWeights,
  type RaiseFloor,
} from './model';
import { DEFAULT_FEE_SCHEDULE, parseFeeSchedule, type FeeScheduleConfig } from './fee-schedule';
import { fetchFeeVolumes, type FeeVolumes } from './volumes';

const ORG = 'hdpm';
const VOLUMES_KEY = 'fee_schedule_volumes';
const VOLUMES_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface FeeInputs {
  facts: FeeFacts;
  capturedAt: string;
  schedule: DoorBand[];
  raiseFloor: RaiseFloor;
  feeSchedule: FeeScheduleConfig;
  weights: PriorityWeights;
  agreements: Agreement[];
  campaign: CampaignEntry[];
}

/** Throws 'appfolio' or 'tables' (as Error.message) so callers can word the error. */
export async function loadFeeInputs(db: SupabaseClient, opts: { refresh?: boolean } = {}): Promise<FeeInputs> {
  let facts: FeeFacts;
  let capturedAt: string;
  try {
    ({ facts, capturedAt } = await loadFeeFacts(db, opts));
  } catch (err) {
    console.error('[fee-management] AppFolio pull failed:', err);
    throw new Error('appfolio');
  }

  const [config, agreements, campaign] = await Promise.all([
    db.from('fee_campaign_config').select('key, value').eq('org_id', ORG),
    db.from('property_agreement').select('*').eq('org_id', ORG),
    db.from('fee_campaign').select('*').eq('org_id', ORG),
  ]);
  const err = config.error || agreements.error || campaign.error;
  if (err) {
    console.error('[fee-management] Supabase read failed:', err);
    throw new Error('tables');
  }
  const cfg = new Map((config.data ?? []).map((r) => [r.key as string, r.value]));

  return {
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
        agreementUrl: a.agreement_url ?? null,
        lastRenewedOn: a.last_renewed_on ?? null,
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
  };
}

/** Trailing-12-month fee volumes, cached daily in kpi_snapshots; `refresh` re-pulls. */
export async function loadFeeVolumes(
  db: SupabaseClient,
  opts: { refresh?: boolean } = {}
): Promise<{ volumes: FeeVolumes; capturedAt: string }> {
  if (!opts.refresh) {
    const { data } = await db
      .from('kpi_snapshots')
      .select('value, captured_at')
      .eq('kpi_name', VOLUMES_KEY)
      .order('captured_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data && Date.now() - new Date(data.captured_at).getTime() < VOLUMES_MAX_AGE_MS) {
      return { volumes: data.value as FeeVolumes, capturedAt: data.captured_at };
    }
  }
  const volumes = await fetchFeeVolumes();
  const { data } = await db.from('kpi_snapshots').insert({ kpi_name: VOLUMES_KEY, value: volumes }).select('captured_at').single();
  return { volumes, capturedAt: data?.captured_at ?? new Date().toISOString() };
}
