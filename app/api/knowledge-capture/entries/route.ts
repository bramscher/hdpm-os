import { NextRequest, NextResponse } from 'next/server';
import { requireSection } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { ORG, TEXT_MIME, loadRoster, resolveSubject } from '@/lib/knowledge-capture/pipeline';
import { normalizeVoices, voicesLabel } from '@/lib/knowledge-capture/voices';

// ~35 brain entries: keeps processing well inside the 300s function limit.
const MAX_CHARS = 60_000;

/**
 * POST /api/knowledge-capture/entries
 * Body: { subjectType, subjectId, text, voices? }
 * A typed or pasted note. Stored as a take with no audio (mime text/plain,
 * the text as its transcript), then processed like any recording via
 * POST /recordings/:id/process — notes, brain, profile, edits all apply.
 */
export async function POST(request: NextRequest) {
  const guard = await requireSection('knowledge_capture');
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { subjectType, subjectId } = body;
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if ((subjectType !== 'owner' && subjectType !== 'property') || typeof subjectId !== 'string' || !subjectId) {
    return NextResponse.json({ error: 'Pick an owner or property first' }, { status: 400 });
  }
  if (!text) return NextResponse.json({ error: 'Type or paste something first' }, { status: 400 });
  if (text.length > MAX_CHARS) return NextResponse.json({ error: 'That is too long — split it into a few notes' }, { status: 413 });

  const db = getSupabaseAdmin();
  const { roster } = await loadRoster(db);
  const subject = resolveSubject(roster, subjectType, subjectId);
  if (!subject) return NextResponse.json({ error: 'Not an active AppFolio owner or property' }, { status: 404 });

  const voices = normalizeVoices(body.voices, guard.email);
  const id = crypto.randomUUID();
  const { error } = await db.from('kc_recording').insert({
    id,
    org_id: ORG,
    subject_type: subjectType,
    subject_id: subjectId,
    subject_name: subject.name,
    speaker_email: guard.email,
    speaker_name: voicesLabel(voices),
    voices,
    storage_path: '',
    mime_type: TEXT_MIME,
    size_bytes: text.length,
    status: 'uploaded',
    transcript: text,
    transcript_model: 'typed',
  });
  if (error) {
    console.error('[knowledge-capture] typed note insert failed:', error.message);
    return NextResponse.json({ error: 'Could not save the note' }, { status: 500 });
  }
  return NextResponse.json({ id });
}
