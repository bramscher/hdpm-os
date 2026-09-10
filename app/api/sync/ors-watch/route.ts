import { NextRequest, NextResponse } from 'next/server';
import { detectNewOrsSections } from '@/lib/knowledge-sync';
import { buildOrsDigestActionId } from '@/lib/agents/ors-digest';
import { resolveStaffByPersonOrEmail } from '@/lib/agents/staff';
import { sendSlackMessage } from '@/lib/agents/channels/slack';
import { logDezActivity } from '@/lib/agents/dez/activity';

// Probes ~200 candidate URLs against a public service — needs the long budget.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  return POST(request);
}

/**
 * POST /api/sync/ors-watch — the ORS 90 "new section" safety net.
 *
 * The weekly knowledge sync only re-fetches a FIXED list of section numbers, so
 * a section the legislature ADDS is invisible until the list is extended. This
 * probes plausible not-yet-known numbers and, if any resolve to real statute
 * text, DMs Craig so the list gets updated. Monthly cron catches special
 * sessions; ?sessionReview=1 (Apr/Aug crons, after Oregon sessions adjourn)
 * additionally posts a "review the list" reminder even when nothing new is found.
 *
 * Protected by CRON_SECRET. Under /api/sync → already public in proxy.ts.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sessionReview = new URL(request.url).searchParams.get('sessionReview') === '1';

  try {
    const { probed, found } = await detectNewOrsSections();

    const craig = await resolveStaffByPersonOrEmail('Craig');
    const dm = craig?.slack_user_id;

    if (found.length && dm) {
      const list = found
        .map((f) => `• *${f.section}* — ${f.title}  <${f.url}|open>`)
        .join('\n');
      const them = found.length > 1 ? 'them' : 'it';
      await sendSlackMessage({
        channel: dm,
        text: `📕 Possible new ORS 90 section(s) not yet in the knowledge base (${found.length}).`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text:
                `📕 *Possible new ORS 90 section(s)* — not in the knowledge base yet:\n${list}\n\n` +
                `Want me to digest ${them} so Dez can answer about ${them}?`,
            },
          },
          {
            type: 'actions',
            // Slack caps an actions block at 5 elements; alerts are ~1–2 sections.
            elements: found.slice(0, 5).map((f) => ({
              type: 'button',
              style: 'primary',
              text: { type: 'plain_text', text: `📥 Digest ${f.section}` },
              action_id: buildOrsDigestActionId(f.section),
            })),
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `🔧 dez · ors-watch · probed ${probed} · (for amendment tracking, also add to \`ALL_ORS_90_SECTIONS\`)`,
              },
            ],
          },
        ],
      });
    }

    if (sessionReview && dm) {
      await sendSlackMessage({
        channel: dm,
        text: '🗓️ Oregon legislative session review — check the ORS 90 section list.',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text:
                `🗓️ *Oregon legislative session review* — a session recently adjourned. Time to review the ORS 90 ` +
                `section list (\`ALL_ORS_90_SECTIONS\` in \`lib/knowledge-sync.ts\`) against the current chapter and ` +
                `re-run \`/api/sync/knowledge?target=ors\`.\n\nAuto-detector this run: probed ${probed}, found ${found.length} new.`,
            },
          },
        ],
      });
    }

    await logDezActivity({
      kind: 'routine',
      surface: 'cron',
      summary: `ors-watch${sessionReview ? ' (session review)' : ''} · probed ${probed}, found ${found.length}`,
      detail: { probed, found: found.map((f) => f.section), sessionReview },
    });

    return NextResponse.json({ ok: true, probed, found, sessionReview, notified: Boolean(dm) });
  } catch (err) {
    console.error('[ors-watch] failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'ors-watch failed' }, { status: 500 });
  }
}
