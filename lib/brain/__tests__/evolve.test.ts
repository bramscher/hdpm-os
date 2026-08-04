import { describe, it, expect } from 'vitest';
import {
  parseEmbedding,
  cosine,
  sourceDoc,
  pickSurvivor,
  scanPairs,
  parseVerdicts,
  type EvolveChunk,
} from '@/lib/brain/evolve';

// 3-dim unit-ish vectors are enough to exercise the band logic.
const chunk = (over: Partial<EvolveChunk>): EvolveChunk => ({
  id: 'c1',
  kind: 'fact',
  content: 'x',
  source_key: null,
  salience: 1,
  created_at: '2026-08-01T00:00:00Z',
  last_seen_at: '2026-08-01T00:00:00Z',
  embedding: [1, 0, 0],
  ...over,
});

describe('parseEmbedding', () => {
  it('parses pgvector string form', () => {
    expect(parseEmbedding('[0.1,0.2,0.3]')).toEqual([0.1, 0.2, 0.3]);
  });
  it('passes arrays through and rejects junk', () => {
    expect(parseEmbedding([1, 2])).toEqual([1, 2]);
    expect(parseEmbedding(null)).toBeNull();
    expect(parseEmbedding('not json')).toBeNull();
  });
});

describe('cosine', () => {
  it('is 1 for identical, 0 for orthogonal', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
  });
});

describe('sourceDoc', () => {
  it('strips the chunk fragment', () => {
    expect(sourceDoc('docs/x.md#3')).toBe('docs/x.md');
    expect(sourceDoc('docs/x.md')).toBe('docs/x.md');
    expect(sourceDoc(null)).toBeNull();
  });
});

describe('pickSurvivor', () => {
  it('prefers kind rank (correction beats fact)', () => {
    const a = chunk({ id: 'a', kind: 'fact' });
    const b = chunk({ id: 'b', kind: 'human_correction' });
    expect(pickSurvivor(a, b)[0].id).toBe('b');
  });
  it('falls back to salience, then recency', () => {
    const a = chunk({ id: 'a', salience: 1.2 });
    const b = chunk({ id: 'b', salience: 1.0 });
    expect(pickSurvivor(a, b)[0].id).toBe('a');
    const c = chunk({ id: 'c', created_at: '2026-08-02T00:00:00Z' });
    const d = chunk({ id: 'd', created_at: '2026-08-01T00:00:00Z' });
    expect(pickSurvivor(c, d)[0].id).toBe('c');
  });
});

describe('scanPairs', () => {
  it('classifies dupes (≥0.95) and band candidates separately', () => {
    // near-identical pair
    const a = chunk({ id: 'a', embedding: [1, 0, 0] });
    const b = chunk({ id: 'b', embedding: [0.999, 0.01, 0] });
    // same-topic band pair (~0.86 cosine, distinct docs)
    const c = chunk({ id: 'c', embedding: [1, 0.4, 0], source_key: 'docs/one.md#1' });
    const d = chunk({ id: 'd', embedding: [1, 0, 0.4], source_key: 'docs/two.md#1' });
    const { dupes, candidates } = scanPairs([a, b, c, d]);
    expect(dupes.map((p) => [p.a.id, p.b.id])).toEqual([['a', 'b']]);
    expect(candidates.some((p) => p.a.id === 'c' && p.b.id === 'd')).toBe(true);
  });

  it('excludes same-document band pairs', () => {
    const a = chunk({ id: 'a', embedding: [1, 0.4, 0], source_key: 'docs/one.md#1' });
    const sameDoc = chunk({ id: 'b', embedding: [1, 0, 0.4], source_key: 'docs/one.md#5' });
    expect(scanPairs([a, sameDoc]).candidates).toEqual([]);
  });

  it('excludes non-statement kinds from the band', () => {
    const fact = chunk({ id: 'a', embedding: [1, 0.4, 0], source_key: 'docs/one.md#1' });
    const inference = chunk({
      id: 'b',
      kind: 'inference',
      embedding: [1, 0, 0.4],
      source_key: 'docs/two.md#1',
    });
    expect(scanPairs([fact, inference]).candidates).toEqual([]);
  });

  it('bounds the scan to leftIds when provided', () => {
    const a = chunk({ id: 'a', embedding: [1, 0, 0] });
    const b = chunk({ id: 'b', embedding: [0.999, 0.01, 0] });
    const { dupes } = scanPairs([a, b], new Set(['zzz-not-present']));
    expect(dupes).toEqual([]);
  });

  it('skips chunks without embeddings', () => {
    const a = chunk({ id: 'a', embedding: null });
    const b = chunk({ id: 'b', embedding: [1, 0, 0] });
    expect(scanPairs([a, b]).dupes).toEqual([]);
  });
});

describe('parseVerdicts', () => {
  it('parses a fenced JSON array and clamps to known pairs', () => {
    const text = '```json\n[{"index":0,"contradicts":true,"note":"fee differs","question":"Which fee?"},{"index":5,"contradicts":true}]\n```';
    const v = parseVerdicts(text, 2);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ index: 0, contradicts: true, note: 'fee differs' });
  });
  it('returns [] on junk', () => {
    expect(parseVerdicts('no json here', 3)).toEqual([]);
    expect(parseVerdicts('{"index":0}', 3)).toEqual([]);
  });
});
