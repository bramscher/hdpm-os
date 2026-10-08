import { NextRequest, NextResponse } from 'next/server';
import { requireSection } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import {
  BUCKET,
  ORG,
  STALE_PROCESSING_MS,
  claimRecording,
  deleteRecordingChunks,
  isTextEntry,
  loadOwnerLinks,
  processRecording,
  regenerateProfile,
} from '@/lib/knowledge-capture/pipeline';
import { aliasMap, canonicalOwner } from '@/lib/knowledge-capture/links';
import { rowVoices } from '@/lib/knowledge-capture/voices';

/** The person who recorded it, anyone whose voice is in it, or an admin. */
function canChange(rec: { speaker_email: string; voices: string[] | null }, guard: { role: string; email: string }): boolean {
  if (guard.role === 'admin') return true;
  const me = guard.email.toLowerCase();
  return rec.speaker_email.toLowerCase() === me || rowVoices(rec).includes(me);
}

// An edit re-runs notes, brain ingest and the profile (two synthesis passes).
export const maxDuration = 300;

const MAX_TRANSCRIPT_CHARS = 200_000;

/**
 * PATCH /api/knowledge-capture/recordings/:id  Body: { transcript }
 * Saves a corrected transcript (the first machine transcript is kept) and
 * rebuilds the take's notes, brain chunks and the subject's profile from it.
 * Same permission as delete: the person who recorded it, or an admin.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireSection('knowledge_capture');
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const body = await request.json().catch(() => ({}));
  const transcript = typeof body.transcript === 'string' ? body.transcript.trim() : '';
  if (!transcript) return NextResponse.json({ error: 'The transcript cannot be empty' }, { status: 400 });
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    return NextResponse.json({ error: 'That transcript is too long' }, { status: 413 });
  }

  const db = getSupabaseAdmin();
  const { data: rec } = await db
    .from('kc_recording')
    .select('id, status, updated_at, transcript, speaker_email, voices')
    .eq('org_id', ORG)
    .eq('id', id)
    .maybeSingle();
  if (!rec) return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
  if (!canChange(rec, guard)) {
    return NextResponse.json({ error: 'Only the person who recorded this can edit it' }, { status: 403 });
  }
  if (transcript === (rec.transcript ?? '').trim()) return NextResponse.json({ ok: true, unchanged: true });
  if (!(await claimRecording(db, id))) {
    return NextResponse.json({ error: 'Still processing — try again in a minute' }, { status: 409 });
  }

  try {
    await processRecording(id, { transcript, editedBy: guard.email });
  } catch (err) {
    return NextResponse.json(
      { error: `Saved, but rebuilding the notes failed: ${err instanceof Error ? err.message : 'unknown error'}. Use Retry.` },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/knowledge-capture/recordings/:id
 * Removes the audio, its brain chunks and the row, then rebuilds the profile
 * without it. Only the person who recorded it (or an admin) may delete.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireSection('knowledge_capture');
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const db = getSupabaseAdmin();
  const { data: rec } = await db
    .from('kc_recording')
    .select('id, subject_type, subject_id, storage_path, mime_type, speaker_email, voices, status, updated_at')
    .eq('org_id', ORG)
    .eq('id', id)
    .maybeSingle();
  if (!rec) return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
  if (!canChange(rec, guard)) {
    return NextResponse.json({ error: 'Only the person who recorded this can delete it' }, { status: 403 });
  }

  // A live run would re-ingest this take's brain entries after it's gone.
  if (rec.status === 'processing' && Date.now() - new Date(rec.updated_at).getTime() < STALE_PROCESSING_MS) {
    return NextResponse.json({ error: 'Still processing — delete it once it finishes' }, { status: 409 });
  }

  if (!isTextEntry(rec)) await db.storage.from(BUCKET).remove([rec.storage_path]);
  await deleteRecordingChunks(db, rec.id);
  const { error } = await db.from('kc_recording').delete().eq('id', rec.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  try {
    const subjectId =
      rec.subject_type === 'owner' ? canonicalOwner(aliasMap(await loadOwnerLinks(db)), rec.subject_id) : rec.subject_id;
    await regenerateProfile(rec.subject_type, subjectId);
  } catch (err) {
    console.error('[knowledge-capture] profile rebuild after delete failed:', err);
    return NextResponse.json({ ok: true, warning: 'Deleted, but the profile could not be rebuilt — use Rebuild profile.' });
  }
  return NextResponse.json({ ok: true });
}
