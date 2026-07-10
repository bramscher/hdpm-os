/**
 * Inspection tenant notices — AppFolio bulk-send bridge.
 *
 * Tenant correspondence must be LOGGED INSIDE AppFolio, and AppFolio has no API
 * to send messages. So instead of sending email ourselves, our app produces the
 * "inspections due this period" list (recipients + a ready-to-paste notice) that
 * staff send from Realm-X Assistant ("Send Bulk Email"), which records the
 * message on each tenant's AppFolio page. After sending, staff mark them sent so
 * we stop surfacing them.
 *
 * (If the AppFolio Realm-X ⇄ Claude connector turns out to expose a programmatic
 * "send tenant message" job, this becomes the place to drive it directly.)
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const COMPANY_NAME = 'High Desert Property Management';
const COMPANY_PHONE = '(541) 406-6409';

export interface NoticeInspectionRow {
  id: string;
  target_date: string | null;
  inspection_type: string | null;
  unit_name: string | null;
  resident_name: string | null;
  notice_email: string | null;
  notice_status: string | null;
  notice_attempts: number | null;
  notice_channel: string | null;
  notice_error: string | null;
  inspection_properties: {
    address_1: string | null;
    address_2: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    resident_name: string | null;
    tenant_email: string | null;
  } | null;
}

/** How a notice was (or will be) delivered. All channels log inside AppFolio. */
export type NoticeChannel = 'manual' | 'realmx_mcp' | 'email';

export interface DueNotice {
  id: string;
  target_date: string | null;
  resident_name: string;
  email: string | null;
  address: string;
  subject: string;
  body: string;
  /** Current dispatch state so senders/UI can show progress + retry failures. */
  status: string | null;
  attempts: number;
  channel: string | null;
  error: string | null;
}

export interface DueNoticesResult {
  count: number;
  with_email: number;
  missing_email: number;
  notices: DueNotice[];
}

function formatLongDate(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function addressOf(insp: NoticeInspectionRow): string {
  const p = insp.inspection_properties;
  const unit = insp.unit_name || p?.address_2;
  return (
    [p?.address_1, unit ? `Unit ${unit}` : null, p?.city, p?.state, p?.zip]
      .filter(Boolean)
      .join(', ') || 'your residence'
  );
}

/** Plain-text notice ready to paste into Realm-X Assistant bulk email. */
export function buildNoticeContent(insp: NoticeInspectionRow): { subject: string; body: string } {
  const address = addressOf(insp);
  const dateStr = insp.target_date ? formatLongDate(insp.target_date) : 'an upcoming date';
  const resident = insp.resident_name || insp.inspection_properties?.resident_name || 'Resident';
  const typeLabel =
    insp.inspection_type && insp.inspection_type.toLowerCase() !== 'routine'
      ? insp.inspection_type
      : 'routine';

  const subject = `Notice of Routine Property Inspection — ${dateStr}`;
  const body = [
    `Dear ${resident},`,
    '',
    `This is an advance notice that ${COMPANY_NAME} will conduct a ${typeLabel} inspection of your residence at ${address} on ${dateStr}.`,
    '',
    'Routine inspections occur about twice a year and help us keep the property well maintained. Our inspector will briefly walk through the unit to check its condition and note any maintenance needs. You are welcome to be present but do not need to be.',
    '',
    'Please make sure pets are secured and the unit is accessible on that day. If the scheduled date does not work, contact us as soon as possible and we will do our best to accommodate.',
    '',
    `Questions or need to reschedule? Call us at ${COMPANY_PHONE} or reply to this message.`,
    '',
    'Thank you,',
    COMPANY_NAME,
    COMPANY_PHONE,
  ].join('\n');

  return { subject, body };
}

/**
 * Scheduled inspections that still need a tenant notice: future target date,
 * not yet marked sent. Returns ready-to-send content + recipient email.
 */
/** Postgres "column does not exist" — the dispatch migration isn't applied yet. */
function isMissingColumn(err: { code?: string; message?: string } | null): boolean {
  return err?.code === '42703' || /column .* does not exist/i.test(err?.message ?? '');
}

// Rich dispatch columns land with 20260709_inspection_notice_dispatch.sql. Until
// that migration is applied we fall back to the legacy select so the live notice
// feature never breaks on a missing column.
const RICH_NOTICE_COLS =
  `id, target_date, inspection_type, unit_name, resident_name, notice_email,
   notice_status, notice_attempts, notice_channel, notice_error,
   inspection_properties ( address_1, address_2, city, state, zip, resident_name, tenant_email )`;
const LEGACY_NOTICE_COLS =
  `id, target_date, inspection_type, unit_name, resident_name, notice_email,
   notice_status,
   inspection_properties ( address_1, address_2, city, state, zip, resident_name, tenant_email )`;

export async function getDueNotices(
  supabase: SupabaseClient,
  options: { today?: Date; limit?: number; dispatchableOnly?: boolean } = {}
): Promise<DueNoticesResult> {
  const today = options.today ?? new Date();
  const todayStr = today.toISOString().split('T')[0];
  const limit = options.limit ?? 1000;

  const runQuery = (cols: string) => {
    let q = supabase
      .from('inspections')
      .select(cols)
      .eq('status', 'scheduled')
      .is('notice_sent_at', null)
      .not('target_date', 'is', null)
      .gte('target_date', todayStr)
      .order('target_date', { ascending: true })
      .limit(limit);
    // A machine sender (Realm-X routine) only wants notices it can actually send:
    // an email on file, not already handed off. Missing-email ones stay for staff.
    if (options.dispatchableOnly) q = q.not('notice_email', 'is', null);
    return q;
  };

  let { data, error } = await runQuery(RICH_NOTICE_COLS);
  if (error && isMissingColumn(error)) {
    ({ data, error } = await runQuery(LEGACY_NOTICE_COLS));
  }

  if (error) throw new Error(`Failed to load due notices: ${error.message}`);

  // Supabase may embed the FK join as an object or a single-element array — normalize.
  const rows: NoticeInspectionRow[] = (data || []).map((row) => {
    const raw = (row as { inspection_properties?: unknown }).inspection_properties;
    const prop = Array.isArray(raw) ? raw[0] ?? null : raw ?? null;
    return { ...(row as object), inspection_properties: prop } as NoticeInspectionRow;
  });

  const notices: DueNotice[] = rows.map((insp) => {
    const { subject, body } = buildNoticeContent(insp);
    return {
      id: insp.id,
      target_date: insp.target_date,
      resident_name: insp.resident_name || insp.inspection_properties?.resident_name || '',
      email: insp.notice_email || insp.inspection_properties?.tenant_email || null,
      address: addressOf(insp),
      subject,
      body,
      status: insp.notice_status ?? 'pending',
      attempts: insp.notice_attempts ?? 0,
      channel: insp.notice_channel ?? null,
      error: insp.notice_error ?? null,
    };
  });

  return {
    count: notices.length,
    with_email: notices.filter((n) => n.email).length,
    missing_email: notices.filter((n) => !n.email).length,
    notices,
  };
}

export type NoticeResultStatus = 'sent' | 'failed' | 'skipped';

export interface NoticeResult {
  id: string;
  status: NoticeResultStatus;
  channel?: NoticeChannel;
  message_id?: string | null;
  error?: string | null;
}

export interface RecordResultsSummary {
  sent: number;
  failed: number;
  skipped: number;
}

/**
 * Record the outcome of one dispatch pass. Sender-agnostic: the manual bridge
 * reports channel 'manual', the Realm-X routine reports 'realmx_mcp'. Failures
 * keep notice_sent_at null so the notice stays in the dispatch queue for retry.
 * Every touch bumps notice_attempts and stamps notice_last_attempt_at.
 */
export async function recordNoticeResults(
  supabase: SupabaseClient,
  results: NoticeResult[]
): Promise<RecordResultsSummary> {
  const summary: RecordResultsSummary = { sent: 0, failed: 0, skipped: 0 };
  if (!results.length) return summary;

  // One read for current attempt counts so we can increment per row. Tolerate
  // the pre-migration state where notice_attempts doesn't exist yet.
  const ids = results.map((r) => r.id);
  const attemptsById = new Map<string, number>();
  const { data: current, error: readErr } = await supabase
    .from('inspections')
    .select('id, notice_attempts')
    .in('id', ids);
  if (!readErr) {
    for (const r of current ?? []) {
      attemptsById.set(r.id as string, (r.notice_attempts as number) ?? 0);
    }
  }

  const now = new Date().toISOString();
  for (const r of results) {
    const attempts = (attemptsById.get(r.id) ?? 0) + 1;

    // Columns that predate the dispatch migration — always safe to write.
    const legacy: Record<string, unknown> = {};
    // Rich dispatch columns — only present after 20260709 migration.
    const rich: Record<string, unknown> = {
      notice_attempts: attempts,
      notice_last_attempt_at: now,
      notice_channel: r.channel ?? 'manual',
    };

    if (r.status === 'sent') {
      legacy.notice_status = 'sent';
      legacy.notice_sent_at = now;
      legacy.notice_message_id = r.message_id ?? null;
      rich.notice_error = null;
    } else if (r.status === 'failed') {
      // Pre-migration there's no 'failed' bucket; leave the legacy status as-is
      // (still pending) so it stays in the queue, and only note the error richly.
      rich.notice_status = 'failed';
      rich.notice_error = r.error ?? 'unknown error';
    } else {
      legacy.notice_status = 'skipped_no_email';
      rich.notice_error = r.error ?? null;
    }

    let { error } = await supabase
      .from('inspections')
      .update({ ...legacy, ...rich })
      .eq('id', r.id);
    if (error && isMissingColumn(error)) {
      // Dispatch migration not applied yet — persist the legacy fields only.
      // A 'failed' result has no legacy field (no pre-migration 'failed' state),
      // so it simply stays pending in the queue for the next pass.
      error = Object.keys(legacy).length
        ? (await supabase.from('inspections').update(legacy).eq('id', r.id)).error
        : null;
    }
    if (error) {
      console.error(`[inspection-notify] record result failed for ${r.id}:`, error.message);
      continue;
    }
    summary[r.status] += 1;
  }

  return summary;
}

/** Back-compat: staff bulk-sent via AppFolio Realm-X and marked them sent. */
export async function markNoticesSent(
  supabase: SupabaseClient,
  ids: string[]
): Promise<{ updated: number }> {
  const summary = await recordNoticeResults(
    supabase,
    ids.map((id) => ({ id, status: 'sent' as const, channel: 'manual' as const }))
  );
  return { updated: summary.sent };
}
