import { describe, it, expect } from 'vitest';
import {
  matchOperatorRequest,
  buildOperatorActionId,
  parseOperatorActionId,
  buildOperatorCard,
} from '@/lib/agents/dez/operator';

describe('matchOperatorRequest', () => {
  it('detects a deposit-to-hold request with a tenant', () => {
    expect(matchOperatorRequest('prepare the deposit-to-hold for Bryce Bramscher')).toEqual({
      template: 'deposit-to-hold',
      tenantQuery: 'Bryce Bramscher',
    });
    expect(matchOperatorRequest('fill the deposit to hold agreement for Jane Doe')).toEqual({
      template: 'deposit-to-hold',
      tenantQuery: 'Jane Doe',
    });
  });

  it('accepts natural request phrasings', () => {
    expect(matchOperatorRequest('can I get a deposit to hold for Hunter Penn?')).toEqual({
      template: 'deposit-to-hold',
      tenantQuery: 'Hunter Penn',
    });
    expect(matchOperatorRequest('make me a deposit to hold for Jane Doe')).toEqual({
      template: 'deposit-to-hold',
      tenantQuery: 'Jane Doe',
    });
  });

  it('requires an action verb + template + a "for <name>"', () => {
    expect(matchOperatorRequest('what is a deposit to hold agreement?')).toBeNull(); // question
    expect(matchOperatorRequest('prepare the lease for Bryce')).toBeNull(); // unknown template
    expect(matchOperatorRequest('prepare the deposit to hold')).toBeNull(); // no tenant
  });

  it('ignores how-it-works questions even when they name a tenant', () => {
    // "how" makes this a process question, not a request to produce a form.
    expect(matchOperatorRequest('how do I do a deposit to hold for Hunter Penn?')).toBeNull();
    expect(matchOperatorRequest("what's the deposit to hold process for new tenants?")).toBeNull();
  });

  it('strips trailing punctuation from the tenant', () => {
    expect(matchOperatorRequest('generate deposit to hold for Bryce Bramscher?')?.tenantQuery).toBe(
      'Bryce Bramscher'
    );
  });
});

describe('op:* action ids', () => {
  it('round-trips approve/discard', () => {
    expect(parseOperatorActionId(buildOperatorActionId('approve', 'p1'))).toEqual({
      kind: 'approve',
      proposalId: 'p1',
    });
    expect(parseOperatorActionId(buildOperatorActionId('discard', 'p-2-3'))).toEqual({
      kind: 'discard',
      proposalId: 'p-2-3',
    });
    expect(parseOperatorActionId('ec:sendsms:x')).toBeNull();
  });
});

describe('buildOperatorCard', () => {
  it('shows approve/discard buttons before a decision', () => {
    const { blocks } = buildOperatorCard({
      proposalId: 'p1',
      template: 'deposit-to-hold',
      tenantQuery: 'Bryce Bramscher',
      steps: ['opened wizard', 'clicked Prepare Form'],
    });
    const hasActions = (blocks as Array<{ type: string }>).some((b) => b.type === 'actions');
    expect(hasActions).toBe(true);
  });

  it('shows a resolution and no buttons after a decision', () => {
    const { blocks } = buildOperatorCard({
      proposalId: 'p1',
      template: 'deposit-to-hold',
      tenantQuery: 'Bryce Bramscher',
      steps: [],
      resolution: 'Discarded by Craig.',
    });
    const hasActions = (blocks as Array<{ type: string }>).some((b) => b.type === 'actions');
    expect(hasActions).toBe(false);
  });
});
