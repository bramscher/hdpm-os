import { NextRequest, NextResponse } from 'next/server';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';
import { enqueueOutbox, dispatchOutbox } from '@/lib/agents/outbox';
import { resolveStaffByPersonOrEmail } from '@/lib/agents/staff';
import { minutesSourceKey } from '@/lib/eos/meeting';
import type { Todo } from '@/lib/eos/types';

const APP_URL = 'https://hdpmchat.highdesertpm.com';

/**
 * POST /api/eos/meetings/:id/conclude — the Conclude step (Brief 2D,
 * doc 06 §4 step 7): record minutes + rating, fan the confirmed to-dos
 * out as Slack cards to their owners, ingest the minutes into the brain.
 * Decisions were already ingested at solve time (idempotent either way).
 *
 * Body: { minutesMd?, rating?, todoIds?: string[] }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  let body: { minutesMd?: unknown; rating?: unknown; todoIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const minutesMd =
    typeof body.minutesMd === 'string' && body.minutesMd.trim()
      ? body.minutesMd.slice(0, 50_000)
      : null;
  const rating =
    typeof body.rating === 'number' && body.rating >= 1 && body.rating <= 10
      ? Math.round(body.rating)
      : null;
  const todoIds = Array.isArray(body.todoIds)
    ? body.todoIds.filter((t): t is string => typeof t === 'string')
    : [];

  const supabase = getSupabaseAdmin();
  const { data: meeting, error: readErr } = await supabase
    .from('meeting')
    .select('id, kind, starts_at')
    .eq('id', id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!meeting) return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });

  const patch: Record<string, unknown> = {};
  if (minutesMd !== null) patch.minutes_md = minutesMd;
  if (rating !== null) patch.rating = rating;
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from('meeting').update(patch).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Archive record of the conclude step.
  const { error: itemErr } = await supabase.from('meeting_item').insert({
    meeting_id: id,
    kind: 'conclude',
    outcome: { rating, todo_ids: todoIds, minutes_recorded: minutesMd !== null },
  });
  if (itemErr) console.error('[eos] conclude meeting_item insert failed:', itemErr.message);
  await logAudit('meeting', id, 'concluded', session.actor, {
    rating,
    todo_count: todoIds.length,
    minutes_recorded: minutesMd !== null,
  });

  // ── Fan confirmed to-dos out as Slack cards ──────────────────────────
  let cardsSent = 0;
  if (todoIds.length > 0) {
    const { data: todoRows } = await supabase
      .from('todo')
      .select('*')
      .in('id', todoIds)
      .eq('status', 'open');
    for (const t of (todoRows ?? []) as Todo[]) {
      if (!t.owner_person) continue;
      const owner = await resolveStaffByPersonOrEmail(t.owner_person);
      if (!owner?.slack_user_id) continue;
      await enqueueOutbox({
        channel: 'slack',
        recipient_person: t.owner_person,
        recipient_address: owner.slack_user_id,
        subject: 'To-do from the meeting',
        body:
          `📋 From today's meeting: *${t.title}* — due ${t.due_on}.\n` +
          `${APP_URL}/company/issues`,
        payload: { todo_id: t.id, meeting_id: id },
      });
      cardsSent++;
    }
    if (cardsSent > 0) await dispatchOutbox({ channel: 'slack' });
  }

  // ── Minutes → brain (best-effort, idempotent on source_key) ──────────
  let minutesIngested = 0;
  if (minutesMd) {
    try {
      const { ingestChunk } = await import('@/lib/brain/ingest');
      const { chunkMarkdown } = await import('@/lib/brain/chunk');
      const dateStr = String(meeting.starts_at).slice(0, 10);
      const chunks = chunkMarkdown(minutesMd, `${meeting.kind} meeting ${dateStr}`);
      for (const c of chunks) {
        const action = await ingestChunk(
          {
            content: c.content,
            kind: 'summary',
            sourceKey: minutesSourceKey(id, c.index),
            sourceTable: 'meeting',
            sourceId: id,
            sourceUrl: `/company/meetings/${id}`,
            author: `human:${session.email}`,
            domain: 'company',
          },
          'eos-minutes'
        );
        if (action === 'add' || action === 'update') minutesIngested++;
      }
    } catch (err) {
      console.warn('[eos] minutes brain ingest failed:', err instanceof Error ? err.message : err);
    }
  }

  return NextResponse.json({ ok: true, cardsSent, minutesIngested });
}
