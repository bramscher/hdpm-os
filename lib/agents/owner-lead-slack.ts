/**
 * Owner leads in Slack — a DM card per new website owner lead, with buttons
 * that move the lead through the website CRM's owner stages (consult booked →
 * proposal sent → signed, or lost). hdpm-web owns the lead: taps PATCH it via
 * /api/os/leads/:id as the tapping staff member, and the card is redrawn from
 * the lead the website returns.
 *
 * Action ids: `ol:<leadId>:<status>`.
 */

import { webAdminFetch } from '@/lib/hdpm-web-admin';

export const OS_LEADS_URL = 'https://os.highdesertpm.com/admin/leads';

export const STAGE_LABELS: Record<string, string> = {
  new: 'New',
  attempted_contact: 'Attempted contact',
  engaged: 'Engaged',
  consult_booked: 'Consult booked',
  proposal_sent: 'Proposal sent',
  signed: 'Signed',
  lost: 'Lost',
  archived: 'Archived',
};

/** Stages offered as buttons; 'new' and 'archived' stay in the Leads page. */
const BUTTON_STAGES = ['attempted_contact', 'engaged', 'consult_booked', 'proposal_sent', 'signed', 'lost'];

export interface OwnerLeadCardLead {
  id: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  status: string;
  source?: string | null;
  message?: string | null;
  property?: string | null;
  isDuplicateOfLeadId?: number | null;
  allowedStatuses: string[];
}

export function olActionId(leadId: number, status: string): string {
  return `ol:${leadId}:${status}`;
}

export function parseOlActionId(actionId: string): { leadId: number; status: string } | null {
  const m = /^ol:(\d+):([a-z_]+)$/.exec(actionId);
  return m ? { leadId: Number(m[1]), status: m[2] } : null;
}

export function buildOwnerLeadCard(
  lead: OwnerLeadCardLead,
  note?: string
): { text: string; blocks: Array<Record<string, unknown>> } {
  const stage = STAGE_LABELS[lead.status] ?? lead.status;
  const contact = [lead.phone, lead.email].filter(Boolean).join(' · ') || 'no contact info';
  const lines = [
    `*${lead.name}* — ${contact}`,
    lead.property ? `Property: ${lead.property}` : null,
    lead.source ? `Source: ${lead.source}` : null,
    `Stage: *${stage}*`,
    lead.isDuplicateOfLeadId ? `_Possible duplicate of lead ${lead.isDuplicateOfLeadId}_` : null,
  ].filter(Boolean);
  const message = (lead.message ?? '').trim();

  const buttons = lead.allowedStatuses
    .filter((s) => BUTTON_STAGES.includes(s))
    .map((s) => ({
      type: 'button',
      action_id: olActionId(lead.id, s),
      text: { type: 'plain_text', text: STAGE_LABELS[s] ?? s },
      ...(s === 'signed' ? { style: 'primary' } : s === 'lost' ? { style: 'danger' } : {}),
    }));

  const blocks: Array<Record<string, unknown>> = [
    { type: 'section', text: { type: 'mrkdwn', text: `:house: *Owner lead*\n${lines.join('\n')}` } },
  ];
  if (message) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `> ${message.slice(0, 600).replace(/\n/g, '\n> ')}` } });
  }
  if (buttons.length) blocks.push({ type: 'actions', elements: buttons.slice(0, 5) });
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: [note, `<${OS_LEADS_URL}|Open in HDPM OS>`].filter(Boolean).join(' · ') }],
  });

  return { text: `Owner lead: ${lead.name} (${stage})`, blocks };
}

/**
 * Apply a stage tap: PATCH the lead on the website as `actorEmail`.
 * Returns the updated lead, or a readable error (e.g. an invalid move).
 */
export async function moveOwnerLead(
  leadId: number,
  status: string,
  actorEmail: string
): Promise<{ ok: true; lead: OwnerLeadCardLead } | { ok: false; error: string }> {
  const res = await webAdminFetch(`/leads/${leadId}`, actorEmail, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
  const data = (await res.json().catch(() => ({}))) as { lead?: OwnerLeadCardLead; error?: string };
  if (!res.ok || !data.lead) return { ok: false, error: data.error || `Website returned ${res.status}` };
  return { ok: true, lead: data.lead };
}

/**
 * Redraw a tapped card: keep its original lead details and message, update
 * the stage line, and swap in buttons for the stages now allowed.
 */
export function redrawOwnerLeadCard(
  originalBlocks: Array<Record<string, unknown>>,
  lead: OwnerLeadCardLead,
  note: string
): Array<Record<string, unknown>> {
  const fresh = buildOwnerLeadCard(lead, note).blocks;
  const kept = originalBlocks
    .filter((b) => b.type !== 'actions' && b.type !== 'context')
    .map((b, i) => {
      if (i !== 0 || b.type !== 'section') return b;
      const text = b.text as { type: string; text: string };
      const stage = STAGE_LABELS[lead.status] ?? lead.status;
      return { ...b, text: { ...text, text: text.text.replace(/Stage: \*[^*]*\*/, `Stage: *${stage}*`) } };
    });
  if (!kept.length) return fresh;
  return [...kept, ...fresh.filter((b) => b.type === 'actions' || b.type === 'context')];
}

export interface UntouchedOwnerLead {
  name: string;
  phone?: string | null;
  email?: string | null;
  createdAt: string;
}

/** Weekday-morning nudge: owner leads still at New (the 50 newest the website lists), oldest of those first. */
export function buildOwnerNudge(
  leads: UntouchedOwnerLead[],
  total: number,
  now: Date
): { text: string; blocks: Array<Record<string, unknown>> } {
  const days = (iso: string) => Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 86_400_000));
  const oldest = [...leads].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)).slice(0, 15);
  const lines = oldest.map((l) => {
    const d = days(l.createdAt);
    return `• *${l.name}* — ${d === 0 ? 'today' : `${d}d`}${l.phone ? ` · ${l.phone}` : l.email ? ` · ${l.email}` : ''}`;
  });
  const more = total > oldest.length ? `\n…and ${total - oldest.length} more` : '';
  const title = `${total} owner lead${total === 1 ? '' : 's'} still at New`;
  return {
    text: title,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `:house: *${title}*\n${lines.join('\n')}${more}` } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: `<${OS_LEADS_URL}|Work them in HDPM OS>` }] },
    ],
  };
}
