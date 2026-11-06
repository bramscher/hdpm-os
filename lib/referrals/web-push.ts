/**
 * One pipeline: push partner referrals into the website's owner Leads so the
 * /growth/pipeline board shows them, with the referring partner on the card.
 *
 * - Only referrals without a website lead are pushed. Leads that came in from
 *   the website intake already carry hdpm_web_lead_id and are skipped.
 * - Referrals without an email can't be pushed (the website needs one); they
 *   are counted as "needs email" and pushed once an email is added.
 * - The referral id is the idempotency key: pushing the same referral twice
 *   returns the same website lead.
 * - A push never throws: failures are recorded as a 'web_push_failed' event on
 *   the referral and retried by the admin push route (pushUnlinkedReferrals).
 *
 * WEBSITE CONTRACT: the request/response types below are the only copy of the
 * website's referral endpoint in hdpm-os. Change them here if it changes.
 */
import { getSupabaseAdmin } from '@/lib/supabase';
import { webAdminFetch } from '@/lib/hdpm-web-admin';
import { BACKFILL_STAGES } from './types';

/** Append-only lead event (same table and shape as leads.ts writeLeadEvent; kept local to avoid an import cycle). */
async function writeLeadEvent(leadId: string, eventType: string, payload: Record<string, unknown>, actor: string) {
  const { error } = await getSupabaseAdmin().from('referral_lead_event').insert({ lead_id: leadId, event_type: eventType, payload, actor });
  if (error) console.error(`[referrals] lead event ${eventType} failed:`, error.message);
}

/** Website path (relative to /api/os): an upsert keyed by the referral id, so resends are safe. */
export const webReferralPath = (referralId: string) => `/leads/referrals/${encodeURIComponent(referralId)}`;

/** Actor for automatic pushes on partner submit (the website requires an @highdesertpm.com actor). */
export const PORTAL_ACTOR = 'partner-portal@highdesertpm.com';

/** PUT /api/os/leads/referrals/{referralId} body. */
export interface WebReferralRequest {
  prospectName: string;
  /** Required by the website (Lead.email is NOT NULL); without it the website answers 422 email_required. */
  prospectEmail: string;
  prospectPhone?: string | null;
  propertyAddress?: string | null;
  town?: string | null;
  /** Becomes the website lead's expectedDoors. */
  unitCount?: number | null;
  notes?: string | null;
  /** null = organic. */
  partner: { id: string; name: string; company?: string | null } | null;
  refCode?: string | null;
  landingPage?: string | null;
  utm?: WebUtm | null;
}

export type WebUtm = Record<'source' | 'medium' | 'campaign' | 'term' | 'content', string | null>;

/** Stored utm may use utm_source or source keys; the website reads source/medium/campaign/term/content. Pure. */
export function toWebUtm(utm: Record<string, unknown> | null): WebUtm | null {
  if (!utm || typeof utm !== 'object') return null;
  const pick = (k: string) => {
    const v = utm[k] ?? utm[`utm_${k}`];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };
  const out: WebUtm = { source: pick('source'), medium: pick('medium'), campaign: pick('campaign'), term: pick('term'), content: pick('content') };
  return Object.values(out).some(Boolean) ? out : null;
}

export interface WebReferralResponse {
  /** created: new owner lead. existing: already pushed. linked: matched an existing owner lead by email/phone. */
  outcome: 'created' | 'existing' | 'linked';
  leadId: number;
  created?: boolean;
}

export interface ReferralRow {
  id: string;
  partner_id: string | null;
  prospect_name: string;
  prospect_email: string | null;
  prospect_phone: string | null;
  property_addresses: string[] | null;
  unit_count: number | null;
  notes: string | null;
  ref_code: string | null;
  landing_page: string | null;
  utm: Record<string, unknown> | null;
  hdpm_web_lead_id: string | null;
  dup_status: string | null;
  stage: string;
  created_at: string;
}

export interface PartnerRow {
  id: string;
  display_name: string;
  company: string | null;
}

export type PushSkip = 'already_linked' | 'needs_email' | 'stage';

/**
 * Why a referral can't be pushed yet, or null when it can. Pure.
 * needs_email: the website needs an email. The referral stays in hdpm-os, is
 * counted as "not on the board: needs email" for admins, and is pushed as soon
 * as an email is added (admin lead PATCH) or by the retry route.
 */
export function pushSkipReason(lead: Pick<ReferralRow, 'hdpm_web_lead_id' | 'prospect_email' | 'stage'>): PushSkip | null {
  if (lead.hdpm_web_lead_id) return 'already_linked';
  // Only referrals still being worked; see BACKFILL_STAGES.
  if (!(BACKFILL_STAGES as readonly string[]).includes(lead.stage)) return 'stage';
  if (!lead.prospect_email?.trim()) return 'needs_email';
  return null;
}

/** Build the website request from a referral and its partner (null = organic). Pure; call only when pushSkipReason is null. */
export function toWebReferral(lead: ReferralRow, partner: PartnerRow | null): WebReferralRequest {
  const address = (lead.property_addresses ?? []).map((a) => a.trim()).filter(Boolean);
  const unitCount = Number.isSafeInteger(lead.unit_count) && (lead.unit_count as number) >= 0 ? (lead.unit_count as number) : null;
  return {
    prospectName: lead.prospect_name.trim(),
    prospectEmail: (lead.prospect_email ?? '').trim(),
    prospectPhone: lead.prospect_phone?.trim() || null,
    propertyAddress: address[0] ?? null,
    town: null,
    unitCount,
    // Extra addresses ride along in the notes so none are lost.
    notes: [lead.notes?.trim(), address.length > 1 ? `Other properties: ${address.slice(1).join('; ')}` : null].filter(Boolean).join('\n\n') || null,
    partner: partner ? { id: partner.id, name: partner.display_name, company: partner.company } : null,
    refCode: lead.ref_code,
    landingPage: lead.landing_page,
    utm: toWebUtm(lead.utm),
  };
}

export type PushResult =
  | { ok: true; websiteLeadId: string; outcome: WebReferralResponse['outcome'] }
  | { ok: false; skipped: PushSkip }
  | { ok: false; error: string };

const SELECT = 'id, partner_id, prospect_name, prospect_email, prospect_phone, property_addresses, unit_count, notes, ref_code, landing_page, utm, hdpm_web_lead_id, dup_status, stage, created_at';

/** Push one referral to the website. Never throws. */
export async function pushReferralToWebsite(leadId: string, actor: string): Promise<PushResult> {
  try {
    const db = getSupabaseAdmin();
    const { data: lead, error } = await db.from('referral_lead').select(SELECT).eq('id', leadId).eq('org_id', 'hdpm').maybeSingle();
    if (error) throw new Error(error.message);
    if (!lead) return { ok: false, error: 'Referral not found' };
    const skip = pushSkipReason(lead as ReferralRow);
    if (skip) return { ok: false, skipped: skip };

    const row = lead as ReferralRow;
    let partner: PartnerRow | null = null;
    if (row.partner_id) {
      const { data: p, error: pErr } = await db
        .from('referral_partner')
        .select('id, display_name, company')
        .eq('id', row.partner_id)
        .eq('org_id', 'hdpm')
        .maybeSingle();
      if (pErr) throw new Error(pErr.message);
      partner = (p as PartnerRow | null) ?? null;
    }

    const res = await webAdminFetch(webReferralPath(leadId), actor, {
      method: 'PUT',
      body: JSON.stringify(toWebReferral(row, partner)),
    });
    const body = (await res.json().catch(() => ({}))) as Partial<WebReferralResponse> & { error?: string; code?: string };
    if (res.status === 422 && body.code === 'email_required') return { ok: false, skipped: 'needs_email' };
    if (!res.ok || !body.leadId) throw new Error(body.error || `Website returned ${res.status}`);

    const websiteLeadId = String(body.leadId);
    const outcome = body.outcome ?? 'created';
    // Only fill the link if nobody else did meanwhile.
    const { error: uErr } = await db
      .from('referral_lead')
      .update({
        hdpm_web_lead_id: websiteLeadId,
        // Linked = the website already had this owner (first touch keeps attribution); flag it for review.
        ...(outcome === 'linked' ? { dup_status: 'suspected' } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', leadId)
      .is('hdpm_web_lead_id', null);
    if (uErr) throw new Error(`saving the website lead id: ${uErr.message}`);
    await writeLeadEvent(leadId, 'web_pushed', { website_lead_id: websiteLeadId, outcome }, actor);
    return { ok: true, websiteLeadId, outcome };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[referrals] push to website failed for ${leadId}:`, message);
    await writeLeadEvent(leadId, 'web_push_failed', { error: message.slice(0, 500) }, actor).catch(() => {});
    return { ok: false, error: message };
  }
}

export { BACKFILL_STAGES };

export interface BackfillReport {
  dryRun: boolean;
  /** Rows looked at in this batch (unlinked, has email, backfill stage). */
  processed: number;
  pushed: number;
  failed: { id: string; error: string }[];
  /** Pass as ?after= to continue; null when this was the last batch. */
  nextCursor: string | null;
  /** Unlinked referrals in backfill stages with no email: not pushable until one is added (whole table, not this batch). */
  needsEmail: number;
  stages: readonly string[];
}

/**
 * Retry / backfill: referrals in BACKFILL_STAGES with an email and no website
 * lead, in batches ordered by id. The cursor (last id seen) always moves
 * forward, so a failing row never blocks later ones; rerun from the start to
 * retry failures. Dry run (the default) only counts. Sequential so the website
 * isn't flooded.
 */
export async function pushUnlinkedReferrals(
  actor: string,
  opts: { dryRun: boolean; limit?: number; after?: string | null }
): Promise<BackfillReport> {
  const db = getSupabaseAdmin();
  const limit = Math.min(Math.max(Math.floor(opts.limit ?? 200), 1), 500);
  let q = db
    .from('referral_lead')
    .select('id, prospect_email, hdpm_web_lead_id')
    .eq('org_id', 'hdpm')
    .is('hdpm_web_lead_id', null)
    .not('prospect_email', 'is', null)
    .in('stage', [...BACKFILL_STAGES]);
  if (opts.after) q = q.gt('id', opts.after);
  const { data, error } = await q.order('id', { ascending: true }).limit(limit);
  if (error) throw new Error(`referral_lead: ${error.message}`);

  const { data: noEmail, error: neErr } = await db
    .from('referral_lead')
    .select('id')
    .eq('org_id', 'hdpm')
    .is('hdpm_web_lead_id', null)
    .is('prospect_email', null)
    .in('stage', [...BACKFILL_STAGES]);
  if (neErr) throw new Error(`referral_lead: ${neErr.message}`);

  const rows = (data ?? []) as Pick<ReferralRow, 'id' | 'prospect_email' | 'hdpm_web_lead_id'>[];
  const report: BackfillReport = {
    dryRun: opts.dryRun,
    processed: rows.length,
    pushed: 0,
    failed: [],
    nextCursor: rows.length === limit ? rows[rows.length - 1].id : null,
    needsEmail: (noEmail ?? []).length,
    stages: BACKFILL_STAGES,
  };
  if (opts.dryRun) return report;
  for (const row of rows) {
    const r = await pushReferralToWebsite(row.id, actor);
    if (r.ok) report.pushed += 1;
    else if ('error' in r) report.failed.push({ id: row.id, error: r.error });
    // 'skipped' here means it was linked or lost its email meanwhile; nothing to do.
  }
  return report;
}
