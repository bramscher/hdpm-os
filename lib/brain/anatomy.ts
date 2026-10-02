/**
 * Anatomical brain layout for /brain. The galaxy (/brain-2) uses the ring
 * positions baked into the nightly snapshot; this module lays the same
 * snapshot out as a brain instead, in the browser, so the snapshot and its
 * cron stay unchanged.
 *
 *   region (lobe): one per layer — core → frontal, skills → parietal & motor,
 *     memory → temporal, routines → cerebellum, integrations → brainstem.
 *     The occipital lobe (vision) has no sources yet; Dez sits in the thalamus.
 *   half: left = taught (k: knowledge docs, intake routines),
 *     right = learned (b: brain docs, routines where Dez acts), 0 = midline.
 *
 * Coordinates: front = +x, up = +y, right half = +z. Everything here is pure
 * and deterministic (seeded samples, hashed jitter), so positions don't move
 * between visits and the module unit-tests in Node.
 */

import { ROUTINES } from '@/lib/routines/registry';
import { hash01, INTEGRATIONS, type VizEdge, type VizLayer, type VizNode } from './viz';

export type Region = 'frontal' | 'parietal' | 'temporal' | 'occipital' | 'cerebellum' | 'stem' | 'core';
export type Half = -1 | 0 | 1;

export const REGIONS: { key: Region; name: string; role: string; holds: string }[] = [
  { key: 'frontal', name: 'Frontal lobe', role: 'Planning & judgement', holds: 'Core · policies & processes' },
  { key: 'parietal', name: 'Parietal & motor', role: 'Turning intent into action', holds: 'Skills · SOPs & procedures' },
  { key: 'temporal', name: 'Temporal lobe', role: 'Long-term memory & language', holds: 'Memory · law & company memory' },
  { key: 'occipital', name: 'Occipital lobe', role: 'Vision', holds: 'Vision · reserved, no sources yet' },
  { key: 'cerebellum', name: 'Cerebellum', role: 'Automatic timing', holds: 'Routines · scheduled jobs' },
  { key: 'stem', name: 'Brainstem', role: 'Link to the outside world', holds: 'Integrations' },
  { key: 'core', name: 'Thalamus', role: 'Routes signals', holds: 'Dez · central intelligence' },
];

export const REGION_FOR_LAYER: Record<VizLayer, Region> = {
  core: 'frontal',
  skills: 'parietal',
  memory: 'temporal',
  routines: 'cerebellum',
  integrations: 'stem',
};

/** A unit is one region in one half (stem and core sit on the midline). */
export interface Unit {
  region: Region;
  half: Half;
}
export const UNITS: Unit[] = REGIONS.flatMap((r): Unit[] =>
  r.key === 'stem' || r.key === 'core' ? [{ region: r.key, half: 0 }] : [{ region: r.key, half: 1 }, { region: r.key, half: -1 }],
);
export function unitIndex(region: Region, half: Half): number {
  return UNITS.findIndex((u) => u.region === region && u.half === half);
}
const UIDX = new Map(UNITS.map((u, i) => [`${u.region}${u.half}`, i]));

/** Dez's position: the thalamus, between the hemispheres. */
export const DEZ_POS: [number, number, number] = [-0.4, -0.2, 0];

// ── Volume ───────────────────────────────────────────────────────────────

const MID = 0.28; // half-width of the gap between hemispheres

function inCerebrum(x: number, y: number, z: number): boolean {
  if (z < MID) return false;
  const dx = (x - 0.2) / (x > 0.2 ? 7.3 : 7.9);
  const dy = (y - 0.9) / (y > 0.9 ? 5.0 : 3.8);
  const zd = (z - 2.6) / (z < 2.6 ? 2.6 : 2.9);
  const dz = z < 2.6 ? zd ** 4 : zd * zd; // flat medial face, round lateral face
  if (dx * dx + dy * dy + dz < 1) return true;
  const tx = (x - 1.2) / 4.4, ty = (y + 2.3) / 1.9, tz = (z - 3.0) / 2.3; // temporal bulge
  return tx * tx + ty * ty + tz * tz < 1;
}

function inCerebellum(x: number, y: number, z: number): boolean {
  if (z < 0.12) return false;
  const dx = (x + 4.5) / 2.6, dy = (y + 3.7) / 1.6, dz = (z - 1.6) / 1.9;
  return dx * dx + dy * dy + dz * dz < 1;
}

function stemAxisX(y: number): number {
  return -1.0 + 0.15 * (y + 1.4);
}

function inStem(x: number, y: number, z: number): boolean {
  const dx = (x - stemAxisX(y)) / 1.0, dy = (y + 4.4) / 3.0, dz = z / 0.95;
  return dx * dx + dy * dy + dz * dz < 1;
}

/** The unit containing a point, or -1 outside the brain. */
export function unitAt(x: number, y: number, z: number): number {
  const h = z >= 0 ? 1 : -1;
  const az = Math.abs(z);
  if (inCerebrum(x, y, az)) {
    let r: Region;
    if (y < -0.5 - 0.17 * x && x > -4.4) r = 'temporal'; // below the lateral (Sylvian) fissure
    else if (x > 1.6 - 0.3 * y) r = 'frontal'; // in front of the central sulcus
    else if (x < -4.6 + 0.25 * y) r = 'occipital'; // behind the parieto-occipital line
    else r = 'parietal';
    return UIDX.get(`${r}${h}`)!;
  }
  if (inCerebellum(x, y, az)) return UIDX.get(`cerebellum${h}`)!;
  if (inStem(x, y, z)) return UIDX.get('stem0')!;
  return -1;
}

// ── Sampling ─────────────────────────────────────────────────────────────

export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface BrainSamples {
  /** Cortex surface points (xyz), the unit each sits in, and a 0–1 shade for the fold pattern. */
  shell: Float32Array;
  shellUnit: Uint8Array;
  shellShade: Float32Array;
  /** Interior points per unit (xyz triples), for placing sector clusters. */
  inside: Float32Array[];
  /** Sample hits per unit, proportional to its volume. */
  volume: number[];
  /** Mean shell position per unit. */
  centroid: [number, number, number][];
}

const SAMPLE_BOX = { x: [-9, 9], y: [-8, 7], z: [-6.5, 6.5] } as const;

/**
 * Sample the brain volume once: surface points become the cortex shell
 * (with gyri / folia grooves cut out so it reads as folded), interior points
 * seed the node layout.
 */
export function sampleBrain(seed = 20261001, count = 170_000): BrainSamples {
  const rand = mulberry32(seed);
  const shell: number[] = [];
  const shellUnit: number[] = [];
  const shellShade: number[] = [];
  const inside: number[][] = UNITS.map(() => []);
  const volume = UNITS.map(() => 0);
  const E = 0.32;
  const dirs = [[E, 0, 0], [-E, 0, 0], [0, E, 0], [0, -E, 0], [0, 0, E], [0, 0, -E]];
  const [x0, x1] = SAMPLE_BOX.x, [y0, y1] = SAMPLE_BOX.y, [z0, z1] = SAMPLE_BOX.z;

  for (let s = 0; s < count; s++) {
    const x = x0 + rand() * (x1 - x0), y = y0 + rand() * (y1 - y0), z = z0 + rand() * (z1 - z0);
    const u = unitAt(x, y, z);
    if (u < 0) continue;
    volume[u]++;
    let outside = false;
    let border = false;
    for (const d of dirs) {
      const v = unitAt(x + d[0], y + d[1], z + d[2]);
      if (v < 0) outside = true;
      else if (v !== u) border = true;
    }
    if (!outside && !border) {
      if (inside[u].length < 12_000) inside[u].push(x, y, z);
      continue;
    }
    const region = UNITS[u].region;
    let shade = 0.8;
    if (outside) {
      if (region === 'cerebellum') {
        if (Math.sin(7.5 * y + 0.8 * Math.sin(1.5 * x)) < -0.3) continue;
        shade = 0.9;
      } else if (region !== 'stem') {
        const g = Math.sin(1.9 * x + 1.4 * Math.sin(1.2 * y + 0.6 * z)) + Math.sin(1.7 * y + 1.3 * Math.sin(1.05 * x - 0.4 * z));
        if (g < -0.6) continue;
        shade = 0.75 + 0.18 * g;
      }
    } else if (rand() > 0.45) {
      continue; // faces between lobes: sparser, so the assembled brain isn't cluttered inside
    }
    shell.push(x, y, z);
    shellUnit.push(u);
    shellShade.push(shade);
  }

  const centroid = UNITS.map((): [number, number, number] => [0, 0, 0]);
  const n = UNITS.map(() => 0);
  for (let i = 0; i < shellUnit.length; i++) {
    const c = centroid[shellUnit[i]];
    c[0] += shell[i * 3];
    c[1] += shell[i * 3 + 1];
    c[2] += shell[i * 3 + 2];
    n[shellUnit[i]]++;
  }
  centroid.forEach((c, i) => {
    if (n[i]) for (let k = 0; k < 3; k++) c[k] /= n[i];
  });
  centroid[unitIndex('core', 0)] = [...DEZ_POS];

  return {
    shell: new Float32Array(shell),
    shellUnit: Uint8Array.from(shellUnit),
    shellShade: new Float32Array(shellShade),
    inside: inside.map((a) => new Float32Array(a)),
    volume,
    centroid,
  };
}

// ── Node layout ──────────────────────────────────────────────────────────

/** Routines that bring information in sit in the taught half. */
const INTAKE_ROUTINES = new Set([
  ...ROUTINES.filter((r) => r.category === 'sync').map((r) => r.id),
  'knowledge_notion',
  'knowledge_onedrive',
  'ors_watch',
  'ors_session_review',
]);

/** Left (-1) = taught, right (1) = learned, 0 = midline. Read from the snapshot's node id prefix. */
export function halfForNode(id: string): Half {
  if (id.startsWith('k:')) return -1;
  if (id.startsWith('b:')) return 1;
  if (id.startsWith('r:')) return INTAKE_ROUTINES.has(id.slice(2)) ? -1 : 1;
  return 0;
}

export type LayoutNode = Pick<VizNode, 'id' | 'label' | 'layer' | 'sector'>;

export interface AnatomyLayout {
  /** xyz per node, before explode offsets. */
  pos: Float32Array;
  /** Unit index per node. */
  unit: Uint8Array;
  /** Base dot size per node (world units), before citation heat. */
  size: Float32Array;
}

const DOC_LAYERS = new Set<VizLayer>(['core', 'skills', 'memory']);

/** Standard normal from two hash draws (Box–Muller), so jitter is per-node and stable. */
function hashGauss(key: string, salt: number): number {
  const u = hash01(key, salt) + 1e-6;
  const v = hash01(key, salt + 7919);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function pointAt(arr: Float32Array, k: number): [number, number, number] {
  const i = (k % (arr.length / 3)) * 3;
  return [arr[i], arr[i + 1], arr[i + 2]];
}

/**
 * Place every node inside its unit. A sector clusters around a point picked
 * by hashing its name; each node jitters around that point by its own id, so
 * a node's position never depends on the other nodes (only on its sector's
 * size bucket, which sets the cluster spread).
 *
 * Regions keep their anatomical size, so dots shrink as a region fills:
 * dot size follows the mean spacing between documents in that half-region.
 */
export function layoutAnatomy(nodes: LayoutNode[], s: BrainSamples): AnatomyLayout {
  const pos = new Float32Array(nodes.length * 3);
  const unit = new Uint8Array(nodes.length);
  const size = new Float32Array(nodes.length);

  const units = nodes.map((n) => {
    const region = REGION_FOR_LAYER[n.layer] ?? 'temporal';
    const half = region === 'stem' ? 0 : halfForNode(n.id) || -1;
    return unitIndex(region, half as Half);
  });
  const sectorCount = new Map<string, number>();
  nodes.forEach((n, i) => {
    const k = `${units[i]}|${n.sector}`;
    sectorCount.set(k, (sectorCount.get(k) ?? 0) + 1);
  });

  nodes.forEach((n, i) => {
    const u = units[i];
    unit[i] = u;
    let p: [number, number, number] | null = null;
    if (UNITS[u].region === 'stem') {
      const k = INTEGRATIONS.indexOf(n.label as (typeof INTEGRATIONS)[number]);
      const slot = k >= 0 ? k : Math.floor(hash01(n.id) * INTEGRATIONS.length);
      const y = -2.9 - slot * 0.62;
      p = [stemAxisX(y) + (slot % 2 ? 0.25 : -0.25), y, slot % 2 ? 0.3 : -0.3];
    } else {
      const inner = s.inside[u];
      const key = `${u}|${n.sector}`;
      const c = pointAt(inner, Math.floor(hash01(key, 11) * (inner.length / 3)));
      const bucket = 2 ** Math.ceil(Math.log2(Math.max(1, sectorCount.get(key)!)));
      const sigma = 0.6 + 0.09 * Math.sqrt(bucket);
      for (let t = 0; t < 40 && !p; t++) {
        const q: [number, number, number] = [
          c[0] + hashGauss(n.id, t * 3 + 1) * sigma,
          c[1] + hashGauss(n.id, t * 3 + 2) * sigma,
          c[2] + hashGauss(n.id, t * 3 + 3) * sigma,
        ];
        if (unitAt(q[0], q[1], q[2]) === u) p = q;
      }
      p ??= pointAt(inner, Math.floor(hash01(n.id, 5) * (inner.length / 3)));
    }
    pos.set(p, i * 3);
  });

  // Dot size per half-region: the emptier it is, the bigger the dots.
  const docs = UNITS.map(() => 0);
  nodes.forEach((n, i) => {
    if (DOC_LAYERS.has(n.layer)) docs[units[i]]++;
  });
  const spacing = docs.map((c, u) => (c ? Math.cbrt(s.volume[u] / c) : 0));
  const maxSpacing = Math.max(...spacing, 1e-9);
  nodes.forEach((n, i) => {
    if (n.layer === 'integrations') size[i] = 0.6;
    else if (n.layer === 'routines') size[i] = 0.34;
    else size[i] = Math.max(0.08, (0.3 * spacing[units[i]]) / maxSpacing);
  });

  return { pos, unit, size };
}

/** Per-unit offsets (xyz) at explode amount t (0 = whole, 1 = apart). */
export function explodeOffsets(t: number, s: BrainSamples, out: Float32Array<ArrayBufferLike> = new Float32Array(UNITS.length * 3)): Float32Array<ArrayBufferLike> {
  UNITS.forEach((u, i) => {
    if (u.region === 'core') {
      out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = 0;
      return;
    }
    const c = s.centroid[i];
    let dx = c[0] + 0.5;
    let dy = c[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    out[i * 3] = dx * 4.4 * t;
    out[i * 3 + 1] = dy * 4.4 * t;
    out[i * 3 + 2] = u.half * 2.6 * t;
  });
  return out;
}

// ── Search scan ──────────────────────────────────────────────────────────

export interface ScanInput {
  /** Meaning-search matches, already mapped to snapshot doc keys. */
  semantic?: { key: string; score: number }[];
  /** Node indices whose title matched the typed text. */
  text?: number[];
  /** Doc keys Dez cited in an Ask answer, in source order. */
  ask?: string[];
}

export const SCAN_CAP = 30;
const TEXT_SCORE = 0.5;
const SPREAD = { link: 0.5, similar: 0.35 } as const;

/**
 * Relevance per node, 0–1, for lighting up the brain. Meaning-search scores
 * are normalised to the best match; a title-only match counts 0.5 (it says
 * nothing about relevance beyond "the words appear"); Ask sources score by
 * rank. Each hit lends part of its score to linked documents, so related
 * knowledge glows faintly. The top SCAN_CAP survive.
 */
export function scanScores(input: ScanInput, index: Map<string, number>, edges: VizEdge[]): Map<number, number> {
  const direct = new Map<number, number>();
  const bump = (i: number | undefined, v: number) => {
    if (i === undefined || !(v > 0)) return;
    if (v > (direct.get(i) ?? 0)) direct.set(i, v);
  };

  const sem = input.semantic ?? [];
  const top = Math.max(0, ...sem.map((m) => m.score));
  if (top > 0) for (const m of sem) bump(index.get(m.key), m.score / top);
  for (const i of input.text ?? []) bump(i, TEXT_SCORE);
  const ask = input.ask ?? [];
  ask.forEach((key, rank) => bump(index.get(key), 1 - (0.6 * rank) / ask.length));

  const out = new Map(direct);
  for (const e of edges) {
    const f = SPREAD[e.kind];
    for (const [from, to] of [[e.s, e.t], [e.t, e.s]]) {
      const v = direct.get(from);
      if (v === undefined) continue;
      if (v * f > (out.get(to) ?? 0)) out.set(to, v * f);
    }
  }

  return new Map([...out.entries()].sort((a, b) => b[1] - a[1]).slice(0, SCAN_CAP));
}
