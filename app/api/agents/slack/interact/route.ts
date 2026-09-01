import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifySlackSignature } from '@/lib/webhook-verify';
import { resolveStaffBySlackId } from '@/lib/agents/staff';
import { decideProposal } from '@/lib/agents/proposals';
import { annotateProposalPayload, rebuildCard } from '@/lib/agents/morning-card-run';
import { parseBlockAction, snoozeDate, isValidYmd } from '@/lib/agents/morning-card';
import { parseEcActionId, ESTIMATE_CHASER_AGENT, VENDOR_CHASE_SMS_ACTION, ESCALATE_ACTION } from '@/lib/agents/estimate-chaser';
import { rebuildSmsQueueCard } from '@/lib/agents/estimate-chaser-run';
import { getPilotConfig } from '@/lib/agents/pilot';
import { parseObActionId, applyAckToBlocks, OPS_BRIEF_AGENT, SEND_BRIEF_ACTION } from '@/lib/agents/ops-brief';
import { parseRockActionId, buildRockCardBlocks, currentQuarter, type RockAction } from '@/lib/eos/rock';
import { parseOrsDigestActionId } from '@/lib/agents/ors-digest';
import { ingestOrsSection } from '@/lib/knowledge-sync';
import { logDezActivity } from '@/lib/agents/dez/activity';
import {
  parseOperatorActionId,
  callOperator,
  buildOperatorCard,
  OPERATOR_AGENT,
  FORM_MERGE_ACTION,
  type OperatorAction,
} from '@/lib/agents/dez/operator';
import { logAudit } from '@/lib/audit';
import { enqueueOutbox, dispatchOutbox } from '@/lib/agents/outbox';
import { updateSlackMessage, splitSlackMessageId } from '@/lib/agents/channels/slack';
import { updateWorkOrderWorkflow, WorkflowValidationError } from '@/lib/maintenance/workflow-db';
import { recordEvent } from '@/lib/maintenance/events';
import { nextBusinessDay, toDateString } from '@/lib/maintenance/business-days';
import type { AgentProposal } from '@/lib/agents/types';

export const maxDuration = 60;

/**
 * POST /api/agents/slack/interact — Slack interactivity receiver.
 *
 * Auth is the Slack request signature (SLACK_SIGNING_SECRET), NOT a session
 * or service token — this is the one /api/agents route with its own scheme.
 * Every action resolves the tapping Slack user through the staff table and
 * applies as that HUMAN (wo_event audit attribution); unlinked users get an
 * ephemeral notice and no write ever happens.
 */
export async function POST(request: NextRequest) {
  // RAW body before any parsing — the signature covers the exact bytes.
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

  let payload: SlackInteractionPayload;
  try {
    payload = JSON.parse(new URLSearchParams(rawBody).get('payload') ?? '{}');
  } catch {
    return new NextResponse(null, { status: 200 });
  }
  if (payload.type !== 'block_actions' || !payload.actions?.length) {
    return new NextResponse(null, { status: 200 });
  }

  const staff = await resolveStaffBySlackId(payload.user?.id ?? '');
  if (!staff) {
    await respond(payload.response_url, {
      response_type: 'ephemeral',
      replace_original: false,
      text: 'Your Slack account is not linked to an HDPM staff record — ask Craig to add your Slack ID to the staff table.',
    });
    return new NextResponse(null, { status: 200 });
  }
  const actor = staff.name || staff.person;

  // Estimate Chaser namespace (ec:*) — the Text chase queue card (Brief D.5).
  const rawAction = payload.actions[0] as { action_id?: unknown } | undefined;
  const ecAction =
    typeof rawAction?.action_id === 'string' ? parseEcActionId(rawAction.action_id) : null;
  if (ecAction) {
    return handleEcAction(ecAction, actor, payload.response_url);
  }

  // Ops Brief namespace (ob:*) — [Acknowledge] on needs-Craig items (Brief E).
  const obAction =
    typeof rawAction?.action_id === 'string' ? parseObActionId(rawAction.action_id) : null;
  if (obAction) {
    return handleObAction(obAction, actor, payload.response_url);
  }

  // Rocks namespace (rock:*) — Friday one-tap on/off self-report (EOS 2E).
  const rockAction =
    typeof rawAction?.action_id === 'string' ? parseRockActionId(rawAction.action_id) : null;
  if (rockAction) {
    return handleRockAction(rockAction, actor, payload.response_url);
  }

  // Operator namespace (op:*) — [Approve & Send] / [Discard] on a merged-form preview.
  const opAction =
    typeof rawAction?.action_id === 'string' ? parseOperatorActionId(rawAction.action_id) : null;
  if (opAction) {
    return handleOpAction(opAction, actor, payload.response_url);
  }

  // ORS-watch namespace (ors:digest:*) — [Digest this] ingests a newly-found
  // ORS 90 section into the knowledge base on the spot.
  const orsDigest =
    typeof rawAction?.action_id === 'string' ? parseOrsDigestActionId(rawAction.action_id) : null;
  if (orsDigest) {
    return handleOrsDigest(orsDigest, actor, payload.response_url);
  }

  const action = parseBlockAction(payload.actions[0]);
  if (!action) {
    return new NextResponse(null, { status: 200 });
  }

  const supabase = getSupabaseAdmin();
  const { data: proposalRow } = await supabase
    .from('agent_proposal')
    .select('*')
    .eq('id', action.proposalId)
    .maybeSingle();
  const proposal = proposalRow as AgentProposal | null;
  if (!proposal || !proposal.subject_id) {
    return new NextResponse(null, { status: 200 });
  }
  const cardDate = (proposal.payload as Record<string, unknown>).card_date as string;
  const woId = proposal.subject_id;
  const now = new Date();
  const tapTime = now.toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: '2-digit',
  });

  let transientError: { proposalId: string; message: string } | undefined;

  try {
    switch (action.kind) {
      case 'done': {
        // Decide FIRST — null means already decided (double-tap): skip the
        // note so re-taps never duplicate audit rows.
        const decided = await decideProposal(action.proposalId, 'approved', actor);
        if (decided) {
          await annotateProposalPayload(action.proposalId, {
            resolution: `Done by ${actor} ${tapTime}`,
          });
          await recordEvent({
            work_order_id: woId,
            event_type: 'note',
            payload: { note: 'Morning card: marked done', source: 'morning_card' },
            actor,
          });
        }
        break;
      }

      case 'snooze': {
        const reason = action.selectedValue;
        if (!reason) break;
        const wo = await loadWo(woId);
        const date = snoozeDate(now);
        await updateWorkOrderWorkflow(
          woId,
          {
            next_action_date: date,
            aging_reason: reason,
            ...(wo?.owner_name ? {} : { owner_name: 'Cheryl' }),
          },
          actor
        );
        await annotateProposalPayload(action.proposalId, {
          snooze_reason: reason,
          snoozed_to: date,
          resolution: `Snoozed to ${date} (${reason}) by ${actor}`,
        });
        await decideProposal(action.proposalId, 'approved', actor);
        break;
      }

      case 'date': {
        if (!isValidYmd(action.selectedDate)) break;
        const wo = await loadWo(woId);
        await updateWorkOrderWorkflow(
          woId,
          {
            next_action_date: action.selectedDate,
            ...(wo?.owner_name ? {} : { owner_name: 'Cheryl' }),
          },
          actor
        );
        await annotateProposalPayload(action.proposalId, {
          resolution: `Date set to ${action.selectedDate} by ${actor}`,
        });
        await decideProposal(action.proposalId, 'edited', actor, {
          next_action_date: action.selectedDate,
        });
        break;
      }

      case 'reassign': {
        const person = action.selectedValue;
        if (!person) break;
        const wo = await loadWo(woId);
        await updateWorkOrderWorkflow(
          woId,
          {
            owner_name: person,
            ...(wo?.next_action_date
              ? {}
              : { next_action_date: toDateString(nextBusinessDay(now)) }),
          },
          actor
        );
        await annotateProposalPayload(action.proposalId, {
          resolution: `Reassigned to ${person} by ${actor}`,
        });
        await decideProposal(action.proposalId, 'edited', actor, { owner_name: person });
        break;
      }
    }
  } catch (err) {
    if (err instanceof WorkflowValidationError) {
      transientError = { proposalId: action.proposalId, message: err.errors.join('; ') };
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Agents] slack interact action failed:', msg);
      transientError = { proposalId: action.proposalId, message: msg };
    }
  }

  // Rebuild the card from proposal state and replace the original message.
  const card = await rebuildCard(cardDate, transientError);
  if (card) {
    const replaced = await respond(payload.response_url, {
      replace_original: true,
      text: card.text,
      blocks: card.blocks,
    });
    if (!replaced && proposal.channel_message_id) {
      const target = splitSlackMessageId(proposal.channel_message_id);
      if (target) {
        await updateSlackMessage({ ...target, text: card.text, blocks: card.blocks });
      }
    }
  }

  return new NextResponse(null, { status: 200 });
}

// ── Estimate Chaser (ec:*) — send-on-tap SMS from the Text chase queue ──

/**
 * sendsms: decide FIRST (double-tap guard), then enqueue + dispatch the
 * sms_zoom outbox row as the tapping human's action. skip: reject with a
 * note. Either way the queue card rebuilds from proposal state.
 */
async function handleEcAction(
  action: { kind: 'sendsms' | 'skip'; proposalId: string },
  actor: string,
  responseUrl: string | undefined
): Promise<NextResponse> {
  const supabase = getSupabaseAdmin();
  const { data: proposalRow } = await supabase
    .from('agent_proposal')
    .select('*')
    .eq('id', action.proposalId)
    .maybeSingle();
  const proposal = proposalRow as AgentProposal | null;
  if (
    !proposal ||
    proposal.agent !== ESTIMATE_CHASER_AGENT ||
    proposal.action_type !== VENDOR_CHASE_SMS_ACTION ||
    !proposal.subject_id
  ) {
    return new NextResponse(null, { status: 200 });
  }
  const pl = proposal.payload as Record<string, unknown>;
  const chaseDate = typeof pl.chase_date === 'string' ? pl.chase_date : '';
  const tapTime = new Date().toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: '2-digit',
  });

  let transientError: { proposalId: string; message: string } | undefined;

  try {
    if (action.kind === 'skip') {
      const decided = await decideProposal(action.proposalId, 'rejected', actor);
      if (decided) {
        await annotateProposalPayload(action.proposalId, {
          resolution: `Skipped by ${actor} ${tapTime}`,
        });
      }
    } else {
      const smsText = typeof pl.sms_text === 'string' ? pl.sms_text : '';
      const vendorPhone = typeof pl.vendor_phone === 'string' ? pl.vendor_phone : '';
      if (!smsText || !vendorPhone) {
        transientError = { proposalId: action.proposalId, message: 'proposal is missing text or phone' };
      } else {
        // Decide FIRST — null means already decided (double-tap): never send twice.
        const decided = await decideProposal(action.proposalId, 'approved', actor);
        if (decided && getPilotConfig().shadow) {
          // Pilot shadow (restart §7): record real motion (approved proposal +
          // wo_event, tagged shadow) but never text the real vendor. The tap
          // still counts toward the §8 number and produces training signal.
          await annotateProposalPayload(action.proposalId, {
            resolution: `Logged in pilot — not sent to vendor by ${actor} ${tapTime}`,
            shadow: true,
          });
          await recordEvent({
            work_order_id: proposal.subject_id,
            event_type: 'note',
            payload: {
              note: `Vendor chase logged in pilot — shadow, not sent (${typeof pl.wo_ref === 'string' ? pl.wo_ref : proposal.subject_id})`,
              source: 'estimate_chaser_sms',
              shadow: true,
            },
            actor,
          });
        } else if (decided) {
          const outboxRow = await enqueueOutbox({
            proposal_id: action.proposalId,
            channel: 'sms_zoom',
            recipient_person: typeof pl.vendor_name === 'string' ? pl.vendor_name : null,
            recipient_address: vendorPhone,
            body: smsText,
            payload: {
              work_order_id: proposal.subject_id,
              chase_date: chaseDate,
              sent_by: actor,
            },
          });
          await dispatchOutbox({ channel: 'sms_zoom' });
          const { data: sentRow } = await supabase
            .from('agent_outbox')
            .select('status, message_id, error')
            .eq('id', outboxRow.id)
            .maybeSingle();

          if (sentRow?.status === 'sent') {
            await annotateProposalPayload(action.proposalId, {
              resolution: `Text sent by ${actor} ${tapTime}`,
              sms_message_id: sentRow.message_id,
            });
            await recordEvent({
              work_order_id: proposal.subject_id,
              event_type: 'note',
              payload: {
                note: `Vendor texted re bid chase (${typeof pl.wo_ref === 'string' ? pl.wo_ref : proposal.subject_id})`,
                source: 'estimate_chaser_sms',
              },
              actor,
            });
          } else if (sentRow?.status === 'skipped') {
            await annotateProposalPayload(action.proposalId, {
              resolution: `Text NOT sent (${sentRow.error ?? 'skipped'}) — tap recorded by ${actor} ${tapTime}`,
            });
            transientError = {
              proposalId: action.proposalId,
              message: sentRow.error ?? 'send skipped',
            };
          } else {
            await annotateProposalPayload(action.proposalId, {
              resolution: `Text queued for retry (${sentRow?.error ?? 'send failed'}) — approved by ${actor} ${tapTime}`,
            });
            transientError = {
              proposalId: action.proposalId,
              message: `send failed, will retry: ${sentRow?.error ?? 'unknown error'}`,
            };
          }
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Agents] ec action failed:', msg);
    transientError = { proposalId: action.proposalId, message: msg };
  }

  if (chaseDate) {
    const card = await rebuildSmsQueueCard(chaseDate, transientError);
    if (card) {
      const replaced = await respond(responseUrl, {
        replace_original: true,
        text: card.text,
        blocks: card.blocks,
      });
      if (!replaced && proposal.channel_message_id) {
        const target = splitSlackMessageId(proposal.channel_message_id);
        if (target) {
          await updateSlackMessage({ ...target, text: card.text, blocks: card.blocks });
        }
      }
    }
  }

  return new NextResponse(null, { status: 200 });
}

// ── Operator (op:*) — approve/discard a merged-form preview ──

/**
 * approve: decide the proposal, then ask the worker to SEND. The worker refuses
 * send until it is deliberately enabled, so approving surfaces that state rather
 * than sending anything. discard: reject. Either way the card re-renders with a
 * resolution and no buttons.
 */
async function handleOpAction(
  action: OperatorAction,
  actor: string,
  responseUrl: string | undefined
): Promise<NextResponse> {
  const supabase = getSupabaseAdmin();
  const { data: proposalRow } = await supabase
    .from('agent_proposal')
    .select('*')
    .eq('id', action.proposalId)
    .maybeSingle();
  const proposal = proposalRow as AgentProposal | null;
  if (!proposal || proposal.agent !== OPERATOR_AGENT || proposal.action_type !== FORM_MERGE_ACTION) {
    return new NextResponse(null, { status: 200 });
  }
  const pl = proposal.payload as Record<string, unknown>;
  const template = typeof pl.template === 'string' ? pl.template : 'form';
  const tenantQuery = typeof pl.tenant_query === 'string' ? pl.tenant_query : '';
  const tapTime = new Date().toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: '2-digit',
  });

  let resolution: string;
  if (action.kind === 'discard') {
    await decideProposal(action.proposalId, 'rejected', actor);
    resolution = `🗑 Discarded by ${actor} ${tapTime} — nothing sent.`;
  } else {
    const decided = await decideProposal(action.proposalId, 'approved', actor);
    if (!decided) {
      resolution = `Already decided.`;
    } else {
      const sent = await callOperator({
        template: template as 'deposit-to-hold',
        tenantQuery,
        mode: 'send',
        requestId: proposal.id,
      });
      resolution =
        sent && sent.status === 'prepared'
          ? `✅ Sent for signing by ${actor} ${tapTime}.`
          : `Approved by ${actor} ${tapTime}, but sending is not enabled yet (${sent?.error ?? 'send disabled'}). Review the preview in AppFolio.`;
    }
  }

  const card = buildOperatorCard({ proposalId: proposal.id, template, tenantQuery, steps: [], resolution });
  const replaced = await respond(responseUrl, { replace_original: true, text: card.text, blocks: card.blocks });
  if (!replaced && proposal.channel_message_id) {
    const target = splitSlackMessageId(proposal.channel_message_id);
    if (target) await updateSlackMessage({ ...target, text: card.text, blocks: card.blocks });
  }
  return new NextResponse(null, { status: 200 });
}

// ── ORS-watch (ors:digest:*) — ingest a newly-found ORS 90 section on tap ──

/**
 * Fetch the section's statute text, embed it, and upsert it into the knowledge
 * base so Dez/Knowledge Chat can answer about it immediately. Replaces the alert
 * with a confirmation. Ingestion is a few seconds (fetch + embed); Slack shows
 * the result via response_url like the other handlers.
 */
async function handleOrsDigest(
  action: { section: string },
  actor: string,
  responseUrl: string | undefined
): Promise<NextResponse> {
  const result = await ingestOrsSection(action.section);
  const time = new Date().toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: '2-digit',
  });
  const text = result.ok
    ? `✅ Digested *ORS ${action.section}${result.title ? ` — ${result.title}` : ''}* into the knowledge base (${actor}, ${time}). Dez can answer about it now.`
    : `⚠️ Couldn't digest ORS ${action.section}: ${result.error ?? 'unknown error'}. Nothing changed.`;

  await respond(responseUrl, {
    replace_original: true,
    text,
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }],
  });
  await logDezActivity({
    kind: 'routine',
    surface: 'dm',
    scope: 'ors-watch',
    actorPerson: actor,
    summary: result.ok ? `digested ORS ${action.section}` : `digest failed ORS ${action.section}`,
    detail: { section: action.section, ok: result.ok, error: result.error ?? null },
  });
  return new NextResponse(null, { status: 200 });
}

// ── Ops Brief (ob:*) — [Acknowledge] on needs-Craig escalations ──

/**
 * Ack = payload annotation on the escalation proposal (they're auto_applied
 * at DM time, so decideProposal doesn't apply). The brief's stored blocks
 * are patched in place — no full re-gather on tap. Idempotent: an already-
 * acknowledged item just re-renders.
 */
async function handleObAction(
  action: { kind: 'ack'; proposalId: string },
  actor: string,
  responseUrl: string | undefined
): Promise<NextResponse> {
  const supabase = getSupabaseAdmin();
  const { data: escRow } = await supabase
    .from('agent_proposal')
    .select('*')
    .eq('id', action.proposalId)
    .maybeSingle();
  const escalation = escRow as AgentProposal | null;
  if (
    !escalation ||
    escalation.agent !== ESTIMATE_CHASER_AGENT ||
    escalation.action_type !== ESCALATE_ACTION
  ) {
    return new NextResponse(null, { status: 200 });
  }
  const escPl = escalation.payload as Record<string, unknown>;
  const tapTime = new Date().toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: '2-digit',
  });

  try {
    if (typeof escPl.acknowledged_by !== 'string') {
      await annotateProposalPayload(action.proposalId, {
        acknowledged_by: actor,
        acknowledged_at: new Date().toISOString(),
        resolution: `Acknowledged by ${actor} ${tapTime}`,
      });
      if (escalation.subject_id) {
        await recordEvent({
          work_order_id: escalation.subject_id,
          event_type: 'note',
          payload: { note: 'Ops brief: escalation acknowledged', source: 'ops_brief' },
          actor,
        });
      }
    }

    // Patch the brief message: find the latest brief whose escalation list
    // contains this item, update its stored blocks, replace the message.
    const { data: briefRows } = await supabase
      .from('agent_proposal')
      .select('*')
      .eq('agent', OPS_BRIEF_AGENT)
      .eq('action_type', SEND_BRIEF_ACTION)
      .order('created_at', { ascending: false })
      .limit(10);
    const brief = ((briefRows ?? []) as AgentProposal[]).find((b) => {
      const ids = (b.payload as Record<string, unknown>).escalation_ids;
      return Array.isArray(ids) && ids.includes(action.proposalId);
    });
    if (brief) {
      const briefPl = brief.payload as Record<string, unknown>;
      const blocks = Array.isArray(briefPl.blocks) ? (briefPl.blocks as unknown[]) : [];
      const patched = applyAckToBlocks(blocks, action.proposalId, actor, tapTime);
      if (patched) {
        await annotateProposalPayload(brief.id, { blocks: patched });
        const text = typeof briefPl.brief_date === 'string' ? `Ops Brief — ${briefPl.brief_date}` : 'Ops Brief';
        const replaced = await respond(responseUrl, {
          replace_original: true,
          text,
          blocks: patched,
        });
        if (!replaced && brief.channel_message_id) {
          const target = splitSlackMessageId(brief.channel_message_id);
          if (target) {
            await updateSlackMessage({ ...target, text, blocks: patched });
          }
        }
      }
    }
  } catch (err) {
    console.error('[Agents] ob action failed:', err instanceof Error ? err.message : String(err));
  }

  return new NextResponse(null, { status: 200 });
}

/**
 * rock:* — one-tap Rock self-report (EOS Brief 2E). Updates rock.status,
 * audits as the tapping human, and rebuilds the owner's card from fresh
 * rows (morning-card strategy). No proposal row involved.
 */
async function handleRockAction(
  action: RockAction,
  actor: string,
  responseUrl: string | undefined
): Promise<NextResponse> {
  const supabase = getSupabaseAdmin();
  try {
    const { data: rock } = await supabase
      .from('rock')
      .select('id, title, status, owner_person, quarter')
      .eq('id', action.rockId)
      .maybeSingle();
    if (!rock) {
      await respond(responseUrl, {
        response_type: 'ephemeral',
        replace_original: false,
        text: 'That Rock no longer exists.',
      });
      return new NextResponse(null, { status: 200 });
    }
    if (rock.status !== action.kind) {
      const { error } = await supabase
        .from('rock')
        .update({ status: action.kind })
        .eq('id', rock.id);
      if (error) throw new Error(error.message);
      await logAudit('rock', rock.id, 'self_report', actor, {
        from: rock.status,
        to: action.kind,
        via: 'slack',
      });
    }

    // Rebuild the whole card for this owner so every row shows current state.
    if (rock.owner_person) {
      const quarter = currentQuarter(new Date());
      const { data: ownerRocks } = await supabase
        .from('rock')
        .select('id, title, status, due_on')
        .eq('org_id', 'hdpm')
        .eq('quarter', quarter)
        .eq('owner_person', rock.owner_person)
        .in('status', ['on', 'off'])
        .order('due_on', { ascending: true, nullsFirst: false });
      const { text, blocks } = buildRockCardBlocks(ownerRocks ?? [], quarter);
      const replaced = await respond(responseUrl, { replace_original: true, text, blocks });
      if (!replaced) {
        console.warn('[Agents] rock card replace failed (response_url)');
      }
    }
  } catch (err) {
    console.error('[Agents] rock action failed:', err instanceof Error ? err.message : String(err));
  }

  return new NextResponse(null, { status: 200 });
}

// ── helpers ──

interface SlackInteractionPayload {
  type?: string;
  user?: { id?: string };
  response_url?: string;
  actions?: unknown[];
}

async function loadWo(id: string): Promise<{ owner_name: string | null; next_action_date: string | null } | null> {
  const { data } = await getSupabaseAdmin()
    .from('work_orders')
    .select('owner_name, next_action_date')
    .eq('id', id)
    .maybeSingle();
  return data ?? null;
}

async function respond(responseUrl: string | undefined, body: Record<string, unknown>): Promise<boolean> {
  if (!responseUrl) return false;
  try {
    const res = await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch (err) {
    console.error('[Agents] response_url post failed:', err instanceof Error ? err.message : String(err));
    return false;
  }
}
