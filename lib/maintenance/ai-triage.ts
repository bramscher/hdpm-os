/**
 * Maintenance OS — AI Next Action Panel.
 *
 * For one work order, Claude generates a structured triage: plain-English
 * summary, priority recommendation (against the P1–P4 SLA table), risk flags,
 * blocker classification, recommended next action, a draft message, and an
 * AppFolio update checklist. Read-only and advisory — a human applies the
 * checklist in AppFolio; nothing is written back automatically.
 *
 * Generated on demand (button on the WO detail page); results are cached as
 * wo_event rows (event_type 'ai_triage') so repeat views cost nothing.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { AppFolioWorkOrder } from '@/lib/appfolio';
import type { MaintWorkOrder, WoEvent } from './types';

// Lazy singleton — same pattern as lib/rag.ts
let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!_anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY or CLAUDE_API_KEY environment variable is not set');
    }
    _anthropic = new Anthropic({ apiKey });
  }
  return _anthropic;
}

// ============================================
// Output contract
// ============================================

export interface AiTriage {
  summary: string;
  priority: {
    recommended: 'P1' | 'P2' | 'P3' | 'P4';
    rationale: string;
    escalate_if: string[];
  };
  risk_flags: string[];
  blocker: {
    classification: 'NONE' | 'TENANT' | 'VENDOR' | 'PARTS' | 'OWNER' | 'WEATHER' | 'INTERNAL';
    detail: string;
  };
  next_action: string;
  draft_message: {
    audience: 'tenant' | 'vendor' | 'owner' | 'internal';
    subject: string;
    body: string;
  };
  appfolio_checklist: string[];
}

const TRIAGE_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: 'Plain-English summary of the situation in 1–3 sentences: what is reported, what has been tried, what is unknown.',
    },
    priority: {
      type: 'object',
      properties: {
        recommended: { type: 'string', enum: ['P1', 'P2', 'P3', 'P4'] },
        rationale: { type: 'string', description: 'One sentence tying the recommendation to the SLA table.' },
        escalate_if: {
          type: 'array',
          items: { type: 'string' },
          description: 'Concrete conditions that would raise the priority (e.g. "tenant confirms active leak").',
        },
      },
      required: ['recommended', 'rationale', 'escalate_if'],
      additionalProperties: false,
    },
    risk_flags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Habitability, safety, liability, or cost risks visible in the data. Empty if none.',
    },
    blocker: {
      type: 'object',
      properties: {
        classification: {
          type: 'string',
          enum: ['NONE', 'TENANT', 'VENDOR', 'PARTS', 'OWNER', 'WEATHER', 'INTERNAL'],
          description: 'What the job is currently waiting on, if anything.',
        },
        detail: { type: 'string' },
      },
      required: ['classification', 'detail'],
      additionalProperties: false,
    },
    next_action: {
      type: 'string',
      description: 'The single most useful next step, concrete enough to act on today.',
    },
    draft_message: {
      type: 'object',
      properties: {
        audience: { type: 'string', enum: ['tenant', 'vendor', 'owner', 'internal'] },
        subject: { type: 'string' },
        body: { type: 'string', description: 'Ready to paste. Professional, warm, specific. No placeholders except [NAME] where the recipient name is unknown.' },
      },
      required: ['audience', 'subject', 'body'],
      additionalProperties: false,
    },
    appfolio_checklist: {
      type: 'array',
      items: { type: 'string' },
      description: 'Ordered steps for the coordinator to apply in AppFolio (status to set, note to add, vendor to assign, date to set).',
    },
  },
  required: [
    'summary',
    'priority',
    'risk_flags',
    'blocker',
    'next_action',
    'draft_message',
    'appfolio_checklist',
  ],
  additionalProperties: false,
} as const;

// ============================================
// Prompts
// ============================================

/**
 * Stable system prompt — keep frozen (no timestamps/IDs) so prompt caching
 * can apply as it grows past the model's minimum cacheable prefix.
 * Ops rules from docs/maintenance-os/02-functional-spec.md.
 */
const TRIAGE_SYSTEM = `You are the maintenance triage assistant for High Desert Property Management (HDPM), a property manager in Bend, Oregon (~850 doors). HDMS is HDPM's in-house maintenance crew (techs: Alberto — lead tech, Brody — inspector/small maintenance) and is dispatched first; external vendors are chosen overflow. Cheryl is the maintenance coordinator who triages, dispatches, chases vendor estimates, and handles owner approvals (PMs do no maintenance work). AppFolio is the system of record.

Priority classes and SLAs (seed values):
- P1 Emergency — active water intrusion, fire/smoke, gas, electrical hazard, sewage backup, no heat in cold weather, security/life-safety. SLA: acknowledge <= 1 hr, dispatch same day.
- P2 Urgent — no water, only toilet down, refrigerator failure, contained major leak. SLA: triage same business day, schedule <= 48 hrs.
- P3 Routine — minor plumbing/electrical, appliance issue without loss of function of the home, doors/windows. SLA: triage <= 1 business day, schedule <= 7 days.
- P4 Planned — preventive work, unit turns, owner improvements. Per plan.

Work order lifecycle stages: NEW -> TRIAGED -> SCHEDULED -> IN_PROGRESS -> WAITING_ON -> VERIFY -> BILL -> CLOSED. WAITING_ON always has a reason: TENANT, VENDOR, PARTS, OWNER, WEATHER, or INTERNAL.

AppFolio statuses you may see: New, Assigned, Scheduled, Estimate Requested (waiting on a vendor bid), Estimated (bid in hand, decision pending), Waiting, Work Completed, Completed, Canceled.

Rules:
- Base everything ONLY on the data provided. Never invent facts, names, dates, or history.
- Be conservative about emergencies: if the data leaves a P1 indicator unresolved (possible active leak, electrical burning smell, no heat, security issue), say so in escalate_if and make the next action a clarifying question to the tenant.
- Prefer dispatching HDMS (Alberto/Brody) for work within a handyman/tech scope; recommend vendors for licensed trades (plumbing beyond minor, electrical beyond minor, HVAC, roofing) or overflow.
- Draft messages: professional, warm, concise, specific to this work order. Sign as "High Desert Property Management". Never promise a time you don't have.
- The AppFolio checklist is applied by a human in AppFolio — phrase steps as concrete UI actions (set status, add note, assign vendor, set scheduled date).`;

// ============================================
// Input assembly (pure — unit-testable)
// ============================================

export interface TriageExtras {
  /** Raw AppFolio fields fetched live at generation time (richer than the mirror). */
  appfolio?: Partial<{
    TenantRemarks: string;
    EntryInstructions: string;
    PreferredTimes: string;
    TenantAvailability: string;
    VendorInstructions: string;
    WorkOrderIssue: string;
    SmartMaintenanceUrgency: string;
    Type: string;
  }> | null;
  vendorName?: string | null;
}

/** Build the user message. Pure. */
export function buildTriageInput(
  wo: MaintWorkOrder,
  events: WoEvent[],
  extras: TriageExtras = {}
): string {
  const lines: string[] = [];
  const push = (label: string, value: unknown) => {
    if (value !== null && value !== undefined && value !== '') lines.push(`${label}: ${value}`);
  };

  lines.push('## Work order');
  push('Number', wo.wo_number);
  push('Property/Unit', wo.unit_name ? `${wo.property_name} #${wo.unit_name}` : wo.property_name);
  push('Description', wo.description);
  push('AppFolio status', wo.appfolio_status);
  push('AppFolio priority (free text)', wo.priority);
  push('Created (AppFolio)', wo.appfolio_created_at ?? wo.created_at);
  push('Board stage', wo.stage);
  push('Waiting reason', wo.waiting_reason);
  push('Current priority class', wo.priority_class ?? 'not set');
  push('HDPM owner', wo.owner_name);
  push('Next action date', wo.next_action_date);
  push('Assigned tech', wo.assigned_tech);
  push('Vendor', extras.vendorName ?? wo.vendor_name);
  push('Scheduled', wo.scheduled_start);
  push('Permission to enter', wo.permission_to_enter ? 'yes' : 'no');
  push('Is a unit turn', wo.is_turn ? 'yes' : undefined);

  const af = extras.appfolio;
  if (af) {
    lines.push('', '## AppFolio detail');
    push('Tenant remarks', af.TenantRemarks);
    push('Work order issue', af.WorkOrderIssue);
    push('Smart-intake urgency', af.SmartMaintenanceUrgency);
    push('Entry instructions', af.EntryInstructions);
    push('Preferred times', af.PreferredTimes);
    push('Tenant availability', af.TenantAvailability);
    push('Vendor instructions', af.VendorInstructions);
    push('Type', af.Type);
  }

  const timeline = events.slice(-15); // most recent 15 events
  if (timeline.length > 0) {
    lines.push('', '## Timeline (oldest first)');
    for (const e of timeline) {
      const note =
        typeof e.payload?.note === 'string'
          ? ` — ${e.payload.note}`
          : e.event_type === 'stage_change'
            ? ` — ${e.payload?.from} -> ${e.payload?.to}`
            : '';
      lines.push(`- ${e.created_at.slice(0, 10)} ${e.event_type} (${e.actor})${note}`);
    }
  }

  lines.push('', 'Generate the triage for this work order.');
  return lines.join('\n');
}

// ============================================
// Generation
// ============================================

export async function generateTriage(
  wo: MaintWorkOrder,
  events: WoEvent[],
  extras: TriageExtras = {}
): Promise<AiTriage> {
  const client = getAnthropic();

  const response = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 4000,
    thinking: { type: 'adaptive' },
    system: [
      {
        type: 'text',
        text: TRIAGE_SYSTEM,
        // Prompt caching: prefix-cached once the system prompt exceeds the
        // model's minimum cacheable prefix; harmless below it.
        cache_control: { type: 'ephemeral' },
      },
    ],
    output_config: {
      format: {
        type: 'json_schema',
        schema: TRIAGE_SCHEMA as unknown as Record<string, unknown>,
      },
    },
    messages: [{ role: 'user', content: buildTriageInput(wo, events, extras) }],
  });

  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === 'text'
  );
  if (!textBlock) {
    throw new Error(`AI triage returned no text (stop_reason: ${response.stop_reason})`);
  }
  return JSON.parse(textBlock.text) as AiTriage;
}
