import { NextRequest, NextResponse } from 'next/server';
import { requireSection } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { BUCKET, ORG, deleteRecordingChunks, regenerateProfile } from '@/lib/knowledge-capture/pipeline';

export const maxDuration = 120;

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
    .select('id, subject_type, subject_id, storage_path, speaker_email')
    .eq('org_id', ORG)
    .eq('id', id)
    .maybeSingle();
  if (!rec) return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
  if (guard.role !== 'admin' && rec.speaker_email.toLowerCase() !== guard.email.toLowerCase()) {
    return NextResponse.json({ error: 'Only the person who recorded this can delete it' }, { status: 403 });
  }

  await db.storage.from(BUCKET).remove([rec.storage_path]);
  await deleteRecordingChunks(db, rec.id);
  const { error } = await db.from('kc_recording').delete().eq('id', rec.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  try {
    await regenerateProfile(rec.subject_type, rec.subject_id);
  } catch (err) {
    console.error('[knowledge-capture] profile rebuild after delete failed:', err);
    return NextResponse.json({ ok: true, warning: 'Deleted, but the profile could not be rebuilt — use Rebuild profile.' });
  }
  return NextResponse.json({ ok: true });
}
