/**
 * Dez → "open estimates" card.
 *
 * On a natural-language ask in Slack ("show me the open estimates", "send Craig
 * the open estimates"), Dez gathers EVERY open estimate work order (the TW11
 * pool), groups them by state, and posts one actionable card — each line links
 * straight to the WO in AppFolio. Read-only: it lists the work, it doesn't chase
 * or send anything. The target is the named person (default: the asker).
 *
 * State groups (priority order): escalated → bid-in-hand (needs approval) →
 * waiting on vendor bid → recently chased (cooldown).
 */

import {
  gatherOpenEstimates,
  type OpenEstimateItem,
  type OpenEstimateState,
} from '@/lib/agents/estimate-chaser-run';
import { resolveStaffByPersonOrEmail } from '@/lib/agents/staff';
import { sendSlackMessage } from '@/lib/agents/channels/slack';

export const DEZ_OPEN_ESTIMATES_AGENT = 'dez_open_estimates';

// ── Intent ──────────────────────────────────────────────────────────────────

const ESTIMATE_RE = /\bestimates?\b/i;
const OPEN_RE = /\b(open|outstanding|stuck|pending|unresolved|standing)\b/i;
// A metrics/count question ("how many open estimates?") belongs to the KPI lane,
// not this card — let it fall through.
const COUNT_GUARD =
  /\b(how many|how much|number of|count of|percentage|percent|what'?s? (our|the)\b.*\brate)\b/i;
// Words that follow the verb but are NOT a person (so "send me" → asker).
const NOT_A_NAME = new Set(['me', 'us', 'the', 'all', 'my', 'our', 'a', 'an', 'these', 'those', 'them']);

/**
 * Detect an "open estimates" card request and extract the target person.
 * Returns { targetName: null } when no explicit person is named (→ the asker).
 * Pure. Returns null when it isn't an open-estimates request.
 */
export function matchOpenEstimatesRequest(question: string): { targetName: string | null } | null {
  if (!ESTIMATE_RE.test(question) || !OPEN_RE.test(question)) return null;
  if (COUNT_GUARD.test(question)) return null;

  const forMatch = question.match(/\bfor\s+([A-Za-z]+)\b/i);
  const sendMatch = question.match(/\b(?:send|give|dm|show|get|pull\s+up|deliver)\s+([A-Za-z]+)\b/i);
  const candidate = (forMatch?.[1] ?? sendMatch?.[1] ?? '').trim();
  const targetName = candidate && !NOT_A_NAME.has(candidate.toLowerCase()) ? candidate : null;
  return { targetName };
}

// ── Card ─────────────────────────────────────────────────────────────────────

const STATE_ORDER: OpenEstimateState[] = ['escalated', 'approval', 'waiting', 'cooldown'];
const STATE_META: Record<OpenEstimateState, { emoji: string; label: string }> = {
  escalated: { emoji: '🔴', label: 'Escalated' },
  approval: { emoji: '🟠', label: 'Bid in hand — needs approval' },
  waiting: { emoji: '🟡', label: 'Waiting on vendor bid' },
  cooldown: { emoji: '⚪', label: 'Recently chased (cooldown)' },
};

const MAX_SECTION_CHARS = 2800; // Slack section text cap is 3000; stay under.

function itemLine(it: OpenEstimateItem): string {
  const where = [it.propertyName || it.propertyAddress, it.unitName ? `#${it.unitName}` : null]
    .filter(Boolean)
    .join(' ');
  const vendor = it.vendorName ? ` · ${it.vendorName}` : '';
  const age = `${it.ageCalendarDays}d`;
  const wo = it.woNumber ? `WO #${it.woNumber}` : 'WO';
  const link = it.appfolioLink ? ` · <${it.appfolioLink}|AppFolio↗>` : '';
  return `• *${wo}* — ${where || 'unknown location'}${vendor} · ${age}${link}`;
}

/** Pack lines into section blocks, each under Slack's per-section char cap. */
function packSections(lines: string[]): unknown[] {
  const blocks: unknown[] = [];
  let buf = '';
  for (const line of lines) {
    if (buf && buf.length + line.length + 1 > MAX_SECTION_CHARS) {
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: buf } });
      buf = '';
    }
    buf = buf ? `${buf}\n${line}` : line;
  }
  if (buf) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: buf } });
  return blocks;
}

/**
 * Build the open-estimates card. Pure. Items are grouped by state (priority
 * order) with a bold subheader per group; every line carries an AppFolio deep
 * link. `forName` is who the card is for (shown in the header).
 */
export function buildOpenEstimatesCard(input: {
  items: OpenEstimateItem[];
  forName: string;
}): { text: string; blocks: unknown[] } {
  const { items, forName } = input;
  if (items.length === 0) {
    return {
      text: `No open estimates for ${forName} 🎉`,
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `📋 *No open estimates* right now, ${forName}. 🎉` },
        },
      ],
    };
  }

  const byState = new Map<OpenEstimateState, OpenEstimateItem[]>();
  for (const it of items) {
    if (!byState.has(it.state)) byState.set(it.state, []);
    byState.get(it.state)!.push(it);
  }
  for (const list of byState.values()) list.sort((a, b) => b.ageCalendarDays - a.ageCalendarDays);

  const summary = STATE_ORDER.filter((s) => byState.has(s))
    .map((s) => `${STATE_META[s].emoji} ${byState.get(s)!.length} ${STATE_META[s].label.toLowerCase()}`)
    .join(' · ');

  const blocks: unknown[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `📋 *Open estimates — ${items.length} total* (for ${forName})`,
      },
    },
    { type: 'context', elements: [{ type: 'mrkdwn', text: summary }] },
  ];

  for (const state of STATE_ORDER) {
    const list = byState.get(state);
    if (!list || list.length === 0) continue;
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${STATE_META[state].emoji} *${STATE_META[state].label}* (${list.length})`,
      },
    });
    for (const b of packSections(list.map(itemLine))) blocks.push(b);
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: 'Read-only snapshot · tap a WO to open it in AppFolio. Dez isn’t chasing these — it’s showing you the work.',
      },
    ],
  });

  // Slack hard-caps a message at 50 blocks; trim defensively (huge pools only).
  const capped = blocks.slice(0, 48);
  if (capped.length < blocks.length) {
    capped.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '…list truncated to fit Slack — open the invoices/board view for the full set.' }],
    });
  }

  return { text: `Open estimates — ${items.length} total for ${forName}`, blocks: capped };
}

// ── Post ─────────────────────────────────────────────────────────────────────

/**
 * Gather the open estimates and deliver the card. If a target person is named
 * and differs from the asker, the card is DM'd to them and the asker gets a
 * short ack in the source channel; otherwise the card posts in the source
 * channel. Never throws — returns a small result for logging.
 */
export async function postOpenEstimatesCard(ctx: {
  requesterPerson: string;
  sourceChannel: string;
  threadTs?: string;
  targetName: string | null;
  now?: Date;
}): Promise<{ delivered: 'self' | 'dm' | 'ack_only'; count: number; targetPerson: string | null }> {
  const { requesterPerson, sourceChannel, threadTs, targetName } = ctx;

  // Resolve the target; fall back to the asker if the named person isn't found
  // or has no Slack id (so a bad name still delivers something useful).
  const named = targetName ? await resolveStaffByPersonOrEmail(targetName) : null;
  const target = named?.slack_user_id ? named : null;
  const isSelf = !target || target.person.toLowerCase() === requesterPerson.toLowerCase();

  const items = await gatherOpenEstimates(ctx.now);
  const forName = target ? target.person : requesterPerson;
  const card = buildOpenEstimatesCard({ items, forName });

  if (isSelf) {
    await sendSlackMessage({ channel: sourceChannel, text: card.text, blocks: card.blocks, thread_ts: threadTs });
    return { delivered: 'self', count: items.length, targetPerson: forName };
  }

  // DM the target, then ack the asker in the channel they asked from.
  const dmOk = await safeSend({ channel: target!.slack_user_id!, text: card.text, blocks: card.blocks });
  if (!dmOk) {
    // Couldn't DM — post the card where they asked so nothing is lost.
    await sendSlackMessage({ channel: sourceChannel, text: card.text, blocks: card.blocks, thread_ts: threadTs });
    return { delivered: 'self', count: items.length, targetPerson: forName };
  }
  await sendSlackMessage({
    channel: sourceChannel,
    text: `📋 Sent the ${items.length} open estimate${items.length === 1 ? '' : 's'} to ${target!.person}.`,
    thread_ts: threadTs,
  });
  return { delivered: 'dm', count: items.length, targetPerson: target!.person };
}

async function safeSend(input: { channel: string; text: string; blocks: unknown[] }): Promise<boolean> {
  try {
    await sendSlackMessage(input);
    return true;
  } catch (err) {
    console.error('[dez/open-estimates] DM failed:', err instanceof Error ? err.message : err);
    return false;
  }
}
