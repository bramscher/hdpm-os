/**
 * Review requests — IO: gather candidates from AppFolio + work_orders,
 * propose them into review_request, and send or skip on Craig's Slack taps.
 * Pure rules and copy live in lib/review-requests.ts.
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import { extractEmail } from '@/lib/appfolio';
import { getKpiConfig, v0FetchAll } from '@/lib/appfolio-kpi';
import { isGloballyKilled } from '@/lib/agents/config';
import { sendEmail } from '@/lib/agents/channels/email';
import {
  ASK_COOLDOWN_DAYS,
  PROPOSAL_TTL_DAYS,
  buildReviewEmail,
  finalizeCandidates,
  pacificDate,
  pickOwnerCandidates,
  pickTenantCandidates,
  reviewUrl,
  type CompletedWorkOrder,
  type OwnerProperty,
  type ReviewCandidate,
  type ReviewReason,
  type TenantFact,
} from '@/lib/review-requests';

type Raw = Record<string, unknown>;
const ALL = { 'filters[LastUpdatedAtFrom]': '1970-01-01T00:00:00Z' };
const DAY = 86_400_000;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function tenantFact(r: Raw): TenantFact | null {
  const id = str(r.Id);
  if (!id || r.HiddenAt) return null;
  const addresses = Array.isArray(r.Addresses) ? (r.Addresses as Raw[]) : [];
  const a = addresses.find((x) => x?.IsPrimary) ?? addresses[0];
  return {
    id,
    firstName: str(r.FirstName),
    lastName: str(r.LastName),
    email: extractEmail(r),
    propertyId: str(r.PropertyId),
    unitId: str(r.UnitId),
    status: str(r.Status),
    primary: r.PrimaryTenant === true,
    moveInOn: str(r.MoveInOn),
    leaseStartDate: str(r.LeaseStartDate),
    leaseSignedDate: str(r.LeaseSignedDate),
    address: a ? [str(a.Address1), str(a.Address2)].filter(Boolean).join(' ') || null : null,
  };
}

function primaryEmail(o: Raw | undefined): string | null {
  if (!o) return null;
  const list = Array.isArray(o.Emails) ? (o.Emails as Raw[]) : [];
  const p = list.find((e) => e?.IsPrimary) ?? list[0];
  return str(p?.EmailAddress) ?? str(o.Email);
}

/** Properties whose management started 90–104 days ago, with their current owners. */
async function ownerProperties(today: string): Promise<OwnerProperty[]> {
  const config = getKpiConfig();
  if (!config) throw new Error('AppFolio API credentials not configured');
  // Sequential: the v0 API 429s readily.
  const properties = await v0FetchAll<Raw>('/properties', ALL, config, 1000, 10);
  const startFloor = new Date(Date.parse(today) - 104 * DAY).toISOString().slice(0, 10);
  const fresh = properties.filter((p) => {
    const start = str(p.ManagementStartDate);
    return !p.HiddenAt && !p.ManagementEndDate && !!start && start.slice(0, 10) >= startFloor;
  });
  if (!fresh.length) return [];
  const groups = await v0FetchAll<Raw>('/owner_groups', ALL, config, 1000, 20);
  const owners = await v0FetchAll<Raw>('/owners', ALL, config, 1000, 10);
  const ownerById = new Map(owners.map((o) => [str(o.Id), o]));
  return fresh.map((p) => {
    const group = groups.find((g) => g.Current === true && g.PropertyId === p.Id);
    const members = Array.isArray(group?.Owners) ? (group!.Owners as Raw[]) : [];
    return {
      id: str(p.Id)!,
      address: [str(p.Address1), str(p.City)].filter(Boolean).join(', ') || str(p.Name),
      managementStartDate: str(p.ManagementStartDate),
      owners: members.map((m) => {
        const id = str(m.OwnerId) ?? str(m.Id) ?? '';
        const person = [str(m.FirstName), str(m.LastName)].filter(Boolean).join(' ');
        const name = (m.IsCompany ? str(m.CompanyName) || person : person || str(m.CompanyName)) || 'Owner';
        return {
          id,
          name,
          firstName: m.IsCompany ? null : str(m.FirstName),
          email: primaryEmail(ownerById.get(id)) ?? str(m.Email),
        };
      }).filter((o) => o.id),
    };
  });
}

export async function gatherReviewCandidates(now: Date): Promise<ReviewCandidate[]> {
  const config = getKpiConfig();
  if (!config) throw new Error('AppFolio API credentials not configured');
  const today = pacificDate(now);
  const db = getSupabaseAdmin();

  const since = new Date(now.getTime() - 10 * DAY).toISOString().slice(0, 10);
  const { data: wos, error } = await db
    .from('work_orders')
    .select('id, wo_number, property_id, unit_id, property_name, property_address, description, completed_date, canceled_date, is_turn, appfolio_recurring')
    .gte('completed_date', since);
  if (error) throw new Error(`work_orders: ${error.message}`);

  const tenants = (await v0FetchAll<Raw>('/tenants', ALL, config, 1000, 20))
    .map(tenantFact)
    .filter((t): t is TenantFact => t !== null);
  const properties = await ownerProperties(today);

  return [
    ...pickTenantCandidates({ tenants, workOrders: (wos ?? []) as CompletedWorkOrder[], today }),
    ...pickOwnerCandidates({ properties, today }),
  ];
}

export interface ReviewRequestRecord {
  id: string;
  audience: 'tenant' | 'owner';
  reason: ReviewReason;
  appfolio_contact_id: string;
  name: string;
  first_name: string | null;
  email: string;
  property: string | null;
  detail: string | null;
  subject_ref: string;
  status: 'proposed' | 'sending' | 'sent' | 'skipped' | 'failed' | 'expired';
  batch_date: string;
  decided_by: string | null;
  decided_at: string | null;
  error: string | null;
  created_at: string;
}

/**
 * Propose today's asks. Expires stale proposals first, skips anyone asked
 * within a year, and inserts only rows that don't already exist.
 */
export async function proposeReviewRequests(
  now: Date,
  opts: { dryRun?: boolean } = {}
): Promise<{ candidates: ReviewCandidate[]; inserted: ReviewRequestRecord[] }> {
  const db = getSupabaseAdmin();
  const batchDate = pacificDate(now);

  if (!opts.dryRun) {
    const { error } = await db
      .from('review_request')
      .update({ status: 'expired' })
      .eq('status', 'proposed')
      .lt('created_at', new Date(now.getTime() - PROPOSAL_TTL_DAYS * DAY).toISOString());
    if (error) throw new Error(`review_request expire: ${error.message}`);
  }

  const { data: recent, error: recentError } = await db
    .from('review_request')
    .select('email')
    .in('status', ['proposed', 'sending', 'sent'])
    .gte('created_at', new Date(now.getTime() - ASK_COOLDOWN_DAYS * DAY).toISOString());
  if (recentError) throw new Error(`review_request: ${recentError.message}`);

  const candidates = finalizeCandidates(
    await gatherReviewCandidates(now),
    new Set((recent ?? []).map((r) => String(r.email).toLowerCase()))
  );
  if (opts.dryRun || !candidates.length) return { candidates, inserted: [] };

  const { data, error } = await db
    .from('review_request')
    .upsert(
      candidates.map((c) => ({
        audience: c.audience,
        reason: c.reason,
        appfolio_contact_id: c.contactId,
        name: c.name,
        first_name: c.firstName,
        email: c.email,
        property: c.property,
        detail: c.detail,
        subject_ref: c.subjectRef,
        batch_date: batchDate,
      })),
      { onConflict: 'reason,appfolio_contact_id,subject_ref', ignoreDuplicates: true }
    )
    .select('*');
  if (error) throw new Error(`review_request insert: ${error.message}`);
  return { candidates, inserted: (data ?? []) as ReviewRequestRecord[] };
}

/** Sends stay off outside production; REVIEW_REQUESTS_DRYRUN=1 pauses them there too. */
export function reviewSendsBlocked(): string | null {
  if (process.env.VERCEL_ENV !== 'production') return 'Review emails only send from production.';
  if (process.env.REVIEW_REQUESTS_DRYRUN === '1') return 'Review emails are paused (REVIEW_REQUESTS_DRYRUN=1).';
  return null;
}

function tapTime(now: Date): string {
  return now.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });
}

/** The note a decided row shows on the card in place of its buttons. */
export function decidedNote(row: Pick<ReviewRequestRecord, 'status' | 'decided_by' | 'decided_at' | 'error'>): string | null {
  const by = row.decided_by ? ` by ${row.decided_by}` : '';
  const at = row.decided_at ? ` ${tapTime(new Date(row.decided_at))}` : '';
  switch (row.status) {
    case 'sent': return `:white_check_mark: Sent${by}${at}`;
    case 'skipped': return `:no_entry_sign: Skipped${by}${at}`;
    case 'sending': return `:hourglass: Sending${by}${at}`;
    case 'failed': return `:warning: Not sent: ${row.error ?? 'unknown error'}`;
    case 'expired': return ':zzz: Expired (older than two weeks)';
    default: return null;
  }
}

export interface ReviewDecision {
  op: 'send' | 'skip';
  ids: string[];
}

/**
 * Apply a tap (one row, or every row on a card). Rows are claimed with a status='proposed' guard so a double
 * tap can never email anyone twice. Returns a note per row for the card.
 */
export async function decideReviewRequests(
  decision: ReviewDecision,
  actor: string,
  now = new Date()
): Promise<{ notes: Map<string, string>; error?: string }> {
  const db = getSupabaseAdmin();
  const notes = new Map<string, string>();

  if (decision.op === 'send') {
    const url = reviewUrl();
    const blocked = !url
      ? 'Set GOOGLE_PLACE_ID (or GOOGLE_REVIEW_URL) in HDPM OS before sending.'
      : reviewSendsBlocked() ?? ((await isGloballyKilled()) ? 'Agent messaging is paused (kill switch).' : null);
    if (blocked) return { notes, error: blocked };
  }

  if (!decision.ids.length) return { notes };
  const { data: claimed, error } = await db
    .from('review_request')
    .update({
      status: decision.op === 'send' ? 'sending' : 'skipped',
      decided_by: actor,
      decided_at: now.toISOString(),
    })
    .eq('status', 'proposed')
    .gte('created_at', new Date(now.getTime() - PROPOSAL_TTL_DAYS * DAY).toISOString())
    .in('id', decision.ids)
    .select('*');
  if (error) return { notes, error: error.message };

  for (const row of (claimed ?? []) as ReviewRequestRecord[]) {
    if (decision.op === 'skip') {
      notes.set(row.id, decidedNote(row)!);
      continue;
    }
    const email = buildReviewEmail(
      { reason: row.reason, firstName: row.first_name, property: row.property, detail: row.detail },
      reviewUrl()!
    );
    const outcome = await sendEmail({
      to: row.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      from: process.env.REVIEW_EMAIL_FROM || 'High Desert Property Management <info@highdesertpm.com>',
      replyTo: process.env.REVIEW_REPLY_TO || 'info@highdesertpm.com',
    });
    const update =
      outcome.status === 'sent'
        ? { status: 'sent', sent_at: new Date().toISOString(), message_id: outcome.message_id ?? null, error: null }
        : { status: 'failed', error: outcome.error ?? 'send failed' };
    const { error: saveError } = await db.from('review_request').update(update).eq('id', row.id);
    if (saveError) console.error('[review-requests] status save failed:', row.id, saveError.message);
    notes.set(row.id, decidedNote({ ...row, ...update } as ReviewRequestRecord)!);
  }

  // Rows this tap didn't claim (already decided elsewhere, or expired): show their current state.
  const missing = decision.ids.filter((id) => !notes.has(id));
  if (missing.length) {
    const { data } = await db.from('review_request').select('*').in('id', missing);
    for (const row of (data ?? []) as ReviewRequestRecord[]) {
      notes.set(row.id, decidedNote(row) ?? ':zzz: Expired (older than two weeks)');
    }
  }
  return { notes };
}
