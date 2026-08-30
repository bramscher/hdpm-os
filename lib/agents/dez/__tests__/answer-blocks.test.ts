import { describe, it, expect } from 'vitest';
import type { Source } from '@/lib/rag';
import {
  toSlackMrkdwn,
  chunkText,
  renderSources,
  buildAnswerBlocks,
  buildBreadcrumb,
} from '@/lib/agents/dez/answer-blocks';

const src = (over: Partial<Source>): Source => ({
  id: '1',
  title: 'SOP-MO-001',
  url: 'https://example.com/sop',
  type: 'notion_sop',
  icon: '📘',
  section: null,
  ...over,
});

describe('toSlackMrkdwn', () => {
  it('converts bold and links to Slack mrkdwn', () => {
    expect(toSlackMrkdwn('**Deposit** due')).toBe('*Deposit* due');
    expect(toSlackMrkdwn('see [the SOP](https://x.co/y)')).toBe('see <https://x.co/y|the SOP>');
  });
});

describe('chunkText', () => {
  it('returns one chunk when under the limit', () => {
    expect(chunkText('short', 2900)).toEqual(['short']);
  });
  it('splits long text into ≤limit chunks', () => {
    const long = 'a'.repeat(50) + '\n\n' + 'b'.repeat(50);
    const chunks = chunkText(long, 60);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(60);
  });
});

describe('renderSources', () => {
  it('numbers sources, includes section, and links when a url exists', () => {
    const line = renderSources([
      src({ section: 'Deposits' }),
      src({ id: '2', title: 'ORS 90.300', icon: '⚖️', url: '' }),
    ]);
    expect(line).toContain('<https://example.com/sop|📘 [1] SOP-MO-001 — Deposits>');
    expect(line).toContain('⚖️ [2] ORS 90.300');
    expect(line).not.toContain('[2] ORS 90.300>'); // no link when url empty
  });
});

describe('buildAnswerBlocks', () => {
  it('emits answer section(s), a sources context, and the breadcrumb', () => {
    const { text, blocks } = buildAnswerBlocks('The answer.', [src({})], '🔧 dez · maintenance · 1 source');
    expect(text).toBe('The answer.');
    const b = blocks as Array<{ type: string; elements?: Array<{ text: string }> }>;
    expect(b[0].type).toBe('section');
    expect(b[b.length - 1].type).toBe('context');
    expect(b[b.length - 1].elements?.[0].text).toContain('🔧 dez · maintenance');
  });

  it('omits the sources context when there are none', () => {
    const { blocks } = buildAnswerBlocks('No sources.', [], '🔧 dez · general');
    const contexts = (blocks as Array<{ type: string }>).filter((x) => x.type === 'context');
    expect(contexts.length).toBe(1); // breadcrumb only
  });
});

describe('buildBreadcrumb', () => {
  it('pluralizes and omits sources at zero', () => {
    expect(buildBreadcrumb('maintenance', 1)).toBe('🔧 dez · maintenance · 1 source');
    expect(buildBreadcrumb('leasing / front desk', 3)).toBe('🔧 dez · leasing / front desk · 3 sources');
    expect(buildBreadcrumb('general', 0)).toBe('🔧 dez · general');
  });
});
