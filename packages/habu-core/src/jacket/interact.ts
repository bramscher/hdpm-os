/**
 * The self-closing loop (§7), as pure logic. One entry point resolves a card
 * action — a human tap OR an inbound external event — advances the jacket, and
 * returns the new state + the collapsed/updated card. The tenant's Slack
 * interact route and webhook handler both call this; neither re-implements it.
 *
 * §7 step 3 is the point of the whole design: when an action lands elsewhere,
 * the external event matches the active step and completes it — the human never
 * comes back to report. Fallback (requires:'tap') completes on the button.
 */

import { advanceStep, projectJacket } from './engine';
import { buildCardModel, type CardModel } from './card';
import type { ExternalMatch, Jacket, JacketStep } from './types';

export interface ExternalEvent {
  source: string; // 'twilio' | 'appfolio' | 'email' | 'webhook' | ...
  event_type: string;
  subject_key: string;
}

function matchesExternal(m: ExternalMatch | null, e: ExternalEvent): boolean {
  return !!m && m.source === e.source && m.event_type === e.event_type && m.subject_key === e.subject_key;
}

/** The active step an inbound event closes (§7 step 3), or null. */
export function matchExternalEvent(steps: JacketStep[], event: ExternalEvent): JacketStep | null {
  return (
    steps.find((s) => s.state === 'active' && matchesExternal(s.external_match, event)) ?? null
  );
}

export type JacketActionInput =
  | { kind: 'tap'; step_id: string; actor: string }
  | { kind: 'external'; event: ExternalEvent };

export interface JacketActionResult {
  jacket: Jacket;
  steps: JacketStep[];
  card: CardModel;
  /** what happened, for audit + the collapsed card line. */
  transition:
    | { type: 'advanced'; completed_step_id: string; activated_step_id: string | null; by: string }
    | { type: 'completed'; completed_step_id: string; by: string } // last step → jacket done
    | { type: 'noop'; reason: string };
}

/**
 * Resolve one action against a jacket. `at` is an ISO timestamp; `today` a
 * tenant-tz YYYY-MM-DD for attention/overdue. `detailsHref` builds the details
 * link. Pure: returns new arrays; never mutates the inputs.
 */
export function applyJacketAction(
  jacket: Jacket,
  steps: JacketStep[],
  input: JacketActionInput,
  ctx: { at: string; today: string; detailsHref?: (jacketId: string) => string }
): JacketActionResult {
  let stepId: string | null = null;
  let actor: string;

  if (input.kind === 'tap') {
    stepId = input.step_id;
    actor = input.actor;
  } else {
    const step = matchExternalEvent(steps, input.event);
    stepId = step?.id ?? null;
    actor = `system:${input.event.source}`;
  }

  if (!stepId) {
    const projected = projectJacket(jacket, steps, { today: ctx.today });
    return {
      jacket: projected,
      steps,
      card: buildCardModel(projected, steps, { today: ctx.today, detailsHref: ctx.detailsHref }),
      transition: { type: 'noop', reason: input.kind === 'external' ? 'no matching active step' : 'unknown step' },
    };
  }

  const adv = advanceStep(steps, stepId, { actor, at: ctx.at });
  const projected = projectJacket(jacket, adv.steps, { today: ctx.today });

  const resolution = adv.jacket_done
    ? `done ${ctx.at.slice(0, 10)}`
    : adv.activatedStepId
      ? `step done · moved on`
      : `step done`;

  const card = buildCardModel(projected, adv.steps, {
    today: ctx.today,
    detailsHref: ctx.detailsHref,
    resolution,
  });

  return {
    jacket: projected,
    steps: adv.steps,
    card,
    transition: adv.jacket_done
      ? { type: 'completed', completed_step_id: stepId, by: actor }
      : { type: 'advanced', completed_step_id: stepId, activated_step_id: adv.activatedStepId, by: actor },
  };
}
