import { describe, it, expect } from 'vitest';
import {
  UNITS,
  unitAt,
  unitIndex,
  sampleBrain,
  halfForNode,
  layoutAnatomy,
  explodeOffsets,
  scanScores,
  SCAN_CAP,
  type LayoutNode,
} from '../anatomy';
import type { VizEdge } from '../viz';

// One shared sample set (it's the expensive part); smaller than the browser's for speed.
const S = sampleBrain(20261001, 80_000);

const docs = (prefix: string, layer: LayoutNode['layer'], sector: string, n: number): LayoutNode[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${sector}:${i}`, label: `${sector} ${i}`, layer, sector }));

describe('brain volume', () => {
  it('gives every lobe in both halves some volume, plus the brainstem', () => {
    for (const [i, u] of UNITS.entries()) {
      if (u.region === 'core') continue; // Dez is a point, not a volume
      expect(S.volume[i], `${u.region}${u.half}`).toBeGreaterThan(50);
    }
  });

  it('puts the right half at +z and the left at -z, mirrored', () => {
    const r = unitAt(4, 2, 3);
    const l = unitAt(4, 2, -3);
    expect(UNITS[r]).toEqual({ region: 'frontal', half: 1 });
    expect(UNITS[l]).toEqual({ region: 'frontal', half: -1 });
    expect(unitAt(0, 0, 0)).toBe(-1); // the gap between hemispheres
    expect(unitAt(20, 0, 0)).toBe(-1);
  });

  it('samples deterministically', () => {
    const again = sampleBrain(20261001, 80_000);
    expect(again.shell.length).toBe(S.shell.length);
    expect(again.shell.slice(0, 30)).toEqual(S.shell.slice(0, 30));
  });
});

describe('halfForNode', () => {
  it('puts knowledge docs left (taught) and brain docs right (learned)', () => {
    expect(halfForNode('k:ors_90:ORS 90.100')).toBe(-1);
    expect(halfForNode('b:node-123')).toBe(1);
  });

  it('puts intake routines left and acting routines right', () => {
    expect(halfForNode('r:wo_sync_15m')).toBe(-1); // sync
    expect(halfForNode('r:knowledge_notion')).toBe(-1);
    expect(halfForNode('r:ors_watch')).toBe(-1);
    expect(halfForNode('r:brain_evolve')).toBe(1);
    expect(halfForNode('r:estimate_chaser')).toBe(1);
    expect(halfForNode('r:eos_scorecard')).toBe(1);
  });

  it('keeps integrations on the midline', () => {
    expect(halfForNode('i:AppFolio')).toBe(0);
  });
});

describe('layoutAnatomy', () => {
  const nodes: LayoutNode[] = [
    ...docs('k:', 'core', 'Policy docs', 30),
    ...docs('b:', 'core', 'Brain policies', 12),
    ...docs('k:', 'skills', 'Notion SOPs', 120),
    ...docs('k:', 'memory', 'ORS 90', 300),
    ...docs('b:', 'memory', 'Company memory · vendors', 60),
    { id: 'r:wo_sync_15m', label: 'Work orders sync', layer: 'routines', sector: 'sync' },
    { id: 'r:estimate_chaser', label: 'Stuck Estimate Chaser', layer: 'routines', sector: 'agent' },
    { id: 'i:AppFolio', label: 'AppFolio', layer: 'integrations', sector: 'Integrations' },
  ];
  const L = layoutAnatomy(nodes, S);

  it('lands every node inside its own lobe and half', () => {
    nodes.forEach((n, i) => {
      if (n.layer === 'integrations') return; // strung along the stem axis by hand
      const p = [L.pos[i * 3], L.pos[i * 3 + 1], L.pos[i * 3 + 2]] as const;
      expect(unitAt(...p), n.id).toBe(L.unit[i]);
    });
    expect(UNITS[L.unit[0]]).toEqual({ region: 'frontal', half: -1 });
    expect(UNITS[L.unit[30]]).toEqual({ region: 'frontal', half: 1 });
    expect(UNITS[L.unit[nodes.length - 3]]).toEqual({ region: 'cerebellum', half: -1 });
    expect(UNITS[L.unit[nodes.length - 2]]).toEqual({ region: 'cerebellum', half: 1 });
    expect(UNITS[L.unit[nodes.length - 1]]).toEqual({ region: 'stem', half: 0 });
  });

  it('is deterministic, and adding a document elsewhere moves nothing', () => {
    const again = layoutAnatomy(nodes, S);
    expect(Array.from(again.pos)).toEqual(Array.from(L.pos));
    const more = layoutAnatomy([...nodes, { id: 'k:loom:new', label: 'New Loom', layer: 'skills', sector: 'Loom videos' }], S);
    expect(Array.from(more.pos.slice(0, L.pos.length))).toEqual(Array.from(L.pos));
  });

  it('shrinks dots as a half-region fills up', () => {
    const sparse = L.size[0]; // 30 policy docs in a big frontal lobe
    const dense = L.size[30 + 12 + 120]; // 300 ORS docs in the temporal lobe
    expect(sparse).toBeGreaterThan(dense);
    expect(dense).toBeGreaterThanOrEqual(0.08);
    expect(Math.max(...L.size.slice(0, 30 + 12 + 120 + 300 + 60))).toBeCloseTo(0.3, 5);
  });
});

describe('explodeOffsets', () => {
  it('is zero when whole and pushes halves apart when exploded', () => {
    expect(Array.from(explodeOffsets(0, S)).every((v) => v === 0)).toBe(true);
    const o = explodeOffsets(1, S);
    const r = unitIndex('frontal', 1), l = unitIndex('frontal', -1);
    expect(o[r * 3 + 2]).toBeGreaterThan(0);
    expect(o[l * 3 + 2]).toBeLessThan(0);
    expect(o[unitIndex('frontal', 1) * 3]).toBeGreaterThan(0); // frontal moves forward
    expect(o[unitIndex('stem', 0) * 3 + 1]).toBeLessThan(0); // stem moves down
  });
});

describe('scanScores', () => {
  const index = new Map(['a', 'b', 'c', 'd', 'e'].map((k, i) => [k, i]));
  const edges: VizEdge[] = [
    { s: 0, t: 3, kind: 'link', w: 1 },
    { s: 1, t: 4, kind: 'similar', w: 0.9 },
  ];

  it('normalises meaning-search scores to the best match and keeps the best per doc', () => {
    const m = scanScores({ semantic: [{ key: 'a', score: 0.04 }, { key: 'b', score: 0.02 }, { key: 'a', score: 0.01 }] }, index, []);
    expect(m.get(0)).toBe(1);
    expect(m.get(1)).toBeCloseTo(0.5);
  });

  it('spreads part of a hit to linked documents', () => {
    const m = scanScores({ semantic: [{ key: 'a', score: 1 }, { key: 'b', score: 1 }] }, index, edges);
    expect(m.get(3)).toBeCloseTo(0.5); // link
    expect(m.get(4)).toBeCloseTo(0.35); // similar
  });

  it('scores title matches at 0.5 and Ask sources by rank', () => {
    expect(scanScores({ text: [2] }, index, []).get(2)).toBe(0.5); // title-only stays at 0.5
    const m = scanScores({ semantic: [{ key: 'a', score: 1 }], text: [2] }, index, []);
    expect(m.get(2)).toBeCloseTo(0.5);
    const a = scanScores({ ask: ['c', 'a'] }, index, []);
    expect(a.get(2)).toBe(1);
    expect(a.get(0)).toBeCloseTo(0.7);
  });

  it('ignores unknown docs and caps the scan', () => {
    expect(scanScores({ semantic: [{ key: 'zzz', score: 1 }] }, index, []).size).toBe(0);
    const big = new Map(Array.from({ length: 80 }, (_, i) => [`k${i}`, i]));
    const m = scanScores({ semantic: Array.from({ length: 80 }, (_, i) => ({ key: `k${i}`, score: 80 - i })) }, big, []);
    expect(m.size).toBe(SCAN_CAP);
  });
});
