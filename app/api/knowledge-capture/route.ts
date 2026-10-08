import { NextRequest, NextResponse } from 'next/server';
import { requireSection } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { ORG, loadRoster } from '@/lib/knowledge-capture/pipeline';
import { buildCoverage } from '@/lib/knowledge-capture/roster';
import { canonicalOwner, suggestOwnerLinks } from '@/lib/knowledge-capture/links';
import { VOICES } from '@/lib/knowledge-capture/voices';

export const maxDuration = 120;

/**
 * GET /api/knowledge-capture[?refresh=1]
 * Every active AppFolio owner and property (cached daily AppFolio pull) with
 * capture coverage: how many recordings, by whom, and whether a profile exists.
 */
export async function GET(request: NextRequest) {
  const guard = await requireSection('knowledge_capture');
  if (!guard.ok) return guard.response;
  const db = getSupabaseAdmin();

  let loaded;
  try {
    loaded = await loadRoster(db, request.nextUrl.searchParams.get('refresh') === '1');
  } catch (err) {
    console.error('[knowledge-capture] AppFolio load failed:', err);
    return NextResponse.json({ error: 'Could not load AppFolio owners and properties. Try again in a minute.' }, { status: 502 });
  }

  const [recs, profiles] = await Promise.all([
    db.from('kc_recording').select('subject_type, subject_id, speaker_name, speaker_email, voices, created_at, status, mime_type, transcript_model').eq('org_id', ORG).neq('status', 'pending_upload'),
    db.from('kc_profile').select('subject_type, subject_id').eq('org_id', ORG),
  ]);
  if (recs.error || profiles.error) {
    console.error('[knowledge-capture] read failed:', recs.error ?? profiles.error);
    return NextResponse.json({ error: 'Knowledge capture tables are not set up yet (run the 20261014 migration).' }, { status: 503 });
  }

  // Takes recorded on a since-merged duplicate count toward the kept profile.
  const toProfile = <T extends { subject_type: string; subject_id: string }>(r: T): T =>
    r.subject_type === 'owner' ? { ...r, subject_id: canonicalOwner(loaded.aliases, r.subject_id) } : r;

  return NextResponse.json({
    ...loaded.roster,
    capturedAt: loaded.capturedAt,
    coverage: buildCoverage(
      (recs.data ?? []).map((r) =>
        toProfile({
          ...r,
          // Transcribed audio not yet added to the brain (see transcribeRecording).
          awaiting_review: r.status === 'uploaded' && !!r.transcript_model && r.mime_type !== 'text/plain',
        })
      ),
      (profiles.data ?? []).map(toProfile)
    ),
    suggestions: suggestOwnerLinks(loaded.raw.owners, loaded.links),
    me: { email: guard.email.toLowerCase(), name: guard.name },
    voices: VOICES,
  });
}
