import { describe, it, expect } from 'vitest';
import { agentActor, isAgentActor, parseAgentActor } from '../actor';

describe('actor convention', () => {
  it('round-trips agent names', () => {
    expect(agentActor('intake_triage')).toBe('agent:intake_triage');
    expect(isAgentActor('agent:intake_triage')).toBe(true);
    expect(parseAgentActor('agent:intake_triage')).toBe('intake_triage');
    expect(parseAgentActor(agentActor('estimate-chaser'))).toBe('estimate-chaser');
  });

  it('rejects non-agent actors', () => {
    expect(isAgentActor('Cheryl')).toBe(false);
    expect(isAgentActor('system:sync')).toBe(false);
    expect(isAgentActor('agent:')).toBe(false);
    expect(isAgentActor('agent:Bad Name')).toBe(false);
    expect(parseAgentActor('Cheryl')).toBeNull();
  });
});
