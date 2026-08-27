/**
 * Loop 1 pilot mode (restart plan §7 rollout adjustment, 2026-08-25).
 *
 * The estimate chase is proven with a small cohort (Craig + Brody) in "shadow"
 * before Cheryl goes live — so the drafts/UX get judged with zero risk of a
 * bad message reaching a real vendor. Both switches are env-driven so that
 * going live is a deliberate, reviewed redeploy rather than a silent DB flip.
 *
 *   AGENT_PILOT_RECIPIENTS — comma-separated staff person names (e.g.
 *     "Craig,Brody"). Empty/unset → pilot off: chases route to Cheryl and
 *     send for real, exactly as before.
 *   AGENT_PILOT_SHADOW=1   — a Send tap records real motion (proposal approved
 *     + wo_event, marked shadow) but suppresses the outbound vendor SMS/email.
 */

export interface PilotConfig {
  /** Staff person names the chase cards/drafts route to instead of Cheryl. */
  recipients: string[];
  /** True → record motion on tap but do not send to the real vendor. */
  shadow: boolean;
}

/** Read the pilot switches from env. Pure aside from process.env. */
export function getPilotConfig(): PilotConfig {
  const recipients = (process.env.AGENT_PILOT_RECIPIENTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    recipients,
    shadow: process.env.AGENT_PILOT_SHADOW === '1',
  };
}

/** Pilot is active only when at least one recipient is configured. */
export function isPilotActive(cfg: PilotConfig = getPilotConfig()): boolean {
  return cfg.recipients.length > 0;
}

/**
 * The production owner of the estimate chase — the staff person whose Outlook
 * drafts folder + Slack the chases route to when no pilot cohort is set.
 *
 * Handed off Cheryl → Jayme (2026-08-26). Env-driven so a further reassignment
 * (or a temporary reroute while jayme@ gets Azure-scoped) is a redeploy env
 * flip, not a code change. The name must match a `staff.person` row that has an
 * email (for the Outlook draft) and, for the SMS/tap path, a `slack_user_id`.
 *
 *   ESTIMATE_CHASER_OWNER — staff person name. Unset → 'Jayme'.
 */
export function getEstimateChaserOwner(): string {
  return process.env.ESTIMATE_CHASER_OWNER?.trim() || 'Jayme';
}
