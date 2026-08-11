/**
 * The jacket card (§7) — "one line, one color, one button."
 *
 * Design law: everything else is behind a tap. A neutral CardModel is the
 * single source; `toSlackBlocks` renders it for the Slack chassis (the §8.3
 * acceptance gate) and the web/App-Home detail view renders the same model.
 * A done jacket collapses to a single ✅ line.
 */

import type { Jacket, JacketAttention, JacketStep } from './types';
import { leadStep } from './engine';

/** Status dot (§7): the derived attention, NOT the process color (App A.0). */
const ATTENTION_EMOJI: Record<JacketAttention, string> = { now: '🔴', soon: '🟡', none: '🟢' };

export interface CardAction {
  /** Stable action id the interact endpoint parses: 'jacket:<jacketId>:step:<stepId>'. */
  action_id: string;
  label: string;
  style?: 'primary' | 'default';
}

export interface CardModel {
  jacket_id: string;
  collapsed: boolean; // done/cancelled → single-line ✅
  emoji: string;
  title: string;
  /** active step label, or the resolution line when collapsed. */
  subtitle: string;
  /** exactly one primary action when open; none when collapsed. */
  action: CardAction | null;
  details_href: string | null;
  overdue: boolean;
}

export function stepActionId(jacketId: string, stepId: string): string {
  return `jacket:${jacketId}:step:${stepId}`;
}

export function parseStepActionId(id: string): { jacket_id: string; step_id: string } | null {
  const m = /^jacket:([^:]+):step:(.+)$/.exec(id);
  return m ? { jacket_id: m[1], step_id: m[2] } : null;
}

/**
 * Build the card model for a jacket. When open, the primary action is the lead
 * active step (§7: if a card needs two primary actions, it's two steps — fix
 * the template). `resolution` supplies the collapsed one-liner.
 */
export function buildCardModel(
  jacket: Jacket,
  steps: JacketStep[],
  opts: { today?: string; detailsHref?: (jacketId: string) => string; resolution?: string } = {}
): CardModel {
  const detailsHref = opts.detailsHref?.(jacket.id) ?? null;

  if (jacket.status !== 'open') {
    return {
      jacket_id: jacket.id,
      collapsed: true,
      emoji: '✅',
      title: jacket.title,
      subtitle: opts.resolution ?? (jacket.status === 'cancelled' ? 'cancelled' : 'done'),
      action: null,
      details_href: detailsHref,
      overdue: false,
    };
  }

  const step = leadStep(steps);
  const overdue = !!(opts.today && step?.due_on && step.due_on < opts.today);
  return {
    jacket_id: jacket.id,
    collapsed: false,
    emoji: ATTENTION_EMOJI[jacket.attention],
    title: jacket.title,
    subtitle: step ? step.label : 'no active step',
    action: step ? { action_id: stepActionId(jacket.id, step.id), label: primaryLabel(step), style: 'primary' } : null,
    details_href: detailsHref,
    overdue,
  };
}

function primaryLabel(step: JacketStep): string {
  // A short imperative from the step label's first clause.
  return step.label.split(/[—:(]/)[0].trim().slice(0, 40) || 'Do it';
}

// ---- Slack Block Kit adapter ----

export interface SlackBlock {
  type: string;
  [k: string]: unknown;
}

/** Render a CardModel as Slack blocks: one section + (when open) one actions block. */
export function toSlackBlocks(model: CardModel): SlackBlock[] {
  const overdueTag = model.overdue ? '  ·  *overdue*' : '';
  const section: SlackBlock = {
    type: 'section',
    text: { type: 'mrkdwn', text: `${model.emoji}  *${model.title}*\n${model.subtitle}${overdueTag}` },
  };
  if (model.collapsed || !model.action) return [section];

  const elements: SlackBlock[] = [
    {
      type: 'button',
      action_id: model.action.action_id,
      text: { type: 'plain_text', text: model.action.label },
      style: model.action.style === 'primary' ? 'primary' : undefined,
    },
  ];
  if (model.details_href) {
    elements.push({
      type: 'button',
      action_id: `details:${model.jacket_id}`,
      text: { type: 'plain_text', text: 'details ↗' },
      url: model.details_href,
    });
  }
  return [section, { type: 'actions', elements }];
}
