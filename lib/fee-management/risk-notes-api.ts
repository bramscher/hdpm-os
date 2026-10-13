import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { MAX_RISK_NOTE_CHARS, canWriteRiskNote, parseRiskNoteInput, saveRiskNote } from './risk-notes';

/**
 * PUT body { ownerSetKey, ownerName?, note } — save the signed-in person's
 * fee change risk note ('' clears it). Shared by the Fee Management and
 * Knowledge Capture routes; each checks its own section first.
 */
export async function putRiskNote(request: Request, email: string): Promise<NextResponse> {
  if (!canWriteRiskNote(email)) {
    return NextResponse.json({ error: 'Only Matt and Penny add notes here' }, { status: 403 });
  }
  const input = parseRiskNoteInput(await request.json().catch(() => null));
  if (!input) return NextResponse.json({ error: `Note must be text under ${MAX_RISK_NOTE_CHARS} characters` }, { status: 400 });
  try {
    return NextResponse.json({ note: await saveRiskNote(getSupabaseAdmin(), email, input) });
  } catch (err) {
    console.error('[fee-management] risk note save failed:', err);
    return NextResponse.json({ error: 'Could not save the note' }, { status: 503 });
  }
}
