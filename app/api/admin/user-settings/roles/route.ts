import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { parseRoleDefaults } from '@/lib/access/sections';
import { clearSectionAccessCache } from '@/lib/access/section-access';

/** PUT { role, overrides, version, reason? } — replace a role's section defaults (Roles tab). */
export async function PUT(request: NextRequest) {
  const guard = await requireRole('admin');
  if (!guard.ok) return guard.response;
  const db = getSupabaseAdmin();
  const { data: actor } = await db.from('staff').select('person').ilike('email', guard.email).eq('active', true).eq('access_role', 'admin').maybeSingle();
  if (!actor) return NextResponse.json({ error: 'Active administrator required' }, { status: 403 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = parseRoleDefaults(body?.role, body?.overrides);
  const version = Number(body?.version);
  const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) || null : null;
  if (!parsed || !Number.isInteger(version)) return NextResponse.json({ error: 'Invalid role defaults' }, { status: 400 });

  const { data: current, error: readErr } = await db.from('role_section_defaults').select('overrides,version').eq('role', parsed.role).maybeSingle();
  if (readErr) return NextResponse.json({ error: 'Role defaults table is not set up yet' }, { status: 503 });
  const currentVersion = (current?.version as number | undefined) ?? 0;
  if (currentVersion !== version) return NextResponse.json({ error: 'Someone else changed this role. Reload and try again.' }, { status: 409 });

  const now = new Date().toISOString();
  const write = current
    ? await db.from('role_section_defaults').update({ overrides: parsed.overrides, version: currentVersion + 1, updated_by: guard.email, updated_at: now }).eq('role', parsed.role).eq('version', currentVersion)
    : await db.from('role_section_defaults').insert({ role: parsed.role, overrides: parsed.overrides, version: 1, updated_by: guard.email, updated_at: now });
  if (write.error) return NextResponse.json({ error: 'Could not save. Reload and try again.' }, { status: 409 });
  await db.from('role_section_defaults_audit').insert({
    role: parsed.role,
    actor: guard.email,
    before_overrides: current?.overrides ?? {},
    after_overrides: parsed.overrides,
    reason,
  });
  clearSectionAccessCache();
  return NextResponse.json({ ok: true, version: currentVersion + 1 });
}
