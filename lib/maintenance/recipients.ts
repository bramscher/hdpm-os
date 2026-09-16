/**
 * Maintenance OS — digest recipient opt-in (admin-managed).
 *
 * Source of truth is the maint_digest_recipient table (person → email +
 * enabled), edited by an admin from the Exceptions view. The
 * MAINT_DIGEST_RECIPIENTS env var (JSON name → email) remains a fallback
 * for anyone the table doesn't cover.
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import { PEOPLE } from './types';
import { isDepartedStaff } from '@/lib/staff-lifecycle';

export interface DigestRecipient {
  person: string;
  email: string | null;
  enabled: boolean;
  updated_at: string;
}

/** Current roster for the admin panel; retired recipients stay historical. */
export async function listDigestRecipients(): Promise<DigestRecipient[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('maint_digest_recipient')
    .select('*')
    .order('person');
  if (error) {
    console.error('[Recipients] List failed:', error.message);
    return [];
  }
  const rows = (data ?? []) as DigestRecipient[];
  // Ensure every named person appears even if the seed row was deleted.
  const seen = new Set(rows.map((r) => r.person));
  for (const person of PEOPLE) {
    if (!seen.has(person)) {
      rows.push({ person, email: null, enabled: false, updated_at: '' });
    }
  }
  return rows.filter((r) => !isDepartedStaff(r.person) && !isDepartedStaff(r.email));
}

/** Upsert one person's email / opt-in flag. */
export async function saveDigestRecipient(
  person: string,
  email: string | null,
  enabled: boolean
): Promise<DigestRecipient> {
  if (isDepartedStaff(person) || isDepartedStaff(email)) {
    throw new Error('This staff member is no longer active. Assign work to Craig.');
  }
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('maint_digest_recipient')
    .upsert(
      { person, email, enabled, updated_at: new Date().toISOString() },
      { onConflict: 'person' }
    )
    .select('*')
    .single();
  if (error || !data) throw new Error(`Failed to save recipient: ${error?.message}`);
  return data as DigestRecipient;
}

function envRecipients(): Record<string, string> {
  const raw = process.env.MAINT_DIGEST_RECIPIENTS;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    console.error('[Recipients] MAINT_DIGEST_RECIPIENTS is not valid JSON');
    return {};
  }
}

/**
 * The active send map: DB opt-ins first, env var fills any gaps.
 * Only enabled rows with an email participate.
 */
export async function getActiveRecipients(): Promise<Record<string, string>> {
  const map: Record<string, string> = { ...envRecipients() };
  for (const r of await listDigestRecipients()) {
    if (r.enabled && r.email) {
      map[r.person] = r.email;
    } else if (r.updated_at && !r.enabled) {
      // An explicit opt-out in the DB overrides the env fallback.
      delete map[r.person];
    }
  }
  return Object.fromEntries(Object.entries(map).filter(([person, email]) =>
    !isDepartedStaff(person) && !isDepartedStaff(email)
  ));
}
