/**
 * Matt's and Penny's own notes on the owners the fee change puts most at risk
 * (Large-owner exposure and Most at risk). One note per owner set per person,
 * shown in Fee Management and Knowledge Capture. Fee campaign only: these
 * never go to the brain.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { VOICES } from '@/lib/knowledge-capture/voices';

const ORG = 'hdpm';
export const MAX_RISK_NOTE_CHARS = 4000;

export interface RiskNote {
  ownerSetKey: string;
  authorEmail: string;
  note: string;
  updatedAt: string;
}

/** Who writes these notes: the Knowledge Capture voices (Matt, Penny; Craig to test). */
export const RISK_NOTE_AUTHORS = VOICES.map((v) => ({ email: v.email, name: v.name, primary: v.source }));

export function canWriteRiskNote(email: string | null | undefined): boolean {
  const e = (email ?? '').trim().toLowerCase();
  return RISK_NOTE_AUTHORS.some((a) => a.email === e);
}

/** A valid PUT body, or null. An empty note means "clear my note". */
export function parseRiskNoteInput(v: unknown): { ownerSetKey: string; ownerName: string | null; note: string } | null {
  const o = v as Record<string, unknown> | null;
  const ownerSetKey = typeof o?.ownerSetKey === 'string' ? o.ownerSetKey.trim() : '';
  if (!ownerSetKey || ownerSetKey.length > 500) return null;
  if (typeof o?.note !== 'string' || o.note.length > MAX_RISK_NOTE_CHARS) return null;
  const ownerName = typeof o.ownerName === 'string' && o.ownerName.trim() ? o.ownerName.trim().slice(0, 300) : null;
  return { ownerSetKey, ownerName, note: o.note.trim() };
}

/** Every note. Before the migration is applied this logs and returns none, so Fee Management still loads. */
export async function loadRiskNotes(db: SupabaseClient): Promise<RiskNote[]> {
  const { data, error } = await db
    .from('fee_risk_note')
    .select('owner_set_key, author_email, note, updated_at')
    .eq('org_id', ORG);
  if (error) {
    console.error('[fee-management] risk notes unavailable (run 20261024_fee_risk_notes.sql?):', error.message);
    return [];
  }
  return (data ?? []).map((r) => ({
    ownerSetKey: r.owner_set_key,
    authorEmail: r.author_email,
    note: r.note,
    updatedAt: r.updated_at,
  }));
}

/** Save (or clear) the signed-in person's note. Returns the saved note, or null when cleared. */
export async function saveRiskNote(
  db: SupabaseClient,
  email: string,
  input: { ownerSetKey: string; ownerName: string | null; note: string }
): Promise<RiskNote | null> {
  const author = email.trim().toLowerCase();
  if (!input.note) {
    const { error } = await db
      .from('fee_risk_note')
      .delete()
      .eq('org_id', ORG)
      .eq('owner_set_key', input.ownerSetKey)
      .eq('author_email', author);
    if (error) throw new Error(error.message);
    return null;
  }
  const updatedAt = new Date().toISOString();
  const { error } = await db.from('fee_risk_note').upsert(
    {
      org_id: ORG,
      owner_set_key: input.ownerSetKey,
      author_email: author,
      owner_name: input.ownerName,
      note: input.note,
      updated_at: updatedAt,
    },
    { onConflict: 'org_id,owner_set_key,author_email' }
  );
  if (error) throw new Error(error.message);
  return { ownerSetKey: input.ownerSetKey, authorEmail: author, note: input.note, updatedAt };
}
