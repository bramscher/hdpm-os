import { NextRequest, NextResponse } from 'next/server';
import { requireSection } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { addNote, loadDetail, setCheck, setComplete, setCoordinator } from '@/lib/turnover/server';
import { todayPacific } from '@/lib/turnover/model';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/turnover-tracker/[id] — one unit turn with its checklist, work orders and activity. */
export async function GET(_request: NextRequest, ctx: Ctx) {
  const guard = await requireSection('brody_turnover');
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const detail = await loadDetail(getSupabaseAdmin(), id, todayPacific());
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(detail);
}

/**
 * POST /api/turnover-tracker/[id]
 * { action: 'check', key, checked, value? } | { action: 'note', body }
 * | { action: 'coordinator', person } | { action: 'complete' } | { action: 'reopen' }
 */
export async function POST(request: NextRequest, ctx: Ctx) {
  const guard = await requireSection('brody_turnover');
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const db = getSupabaseAdmin();
  const { data: turn } = await db.from('unit_turn').select('id').eq('id', id).maybeSingle();
  if (!turn) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const actor = guard.name || guard.email;
  try {
    switch (body.action) {
      case 'check':
        await setCheck(db, id, String(body.key ?? ''), body.checked === true, typeof body.value === 'string' ? body.value : null, actor);
        break;
      case 'note':
        await addNote(db, id, String(body.body ?? ''), actor);
        break;
      case 'coordinator':
        await setCoordinator(db, id, String(body.person ?? ''), actor);
        break;
      case 'complete':
      case 'reopen':
        await setComplete(db, id, body.action === 'complete', actor);
        break;
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Update failed' }, { status: 400 });
  }
}
