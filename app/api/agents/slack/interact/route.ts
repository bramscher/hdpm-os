import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifySlackSignature } from '@/lib/webhook-verify';
import { resolveStaffBySlackId } from '@/lib/agents/staff';
import { decideProposal } from '@/lib/agents/proposals';
import { annotateProposalPayload, rebuildCard } from '@/lib/agents/morning-card-run';
import { parseBlockAction, snoozeDate, isValidYmd } from '@/lib/agents/morning-card';
import { parseEcActionId, ESTIMATE_CHASER_AGENT, VENDOR_CHASE_SMS_ACTION, ESCALATE_ACTION } from '@/lib/agents/estimate-chaser';
import { rebuildSmsQueueCard } from '@/lib/agents/estimate-chaser-run';
import { parseObActionId, applyAckToBlocks, OPS_BRIEF_AGENT, SEND_BRIEF_ACTION } from '@/lib/agents/ops-brief';
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
        if (decided) {
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
