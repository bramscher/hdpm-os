import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { normalizePhone } from '@/lib/maintenance/route-day';

/**
 * PATCH { person, phone } — a person's mobile number, used to text them their day route
 * (from the office's Zoom line). US numbers only, stored as +1XXXXXXXXXX; an empty phone clears it.
 * Guards: active DB admin only.
 */
export async function PATCH(request: NextRequest) {
  const guard = await requireRole('admin');
  if (!guard.ok) return guard.response;
  const db = getSupabaseAdmin();
  const { data: actor } = await db.from('staff').select('person').ilike('email', guard.email).eq('active', true).eq('access_role', 'admin').maybeSingle();
  if (!actor) return NextResponse.json({ error: 'Active administrator required' }, { status: 403 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const person = typeof body?.person === 'string' ? body.person : '';
  const raw = typeof body?.phone === 'string' ? body.phone.trim() : '';
  const phone = raw ? normalizePhone(raw) : null;
  if (!person) return NextResponse.json({ error: 'Choose a person' }, { status: 400 });
  if (raw && !phone) return NextResponse.json({ error: 'Enter a 10-digit US mobile number' }, { status: 400 });

  const { data: target } = await db.from('staff').select('person,active').eq('person', person).maybeSingle();
  if (!target?.active) return NextResponse.json({ error: 'Staff member not found' }, { status: 404 });
  const { error } = await db.from('staff').update({ phone }).eq('person', person);
  if (error) return NextResponse.json({ error: 'Could not save the mobile number. Reload and try again.' }, { status: 500 });
  console.log(`[user-settings] ${guard.email} ${phone ? 'set' : 'cleared'} the mobile number for ${person}`);
  return NextResponse.json({ ok: true, phone });
}
