import { NextRequest, NextResponse } from 'next/server';
import { requireSection } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { ORG, claimRecording, processRecording } from '@/lib/knowledge-capture/pipeline';

// Transcribing a long take plus two synthesis passes can take a few minutes.
export const maxDuration = 300;

/**
 * POST /api/knowledge-capture/recordings/:id/process
 * Transcribe → notes → brain → profile. Also the retry for a failed take.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireSection('knowledge_capture');
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const db = getSupabaseAdmin();
  const { data: rec } = await db
    .from('kc_recording')
    .select('id')
    .eq('org_id', ORG)
    .eq('id', id)
    .maybeSingle();
  if (!rec) return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
  // Atomic: a second click while a run is live gets 409 instead of paying twice;
  // a run older than the function limit is dead and may be retried.
  if (!(await claimRecording(db, id))) return NextResponse.json({ error: 'Already processing' }, { status: 409 });

  try {
    await processRecording(id);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Processing failed' },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
