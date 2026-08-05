import { NextRequest, NextResponse } from 'next/server';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';
import { validateSolveOutcome, decisionSourceKey, type SolveOutcome } from '@/lib/eos/meeting';

/**
 * POST /api/eos/issues/:id/solve — IDS solve with a forced structured
 * outcome (Brief 2D, doc 06 §4 step 6): a decision row and/or one or more
 * to-dos. No outcome, no "solved". Humans only; the decision (if any) is
 * ingested into the brain as a fact, and when solved inside a meeting a
 * meeting_item records the outcome for the archive.
 *
 * Body: { decision?: { title, statementMd, contextMd? },
 *         todos?: [{ title, ownerPerson?, dueOn? }], meetingId? }
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

  let body: SolveOutcome & { meetingId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const outcome: SolveOutcome = {
    decision:
      body.decision && typeof body.decision.title === 'string'
        ? {
            title: body.decision.title.trim().slice(0, 300),
            statementMd: String(body.decision.statementMd ?? '').slice(0, 8000),
            contextMd:
              typeof body.decision.contextMd === 'string'
                ? body.decision.contextMd.slice(0, 8000)
                : undefined,
          }
        : undefined,
    todos: Array.isArray(body.todos)
      ? body.todos
          .filter((t) => typeof t?.title === 'string')
          .map((t) => ({
            title: t.title.trim().slice(0, 300),
            ownerPerson: typeof t.ownerPerson === 'string' && t.ownerPerson ? t.ownerPerson : null,
            dueOn:
              typeof t.dueOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.dueOn) ? t.dueOn : null,
          }))
      : undefined,
  };
  const invalid = validateSolveOutcome(outcome);
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 400 });
  }
  const meetingId = typeof body.meetingId === 'string' ? body.meetingId : null;

  const supabase = getSupabaseAdmin();
  const { data: issue, error: readErr } = await supabase
    .from('issue')
    .select('id, title, status')
    .eq('id', id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!issue) return NextResponse.json({ error: 'Issue not found' }, { status: 404 });
  if (issue.status === 'solved') {
    return NextResponse.json({ error: 'Issue is already solved' }, { status: 409 });
  }

  // ── decision row (human-authored; agents never create these) ─────────
  let decisionId: string | null = null;
  if (outcome.decision) {
    const { data: decisionRow, error: decErr } = await supabase
      .from('decision')
      .insert({
        title: outcome.decision.title,
        statement_md: outcome.decision.statementMd,
        context_md: outcome.decision.contextMd ?? null,
        decided_by: session.actor,
        decided_in_meeting_id: meetingId,
        issue_id: id,
      })
      .select('id')
      .single();
    if (decErr) return NextResponse.json({ error: decErr.message }, { status: 500 });
    decisionId = decisionRow.id;
    await logAudit('decision', decisionId as string, 'created', session.actor, {
      title: outcome.decision.title,
      issue_id: id,
      meeting_id: meetingId,
    });
    // Brain ingest — best-effort, idempotent on source_key; never blocks the solve.
    try {
      const { ingestChunk } = await import('@/lib/brain/ingest');
      await ingestChunk(
        {
          content:
            `Decision: ${outcome.decision.title}\n\n${outcome.decision.statementMd}` +
            (outcome.decision.contextMd ? `\n\nContext: ${outcome.decision.contextMd}` : '') +
            `\n\nDecided by ${session.actor}, resolving issue "${issue.title}".`,
          kind: 'fact',
          sourceKey: decisionSourceKey(decisionId as string),
          sourceTable: 'decision',
          sourceId: decisionId as string,
          sourceUrl: meetingId ? `/company/meetings/${meetingId}` : '/company/issues',
          author: `human:${session.email}`,
          domain: 'company',
        },
        'eos-decision'
      );
    } catch (err) {
      console.warn('[eos] decision brain ingest failed:', err instanceof Error ? err.message : err);
    }
  }

  // ── to-dos (source 'issue' so the chain is traceable) ────────────────
  const todoIds: string[] = [];
  for (const t of outcome.todos ?? []) {
    if (!t.title) continue;
    const insert: Record<string, unknown> = {
      title: t.title,
      owner_person: t.ownerPerson,
      source: 'issue',
      source_id: id,
    };
    if (t.dueOn) insert.due_on = t.dueOn;
    const { data: todoRow, error: todoErr } = await supabase
      .from('todo')
      .insert(insert)
      .select('id')
      .single();
    if (todoErr) {
      console.error('[eos] solve todo insert failed:', todoErr.message);
      continue;
    }
    todoIds.push(todoRow.id);
    await logAudit('todo', todoRow.id, 'created', session.actor, {
      title: t.title,
      owner_person: t.ownerPerson,
      source: 'issue',
      source_id: id,
    });
  }
  if (!decisionId && todoIds.length === 0) {
    return NextResponse.json({ error: 'Outcome could not be recorded' }, { status: 500 });
  }

  // ── mark solved ──────────────────────────────────────────────────────
  const { error: solveErr } = await supabase
    .from('issue')
    .update({
      status: 'solved',
      solved_decision_id: decisionId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (solveErr) return NextResponse.json({ error: solveErr.message }, { status: 500 });
  await logAudit('issue', id, 'solved', session.actor, {
    decision_id: decisionId,
    todo_ids: todoIds,
    meeting_id: meetingId,
  });

  // ── meeting archive record ───────────────────────────────────────────
  if (meetingId) {
    const { error: itemErr } = await supabase.from('meeting_item').insert({
      meeting_id: meetingId,
      kind: 'ids',
      ref_table: 'issue',
      ref_id: id,
      outcome: { decision_id: decisionId, todo_ids: todoIds },
    });
    if (itemErr) console.error('[eos] meeting_item insert failed:', itemErr.message);
  }

  return NextResponse.json({ ok: true, decisionId, todoIds });
}
