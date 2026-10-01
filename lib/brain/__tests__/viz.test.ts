import { describe, it, expect } from 'vitest';
import { buildSnapshot, classifyDoc, countCitedChunks, hash01, layoutRing, brainMatchDocKey, INTEGRATIONS, type VizDocRow } from '../viz';
import { ROUTINES } from '@/lib/routines/registry';

const doc = (over: Partial<VizDocRow>): VizDocRow => ({
  doc: 'k:ors_90:ORS 90.100', origin: 'knowledge', source_type: 'ors_90', domain: null, entity_type: null,
  title: 'ORS 90.100', url: 'https://law', chunks: 3, updated_at: '2026-09-01T00:00:00Z', excerpt: 'Definitions  \n  text', ...over,
});

describe('classifyDoc', () => {
  it('puts law in memory, SOPs in skills, policies in core', () => {
    expect(classifyDoc(doc({}))).toEqual({ layer: 'memory', sector: 'ORS 90' });
    expect(classifyDoc(doc({ source_type: 'notion_sop' }))).toEqual({ layer: 'skills', sector: 'Notion SOPs' });
    expect(classifyDoc(doc({ source_type: 'onedrive_doc' })).layer).toBe('skills');
    expect(classifyDoc(doc({ source_type: 'policy_doc' })).layer).toBe('core');
    expect(classifyDoc(doc({ origin: 'brain', source_type: 'brain', entity_type: 'process' }))).toEqual({ layer: 'core', sector: 'Brain processes' });
    expect(classifyDoc(doc({ origin: 'brain', source_type: 'brain', entity_type: 'decision' }))).toEqual({ layer: 'memory', sector: 'Company memory · decisions' });
    expect(classifyDoc(doc({ origin: 'brain', source_type: 'brain', domain: 'company' })).sector).toBe('Company memory · company');
  });
});

describe('layout', () => {
  it('is deterministic and stays within the ring band', () => {
    const nodes = Array.from({ length: 50 }, (_, i) => ({ id: `n${i}`, sector: i < 20 ? 'a' : 'b', label: `n${i}` }));
    const a = layoutRing(nodes, 20, 3);
    const b = layoutRing([...nodes].reverse(), 20, 3);
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
    for (const [x, , z] of a.values()) {
      const r = Math.hypot(x, z);
      expect(r).toBeGreaterThanOrEqual(17 - 0.01);
      expect(r).toBeLessThanOrEqual(23 + 0.01);
    }
  });
  it('hash01 is stable and in [0,1)', () => {
    expect(hash01('x')).toBe(hash01('x'));
    expect(hash01('x', 1)).not.toBe(hash01('x', 2));
    expect(hash01('anything')).toBeLessThan(1);
  });
});

describe('buildSnapshot', () => {
  const docs = [
    doc({}),
    doc({ doc: 'k:ors_90:ORS 90.101', title: 'ORS 90.101' }),
    doc({ doc: 'k:notion_sop:Move-out', source_type: 'notion_sop', title: 'Move-out' }),
    doc({ doc: 'b:n1', origin: 'brain', source_type: 'brain', entity_type: 'policy', title: 'Pet policy' }),
    doc({ doc: 'b:n2', origin: 'brain', source_type: 'brain', entity_type: 'decision', title: 'Decision' }),
  ];
  const snap = buildSnapshot(
    {
      docs,
      knn: [['k:ors_90:ORS 90.100', 'k:ors_90:ORS 90.101', 0.91], ['k:ors_90:ORS 90.101', 'k:ors_90:ORS 90.100', 0.91], ['k:ors_90:ORS 90.100', 'b:missing', 0.5]],
      edges: [['b:n1', 'b:n2', 'governed_by']],
      cites: { 'k:notion_sop:Move-out': 9, 'k:ors_90:ORS 90.100': 1 },
      routineStatus: { estimate_chaser: 'halted' },
    },
    new Date('2026-10-01T10:00:00Z')
  );

  it('includes every doc, routine and integration with a position', () => {
    expect(snap.nodes).toHaveLength(docs.length + ROUTINES.length + INTEGRATIONS.length);
    expect(snap.nodes.every((n) => n.pos.every(Number.isFinite))).toBe(true);
    expect(snap.nodes.find((n) => n.id === 'r:estimate_chaser')?.status).toBe('halted');
    expect(snap.nodes.find((n) => n.id === 'r:kpi_snapshot')?.status).toBe('never');
  });

  it('dedupes symmetric neighbour edges and drops edges to unknown docs', () => {
    expect(snap.edges.filter((e) => e.kind === 'similar')).toHaveLength(1);
    expect(snap.edges.filter((e) => e.kind === 'link')).toEqual([expect.objectContaining({ label: 'governed_by' })]);
  });

  it('log-scales citation heat against the most-cited doc', () => {
    const heat = (id: string) => snap.nodes.find((n) => n.id === id)!.heat;
    expect(heat('k:notion_sop:Move-out')).toBe(1);
    expect(heat('k:ors_90:ORS 90.100')).toBeGreaterThan(0);
    expect(heat('k:ors_90:ORS 90.100')).toBeLessThan(0.5);
    expect(heat('k:ors_90:ORS 90.101')).toBe(0);
  });

  it('collapses whitespace in excerpts and reports stats', () => {
    expect(snap.nodes[0].excerpt).toBe('Definitions text');
    expect(snap.stats).toMatchObject({ documents: 5, chunks: 15, citations: 10, similarEdges: 1, linkEdges: 1 });
    expect(snap.layers.find((l) => l.key === 'memory')?.count).toBe(3);
  });
});

describe('countCitedChunks / brainMatchDocKey', () => {
  it('counts only well-formed chunk ids', () => {
    const id = '5aaa51c5-0caf-4d94-a99c-76fe7d6a3df1';
    const counts = countCitedChunks([{ cited: [{ id, type: 'ors_90' }, { id: 'nope' }] }, { cited: [{ id }] }, { sources: 3 }, null]);
    expect([...counts.entries()]).toEqual([[id, 2]]);
  });
  it('mirrors the SQL doc key', () => {
    expect(brainMatchDocKey({ id: 'c', node_id: 'n', source_url: 'u' })).toBe('b:n');
    expect(brainMatchDocKey({ id: 'c', node_id: null, source_url: 'docs/x.md' })).toBe('b:docs/x.md');
    expect(brainMatchDocKey({ id: 'c', node_id: null, source_url: null })).toBe('b:c');
  });
});
