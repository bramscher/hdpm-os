/**
 * Agent identity & voice (§3 identity layer). An agent that holds a seat is a
 * named colleague: a display name, a face, a voice, and declared expertise.
 * Pure/DB-free — the tenant loads AgentIdentity rows and passes them in.
 *
 * Split of concerns:
 *   - agent_config  → what an agent may DO (autonomy per action).
 *   - AgentIdentity → who it IS and how it SPEAKS (this module).
 *   - seat.agent_id → which box on the chart it holds.
 */

import { agentActor } from '../actor';

export interface AgentIdentity {
  id: string; // stable key = seat.agent_id / agent_config.agent
  org_id: string;
  display_name: string; // 'Casey'
  title: string | null; // 'Vendor Estimate Chaser'
  avatar: string | null; // emoji '🤖' or icon url
  persona: string | null; // voice/tone fragment
  expertise: string[]; // skill tags
  model: string | null; // LLM used to compose messages
  active: boolean;
}

/** The actor string this agent writes to audit / done_by ('agent:<id>'). */
export function agentActorFor(a: Pick<AgentIdentity, 'id'>): string {
  return agentActor(a.id);
}

/** Short sign-off appended to an agent's messages: '— Casey · Vendor Estimate Chaser'. */
export function signature(a: AgentIdentity): string {
  return a.title ? `— ${a.display_name} · ${a.title}` : `— ${a.display_name}`;
}

/**
 * Slack sender identity for chat.postMessage (needs chat:write.customize).
 * An emoji avatar → icon_emoji; a URL avatar → icon_url. Returned shape is
 * spread into the outbox payload's `as` field; the Slack adapter passes it
 * through. Omitted keys mean "use the bot's default".
 */
export function slackIdentity(a: AgentIdentity): { username: string; icon_emoji?: string; icon_url?: string } {
  const out: { username: string; icon_emoji?: string; icon_url?: string } = { username: a.display_name };
  if (a.avatar) {
    if (/^https?:\/\//.test(a.avatar)) out.icon_url = a.avatar;
    else out.icon_emoji = a.avatar.startsWith(':') ? a.avatar : emojiToSlackCode(a.avatar);
  }
  return out;
}

/** Best-effort: a raw emoji glyph → a Slack :shortcode:. Falls back to :robot_face:. */
function emojiToSlackCode(glyph: string): string {
  const map: Record<string, string> = {
    '🤖': ':robot_face:',
    '🧰': ':toolbox:',
    '📋': ':clipboard:',
    '💸': ':money_with_wings:',
    '🔑': ':key:',
    '📇': ':card_index:',
  };
  return map[glyph] ?? ':robot_face:';
}

/**
 * System-prompt preamble for composing this agent's messages in its own voice.
 * Carries name, role, expertise, persona, and the non-negotiable HABU guardrail:
 * an agent proposes and files — it never claims to have taken an action it did
 * not, and it escalates rather than overstepping its ceiling.
 */
export function personaPreamble(a: AgentIdentity): string {
  const lines = [
    `You are ${a.display_name}${a.title ? `, the ${a.title}` : ''} — an agent colleague on the team.`,
    a.expertise.length ? `Your expertise: ${a.expertise.join(', ')}.` : '',
    a.persona ? `Voice: ${a.persona}` : '',
    `Write briefly and concretely. Sign as "${signature(a)}".`,
    `You act only within your authority: propose and file, never claim work you did not do, and escalate to your human seat when you hit a ceiling or get stuck.`,
  ];
  return lines.filter(Boolean).join('\n');
}
