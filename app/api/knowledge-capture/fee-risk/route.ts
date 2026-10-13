import { NextRequest, NextResponse } from 'next/server';
import { requireSection } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { loadFeeInputs, loadFeeVolumes } from '@/lib/fee-management/inputs';
import { feeRiskList } from '@/lib/fee-management/risk-list';
import { RISK_NOTE_AUTHORS, canWriteRiskNote, loadRiskNotes } from '@/lib/fee-management/risk-notes';
import { putRiskNote } from '@/lib/fee-management/risk-notes-api';

export const maxDuration = 120;

const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

/**
 * GET /api/knowledge-capture/fee-risk
 * The owners the proposed fee change puts most at risk (same math as Fee
 * Management → Fee Schedule, saved schedule) with Matt's and Penny's notes.
 * Read-only fee numbers: Matt and Penny don't need Fee Management access.
 */
export async function GET() {
  const guard = await requireSection('knowledge_capture');
  if (!guard.ok) return guard.response;
  const db = getSupabaseAdmin();
  try {
    const [inputs, { volumes }, notes] = await Promise.all([loadFeeInputs(db), loadFeeVolumes(db), loadRiskNotes(db)]);
    return NextResponse.json({
      ...feeRiskList(inputs, volumes, todayIso()),
      notes,
      authors: RISK_NOTE_AUTHORS,
      me: guard.email,
      canWrite: canWriteRiskNote(guard.email),
    });
  } catch (err) {
    console.error('[knowledge-capture] fee risk list failed:', err);
    return NextResponse.json({ error: 'Could not load the fee change risk list. Try again in a minute.' }, { status: 502 });
  }
}

/** PUT — save the signed-in person's note on an at-risk owner. */
export async function PUT(request: NextRequest) {
  const guard = await requireSection('knowledge_capture');
  if (!guard.ok) return guard.response;
  return putRiskNote(request, guard.email);
}
