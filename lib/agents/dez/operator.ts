/**
 * Dez → AppFolio operator worker client + intent.
 *
 * The operator worker (separate Railway service, services/dez-operator) does
 * web-app-only AppFolio actions the v0 API can't — starting with the
 * deposit-to-hold form merge. This module detects the request, signs the call
 * (HMAC contract matching services/dez-operator/src/sign.ts), and provides the
 * op:* Slack action-id helpers for the approve/discard buttons.
 *
 * Feature is OFF unless DEZ_OPERATOR_URL is set (and agent_config enables it +
 * the kill switch is off — checked in the events route). `send` mode is never
 * automatic; it only runs from an explicit human [Approve & Send] tap.
 */

import { createHmac } from 'node:crypto';

export const OPERATOR_AGENT = 'dez_operator';
export const FORM_MERGE_ACTION = 'form_merge';

export interface OperatorRequest {
  template: 'deposit-to-hold';
  tenantQuery: string;
}

// Only the deposit-to-hold form is wired today; more templates = more phrases.
const TEMPLATE_PHRASES: { re: RegExp; template: 'deposit-to-hold' }[] = [
  { re: /deposit[\s-]*to[\s-]*hold|deposit to hold agreement|deposit hold/i, template: 'deposit-to-hold' },
];
// Action verbs staff actually use to ask Dez to PRODUCE a form. Kept broad so
// natural phrasing ("can I get… for…", "make me a… for…") works.
const REQUEST_VERBS =
  /\b(prepare|prep|fill|generate|create|draft|start|make|do|issue|get|need|want|run|produce|put\s+together|set\s+up|send\s+out)\b/i;

// Genuine how-it-works questions ABOUT the form (not a request to produce one) —
// these must still fall through to the SOP/RAG answer, not fire the worker.
const QUESTION_GUARD =
  /\b(how|what|what's|whats|when|why|which|where|explain|policy|process|procedure|difference|meaning|means|do i need|should i)\b/i;

/**
 * Detect an operator request like "prepare the deposit-to-hold for Bryce
 * Bramscher" or "can I get a deposit to hold for Jane Doe?". Requires an action
 * verb + a known template + a "for <name>", and is NOT a how-it-works question.
 * Pure. Returns null when it isn't an operator request (falls through to Q&A).
 */
export function matchOperatorRequest(question: string): OperatorRequest | null {
  if (QUESTION_GUARD.test(question)) return null; // asking ABOUT the form, not for one
  if (!REQUEST_VERBS.test(question)) return null;
  const tpl = TEMPLATE_PHRASES.find((t) => t.re.test(question));
  if (!tpl) return null;
  const forMatch = question.match(/\bfor\s+(.+?)\s*$/i);
  const tenantQuery = forMatch ? forMatch[1].replace(/[?.!]+$/, '').trim() : '';
  if (!tenantQuery) return null;
  return { template: tpl.template, tenantQuery };
}

// ── signed contract with the worker ──

function signBody(secret: string, timestamp: string, rawBody: string): string {
  return 'v1=' + createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

export interface OperatorResult {
  status: 'prepared' | 'error';
  previewImageBase64?: string;
  steps?: string[];
  error?: string;
}

/**
 * Call the operator worker. Returns null when the feature is off (no
 * DEZ_OPERATOR_URL) so callers can treat "not configured" as "not available".
 */
export async function callOperator(input: {
  template: 'deposit-to-hold';
  tenantQuery: string;
  mode: 'prepare' | 'send';
  requestId: string;
}): Promise<OperatorResult | null> {
  const url = process.env.DEZ_OPERATOR_URL;
  const secret = process.env.DEZ_OPERATOR_SECRET;
  if (!url || !secret) return null;

  const rawBody = JSON.stringify(input);
  const ts = String(Math.floor(Date.now() / 1000));
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/operator/form-merge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-dez-timestamp': ts,
        'x-dez-signature': signBody(secret, ts, rawBody),
      },
      body: rawBody,
    });
    return (await res.json()) as OperatorResult;
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Slack op:* action-id helpers (approve/discard on the preview card) ──

export type OperatorAction = { kind: 'approve' | 'discard'; proposalId: string };

export function buildOperatorActionId(kind: 'approve' | 'discard', proposalId: string): string {
  return `op:${kind}:${proposalId}`;
}

/** Parse an op:* action id. Pure. Returns null if not an operator action. */
export function parseOperatorActionId(actionId: string): OperatorAction | null {
  const m = actionId.match(/^op:(approve|discard):(.+)$/);
  if (!m) return null;
  return { kind: m[1] as 'approve' | 'discard', proposalId: m[2] };
}

/** The Slack card shown after a merged preview is prepared. Pure. */
export function buildOperatorCard(input: {
  proposalId: string;
  template: string;
  tenantQuery: string;
  steps: string[];
  resolution?: string;
}): { text: string; blocks: unknown[] } {
  const title = `📄 Prepared *${input.template}* for *${input.tenantQuery}* — merged preview ready in AppFolio.`;
  const blocks: unknown[] = [
    { type: 'section', text: { type: 'mrkdwn', text: title } },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `🔧 dez · operator · ${input.steps.join(' → ')}` }],
    },
  ];
  if (input.resolution) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: input.resolution }] });
  } else {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          style: 'primary',
          text: { type: 'plain_text', text: 'Approve & Send' },
          action_id: buildOperatorActionId('approve', input.proposalId),
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Discard' },
          action_id: buildOperatorActionId('discard', input.proposalId),
        },
      ],
    });
    blocks.push({
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: '⚠️ Sending for signature is gated — review the preview in AppFolio first.' },
      ],
    });
  }
  return { text: `Prepared ${input.template} for ${input.tenantQuery}`, blocks };
}
