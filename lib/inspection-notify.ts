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

export interface DueNotice {
  id: string;
  target_date: string | null;
  resident_name: string;
  email: string | null;
  address: string;
  subject: string;
  body: string;
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
export async function getDueNotices(
  supabase: SupabaseClient,
  options: { today?: Date; limit?: number } = {}
): Promise<DueNoticesResult> {
  const today = options.today ?? new Date();
  const todayStr = today.toISOString().split('T')[0];
  const limit = options.limit ?? 1000;

  const { data, error } = await supabase
    .from('inspections')
    .select(
      `id, target_date, inspection_type, unit_name, resident_name, notice_email,
       inspection_properties ( address_1, address_2, city, state, zip, resident_name, tenant_email )`
    )
    .eq('status', 'scheduled')
    .is('notice_sent_at', null)
    .not('target_date', 'is', null)
    .gte('target_date', todayStr)
    .order('target_date', { ascending: true })
    .limit(limit);

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
    };
  });

  return {
    count: notices.length,
    with_email: notices.filter((n) => n.email).length,
    missing_email: notices.filter((n) => !n.email).length,
    notices,
  };
}

/** Mark notices as sent after staff bulk-send them through AppFolio Realm-X. */
export async function markNoticesSent(
  supabase: SupabaseClient,
  ids: string[]
): Promise<{ updated: number }> {
  if (!ids.length) return { updated: 0 };
  const { data, error } = await supabase
    .from('inspections')
    .update({ notice_status: 'sent', notice_sent_at: new Date().toISOString() })
    .in('id', ids)
    .select('id');
  if (error) throw new Error(`Failed to mark notices sent: ${error.message}`);
  return { updated: data?.length ?? 0 };
}
