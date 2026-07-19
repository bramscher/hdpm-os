/**
 * Agent-OS actor convention.
 *
 * wo_event.actor (and agent_proposal.decided_by) distinguish who acted:
 * - agents write 'agent:<name>' (lowercase snake/kebab name, e.g. 'agent:intake_triage')
 * - humans resolve through the staff table to their name/email — the same
 *   semantics requireStaffSession() has always used
 * - existing system actors ('system:sync', 'system:tripwire-N') are unchanged
 *
 * Decisions (proposal approve/edit/reject) must always carry a human actor,
 * never 'agent:*' — enforced at the API layer.
 */

const AGENT_ACTOR_RE = /^agent:[a-z0-9_-]+$/;

export function agentActor(agent: string): string {
  return `agent:${agent}`;
}

export function isAgentActor(actor: string): boolean {
  return AGENT_ACTOR_RE.test(actor);
}

/** Returns the agent name from an 'agent:<name>' actor, or null. */
export function parseAgentActor(actor: string): string | null {
  return isAgentActor(actor) ? actor.slice('agent:'.length) : null;
}
