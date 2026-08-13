import { describe, expect, it } from 'vitest';
import { nextVariantSuffix } from '../invoices';

describe('nextVariantSuffix', () => {
  it('returns 1 for the first duplicate (only the original, NULL, exists)', () => {
    expect(nextVariantSuffix([null])).toBe(1);
  });

  it('returns 1 when there are no rows at all', () => {
    expect(nextVariantSuffix([])).toBe(1);
  });

  it('returns one past the highest existing suffix', () => {
    expect(nextVariantSuffix([null, 1, 2])).toBe(3);
  });

  it('fills past the max, not a gap (suffixes are monotonic, never reused)', () => {
    // 000041, -1, -3 exist (-2 was deleted) → next is 4, not 2.
    expect(nextVariantSuffix([null, 1, 3])).toBe(4);
  });

  it('ignores null/undefined originals mixed in', () => {
    expect(nextVariantSuffix([undefined, null, 5, null])).toBe(6);
  });
});
