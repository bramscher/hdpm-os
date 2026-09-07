/**
 * Estimate-drafter agent — DB + LLM orchestration.
 *
 * draftEstimateFromWorkOrder loads a work order's text (description + live
 * AppFolio detail + internal timeline notes), asks Claude to select price-book
 * line items, prices them deterministically, and records the draft as an
 * agent_proposal. It does NOT create the estimate — the result pre-populates the
 * builder for a human to review/edit/issue. Read-only against the WO.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getWorkOrderById, type WorkOrder } from '@/lib/work-orders';
import { fetchWorkOrderDetails } from '@/lib/appfolio';
import { listEvents } from '@/lib/maintenance/events';
import { listPriceBookItems } from '@/lib/turn-estimator/price-book';
import { getEstimatorConfig } from '@/lib/turn-estimator/config';
import { createProposal } from '@/lib/agents/proposals';
import { logAudit } from '@/lib/audit';
import {
  ESTIMATE_DRAFTER_AGENT,
  DRAFT_ESTIMATE_ACTION,
  DRAFT_ESTIMATE_SCHEMA,
  priceDraftLines,
  priceBookMenu,
  type AgentDraftResult,
  type DraftedLine,
} from './estimate-drafter';

// Lazy singleton — same pattern as lib/rag.ts / lib/maintenance/ai-triage.ts
let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!_anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY or CLAUDE_API_KEY is not set');
    _anthropic = new Anthropic({ apiKey });
  }
  return _anthropic;
}

/**
 * Frozen system prompt (no timestamps/IDs → prompt-cacheable). The price book is
 * passed in the user message, not here, so it can change without busting the cache.
 */
const DRAFTER_SYSTEM = `You draft maintenance estimates for High Desert Property Management (HDPM), a property manager in Bend, Oregon. HDMS is HDPM's in-house crew. Your job: read a work order and select the price-book line items that cover the work, with quantities. You do NOT set prices — a deterministic engine prices your selections from the price book.

Rules:
- Choose ONLY item_code values from the price book provided in the message. Never invent a code. Pick the closest fit.
- One line per distinct task or material. Combine nothing; split nothing that is one job.
- Set only the numeric fields a line's pricing method needs:
  - service_min / hourly items: set "minutes" (on-site time) and, when you can estimate it, "est_labor_hours".
  - cost_plus / materials items: set "est_material_cost" (your best dollar estimate of the parts/vendor cost).
  - flat / per_qty / package / allowance items: set "qty" (default 1); leave minutes/material blank.
- Base everything ONLY on the work-order text. Do not invent facts, rooms, or quantities. If a quantity is unclear, use 1 and lower the confidence.
- Set "confidence" per line: high = the text clearly calls for this; medium = reasonable inference; low = a guess.
- Put anything the work order asks for that no price-book item covers into "unmapped_notes" — never force an ill-fitting code and never silently drop scope.
- Prefer a single service-call minimum plus time for small multi-task visits; the engine handles minimum bundling, so still pick the right items.
- "summary" is one short paragraph for the human reviewer describing the scope you drafted.`;

/** Build the user message from the WO text + AppFolio detail + timeline notes. */
export function buildDrafterInput(
  wo: WorkOrder,
  appfolio: Awaited<ReturnType<typeof fetchWorkOrderDetails>>,
  events: Awaited<ReturnType<typeof listEvents>>,
  menu: string
): string {
  const lines: string[] = [];
  const push = (label: string, value: unknown) => {
    if (value !== null && value !== undefined && value !== '') lines.push(`${label}: ${value}`);
  };

  lines.push('## Price book (choose item_code values from this list only)');
  lines.push(menu);

  lines.push('', '## Work order');
  push('Number', wo.wo_number);
  push('Property/Unit', wo.unit_name ? `${wo.property_name} #${wo.unit_name}` : wo.property_name);
  push('Description', wo.description);
  push('AppFolio status', wo.appfolio_status);
  push('Priority', wo.priority);
  push('Is a unit turn', wo.is_turn ? 'yes' : undefined);

  if (appfolio) {
    lines.push('', '## AppFolio detail');
    push('Tenant remarks', appfolio.TenantRemarks);
    push('Work order issue', appfolio.WorkOrderIssue);
    push('Vendor instructions', appfolio.VendorInstructions);
    push('Entry instructions', appfolio.EntryInstructions);
    push('Type', appfolio.Type);
  }

  const notes = events
    .filter((e) => typeof e.payload?.note === 'string' && (e.payload.note as string).trim())
    .slice(-15);
  if (notes.length > 0) {
    lines.push('', '## Internal notes (oldest first)');
    for (const e of notes) lines.push(`- ${e.created_at.slice(0, 10)} (${e.actor}): ${e.payload.note}`);
  }

  lines.push('', 'Draft the estimate line items for this work order.');
  return lines.join('\n');
}

export async function callDraftModel(input: string): Promise<AgentDraftResult> {
  const client = getAnthropic();
  const response = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 4000,
    thinking: { type: 'adaptive' },
    system: [{ type: 'text', text: DRAFTER_SYSTEM, cache_control: { type: 'ephemeral' } }],
    output_config: {
      format: { type: 'json_schema', schema: DRAFT_ESTIMATE_SCHEMA as unknown as Record<string, unknown> },
    },
    messages: [{ role: 'user', content: input }],
  });
  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === 'text'
  );
  if (!textBlock) throw new Error(`estimate drafter returned no text (stop_reason: ${response.stop_reason})`);
  return JSON.parse(textBlock.text) as AgentDraftResult;
}

export interface DraftEstimateOutcome {
  work_order_id: string;
  wo_number: string | null;
  property_name: string | null;
  unit_name: string | null;
  unit_turn_id: string | null;
  lines: DraftedLine[];
  owner_total: number;
  internal_cost_total: number;
  /** Model notes + any hallucinated codes that were dropped. */
  unmapped_notes: string[];
  summary: string;
  proposal_id: string;
}

/**
 * Draft an estimate from a work order. Loads WO text, asks Claude to select
 * price-book lines, prices them deterministically, records an agent_proposal,
 * and returns the priced draft for the builder. Does not persist an estimate.
 */
export async function draftEstimateFromWorkOrder(
  workOrderId: string,
  actor: string
): Promise<DraftEstimateOutcome> {
  const wo = await getWorkOrderById(workOrderId);
  if (!wo) throw new Error(`work order not found: ${workOrderId}`);

  const [appfolio, events, priceBook, cfg] = await Promise.all([
    wo.appfolio_id ? fetchWorkOrderDetails(wo.appfolio_id).catch(() => null) : Promise.resolve(null),
    listEvents(workOrderId).catch(() => []),
    listPriceBookItems(),
    getEstimatorConfig(),
  ]);

  const input = buildDrafterInput(wo, appfolio, events, priceBookMenu(priceBook));
  const result = await callDraftModel(input);

  const priced = priceDraftLines(result.lines ?? [], priceBook, cfg);

  // Surface any hallucinated codes alongside the model's own unmapped notes.
  const unmapped_notes = [
    ...(result.unmapped_notes ?? []),
    ...priced.unmapped_codes.map((c) => `Dropped unrecognized price-book code "${c}".`),
  ];

  const proposal = await createProposal({
    agent: ESTIMATE_DRAFTER_AGENT,
    subject_type: 'work_order',
    subject_id: workOrderId,
    action_type: DRAFT_ESTIMATE_ACTION,
    payload: {
      wo_number: wo.wo_number,
      lines: priced.lines,
      owner_total: priced.owner_total,
      internal_cost_total: priced.internal_cost_total,
      unmapped_notes,
    },
    rationale: result.summary ?? null,
  });

  await logAudit('work_order', workOrderId, 'estimate_drafted', `agent:${ESTIMATE_DRAFTER_AGENT}`, {
    proposal_id: proposal.id,
    line_count: priced.lines.length,
    owner_total: priced.owner_total,
    unmapped: unmapped_notes.length,
  });

  return {
    work_order_id: workOrderId,
    wo_number: wo.wo_number,
    property_name: wo.property_name,
    unit_name: wo.unit_name,
    unit_turn_id: wo.unit_turn_id,
    lines: priced.lines,
    owner_total: priced.owner_total,
    internal_cost_total: priced.internal_cost_total,
    unmapped_notes,
    summary: result.summary ?? '',
    proposal_id: proposal.id,
  };
}
