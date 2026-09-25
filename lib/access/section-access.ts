/**
 * Server-side loader for per-person section overrides (staff_section_access).
 * Cached 60s per instance like roles, so switches take effect on the next
 * token refresh within about a minute. Fails open to role defaults (and logs)
 * if the table is missing or unreachable, so a DB hiccup never locks staff out.
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import { deniedSections, parseSectionOverrides, type SectionOverrides } from './sections';

const TTL_MS = 60_000;
let cache: { at: number; byEmail: Map<string, SectionOverrides> } | null = null;

async function loadAll(): Promise<Map<string, SectionOverrides>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.byEmail;
  const db = getSupabaseAdmin();
  const [{ data: staff, error: e1 }, { data: rows, error: e2 }] = await Promise.all([
    db.from('staff').select('person,email').eq('active', true),
    db.from('staff_section_access').select('person,overrides'),
  ]);
  if (e1 || e2) throw new Error(e1?.message || e2?.message);
  const byPerson = new Map((rows ?? []).map((r) => [r.person as string, parseSectionOverrides(r.overrides) ?? {}]));
  const byEmail = new Map<string, SectionOverrides>();
  for (const s of staff ?? []) if (s.email) byEmail.set((s.email as string).toLowerCase(), byPerson.get(s.person as string) ?? {});
  cache = { at: Date.now(), byEmail };
  return byEmail;
}

export function clearSectionAccessCache(): void {
  cache = null;
}

/** Section keys this person may not use (empty = everything their role allows). */
export async function getDeniedSections(email: string | null | undefined, role: string | undefined): Promise<string[]> {
  if (!email) return deniedSections(role, {});
  try {
    const overrides = (await loadAll()).get(email.toLowerCase()) ?? {};
    return deniedSections(role, overrides);
  } catch (err) {
    console.error('[access] section overrides unavailable; using role defaults', err);
    return deniedSections(role, {});
  }
}
