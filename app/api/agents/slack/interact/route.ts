import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifySlackSignature } from '@/lib/webhook-verify';
import { resolveStaffBySlackId } from '@/lib/agents/staff';
import { decideProposal } from '@/lib/agents/proposals';
import { annotateProposalPayload, rebuildCard } from '@/lib/agents/morning-card-run';
import { parseBlockAction, snoozeDate, isValidYmd } from '@/lib/agents/morning-card';
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
