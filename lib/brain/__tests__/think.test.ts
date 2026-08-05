import { describe, it, expect } from 'vitest';
import { brainSourcesForChat, buildBrainContext, KIND_LABELS } from '@/lib/brain/think';
import type { BrainMatch } from '@/lib/brain/types';

const match = (over: Partial<BrainMatch>): BrainMatch => ({
  id: 'c1',
  node_id: null,
  kind: 'fact',
  domain: 'company',
  content: 'Agent-OS Q&A › Q2 ceilings\n\nOwner/tenant sends hard-walled at L2 forever.',
  source_url: 'docs/agent-os/01-questions-and-answers.md',
  source_table: null,
  source_id: null,
  author: 'system',
  sensitivity: 'internal',
  salience: 1,
  score: 0.02,
  ...over,
});

describe('brainSourcesForChat', () => {
  it('maps to chat sources with brain icon, GitHub link, kind label', () => {
    const [s] = brainSourcesForChat([match({})]);
    expect(s.icon).toBe('🧠');
    expect(s.type).toBe('brain');
    expect(s.title).toBe('Agent-OS Q&A › Q2 ceilings');
    expect(s.url).toBe(
      'https://github.com/bramscher/hdpm-os/blob/main/docs/agent-os/01-questions-and-answers.md'
    );
    expect(s.section).toBe(KIND_LABELS.fact);
  });

  it('passes through absolute urls', () => {
    const [s] = brainSourcesForChat([match({ source_url: 'https://example.com/x' })]);
    expect(s.url).toBe('https://example.com/x');
  });
});

describe('buildBrainContext', () => {
  it('continues numbering and labels kind/author', () => {
    const ctx = buildBrainContext(
      [match({}), match({ id: 'c2', kind: 'inference', author: 'agent:ops-brief' })],
      16
    );
    expect(ctx).toContain('[Source 16] (company memory — recorded decision/fact)');
    expect(ctx).toContain('[Source 17] (company memory — inference — verify before relying on it, author: agent:ops-brief)');
  });

  it('is empty for no matches', () => {
    expect(buildBrainContext([], 5)).toBe('');
  });
});
