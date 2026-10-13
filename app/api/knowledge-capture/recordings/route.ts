import { NextRequest, NextResponse } from 'next/server';
import { requireSection } from '@/lib/require-role';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabase';
import { BUCKET, ORG, loadRoster, resolveSubject } from '@/lib/knowledge-capture/pipeline';
import { MAX_AUDIO_BYTES, audioExtension } from '@/lib/knowledge-capture/synthesize';
import { normalizeVoices, voicesLabel } from '@/lib/knowledge-capture/voices';
import { isTakeId, recordedAtFrom } from '@/lib/knowledge-capture/offline';

/**
 * POST /api/knowledge-capture/recordings
 * Body: { subjectType: 'owner'|'property'|null, subjectId, mimeType, sizeBytes, voices?: emails of who is talking,
 *         id?: the device's take id, recordedAt?: ISO time the take was recorded }
 * Creates the recording row and a signed upload URL; the browser uploads the
 * audio straight to storage (bypassing the API body limit), then calls
 * POST /recordings/:id/transcribe.
 *
 * Takes recorded offline upload later from the device's outbox, maybe more than
 * once if signal drops mid-upload. With the device's `id` a retry reuses the row:
 * still waiting for audio → a fresh upload URL; audio already in → `uploaded: true`.
 * `recordedAt` becomes created_at, so the take is dated when it was recorded.
 *
 * Quick capture: with no subject (subjectType null), the take uploads and
 * transcribes untagged and waits in the Inbox until someone tags it.
 */
export async function POST(request: NextRequest) {
  const guard = await requireSection('knowledge_capture');
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => ({}));
  const { subjectType, subjectId, mimeType, sizeBytes, voices: rawVoices, id: deviceId, recordedAt } = body as Record<string, unknown>;
  const voices = normalizeVoices(rawVoices, guard.email);
  const quick = subjectType == null;
  if (!quick && ((subjectType !== 'owner' && subjectType !== 'property') || typeof subjectId !== 'string' || !subjectId)) {
    return NextResponse.json({ error: 'Pick an owner or property first' }, { status: 400 });
  }
  if (typeof mimeType !== 'string' || !mimeType.startsWith('audio/')) {
    return NextResponse.json({ error: 'That file is not audio' }, { status: 400 });
  }
  if (typeof sizeBytes === 'number' && sizeBytes > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: 'Recording is over 25 MB — split it into shorter takes' }, { status: 413 });
  }

  if (deviceId !== undefined && !isTakeId(deviceId)) {
    return NextResponse.json({ error: 'Bad take id' }, { status: 400 });
  }

  const db = getSupabaseAdmin();
  if (deviceId) {
    const retry = await resumeUpload(db, deviceId, guard.email);
    if (retry) return retry;
  }
  let subject: { name: string } | null = null;
  if (!quick) {
    const { roster } = await loadRoster(db);
    subject = resolveSubject(roster, subjectType as 'owner' | 'property', subjectId as string);
    if (!subject) return NextResponse.json({ error: 'Not an active AppFolio owner or property' }, { status: 404 });
  }

  const id = deviceId ?? crypto.randomUUID();
  const path = quick ? `inbox/${id}.${audioExtension(mimeType)}` : `${subjectType}/${subjectId}/${id}.${audioExtension(mimeType)}`;
  const at = recordedAtFrom(recordedAt);
  const { error } = await db.from('kc_recording').insert({
    id,
    org_id: ORG,
    subject_type: quick ? null : subjectType,
    subject_id: quick ? null : subjectId,
    subject_name: subject?.name ?? null,
    speaker_email: guard.email,
    speaker_name: voicesLabel(voices),
    voices,
    storage_path: path,
    mime_type: mimeType,
    size_bytes: typeof sizeBytes === 'number' ? sizeBytes : null,
    ...(at ? { created_at: at } : {}),
  });
  // Two tabs uploading the same take at once: the loser picks up the winner's row.
  if (error?.code === '23505' && deviceId) {
    const retry = await resumeUpload(db, deviceId, guard.email);
    if (retry) return retry;
  }
  if (error) {
    console.error('[knowledge-capture] insert failed:', error.message);
    return NextResponse.json({ error: 'Could not start the recording upload' }, { status: 500 });
  }

  const signed = await signUpload(db, id, path);
  if (!signed.ok) await db.from('kc_recording').delete().eq('id', id);
  return signed.response;
}

/** A signed URL that may overwrite a half-finished upload from an earlier try. */
async function signUpload(db: SupabaseClient, id: string, path: string) {
  const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true });
  if (error || !data) {
    console.error('[knowledge-capture] signed upload failed:', error?.message);
    return { ok: false, response: NextResponse.json({ error: 'Could not start the recording upload' }, { status: 500 }) };
  }
  return { ok: true, response: NextResponse.json({ id, path, token: data.token }) };
}

/** The response for a take this device already started, or null if there's no such row. */
async function resumeUpload(db: SupabaseClient, id: string, email: string): Promise<NextResponse | null> {
  const { data: rec } = await db
    .from('kc_recording')
    .select('id, speaker_email, storage_path, status')
    .eq('org_id', ORG)
    .eq('id', id)
    .maybeSingle();
  if (!rec) return null;
  if (rec.speaker_email !== email) {
    return NextResponse.json({ error: 'That take belongs to someone else' }, { status: 409 });
  }
  if (rec.status !== 'pending_upload') return NextResponse.json({ id, uploaded: true });
  return (await signUpload(db, id, rec.storage_path)).response;
}
