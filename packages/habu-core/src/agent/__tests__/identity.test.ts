import { describe, it, expect } from 'vitest';
import type { AgentIdentity } from '../identity';
import { agentActorFor, signature, slackIdentity, personaPreamble } from '../identity';

function agent(overrides: Partial<AgentIdentity> = {}): AgentIdentity {
  return {
    id: 'estimate_chaser',
    org_id: 'demo',
    display_name: 'Casey',
    title: 'Vendor Estimate Chaser',
    avatar: '🤖',
    persona: 'friendly, terse, a little dogged',
    expertise: ['vendor comms', 'estimates', 'follow-ups'],
    model: 'claude-sonnet-5',
    active: true,
    ...overrides,
  };
}

describe('agent identity', () => {
  it('derives the audit actor from the id', () => {
    expect(agentActorFor(agent())).toBe('agent:estimate_chaser');
  });

  it('signs with name and title', () => {
    expect(signature(agent())).toBe('— Casey · Vendor Estimate Chaser');
    expect(signature(agent({ title: null }))).toBe('— Casey');
  });

  it('maps an emoji avatar to a Slack icon_emoji', () => {
    expect(slackIdentity(agent())).toEqual({ username: 'Casey', icon_emoji: ':robot_face:' });
  });

  it('maps a url avatar to icon_url', () => {
    expect(slackIdentity(agent({ avatar: 'https://x/y.png' }))).toEqual({ username: 'Casey', icon_url: 'https://x/y.png' });
  });

  it('passes an explicit :shortcode: through', () => {
    expect(slackIdentity(agent({ avatar: ':money_with_wings:' })).icon_emoji).toBe(':money_with_wings:');
  });

  it('omits the icon when no avatar', () => {
    expect(slackIdentity(agent({ avatar: null }))).toEqual({ username: 'Casey' });
  });

  it('builds a persona preamble carrying voice, expertise, and the guardrail', () => {
    const p = personaPreamble(agent());
    expect(p).toContain('You are Casey, the Vendor Estimate Chaser');
    expect(p).toContain('vendor comms, estimates, follow-ups');
    expect(p).toContain('friendly, terse');
    expect(p).toContain('— Casey · Vendor Estimate Chaser');
    expect(p).toContain('never claim work you did not do');
  });
});
