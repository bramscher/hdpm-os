/**
 * Server-side loader for per-person section overrides (staff_section_access).
 * Cached 60s per instance like roles, so switches take effect on the next
 * token refresh within about a minute. Fails open to role defaults (and logs)
 * if the table is missing or unreachable, so a DB hiccup never locks staff out.
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import { deniedSections, parseSectionOverrides, type RoleDefaultOverrides, type SectionOverrides } from './sections';

const TTL_MS = 60_000;
let cache: { at: number; byEmail: Map<string, SectionOverrides> } | null = null;
let roleCache: { at: number; value: RoleDefaultOverrides } | null = null;

/** Admin-edited role defaults; empty (code defaults) if the table is missing or unreachable. */
export async function loadRoleDefaults(): Promise<RoleDefaultOverrides> {
  if (roleCache && Date.now() - roleCache.at < TTL_MS) return roleCache.value;
  const { data, error } = await getSupabaseAdmin().from('role_section_defaults').select('role,overrides');
  if (error) {
    console.error('[access] role defaults unavailable; using code defaults', error.message);
    return {};
  }
  const value: RoleDefaultOverrides = {};
  for (const r of data ?? []) value[r.role as string] = parseSectionOverrides(r.overrides) ?? {};
  roleCache = { at: Date.now(), value };
  return value;
}

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
  roleCache = null;
}

/** Section keys this person may not use (empty = everything their role allows). */
export async function getDeniedSections(email: string | null | undefined, role: string | undefined): Promise<string[]> {
  const roleDefaults = await loadRoleDefaults().catch(() => ({}));
  if (!email) return deniedSections(role, {}, roleDefaults);
  try {
    const overrides = (await loadAll()).get(email.toLowerCase()) ?? {};
    return deniedSections(role, overrides, roleDefaults);
  } catch (err) {
    console.error('[access] section overrides unavailable; using role defaults', err);
    return deniedSections(role, {}, roleDefaults);
  }
}
