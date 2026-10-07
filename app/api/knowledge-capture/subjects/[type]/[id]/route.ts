import { NextRequest, NextResponse } from 'next/server';
import { requireSection } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { BUCKET, ORG, regenerateProfile } from '@/lib/knowledge-capture/pipeline';
import type { SubjectType } from '@/lib/knowledge-capture/roster';

export const maxDuration = 300;

type Params = { params: Promise<{ type: string; id: string }> };

function subjectType(t: string): SubjectType | null {
  return t === 'owner' || t === 'property' ? t : null;
}

/** GET — the subject's profile plus every recording (transcript, notes, playback URL). */
export async function GET(_request: NextRequest, { params }: Params) {
  const guard = await requireSection('knowledge_capture');
  if (!guard.ok) return guard.response;
  const { type: rawType, id } = await params;
  const type = subjectType(rawType);
  if (!type) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const db = getSupabaseAdmin();
  const [profile, recs] = await Promise.all([
    db.from('kc_profile').select('profile_md, recording_count, generated_at').eq('org_id', ORG).eq('subject_type', type).eq('subject_id', id).maybeSingle(),
    db
      .from('kc_recording')
      .select('id, speaker_email, speaker_name, storage_path, duration_sec, status, error, transcript, transcript_original, transcript_edited_at, transcript_edited_by, notes_md, chunk_count, created_at')
      .eq('org_id', ORG)
      .eq('subject_type', type)
      .eq('subject_id', id)
      .order('created_at', { ascending: false }),
  ]);
  if (profile.error || recs.error) {
    return NextResponse.json({ error: 'Could not load this profile' }, { status: 500 });
  }

  // A take still 'pending_upload' after 10 minutes most likely uploaded but its
  // process call never arrived: show it as 'uploaded' so Retry is offered.
  const staleBefore = Date.now() - 10 * 60 * 1000;
  const rows = (recs.data ?? [])
    .filter((r) => r.status !== 'pending_upload' || new Date(r.created_at).getTime() < staleBefore)
    .map((r) => (r.status === 'pending_upload' ? { ...r, status: 'uploaded' } : r));
  const signed = rows.length
    ? await db.storage.from(BUCKET).createSignedUrls(rows.map((r) => r.storage_path), 60 * 60)
    : { data: [] };
  const urlByPath = new Map((signed.data ?? []).map((s) => [s.path, s.signedUrl]));

  return NextResponse.json({
    profile: profile.data
      ? { markdown: profile.data.profile_md, recordingCount: profile.data.recording_count, generatedAt: profile.data.generated_at }
      : null,
    recordings: rows.map((r) => ({
      id: r.id,
      speaker: r.speaker_name || r.speaker_email,
      mine: r.speaker_email.toLowerCase() === guard.email.toLowerCase(),
      durationSec: r.duration_sec,
      status: r.status,
      error: r.error,
      transcript: r.transcript,
      originalTranscript: r.transcript_original,
      editedAt: r.transcript_edited_at,
      editedBy: r.transcript_edited_by,
      notes: r.notes_md,
      chunkCount: r.chunk_count,
      createdAt: r.created_at,
      audioUrl: urlByPath.get(r.storage_path) ?? null,
    })),
    canDeleteAny: guard.role === 'admin',
  });
}

/** POST — rebuild the profile from all finished recordings. */
export async function POST(_request: NextRequest, { params }: Params) {
  const guard = await requireSection('knowledge_capture');
  if (!guard.ok) return guard.response;
  const { type: rawType, id } = await params;
  const type = subjectType(rawType);
  if (!type) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const markdown = await regenerateProfile(type, id);
    return NextResponse.json({ ok: true, hasProfile: markdown != null });
  } catch (err) {
    console.error('[knowledge-capture] profile rebuild failed:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Rebuild failed' }, { status: 500 });
  }
}
