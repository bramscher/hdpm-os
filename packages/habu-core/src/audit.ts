/**
 * audit_event write helper (Phase 2, Brief 2A — briefs/audit-event-design.md).
 *
 * One place all CRM/EOS/brain/work_run mutations log through. Append-only:
 * corrections are new events, never edits. Best-effort — an audit failure is
 * logged loudly but never blocks the user action. Actor convention matches
 * wo_event (lib/agents/actor.ts): humans as themselves, agents as
 * 'agent:<name>', jobs as 'system:<job>'.
 */

import { getSupabaseAdmin } from './db';

export async function logAudit(
  subjectType: string,
  subjectId: string,
  eventType: string,
  actor: string,
  payload?: Record<string, unknown>,
  channelRef?: string
): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from('audit_event').insert({
      subject_type: subjectType,
      subject_id: subjectId,
      event_type: eventType,
      actor,
      payload: payload ?? null,
      channel_ref: channelRef ?? null,
    });
    if (error) {
      console.error(
        `[audit] FAILED ${subjectType}/${subjectId} ${eventType} by ${actor}: ${error.message}`
      );
    }
  } catch (err) {
    console.error('[audit] FAILED (threw):', err);
  }
}
