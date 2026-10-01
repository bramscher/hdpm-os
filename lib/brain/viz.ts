/**
 * Brain map snapshot (workstream D). The nightly cron turns the knowledge base
 * into one JSON file that /brain draws as a radial point cloud:
 *
 *   layer (ring, inside → out): Core · Skills · Memory · Routines · Integrations
 *   sector (wedge within a ring): source type / brain entity type / routine category
 *   edges: each document's 3 nearest neighbours (averaged embeddings) + real brain_edge rows
 *   heat: how often Dez cited the document in the last 90 days
 *
 * Positions are computed here, on the server, and are deterministic (hash
 * jitter), so the map doesn't reshuffle every night. buildSnapshot is pure and
 * unit-tested; loadVizInput does the reads.
 */

import { ROUTINES } from '@/lib/routines/registry';

export type VizLayer = 'core' | 'skills' | 'memory' | 'routines' | 'integrations';

export const LAYERS: { key: VizLayer; label: string; radius: number; band: number }[] = [
  { key: 'core', label: 'Core: policies & processes', radius: 7, band: 2 },
  { key: 'skills', label: 'Skills: SOPs & procedures', radius: 15, band: 3 },
  { key: 'memory', label: 'Memory: law & company memory', radius: 25, band: 4 },
  { key: 'routines', label: 'Routines', radius: 34, band: 1 },
  { key: 'integrations', label: 'Integrations', radius: 40, band: 0.5 },
];

export const INTEGRATIONS = ['AppFolio', 'Microsoft 365', 'Notion', 'Slack', 'Zoom', 'QuickBooks', 'Haven'];

const SOURCE_LABEL: Record<string, string> = {
  ors_90: 'ORS 90',
  notion_sop: 'Notion SOPs',
  onedrive_doc: 'OneDrive procedures',
  loom_video: 'Loom videos',
  policy_doc: 'Policy docs',
};

export interface VizDocRow {
  doc: string;
  origin: 'knowledge' | 'brain';
  source_type: string;
  domain: string | null;
  entity_type: string | null;
  title: string | null;
  url: string | null;
  chunks: number;
  updated_at: string | null;
  excerpt: string | null;
}

export interface VizInput {
  docs: VizDocRow[];
  /** [src doc, dst doc, cosine similarity] */
  knn: [string, string, number][];
  /** [src doc, dst doc, relation] */
  edges: [string, string, string][];
  /** doc key → times cited */
  cites: Record<string, number>;
  /** routine id → last run status */
  routineStatus: Record<string, string>;
}

export interface VizNode {
  id: string;
  label: string;
  layer: VizLayer;
  sector: string;
  url: string | null;
  excerpt: string | null;
  updatedAt: string | null;
  chunks: number;
  cites: number;
  /** 0–1, log-scaled against the most-cited document */
  heat: number;
  status?: string;
  pos: [number, number, number];
}

export interface VizEdge {
  s: number;
  t: number;
  kind: 'similar' | 'link';
  w: number;
  label?: string;
}

export interface VizSnapshot {
  version: 1;
  generatedAt: string;
  layers: { key: VizLayer; label: string; radius: number; count: number }[];
  sectors: { key: string; layer: VizLayer; count: number }[];
  nodes: VizNode[];
  edges: VizEdge[];
  stats: { documents: number; chunks: number; citations: number; similarEdges: number; linkEdges: number };
}

/** Stable 0–1 pseudo-random from a string (FNV-1a). */
export function hash01(s: string, salt = 0): number {
  let h = 0x811c9dc5 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 100_000) / 100_000;
}

export function classifyDoc(d: VizDocRow): { layer: VizLayer; sector: string } {
  if (d.origin === 'knowledge') {
    if (d.source_type === 'policy_doc') return { layer: 'core', sector: SOURCE_LABEL.policy_doc };
    if (d.source_type === 'ors_90') return { layer: 'memory', sector: SOURCE_LABEL.ors_90 };
    return { layer: 'skills', sector: SOURCE_LABEL[d.source_type] ?? d.source_type };
  }
  if (d.entity_type === 'policy' || d.entity_type === 'process') {
    return { layer: 'core', sector: d.entity_type === 'policy' ? 'Brain policies' : 'Brain processes' };
  }
  const t = d.entity_type ? d.entity_type.replace(/_/g, ' ') : null;
  return { layer: 'memory', sector: t ? `Company memory · ${t}s` : `Company memory · ${d.domain ?? 'ops'}` };
}

function cleanTitle(d: VizDocRow): string {
  const raw = (d.title ?? '').trim() || d.doc.replace(/^[kb]:/, '');
  return raw.length > 90 ? `${raw.slice(0, 89)}…` : raw;
}

/**
 * Place a ring's nodes: sorted by sector then label, evenly spaced around the
 * circle with a gap between sectors so wedges read as groups. Radius and
 * height get deterministic jitter inside the layer's band.
 */
export function layoutRing(nodes: { id: string; sector: string; label: string }[], radius: number, band: number): Map<string, [number, number, number]> {
  const out = new Map<string, [number, number, number]>();
  if (nodes.length === 0) return out;
  const sorted = [...nodes].sort((a, b) => a.sector.localeCompare(b.sector) || a.label.localeCompare(b.label));
  const sectors = new Set(sorted.map((n) => n.sector)).size;
  const gap = sectors > 1 ? Math.max(1, Math.round(sorted.length * 0.03)) : 0;
  const slots = sorted.length + sectors * gap;
  let slot = 0;
  let prev: string | null = null;
  for (const n of sorted) {
    if (prev !== null && n.sector !== prev) slot += gap;
    prev = n.sector;
    const angle = (2 * Math.PI * (slot + 0.5)) / slots + (hash01(n.id, 3) - 0.5) * (Math.PI / slots);
    const r = radius + (hash01(n.id, 1) - 0.5) * band * 2;
    const y = (hash01(n.id, 2) - 0.5) * band * 1.6;
    out.set(n.id, [round(r * Math.cos(angle)), round(y), round(r * Math.sin(angle))]);
    slot++;
  }
  return out;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function buildSnapshot(input: VizInput, now = new Date()): VizSnapshot {
  type Draft = Omit<VizNode, 'pos' | 'heat'>;
  const drafts: Draft[] = [];

  for (const d of input.docs) {
    const { layer, sector } = classifyDoc(d);
    drafts.push({
      id: d.doc,
      label: cleanTitle(d),
      layer,
      sector,
      url: d.url,
      excerpt: d.excerpt ? d.excerpt.replace(/\s+/g, ' ').trim().slice(0, 280) : null,
      updatedAt: d.updated_at,
      chunks: d.chunks,
      cites: input.cites[d.doc] ?? 0,
    });
  }
  for (const r of ROUTINES) {
    drafts.push({
      id: `r:${r.id}`,
      label: r.name,
      layer: 'routines',
      sector: r.category,
      url: null,
      excerpt: `${r.schedule} UTC · owner ${r.owner}`,
      updatedAt: null,
      chunks: 0,
      cites: 0,
      status: input.routineStatus[r.id] ?? 'never',
    });
  }
  for (const name of INTEGRATIONS) {
    drafts.push({ id: `i:${name}`, label: name, layer: 'integrations', sector: 'Integrations', url: null, excerpt: null, updatedAt: null, chunks: 0, cites: 0 });
  }

  const positions = new Map<string, [number, number, number]>();
  for (const L of LAYERS) {
    for (const [id, p] of layoutRing(drafts.filter((d) => d.layer === L.key), L.radius, L.band)) positions.set(id, p);
  }

  const maxCites = Math.max(0, ...drafts.map((d) => d.cites));
  const nodes: VizNode[] = drafts.map((d) => ({
    ...d,
    heat: maxCites > 0 ? round(Math.log1p(d.cites) / Math.log1p(maxCites)) : 0,
    pos: positions.get(d.id)!,
  }));
  const index = new Map(nodes.map((n, i) => [n.id, i]));

  const edges: VizEdge[] = [];
  const seen = new Set<string>();
  const add = (a: string, b: string, kind: VizEdge['kind'], w: number, label?: string) => {
    const s = index.get(a);
    const t = index.get(b);
    if (s === undefined || t === undefined || s === t) return;
    const key = `${Math.min(s, t)}-${Math.max(s, t)}-${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push(label ? { s, t, kind, w, label } : { s, t, kind, w });
  };
  for (const [a, b, sim] of input.knn) add(a, b, 'similar', round(sim));
  for (const [a, b, rel] of input.edges) add(a, b, 'link', 1, rel);

  const sectorCounts = new Map<string, { layer: VizLayer; count: number }>();
  for (const n of nodes) {
    const k = `${n.layer}|${n.sector}`;
    sectorCounts.set(k, { layer: n.layer, count: (sectorCounts.get(k)?.count ?? 0) + 1 });
  }

  return {
    version: 1,
    generatedAt: now.toISOString(),
    layers: LAYERS.map((L) => ({ key: L.key, label: L.label, radius: L.radius, count: nodes.filter((n) => n.layer === L.key).length })),
    sectors: [...sectorCounts.entries()].map(([k, v]) => ({ key: k.split('|')[1], layer: v.layer, count: v.count })),
    nodes,
    edges,
    stats: {
      documents: input.docs.length,
      chunks: input.docs.reduce((n, d) => n + d.chunks, 0),
      citations: Object.values(input.cites).reduce((a, b) => a + b, 0),
      similarEdges: edges.filter((e) => e.kind === 'similar').length,
      linkEdges: edges.filter((e) => e.kind === 'link').length,
    },
  };
}

/** Count cited chunk ids across dez_activity.detail.cited arrays. */
export function countCitedChunks(details: unknown[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const d of details) {
    const cited = (d as { cited?: unknown } | null)?.cited;
    if (!Array.isArray(cited)) continue;
    for (const c of cited) {
      const id = (c as { id?: unknown })?.id;
      if (typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Doc key for a brain search match, mirroring brain_viz_doc_key() in SQL
 * (node, else source_url, else chunk id). Used to light up search results.
 */
export function brainMatchDocKey(m: { id: string; node_id: string | null; source_url: string | null }): string {
  return `b:${m.node_id ?? (m.source_url || m.id)}`;
}
