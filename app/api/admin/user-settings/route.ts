import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { hiddenFromRoster } from '@/lib/access/roster';
import { clearSectionAccessCache } from '@/lib/access/section-access';
import { deniedSections, parseSectionOverrides, type SectionOverrides } from '@/lib/access/sections';

async function activeAdmin(email: string) {
  // Verify current admin status in the DB — an old JWT is not permission to administer access.
  const { data } = await getSupabaseAdmin()
    .from('staff')
    .select('person')
    .ilike('email', email)
    .eq('active', true)
    .eq('access_role', 'admin')
    .maybeSingle();
  return data;
}

/** GET — everyone's section switches + recent changes. Admin only. */
export async function GET() {
  const guard = await requireRole('admin');
  if (!guard.ok) return guard.response;
  if (!(await activeAdmin(guard.email))) return NextResponse.json({ error: 'Active administrator required' }, { status: 403 });
  const db = getSupabaseAdmin();
  const [staff, access, audit] = await Promise.all([
    db.from('staff').select('person,email,active,access_role,role').eq('active', true).order('person'),
    db.from('staff_section_access').select('person,overrides,version'),
    db.from('staff_section_access_audit').select('*').order('id', { ascending: false }).limit(100),
  ]);
  if (staff.error) return NextResponse.json({ error: 'Could not load staff' }, { status: 503 });
  const tableMissing = !!access.error;
  const byPerson = new Map((access.data ?? []).map((r) => [r.person as string, r]));
  return NextResponse.json({
    setupNeeded: tableMissing,
    staff: (staff.data ?? [])
      .filter((s) => !hiddenFromRoster(s.person) && !hiddenFromRoster(s.email))
      .map((s) => {
        const row = byPerson.get(s.person);
        const overrides = (parseSectionOverrides(row?.overrides) ?? {}) as SectionOverrides;
        return {
          person: s.person,
          email: s.email,
          jobTitle: s.role,
          access_role: s.access_role,
          overrides,
          version: (row?.version as number | undefined) ?? 0,
          denied: deniedSections(s.access_role, overrides),
        };
      }),
    audit: audit.error ? [] : audit.data ?? [],
  });
}

/** PATCH { person, overrides, version, reason? } — replace one person's switches. Admin only. */
export async function PATCH(request: NextRequest) {
  const guard = await requireRole('admin');
  if (!guard.ok) return guard.response;
  if (!(await activeAdmin(guard.email))) return NextResponse.json({ error: 'Active administrator required' }, { status: 403 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const person = typeof body?.person === 'string' ? body.person : '';
  const overrides = parseSectionOverrides(body?.overrides);
  const version = Number(body?.version);
  const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) || null : null;
  if (!person || !overrides || !Number.isInteger(version)) {
    return NextResponse.json({ error: 'Invalid change' }, { status: 400 });
  }

  const db = getSupabaseAdmin();
  const { data: target } = await db.from('staff').select('person,active').eq('person', person).maybeSingle();
  if (!target?.active) return NextResponse.json({ error: 'Staff member not found' }, { status: 404 });

  const { data: current, error: readErr } = await db.from('staff_section_access').select('overrides,version').eq('person', person).maybeSingle();
  if (readErr) return NextResponse.json({ error: 'User settings table is not set up yet' }, { status: 503 });
  const currentVersion = (current?.version as number | undefined) ?? 0;
  if (currentVersion !== version) {
    return NextResponse.json({ error: 'Someone else changed these settings. Reload and try again.' }, { status: 409 });
  }

  const now = new Date().toISOString();
  const write = current
    ? await db.from('staff_section_access').update({ overrides, version: currentVersion + 1, updated_by: guard.email, updated_at: now }).eq('person', person).eq('version', currentVersion)
    : await db.from('staff_section_access').insert({ person, overrides, version: 1, updated_by: guard.email, updated_at: now });
  if (write.error) return NextResponse.json({ error: 'Could not save. Reload and try again.' }, { status: 409 });

  await db.from('staff_section_access_audit').insert({
    person,
    actor: guard.email,
    before_overrides: (current?.overrides as SectionOverrides | undefined) ?? {},
    after_overrides: overrides,
    reason,
  });
  clearSectionAccessCache();
  return NextResponse.json({ ok: true, version: currentVersion + 1 });
}
