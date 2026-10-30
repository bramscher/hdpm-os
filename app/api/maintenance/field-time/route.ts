import { NextRequest, NextResponse } from 'next/server';
import { requireCompanySession } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { dailyBillingActor } from '@/lib/daily-billing/server';
import { pacificDay } from '@/lib/maintenance-workspace/model';
import { FIELD_TECHS, loadFieldDay, manualEntry, rebuildDay, type Source } from '@/lib/field-time/server';

const noStore = { 'Cache-Control': 'private, no-store' };
export async function GET(request: NextRequest) {
  const guard = await requireCompanySession(); if (!guard.ok) return guard.response;
  try {
    const actor = await dailyBillingActor(guard.email);
    const q = request.nextUrl.searchParams;
    const technician = q.get('technician') || (actor.admin ? FIELD_TECHS[0] : actor.person);
    return NextResponse.json(await loadFieldDay(actor, technician, q.get('date') || pacificDay(), q.get('source') || undefined), { headers: noStore });
  } catch (e) { return failure(e); }
}

/** Day operations. Segments are always computed here, never accepted from the browser. */
export async function POST(request: NextRequest) {
  const guard = await requireCompanySession(); if (!guard.ok) return guard.response;
  try {
    const actor = await dailyBillingActor(guard.email);
    const body = await request.json();
    const source: Source = body.source === 'device' ? 'device' : 'sample';
    if (body.op === 'sample_save' || body.op === 'rebuild') {
      await rebuildDay(actor, String(body.technician || ''), String(body.date || ''), body.op === 'sample_save' ? 'sample' : source, body.op === 'sample_save' ? body.spec : undefined);
      return NextResponse.json(await loadFieldDay(actor, body.technician, body.date, body.op === 'sample_save' ? 'sample' : source), { headers: noStore });
    }
    if (body.op === 'manual_add' || body.op === 'manual_remove') return NextResponse.json(await manualEntry(actor, body), { headers: noStore });
    const allowed: Record<string, string[]> = {
      confirm: ['segment_id', 'version', 'kind', 'allocations', 'label', 'note'],
      confirm_all: ['day_id', 'version'],
      delete_sample: ['day_id'],
    };
    if (!allowed[body.op]) throw new Error('Unknown field time action');
    const req: Record<string, unknown> = { op: body.op };
    for (const key of allowed[body.op]) if (key in body) req[key] = body[key];
    const { data, error } = await getSupabaseAdmin().rpc('field_time_apply', { actor: guard.email, request: req });
    if (error) throw new Error(error.message);
    if (body.op === 'delete_sample') return NextResponse.json({ deleted: true }, { headers: noStore });
    const day = data.day as { technician: string; work_date: string; source: Source };
    return NextResponse.json(await loadFieldDay(actor, day.technician, day.work_date, day.source), { headers: noStore });
  } catch (e) { return failure(e); }
}

function failure(e: unknown) {
  const message = e instanceof Error ? e.message : 'Field time could not load';
  return NextResponse.json({ error: message.replace(/^(FORBIDDEN|CONFLICT): /, '') }, { status: message.includes('FORBIDDEN') ? 403 : message.includes('CONFLICT') ? 409 : 400 });
}
