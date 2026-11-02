/**
 * Operator-failure alerting — surface a broken AppFolio operator flow fast.
 *
 * The operator worker drives the AppFolio web app, so an AppFolio UI change can
 * break a selector silently. Both the live Slack verb (when a staff request
 * fails) and the weekly canary route this through here: DM Craig + log a
 * needs_attention row so it also shows in the /agents "Needs attention" panel.
 * Best-effort — never throws (must not break the caller).
 */

import { resolveStaffByPersonOrEmail } from '@/lib/agents/staff';
import { sendSlackMessage } from '@/lib/agents/channels/slack';
import { logDezActivity } from '@/lib/agents/dez/activity';

export async function alertOperatorFailure(input: {
  context: 'request' | 'canary' | 'canary_stuck';
  template: string;
  tenantQuery: string;
  error: string;
  requestedBy?: string;
}): Promise<void> {
  const { context, template, tenantQuery, error, requestedBy } = input;

  // needs_attention row → /agents panel (best-effort; table may be unapplied).
  await logDezActivity({
    kind: context === 'request' ? 'verb' : 'routine',
    surface: context === 'request' ? 'dm' : 'cron',
    scope: 'operator',
    actorPerson: requestedBy ?? null,
    summary: `operator failed: ${template} for ${tenantQuery}`,
    detail: { needs_attention: true, context, template, tenant_query: tenantQuery, error },
  });

  // DM Craig.
  try {
    const craig = await resolveStaffByPersonOrEmail('Craig');
    if (!craig?.slack_user_id) return;
    const title =
      context === 'canary'
        ? '🚨 Dez operator *canary failed* — the AppFolio deposit-to-hold flow looks broken'
        : context === 'canary_stuck'
          ? '🚨 Dez operator *canary didn\'t finish* — this week\'s self-test has no result'
          : '⚠️ Dez operator *failed on a live request*';
    const hint =
      context === 'canary'
        ? 'Weekly self-test — most likely an AppFolio UI change broke a selector. Check Railway logs or re-run the probe.'
        : context === 'canary_stuck'
          ? 'The worker may be hung or asleep. Check Railway logs and the Vercel cron log, then re-run the canary.'
          : 'A staff member hit this. Check the Railway `/operator/form-merge` logs.';
    await sendSlackMessage({
      channel: craig.slack_user_id,
      text:
        context === 'canary'
          ? 'Dez operator canary failed'
          : context === 'canary_stuck'
            ? 'Dez operator canary did not finish'
            : 'Dez operator failed',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text:
              `${title}\n*Template:* ${template}\n*Tenant:* ${tenantQuery}` +
              (requestedBy ? `\n*Requested by:* ${requestedBy}` : '') +
              `\n*Error:* ${error}`,
          },
        },
        { type: 'context', elements: [{ type: 'mrkdwn', text: hint }] },
      ],
    });
  } catch (err) {
    console.error('[Dez] operator failure alert failed:', err instanceof Error ? err.message : String(err));
  }
}
