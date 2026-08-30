import { NextRequest, NextResponse, after } from 'next/server';
import { verifySlackSignature } from '@/lib/webhook-verify';
import { resolveStaffBySlackId } from '@/lib/agents/staff';
import { askRAG } from '@/lib/rag';
import { sendSlackMessage } from '@/lib/agents/channels/slack';
import { routeToScope } from '@/lib/agents/dez/router';
import { buildAnswerBlocks, buildBreadcrumb } from '@/lib/agents/dez/answer-blocks';
import { shouldIgnoreEvent, stripMention, type SlackEvent } from '@/lib/agents/dez/event-guard';

export const maxDuration = 60;

/**
 * POST /api/agents/slack/events — Dez's inbound conversational surface.
 *
 * Slack Events API (NOT the interactivity receiver next door): free-text DMs
 * (message.im) and @Dez channel mentions (app_mention). Auth = Slack request
 * signature (SLACK_SIGNING_SECRET), same as interact/route.ts. Read-only —
 * answers from the RAG corpus (askRAG); no writes, no proposals.
 *
 * Slack requires a 200 within 3s but askRAG calls Claude (slower), so we ack
 * immediately and answer in an after() callback. The loop guard
 * (shouldIgnoreEvent) is the critical correctness property: never answer a
 * bot/self message.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawBody = Buffer.from(await request.arrayBuffer()).toString('utf8');

  const ok = verifySlackSignature({
    signingSecret: process.env.SLACK_SIGNING_SECRET ?? '',
    timestamp: request.headers.get('x-slack-request-timestamp'),
    signature: request.headers.get('x-slack-signature'),
    rawBody,
  });
  if (!ok) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let body: SlackEventEnvelope;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new NextResponse(null, { status: 200 });
  }

  // Event Subscriptions setup handshake.
  if (body.type === 'url_verification') {
    return NextResponse.json({ challenge: body.challenge ?? '' });
  }

  // Slack redelivers on timeout/non-200 — never answer a retry twice.
  if (request.headers.get('x-slack-retry-num')) {
    return new NextResponse(null, { status: 200 });
  }

  const event = body.event;
  if (body.type !== 'event_callback' || shouldIgnoreEvent(event, process.env.SLACK_BOT_USER_ID)) {
    return new NextResponse(null, { status: 200 });
  }

  // Ack now; answer in the background (askRAG > 3s).
  after(() => handleQuestion(event as SlackEvent));
  return new NextResponse(null, { status: 200 });
}

async function handleQuestion(event: SlackEvent): Promise<void> {
  const channel = event.channel;
  if (!channel) return;
  // Thread channel @mentions (keeps channels tidy) and any reply already in a
  // thread; but post top-level in 1:1 DMs — threading a DM reads as an awkward
  // nested reply.
  const threadTs = event.thread_ts ?? (event.channel_type === 'im' ? undefined : event.ts);

  try {
    const question =
      event.type === 'app_mention' ? stripMention(event.text) : (event.text ?? '').trim();
    if (!question) return;

    const staff = await resolveStaffBySlackId(event.user ?? '');
    if (!staff) {
      await sendSlackMessage({
        channel,
        text: 'Your Slack account is not linked to an HDPM staff record — ask Craig to add your Slack ID to the staff table.',
        thread_ts: threadTs,
      });
      return;
    }

    const { scope, label } = routeToScope(channel, event.channel_type);

    const { answer, sources } = await askRAG(question);
    const breadcrumb = buildBreadcrumb(label, sources.length);
    const { text, blocks } = buildAnswerBlocks(answer, sources, breadcrumb);

    await sendSlackMessage({ channel, text, blocks, thread_ts: threadTs });

    logActivity(staff.name || staff.person, scope, question);
  } catch (err) {
    console.error('[Dez] events handler failed:', err instanceof Error ? err.message : String(err));
    try {
      await sendSlackMessage({
        channel,
        text: "Sorry — I hit an error answering that. Try again in a moment, or wish: it in #dez-wishlist if it keeps failing.",
        thread_ts: threadTs,
      });
    } catch {
      /* best-effort */
    }
  }
}

/** Fire-and-forget visibility line to #dez-activity (best-effort). */
function logActivity(person: string, scope: string, question: string): void {
  const channel = process.env.SLACK_DEZ_ACTIVITY_CHANNEL;
  if (!channel) return;
  const q = question.length > 140 ? `${question.slice(0, 140)}…` : question;
  void sendSlackMessage({
    channel,
    text: `🔎 ${person} asked ${scope} · "${q}"`,
  }).catch(() => {
    /* activity logging never blocks an answer */
  });
}

interface SlackEventEnvelope {
  type?: string;
  challenge?: string;
  event?: SlackEvent;
}
