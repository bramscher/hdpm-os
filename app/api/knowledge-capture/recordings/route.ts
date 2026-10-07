import { NextRequest, NextResponse } from 'next/server';
import { requireSection } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { BUCKET, ORG, loadRoster, resolveSubject } from '@/lib/knowledge-capture/pipeline';
import { MAX_AUDIO_BYTES, audioExtension } from '@/lib/knowledge-capture/synthesize';

/**
 * POST /api/knowledge-capture/recordings
 * Body: { subjectType: 'owner'|'property', subjectId, mimeType, sizeBytes }
 * Creates the recording row and a signed upload URL; the browser uploads the
 * audio straight to storage (bypassing the API body limit), then calls
 * POST /recordings/:id/process.
 */
export async function POST(request: NextRequest) {
  const guard = await requireSection('knowledge_capture');
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => ({}));
  const { subjectType, subjectId, mimeType, sizeBytes } = body as Record<string, unknown>;
  if ((subjectType !== 'owner' && subjectType !== 'property') || typeof subjectId !== 'string' || !subjectId) {
    return NextResponse.json({ error: 'Pick an owner or property first' }, { status: 400 });
  }
  if (typeof mimeType !== 'string' || !mimeType.startsWith('audio/')) {
    return NextResponse.json({ error: 'That file is not audio' }, { status: 400 });
  }
  if (typeof sizeBytes === 'number' && sizeBytes > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: 'Recording is over 25 MB — split it into shorter takes' }, { status: 413 });
  }

  const db = getSupabaseAdmin();
  const { roster } = await loadRoster(db);
  const subject = resolveSubject(roster, subjectType, subjectId);
  if (!subject) return NextResponse.json({ error: 'Not an active AppFolio owner or property' }, { status: 404 });

  const id = crypto.randomUUID();
  const path = `${subjectType}/${subjectId}/${id}.${audioExtension(mimeType)}`;
  const { error } = await db.from('kc_recording').insert({
    id,
    org_id: ORG,
    subject_type: subjectType,
    subject_id: subjectId,
    subject_name: subject.name,
    speaker_email: guard.email,
    speaker_name: guard.name,
    storage_path: path,
    mime_type: mimeType,
    size_bytes: typeof sizeBytes === 'number' ? sizeBytes : null,
  });
  if (error) {
    console.error('[knowledge-capture] insert failed:', error.message);
    return NextResponse.json({ error: 'Could not start the recording upload' }, { status: 500 });
  }

  const { data, error: signErr } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
  if (signErr || !data) {
    console.error('[knowledge-capture] signed upload failed:', signErr?.message);
    await db.from('kc_recording').delete().eq('id', id);
    return NextResponse.json({ error: 'Could not start the recording upload' }, { status: 500 });
  }
  return NextResponse.json({ id, path, token: data.token });
}
