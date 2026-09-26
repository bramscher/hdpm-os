import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { ACCESS_ROLES, clearRoleCache, type AccessRole } from '@/lib/roles';
import { clearSectionAccessCache } from '@/lib/access/section-access';

/**
 * PATCH { person, access_role, reason? } — assign a person's role.
 * Guards: active DB admin only; can't change your own role; can't remove the last admin.
 */
export async function PATCH(request: NextRequest) {
  const guard = await requireRole('admin');
  if (!guard.ok) return guard.response;
  const db = getSupabaseAdmin();
  const { data: actor } = await db.from('staff').select('person').ilike('email', guard.email).eq('active', true).eq('access_role', 'admin').maybeSingle();
  if (!actor) return NextResponse.json({ error: 'Active administrator required' }, { status: 403 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const person = typeof body?.person === 'string' ? body.person : '';
  const role = body?.access_role as AccessRole;
  const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) || null : null;
  if (!person || !(ACCESS_ROLES as readonly string[]).includes(role)) return NextResponse.json({ error: 'Invalid role change' }, { status: 400 });
  if (person === actor.person) return NextResponse.json({ error: "You can't change your own role. Ask another admin." }, { status: 400 });

  const { data: target } = await db.from('staff').select('person,access_role,active').eq('person', person).maybeSingle();
  if (!target?.active) return NextResponse.json({ error: 'Staff member not found' }, { status: 404 });
  if (target.access_role === role) return NextResponse.json({ ok: true, unchanged: true });

  if (target.access_role === 'admin' && role !== 'admin') {
    const { count } = await db.from('staff').select('person', { count: 'exact', head: true }).eq('active', true).eq('access_role', 'admin');
    if ((count ?? 0) <= 1) return NextResponse.json({ error: 'At least one admin is required' }, { status: 400 });
  }

  const { error } = await db.from('staff').update({ access_role: role }).eq('person', person).eq('access_role', target.access_role);
  if (error) return NextResponse.json({ error: 'Could not change role. Reload and try again.' }, { status: 409 });
  const audit = await db.from('staff_role_audit').insert({ person, actor: guard.email, from_role: target.access_role, to_role: role, reason });
  if (audit.error) console.error('[user-settings] role audit write failed (run 20260925b migration):', audit.error.message);
  clearRoleCache();
  clearSectionAccessCache();
  return NextResponse.json({ ok: true });
}
