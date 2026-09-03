import { NextRequest, NextResponse, after } from 'next/server';
import { verifySlackSignature } from '@/lib/webhook-verify';
import { resolveStaffBySlackId } from '@/lib/agents/staff';
import { askRAG } from '@/lib/rag';
import { sendSlackMessage } from '@/lib/agents/channels/slack';
import { routeToScope } from '@/lib/agents/dez/router';
import { buildAnswerBlocks, buildBreadcrumb } from '@/lib/agents/dez/answer-blocks';
import { shouldIgnoreEvent, stripMention, type SlackEvent } from '@/lib/agents/dez/event-guard';
import { logDezActivity } from '@/lib/agents/dez/activity';
import { matchKpiIntent, answerKpiQuestion, kpiAdmins } from '@/lib/agents/dez/kpi-brief';
import { matchOpenEstimatesRequest, postOpenEstimatesCard } from '@/lib/agents/dez/open-estimates';
import { looksLikeFormRequest, assessFormSources } from '@/lib/agents/dez/quality-flag';
import {
  matchOperatorRequest,
  callOperator,
  buildOperatorCard,
  OPERATOR_AGENT,
  FORM_MERGE_ACTION,
  type OperatorRequest,
} from '@/lib/agents/dez/operator';
import { getAgentConfig, effectiveLevel, isGloballyKilled, getNotifyRecipients } from '@/lib/agents/config';
import { createProposal } from '@/lib/agents/proposals';
import { alertOperatorFailure } from '@/lib/agents/dez/operator-alert';

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

    const surface = event.channel_type === 'im' ? 'dm' : 'channel';
    const person = staff.name || staff.person;
    const q = question.length > 140 ? `${question.slice(0, 140)}…` : question;

    // Operator verb — a web-app-only AppFolio action (form merge) routed to the
    // Playwright worker. Gated + logged; stops at a merged preview. Falls
    // through to Q&A when it isn't an operator request.
    const operatorReq = matchOperatorRequest(question);
    if (operatorReq) {
      await handleOperatorRequest({
        channel,
        threadTs,
        surface,
        person,
        actorSlackId: event.user ?? null,
        req: operatorReq,
      });
      return;
    }

    // Open-estimates card — "show me the open estimates", "send Craig the open
    // estimates". Posts a read-only, grouped, AppFolio-linked card of the whole
    // TW11 pool to the named person (default: the asker). Before the KPI lane so
    // "open estimates" doesn't get read as a metric.
    const openEst = matchOpenEstimatesRequest(question);
    if (openEst) {
      const res = await postOpenEstimatesCard({
        requesterPerson: person,
        sourceChannel: channel,
        threadTs,
        targetName: openEst.targetName,
      });
      await logDezActivity({
        kind: 'verb',
        surface,
        scope: 'open-estimates',
        actorPerson: person,
        actorSlackId: event.user ?? null,
        summary: `open estimates → ${res.targetPerson ?? person} (${res.count})`,
        detail: { target: res.targetPerson, count: res.count, delivered: res.delivered },
        sourceChannel: channel,
      });
      return;
    }

    // KPI lane — a metrics question is answered from kpi_snapshots (financial
    // KPIs gated to admins), NOT the SOP corpus. Falls through to askRAG when
    // the question isn't KPI-shaped.
    const kpiNames = matchKpiIntent(question);
    if (kpiNames.length) {
      const isAdmin = kpiAdmins().includes(staff.person);
      const { answer, kpis } = await answerKpiQuestion({ question, names: kpiNames, isAdmin });
      const { text, blocks } = buildAnswerBlocks(answer, [], buildBreadcrumb('kpi', 0));
      await sendSlackMessage({ channel, text, blocks, thread_ts: threadTs });
      await logDezActivity({
        kind: 'question',
        surface,
        scope: 'kpi',
        actorPerson: person,
        actorSlackId: event.user ?? null,
        summary: `"${q}"`,
        detail: { question, kpis },
        sourceChannel: channel,
      });
      return;
    }

    const { scope, label } = routeToScope(channel, event.channel_type);

    const { answer, sources } = await askRAG(question);

    // Freshness/quality flag — if the ask is for an actual form/document, check
    // whether what we found looks current (branded) before they use it, and
    // route the doubtful ones to Craig.
    const flag = looksLikeFormRequest(question) ? assessFormSources(sources) : null;
    const finalAnswer = flag?.caveat ? `${answer}\n\n${flag.caveat}` : answer;

    const breadcrumb = buildBreadcrumb(label, sources.length);
    const { text, blocks } = buildAnswerBlocks(finalAnswer, sources, breadcrumb);

    await sendSlackMessage({ channel, text, blocks, thread_ts: threadTs });

    if (flag?.needsAttention) {
      await notifyCraigReview({ asker: person, question, reason: flag.reason ?? '', title: flag.flaggedTitle });
    }

    await logDezActivity({
      kind: 'question',
      surface,
      scope,
      actorPerson: person,
      actorSlackId: event.user ?? null,
      summary: `"${q}"`,
      detail: {
        question,
        sources: sources.length,
        needs_attention: flag?.needsAttention ?? false,
        flag_reason: flag?.reason ?? null,
        flagged_title: flag?.flaggedTitle ?? null,
      },
      sourceChannel: channel,
    });
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

/**
 * Operator verb — prepare a merged form via the AppFolio operator worker.
 * Gated by the kill switch + agent_config('dez_operator','form_merge') and by
 * DEZ_OPERATOR_URL being set. Stops at a merged preview; posts an approve card.
 */
async function handleOperatorRequest(ctx: {
  channel: string;
  threadTs: string | undefined;
  surface: 'dm' | 'channel';
  person: string;
  actorSlackId: string | null;
  req: OperatorRequest;
}): Promise<void> {
  const { channel, threadTs, req } = ctx;
  const reply = (text: string) => sendSlackMessage({ channel, text, thread_ts: threadTs });

  // Gate: global kill switch + per-action autonomy level.
  if (await isGloballyKilled()) {
    await reply('Dez agents are paused (kill switch is on).');
    return;
  }
  if (effectiveLevel(await getAgentConfig(OPERATOR_AGENT, FORM_MERGE_ACTION)) < 1) {
    await reply("The AppFolio operator isn't enabled yet — ask Craig to turn on `dez_operator` on the /agents page.");
    return;
  }

  // The operator drives AppFolio in a real browser (~15-30s) — acknowledge now
  // so the requester isn't staring at dead air until the preview card lands.
  await reply(`🛠️ On it — preparing the *${req.template}* for *${req.tenantQuery}* in AppFolio. Give me a few seconds…`);

  const proposal = await createProposal({
    agent: OPERATOR_AGENT,
    action_type: FORM_MERGE_ACTION,
    subject_type: 'form_merge',
    payload: { template: req.template, tenant_query: req.tenantQuery, mode: 'prepare' },
    rationale: `Prepare ${req.template} for ${req.tenantQuery} (requested by ${ctx.person})`,
  });

  const result = await callOperator({
    template: req.template,
    tenantQuery: req.tenantQuery,
    mode: 'prepare',
    requestId: proposal.id,
  });

  if (!result) {
    await reply("The AppFolio operator worker isn't reachable right now (not configured). Nothing was done.");
    return;
  }
  if (result.status !== 'prepared') {
    await reply(`I couldn't prepare that: ${result.error ?? 'unknown error'}. Nothing was sent.`);
    await alertOperatorFailure({
      context: 'request',
      template: req.template,
      tenantQuery: req.tenantQuery,
      error: result.error ?? 'unknown error',
      requestedBy: ctx.person,
    });
  } else {
    const card = buildOperatorCard({
      proposalId: proposal.id,
      template: req.template,
      tenantQuery: req.tenantQuery,
      steps: result.steps ?? [],
    });
    await sendSlackMessage({ channel, text: card.text, blocks: card.blocks, thread_ts: threadTs });
  }

  await logDezActivity({
    kind: 'verb',
    surface: ctx.surface,
    scope: 'operator',
    actorPerson: ctx.person,
    actorSlackId: ctx.actorSlackId,
    summary: `prepare ${req.template} for ${req.tenantQuery}`,
    detail: { template: req.template, tenant_query: req.tenantQuery, status: result.status, proposal_id: proposal.id },
    sourceChannel: channel,
  });
}

/** DM the form-review recipients when Dez flags a form as possibly-outdated
 *  (best-effort). Recipients are configurable via agent_config.slack_recipients
 *  for dez/form_flag; defaults to Craig. */
async function notifyCraigReview(input: {
  asker: string;
  question: string;
  reason: string;
  title: string | null;
}): Promise<void> {
  try {
    const recipients = await getNotifyRecipients('dez', 'form_flag', ['Craig']);
    for (const r of recipients) {
      await sendSlackMessage({
        channel: r.slack_user_id!,
        text: '🚩 Dez flagged a form for your review',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text:
                `🚩 *Dez flagged a form for review*\n` +
                `*Asked by:* ${input.asker}\n` +
                `*Question:* ${input.question}\n` +
                `*Doc:* ${input.title ?? '—'}\n` +
                `*Why:* ${input.reason}`,
            },
          },
        ],
      });
    }
  } catch (err) {
    console.error('[Dez] form review notify failed:', err instanceof Error ? err.message : String(err));
  }
}

interface SlackEventEnvelope {
  type?: string;
  challenge?: string;
  event?: SlackEvent;
}
