import { describe, it, expect } from 'vitest';
import { chunkMarkdown } from '@/lib/brain/chunk';

const DOC = `# Title

Intro paragraph with enough words to clear the minimum chunk size threshold for testing purposes here.

## Section A

Body of section A with plenty of content so that it is not filtered out by the minimum size rule.

### Sub A1

Sub-section content that also has enough characters to be retained by the chunker in the output list.

## Section B

Short.
`;

describe('chunkMarkdown', () => {
  it('splits on headings and prefixes the heading trail', () => {
    const chunks = chunkMarkdown(DOC, 'Doc');
    const contents = chunks.map((c) => c.content);
    expect(contents.some((c) => c.startsWith('Title\n\nIntro paragraph'))).toBe(true);
    expect(contents.some((c) => c.startsWith('Title › Section A\n\n'))).toBe(true);
    expect(contents.some((c) => c.startsWith('Title › Section A › Sub A1\n\n'))).toBe(true);
  });

  it('drops sections below the minimum size', () => {
    const chunks = chunkMarkdown(DOC, 'Doc');
    expect(chunks.some((c) => c.heading === 'Section B')).toBe(false);
  });

  it('assigns stable sequential indexes', () => {
    const chunks = chunkMarkdown(DOC, 'Doc');
    expect(chunks.map((c) => c.index)).toEqual([...chunks.keys()]);
  });

  it('splits oversized sections at paragraph boundaries', () => {
    const bigPara = 'word '.repeat(120).trim();
    const big = `# T\n\n## Long\n\n${Array.from({ length: 8 }, () => bigPara).join('\n\n')}\n`;
    const chunks = chunkMarkdown(big, 'T');
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(2600);
    expect(chunks.every((c) => c.heading === 'Long')).toBe(true);
  });

  it('hard-slices a single paragraph beyond the limit', () => {
    const monster = 'x'.repeat(6000);
    const chunks = chunkMarkdown(`# T\n\n## M\n\n${monster}\n`, 'T');
    expect(chunks.length).toBeGreaterThanOrEqual(3);
  });
});
