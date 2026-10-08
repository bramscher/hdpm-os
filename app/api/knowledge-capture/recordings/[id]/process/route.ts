import { NextRequest, NextResponse } from 'next/server';
import { requireSection } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { ORG, claimRecording, processRecording } from '@/lib/knowledge-capture/pipeline';

// Transcribing a long take plus two synthesis passes can take a few minutes.
export const maxDuration = 300;

const MAX_TRANSCRIPT_CHARS = 200_000;

/**
 * POST /api/knowledge-capture/recordings/:id/process   Body (optional): { transcript }
 * Step 2: notes → brain → profile, usually after the transcript was reviewed.
 * A changed transcript is saved first (the machine version is kept as the
 * original). Also the retry for a failed take.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireSection('knowledge_capture');
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const db = getSupabaseAdmin();
  const { data: rec } = await db
    .from('kc_recording')
    .select('id, transcript')
    .eq('org_id', ORG)
    .eq('id', id)
    .maybeSingle();
  if (!rec) return NextResponse.json({ error: 'Recording not found' }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { transcript?: unknown };
  const reviewed = typeof body.transcript === 'string' ? body.transcript.trim() : null;
  if (reviewed !== null && !reviewed) return NextResponse.json({ error: 'The transcript cannot be empty' }, { status: 400 });
  if (reviewed && reviewed.length > MAX_TRANSCRIPT_CHARS) return NextResponse.json({ error: 'That transcript is too long' }, { status: 413 });
  const changed = reviewed !== null && reviewed !== (rec.transcript ?? '').trim();
  // Atomic: a second click while a run is live gets 409 instead of paying twice;
  // a run older than the function limit is dead and may be retried.
  if (!(await claimRecording(db, id))) return NextResponse.json({ error: 'Already processing' }, { status: 409 });

  try {
    await processRecording(id, changed ? { transcript: reviewed!, editedBy: guard.email } : undefined);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Processing failed' },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
