import { NextRequest, NextResponse } from 'next/server';
import { requireSection } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { ORG, loadRoster, resolveSubject } from '@/lib/knowledge-capture/pipeline';
import { canChangeTake, normalizeVoices, voicesLabel } from '@/lib/knowledge-capture/voices';

/**
 * POST /api/knowledge-capture/recordings/:id/tag
 * Body: { subjectType: 'owner'|'property', subjectId, voices? }
 * Files a quick-capture take under an owner or property. It then shows on
 * that subject's page for transcript review and Add to brain. Only untagged
 * takes can be tagged (moving a filed take would leave its brain entries behind).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireSection('knowledge_capture');
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { subjectType, subjectId } = body;
  if ((subjectType !== 'owner' && subjectType !== 'property') || typeof subjectId !== 'string' || !subjectId) {
    return NextResponse.json({ error: 'Pick an owner or property' }, { status: 400 });
  }

  const db = getSupabaseAdmin();
  const { data: rec } = await db
    .from('kc_recording')
    .select('id, speaker_email, voices, subject_type')
    .eq('org_id', ORG)
    .eq('id', id)
    .maybeSingle();
  if (!rec) return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
  if (!canChangeTake(rec, guard)) {
    return NextResponse.json({ error: 'Only the person who recorded this can tag it' }, { status: 403 });
  }
  if (rec.subject_type) return NextResponse.json({ error: 'This take is already filed' }, { status: 409 });

  const { roster } = await loadRoster(db);
  const subject = resolveSubject(roster, subjectType, subjectId);
  if (!subject) return NextResponse.json({ error: 'Not an active AppFolio owner or property' }, { status: 404 });

  const voices = body.voices !== undefined ? normalizeVoices(body.voices, rec.speaker_email) : null;
  // Only an untagged row: two people tagging at once can't both win.
  const { data, error } = await db
    .from('kc_recording')
    .update({
      subject_type: subjectType,
      subject_id: subjectId,
      subject_name: subject.name,
      ...(voices ? { voices, speaker_name: voicesLabel(voices) } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('org_id', ORG)
    .eq('id', id)
    .is('subject_type', null)
    .select('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: 'This take is already filed' }, { status: 409 });
  return NextResponse.json({ ok: true, subjectName: subject.name });
}
