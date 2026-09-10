/**
 * Dez activity log — makes the agentic surface visible.
 *
 * Every Dez interaction (a question answered, a routine run, later a subagent
 * or verb spin-up) records a dez_activity row and, if #dez-activity is wired,
 * posts a live feed line. Both halves are BEST-EFFORT: the DB table may not be
 * applied yet and the Slack channel may be unset — neither can be allowed to
 * block an answer or a cron, so failures are logged and swallowed.
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import { sendSlackMessage } from '@/lib/agents/channels/slack';

export type DezActivityKind = 'question' | 'routine' | 'subagent' | 'verb';

export interface DezActivityInput {
  kind: DezActivityKind;
  surface?: 'dm' | 'channel' | 'cron';
  scope?: string | null;
  actorPerson?: string | null;
  actorSlackId?: string | null;
  summary: string;
  detail?: Record<string, unknown>;
  sourceChannel?: string | null;
}

const KIND_ICON: Record<DezActivityKind, string> = {
  question: '🔎',
  routine: '🛠',
  subagent: '🔧',
  verb: '⚡',
};

/** Format the one-line #dez-activity feed message. Pure. */
export function buildActivityLine(input: DezActivityInput): string {
  const icon = KIND_ICON[input.kind];
  const who = input.actorPerson ? `${input.actorPerson} · ` : '';
  const lane = input.scope ? `${input.scope} · ` : '';
  return `${icon} ${who}${lane}${input.summary}`;
}

/** Record a Dez interaction (DB row + best-effort feed post). Never throws. */
export async function logDezActivity(input: DezActivityInput): Promise<void> {
  // 1) Persist. Supabase returns { error } rather than throwing; a missing
  //    table (migration not applied yet) surfaces here and is tolerated.
  try {
    const { error } = await getSupabaseAdmin()
      .from('dez_activity')
      .insert({
        kind: input.kind,
        surface: input.surface ?? null,
        scope: input.scope ?? null,
        actor_person: input.actorPerson ?? null,
        actor_slack_id: input.actorSlackId ?? null,
        summary: input.summary,
        detail: input.detail ?? {},
        source_channel: input.sourceChannel ?? null,
      });
    if (error) {
      console.warn('[Dez] dez_activity insert skipped:', error.message);
    }
  } catch (err) {
    console.warn('[Dez] dez_activity insert failed:', err instanceof Error ? err.message : String(err));
  }

  // 2) Live feed line (only if the channel is configured).
  const channel = process.env.SLACK_DEZ_ACTIVITY_CHANNEL;
  if (channel) {
    void sendSlackMessage({ channel, text: buildActivityLine(input) }).catch(() => {
      /* feed logging never blocks */
    });
  }
}
