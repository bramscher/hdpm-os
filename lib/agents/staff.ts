/**
 * Staff identity map lookups — how channel events (Slack taps, SMS replies)
 * resolve to a human actor for audit attribution. All lookups are active-only.
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import type { StaffRow } from './types';

/** Digits-only tail comparison so '+15415551234' matches '(541) 555-1234'. */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export async function resolveStaffBySlackId(slackUserId: string): Promise<StaffRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('staff')
    .select('*')
    .eq('slack_user_id', slackUserId)
    .eq('active', true)
    .maybeSingle();
  if (error) {
    console.error('[Agents] staff slack lookup failed:', error.message);
    return null;
  }
  return (data as StaffRow) ?? null;
}

export async function resolveStaffByPhone(phone: string): Promise<StaffRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from('staff').select('*').eq('active', true);
  if (error) {
    console.error('[Agents] staff phone lookup failed:', error.message);
    return null;
  }
  const target = normalizePhone(phone);
  if (!target) return null;
  const match = ((data ?? []) as StaffRow[]).find(
    (s) => s.phone && normalizePhone(s.phone) === target
  );
  return match ?? null;
}

/** Resolve by short person name (case-insensitive) or email. */
export async function resolveStaffByPersonOrEmail(id: string): Promise<StaffRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from('staff').select('*').eq('active', true);
  if (error) {
    console.error('[Agents] staff lookup failed:', error.message);
    return null;
  }
  const needle = id.trim().toLowerCase();
  const match = ((data ?? []) as StaffRow[]).find(
    (s) =>
      s.person.toLowerCase() === needle ||
      (s.email && s.email.toLowerCase() === needle)
  );
  return match ?? null;
}
