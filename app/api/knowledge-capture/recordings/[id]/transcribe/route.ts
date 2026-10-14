import { NextRequest, NextResponse, after } from 'next/server';
import { requireSection } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { ORG, autoAddToBrain, claimRecording, isTagged, isTextEntry, transcribeRecording } from '@/lib/knowledge-capture/pipeline';
import { skipsReview } from '@/lib/knowledge-capture/voices';

// Whisper on a long take can take a couple of minutes.
export const maxDuration = 300;

// Past this, notes + brain might not fit in the same function run: leave it for review.
const AUTO_ADD_BUDGET_MS = 120_000;

/**
 * POST /api/knowledge-capture/recordings/:id/transcribe
 * Step 1 for audio: transcribe only, so the transcript can be reviewed before
 * it goes to the brain (POST /process with the reviewed text is step 2).
 * Takes recorded by someone who skips review go on to the brain by themselves.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireSection('knowledge_capture');
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const db = getSupabaseAdmin();
  const { data: rec } = await db
    .from('kc_recording')
    .select('id, mime_type, transcript, speaker_email, subject_type')
    .eq('org_id', ORG)
    .eq('id', id)
    .maybeSingle();
  if (!rec) return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
  if (isTextEntry(rec)) return NextResponse.json({ error: 'Typed notes have nothing to transcribe' }, { status: 400 });
  // A device that lost signal mid-request asks again; don't pay Whisper twice.
  if (rec.transcript) return NextResponse.json({ transcript: rec.transcript });
  if (!(await claimRecording(db, id))) return NextResponse.json({ error: 'Already working on this take' }, { status: 409 });

  const started = Date.now();
  try {
    const transcript = await transcribeRecording(id);
    const addingToBrain = isTagged(rec) && skipsReview(rec.speaker_email) && Date.now() - started < AUTO_ADD_BUDGET_MS;
    if (addingToBrain) after(() => autoAddToBrain(id));
    return NextResponse.json({ transcript, addingToBrain });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Transcription failed' }, { status: 500 });
  }
}
