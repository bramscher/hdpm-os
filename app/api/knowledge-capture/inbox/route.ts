import { NextResponse } from 'next/server';
import { requireSection } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { BUCKET, ORG, STALE_PROCESSING_MS } from '@/lib/knowledge-capture/pipeline';
import { canChangeTake, rowVoices, voicesLabel } from '@/lib/knowledge-capture/voices';

/** How long an upload may sit unfinished before the take counts as stuck. */
const STALE_UPLOAD_MS = 10 * 60 * 1000;

export type InboxStatus = 'uploading' | 'transcribing' | 'ready' | 'error';

/**
 * GET /api/knowledge-capture/inbox
 * Quick-capture takes with no owner or property yet, newest first, with
 * transcript and playback URL so someone can tell what each one is about and
 * tag it (POST /recordings/:id/tag).
 */
export async function GET() {
  const guard = await requireSection('knowledge_capture');
  if (!guard.ok) return guard.response;
  const db = getSupabaseAdmin();

  const { data, error } = await db
    .from('kc_recording')
    .select('id, speaker_email, speaker_name, voices, storage_path, duration_sec, status, error, transcript, created_at, updated_at')
    .eq('org_id', ORG)
    .is('subject_type', null)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) {
    console.error('[knowledge-capture] inbox read failed:', error.message);
    return NextResponse.json({ error: 'Could not load the inbox (run the 20261025 migration?)' }, { status: 503 });
  }

  const now = Date.now();
  const age = (iso: string) => now - new Date(iso).getTime();
  const rows = (data ?? []).map((r) => {
    let status: InboxStatus;
    let err: string | null = r.error;
    if (r.status === 'pending_upload') {
      status = age(r.updated_at) < STALE_UPLOAD_MS ? 'uploading' : 'error';
      if (status === 'error') err = "The upload didn't finish here — check the phone it was recorded on, or Retry.";
    } else if (r.status === 'processing') {
      status = age(r.updated_at) < STALE_PROCESSING_MS ? 'transcribing' : 'error';
      if (status === 'error') err = 'Timed out while transcribing — Retry.';
    } else if (r.status === 'error' || !r.transcript) {
      status = 'error';
      err = err ?? 'Not transcribed yet — Retry.';
    } else {
      status = 'ready';
    }
    return { r, status, err };
  });

  const paths = rows.filter((x) => x.status !== 'uploading').map((x) => x.r.storage_path);
  const signed = paths.length ? await db.storage.from(BUCKET).createSignedUrls(paths, 60 * 60) : { data: [] };
  const urlByPath = new Map((signed.data ?? []).map((s) => [s.path, s.signedUrl]));

  return NextResponse.json({
    takes: rows.map(({ r, status, err }) => ({
      id: r.id,
      speaker: voicesLabel(rowVoices(r)),
      voices: rowVoices(r),
      mine: canChangeTake(r, guard),
      durationSec: r.duration_sec,
      status,
      error: status === 'error' ? err : null,
      transcript: r.transcript,
      createdAt: r.created_at,
      audioUrl: urlByPath.get(r.storage_path) ?? null,
    })),
  });
}
