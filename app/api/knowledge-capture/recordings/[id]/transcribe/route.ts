import { NextRequest, NextResponse } from 'next/server';
import { requireSection } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { ORG, claimRecording, isTextEntry, transcribeRecording } from '@/lib/knowledge-capture/pipeline';

// Whisper on a long take can take a couple of minutes.
export const maxDuration = 300;

/**
 * POST /api/knowledge-capture/recordings/:id/transcribe
 * Step 1 for audio: transcribe only, so the transcript can be reviewed before
 * it goes to the brain (POST /process with the reviewed text is step 2).
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireSection('knowledge_capture');
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const db = getSupabaseAdmin();
  const { data: rec } = await db.from('kc_recording').select('id, mime_type').eq('org_id', ORG).eq('id', id).maybeSingle();
  if (!rec) return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
  if (isTextEntry(rec)) return NextResponse.json({ error: 'Typed notes have nothing to transcribe' }, { status: 400 });
  if (!(await claimRecording(db, id))) return NextResponse.json({ error: 'Already working on this take' }, { status: 409 });

  try {
    const transcript = await transcribeRecording(id);
    return NextResponse.json({ transcript });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Transcription failed' }, { status: 500 });
  }
}
