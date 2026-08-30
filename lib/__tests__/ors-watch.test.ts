import { describe, it, expect } from 'vitest';
import { candidateNewOrsSections } from '@/lib/knowledge-sync';

describe('candidateNewOrsSections', () => {
  it('probes inserted-section gaps after each known section', () => {
    const c = candidateNewOrsSections(['90.300', '90.302'], { gapAhead: 2, tail: 0 });
    // 90.300 -> 90.301, 90.302(known, excluded); 90.302 -> 90.303, 90.304
    expect(c).toContain('90.301');
    expect(c).toContain('90.303');
    expect(c).toContain('90.304');
    expect(c).not.toContain('90.302'); // known — never re-probed
  });

  it('probes a tail window past the current maximum', () => {
    const c = candidateNewOrsSections(['90.870', '90.875'], { gapAhead: 0, tail: 3 });
    expect(c).toEqual(['90.876', '90.877', '90.878']);
  });

  it('excludes every known section and dedupes', () => {
    const known = ['90.100', '90.105', '90.110'];
    const c = candidateNewOrsSections(known, { gapAhead: 2, tail: 5 });
    for (const k of known) expect(c).not.toContain(k);
    expect(new Set(c).size).toBe(c.length);
  });

  it('formats section numbers with three decimals', () => {
    const c = candidateNewOrsSections(['90.300'], { gapAhead: 1, tail: 0 });
    expect(c).toEqual(['90.301']);
  });
});
