'use client';

/**
 * The anatomical brain map, in plain three.js like the galaxy (BrainScene).
 *
 * Everything is additive point sprites and lines, with no bloom pass: a
 * folded cortex shell tinted per half, a faint skull, one dot per document
 * (ringed in the learned half), neighbour edges, pulsing citation beams from
 * Dez in the thalamus, and a search "scan" that heats hits and the cortex
 * around them by relevance. Explode moves each lobe outward; positions are
 * only rewritten while it's changing. Loaded with next/dynamic, ssr: false.
 */

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { VizSnapshot } from '@/lib/brain/viz';
import { REGIONS, UNITS, DEZ_POS, explodeOffsets, type AnatomyLayout, type BrainSamples, type Half, type Region } from '@/lib/brain/anatomy';
import { HALF_TINT, LAYER_COLOR, REGION_COLOR, STATUS_COLOR } from '../colors';

export type ViewName = 'angled' | 'side' | 'top' | 'back';

export interface AnatomySceneProps {
  snapshot: VizSnapshot;
  samples: BrainSamples;
  layout: AnatomyLayout;
  /** Node indices passing the sector filter. null = all. */
  visible: Set<number> | null;
  focusRegion: Region | null;
  focusHalf: Half | null;
  /** Search / Ask relevance per node, 0–1. Empty = no scan. */
  scan: Map<number, number>;
  /** Explode target, 0 = whole, 1 = apart; `slow` eases it like the opening. */
  explode: { value: number; slow: boolean };
  skull: boolean;
  spin: boolean;
  /** Camera preset; bump `seq` to re-apply the same one. */
  view: { name: ViewName; seq: number };
  hovered: number | null;
  selected: number | null;
  onHover: (i: number | null) => void;
  onSelect: (i: number | null) => void;
  /** Reports the animated explode amount (whole percent) so the slider can follow. */
  onExplodeProgress: (pct: number) => void;
}

const CITE_BEAMS = 28;
const MAX_SCAN = 32;
const BIG = new THREE.Sphere(new THREE.Vector3(), 60);
const TARGET = new THREE.Vector3(-0.6, -0.8, 0);
const VIEWS: Record<ViewName, [theta: number, phi: number, radius: number]> = {
  angled: [0.55, 1.2, 29],
  side: [0, Math.PI / 2, 27],
  top: [0, 0.05, 29],
  back: [-Math.PI / 2 + 0.0001, 1.35, 28],
};
const HOT = new THREE.Color('#ffb347');
const WHITE = new THREE.Color('#fff7d6');
const LABEL_LIFT: Record<Region, [number, number]> = {
  frontal: [0.5, 1.2], parietal: [0, 1.6], temporal: [0.8, -0.9], occipital: [-0.6, 0.4], cerebellum: [-0.5, -0.9], stem: [0.3, -1.6], core: [0, 1.4],
};

// Soft additive dots; aRing turns a dot into a ring (the learned half).
const VERT = /* glsl */ `
attribute float aSize; attribute vec3 aColor; attribute float aRing;
uniform float uScale; varying vec3 vColor; varying float vRing;
void main() {
  vColor = aColor; vRing = aRing;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(1.5, aSize * uScale / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */ `
uniform float uSoft; uniform float uOpacity; varying vec3 vColor; varying float vRing;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float solid = pow(1.0 - d, uSoft);
  float ring = exp(-pow((d - 0.68) / 0.15, 2.0)) * 0.95 + solid * 0.25;
  gl_FragColor = vec4(vColor * mix(solid, ring, vRing) * uOpacity, 1.0);
  #include <colorspace_fragment>
}`;

function pointMaterial(soft: number) {
  return new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 1 }, uSoft: { value: soft }, uOpacity: { value: 1 } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    transparent: true,
  });
}

function makePoints(pos: Float32Array, col: Float32Array, size: Float32Array, ring: Float32Array, mat: THREE.ShaderMaterial) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aRing', new THREE.BufferAttribute(ring, 1));
  g.boundingSphere = BIG;
  const p = new THREE.Points(g, mat);
  p.frustumCulled = false;
  return p;
}

function makeLines(segments: number, opacity = 1) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(segments * 6);
  const col = new Float32Array(segments * 6);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.boundingSphere = BIG;
  const mat = new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, opacity, depthWrite: false, depthTest: false });
  const l = new THREE.LineSegments(g, mat);
  l.frustumCulled = false;
  return { l, g, pos, col, mat };
}

/** Skull: sparse dots on a cranium dome, open at the base (brow in front, low at the back). */
function skullPoints(): Float32Array {
  const rand = (() => {
    let a = 42;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();
  const out: number[] = [];
  while (out.length < 6500 * 3) {
    const u = rand() * 2 - 1, a = rand() * Math.PI * 2, q = Math.sqrt(1 - u * u);
    const x = -0.1 + 8.9 * q * Math.cos(a), z = 6.5 * q * Math.sin(a);
    const y = u < 0 ? 0.8 + 5.2 * u : 0.8 + 6.1 * u;
    if (y < -3.75 + 0.22 * x) continue;
    out.push(x, y, z);
  }
  return new Float32Array(out);
}

interface Data {
  objects: THREE.Object3D[];
  shellPts: THREE.Points;
  shellBase: Float32Array;
  shellAct: Float32Array | null;
  nodePts: THREE.Points;
  nodeColor: THREE.Color[];
  baseSize: Float32Array;
  edges: ReturnType<typeof makeLines>;
  cites: ReturnType<typeof makeLines>;
  citeIdx: number[];
  scanLines: ReturnType<typeof makeLines>;
  scanIdx: number[];
  focus: ReturnType<typeof makeLines>;
  adj: number[][];
}

interface World {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  dez: THREE.Mesh;
  skull: THREE.Points;
  materials: THREE.ShaderMaterial[];
  data: Data | null;
  off: Float32Array;
  explodeNow: number;
  scanT: number;
  posDirty: boolean;
  colorDirty: boolean;
  goal: [number, number, number] | null;
  resize?: () => void;
}

export default function AnatomyScene(props: AnatomySceneProps) {
  const host = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const world = useRef<World | null>(null);
  const live = useRef(props);
  live.current = props;

  // ── Renderer, camera, controls, skull, Dez: once ────────────────────────
  useEffect(() => {
    const el = host.current!;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor('#030712');
    el.appendChild(renderer.domElement);
    renderer.domElement.style.touchAction = 'none';

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(TARGET);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotateSpeed = 0.5;
    controls.minDistance = 10;
    controls.maxDistance = 70;
    controls.enablePan = false;

    // Opening shot: pulled back and turned, easing into the angled view.
    const [t0, p0, r0] = VIEWS.angled;
    const start: [number, number, number] = reduceMotion ? [t0, p0, r0] : [t0 - 0.9, p0, r0 + 10];
    camera.position.setFromSpherical(new THREE.Spherical(start[2], start[1], start[0])).add(TARGET);

    const dez = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.75, 1),
      new THREE.MeshBasicMaterial({ color: '#ffd27a', wireframe: true, transparent: true, opacity: 0.7, depthWrite: false, depthTest: false }),
    );
    dez.position.set(...DEZ_POS);
    scene.add(dez);

    const skullPos = skullPoints();
    const n = skullPos.length / 3;
    const sc = new THREE.Color('#c9d3e6');
    const skullCol = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const k = 0.05 + 0.03 * ((i * 2654435761) % 1000) / 1000;
      skullCol.set([sc.r * k, sc.g * k, sc.b * k], i * 3);
    }
    const skullMat = pointMaterial(1.6);
    const skull = makePoints(skullPos, skullCol, new Float32Array(n).fill(0.1), new Float32Array(n), skullMat);
    scene.add(skull);

    const w: World = {
      renderer, scene, camera, controls, dez, skull,
      materials: [skullMat],
      data: null,
      off: new Float32Array(UNITS.length * 3),
      explodeNow: live.current.explode.value,
      scanT: 0,
      posDirty: true,
      colorDirty: true,
      goal: reduceMotion ? null : [t0, p0, r0],
    };
    world.current = w;
    controls.addEventListener('start', () => (w.goal = null));

    // Hover + click: nearest dot to the ray, among the ones in focus.
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points = { threshold: 0.28 };
    const pointer = new THREE.Vector2();
    let down: { x: number; y: number } | null = null;
    const pick = (ev: PointerEvent): number | null => {
      const d = w.data;
      if (!d) return null;
      const r = renderer.domElement.getBoundingClientRect();
      pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(d.nodePts, false).filter((h) => inFocus(h.index!));
      if (!hits.length) return null;
      hits.sort((a, b) => (a.distanceToRay ?? 0) - (b.distanceToRay ?? 0));
      return hits[0].index ?? null;
    };
    const onMove = (ev: PointerEvent) => {
      if (ev.buttons) return; // orbiting
      const i = pick(ev);
      if (i !== live.current.hovered) live.current.onHover(i);
      renderer.domElement.style.cursor = i === null ? 'grab' : 'pointer';
    };
    const onDown = (ev: PointerEvent) => (down = { x: ev.clientX, y: ev.clientY });
    const onUp = (ev: PointerEvent) => {
      if (!down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 5) return;
      live.current.onSelect(pick(ev));
    };
    const onLeave = () => live.current.onHover(null);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointerleave', onLeave);

    const resize = () => {
      const { clientWidth: cw, clientHeight: ch } = el;
      if (!cw || !ch) return;
      renderer.setSize(cw, ch);
      camera.aspect = cw / ch;
      camera.fov = cw < ch ? 58 : 42; // portrait phones: widen so the whole head fits
      camera.updateProjectionMatrix();
      const scale = renderer.getDrawingBufferSize(new THREE.Vector2()).y / (2 * Math.tan((camera.fov * Math.PI) / 360));
      for (const m of w.materials) m.uniforms.uScale.value = scale;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    w.resize = resize;

    const clock = new THREE.Clock();
    const v = new THREE.Vector3();
    const sph = new THREE.Spherical();
    let lastPct = -1;
    let lastT = 0;
    let raf = 0;
    // Frame-rate independent easing: fraction of the remaining distance to cover this frame.
    const ease = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const t = clock.getElapsedTime();
      const dt = Math.min(0.1, t - lastT);
      lastT = t;
      const p = live.current;
      const d = w.data;

      // Explode easing: slow for the opening, quick for the slider.
      const target = p.explode.value;
      const diff = target - w.explodeNow;
      if (Math.abs(diff) > 1e-4) {
        w.explodeNow = reduceMotion ? target : w.explodeNow + diff * ease(p.explode.slow ? 1.7 : 7.5, dt);
        if (Math.abs(target - w.explodeNow) < 1e-3) w.explodeNow = target;
        w.posDirty = true;
        const pct = Math.round(w.explodeNow * 100);
        if (pct !== lastPct) {
          lastPct = pct;
          p.onExplodeProgress(pct);
        }
      }
      if (d && w.posDirty) {
        updatePositions(w, d);
        w.posDirty = false;
      }

      // Scan fade in / out.
      const scanTarget = p.scan.size ? 1 : 0;
      if (Math.abs(scanTarget - w.scanT) > 1e-3) {
        w.scanT = reduceMotion ? scanTarget : w.scanT + (scanTarget - w.scanT) * ease(4.3, dt);
        if (Math.abs(scanTarget - w.scanT) <= 1e-3) w.scanT = scanTarget;
        w.colorDirty = true;
      }
      if (d && w.colorDirty) {
        updateColors(w, d);
        w.colorDirty = false;
      }

      // Skull lifts and fades as the brain comes apart.
      skull.scale.setScalar(1 + 0.35 * w.explodeNow);
      skull.position.y = 3 * w.explodeNow;
      skullMat.uniforms.uOpacity.value = p.skull ? Math.max(0, 1 - w.explodeNow * 1.8) : 0;
      skull.visible = skullMat.uniforms.uOpacity.value > 0.01;

      // Camera: presets animate; otherwise orbit controls (auto-rotate when idle).
      if (w.goal) {
        sph.setFromVector3(v.copy(camera.position).sub(TARGET));
        let gt = w.goal[0];
        while (gt - sph.theta > Math.PI) gt -= 2 * Math.PI;
        while (sph.theta - gt > Math.PI) gt += 2 * Math.PI;
        const k = ease(p.explode.slow ? 1.8 : 6.3, dt);
        sph.theta += (gt - sph.theta) * k;
        sph.phi += (w.goal[1] - sph.phi) * k;
        sph.radius += (w.goal[2] - sph.radius) * k;
        camera.position.setFromSpherical(sph).add(TARGET);
        if (Math.abs(gt - sph.theta) + Math.abs(w.goal[1] - sph.phi) + Math.abs(w.goal[2] - sph.radius) < 1e-3) w.goal = null;
      }
      controls.autoRotate = p.spin && !reduceMotion && !w.goal && p.hovered === null && p.selected === null;
      controls.update();

      if (d) {
        d.cites.mat.opacity = reduceMotion ? 0.8 : 0.55 + 0.4 * Math.sin(t * 2.2);
        d.scanLines.mat.opacity = reduceMotion ? 1 : 0.75 + 0.25 * Math.sin(t * 4);
      }
      if (!reduceMotion) {
        dez.rotation.y = t * 0.3;
        dez.rotation.x = t * 0.17;
      }
      renderer.render(scene, camera);
      placeOverlay(w, el);
    };
    frame();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('pointerleave', onLeave);
      controls.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
      world.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Geometry for this snapshot ───────────────────────────────────────────
  useEffect(() => {
    const w = world.current;
    if (!w) return;
    const { snapshot, samples, layout } = props;
    if (w.data) {
      for (const o of w.data.objects) {
        w.scene.remove(o);
        const m = o as THREE.Mesh;
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
      w.materials = w.materials.slice(0, 1); // keep the skull's
    }

    // Cortex shell, tinted by half.
    const ns = samples.shellUnit.length;
    const shellBase = new Float32Array(ns * 3);
    const c = new THREE.Color();
    const tint = { '-1': new THREE.Color(HALF_TINT.taught), '1': new THREE.Color(HALF_TINT.learned) } as Record<string, THREE.Color>;
    for (let i = 0; i < ns; i++) {
      const u = UNITS[samples.shellUnit[i]];
      c.set(REGION_COLOR[u.region]);
      if (u.half) c.lerp(tint[String(u.half)], 0.4);
      const k = (u.region === 'occipital' ? 0.17 : 0.2) * samples.shellShade[i];
      shellBase.set([c.r * k, c.g * k, c.b * k], i * 3);
    }
    const shellMat = pointMaterial(1.8);
    const shellPts = makePoints(new Float32Array(samples.shell), new Float32Array(shellBase), new Float32Array(ns).fill(0.11), new Float32Array(ns), shellMat);

    // Nodes.
    const N = snapshot.nodes.length;
    const nodeColor = snapshot.nodes.map((n) =>
      new THREE.Color(n.layer === 'routines' ? STATUS_COLOR[n.status ?? 'never'] ?? LAYER_COLOR.routines : LAYER_COLOR[n.layer]),
    );
    const ring = new Float32Array(N);
    const baseSize = new Float32Array(N);
    snapshot.nodes.forEach((n, i) => {
      const half = UNITS[layout.unit[i]].half;
      ring[i] = half === 1 ? (n.layer === 'routines' ? 0.6 : 1) : 0;
      baseSize[i] = layout.size[i] * (1 + 1.3 * n.heat) * (ring[i] ? 1.3 : 1);
    });
    const nodeMat = pointMaterial(1.3);
    const nodePts = makePoints(new Float32Array(N * 3), new Float32Array(N * 3), new Float32Array(baseSize), ring, nodeMat);

    // Lines: neighbour edges, citation beams, scan beams, focus (hover / selected) edges.
    const edges = makeLines(snapshot.edges.length);
    const citeIdx = snapshot.nodes
      .map((n, i) => [i, n.cites] as const)
      .filter(([, k]) => k > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, CITE_BEAMS)
      .map(([i]) => i);
    const cites = makeLines(CITE_BEAMS);
    cites.g.setDrawRange(0, citeIdx.length * 2);
    const scanLines = makeLines(MAX_SCAN);
    scanLines.g.setDrawRange(0, 0);
    const focus = makeLines(96, 0.9);
    focus.g.setDrawRange(0, 0);
    const adj: number[][] = snapshot.nodes.map(() => []);
    snapshot.edges.forEach((e, k) => {
      adj[e.s].push(k);
      adj[e.t].push(k);
    });

    const objects = [shellPts, edges.l, cites.l, scanLines.l, focus.l, nodePts];
    for (const o of objects) w.scene.add(o);
    w.materials.push(shellMat, nodeMat);
    w.data = { objects, shellPts, shellBase, shellAct: null, nodePts, nodeColor, baseSize, edges, cites, citeIdx, scanLines, scanIdx: [], focus, adj };
    w.resize?.();
    w.posDirty = true;
    w.colorDirty = true;
  }, [props.snapshot, props.samples, props.layout]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scan: which hits, and how the cortex around them heats up ────────────
  useEffect(() => {
    const w = world.current;
    const d = w?.data;
    if (!w || !d) return;
    const { scan, layout, samples } = props;
    if (!scan.size) {
      w.colorDirty = true; // fades out in the loop; keep the old activation until then
      return;
    }
    d.scanIdx = [...scan.keys()].sort((a, b) => scan.get(b)! - scan.get(a)!).slice(0, MAX_SCAN);
    const act = new Float32Array(samples.shellUnit.length);
    const R = 2.4;
    for (const i of d.scanIdx) {
      const s = scan.get(i)!;
      const px = layout.pos[i * 3], py = layout.pos[i * 3 + 1], pz = layout.pos[i * 3 + 2];
      for (let j = 0; j < act.length; j++) {
        if (samples.shellUnit[j] !== layout.unit[i]) continue;
        const dist = Math.hypot(samples.shell[j * 3] - px, samples.shell[j * 3 + 1] - py, samples.shell[j * 3 + 2] - pz);
        if (dist < R) act[j] = Math.max(act[j], s * (1 - dist / R));
      }
    }
    d.shellAct = act;
    d.scanLines.g.setDrawRange(0, d.scanIdx.length * 2);
    w.scanT = 0; // replay the fade for each new scan
    w.posDirty = true;
    w.colorDirty = true;
  }, [props.scan]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus, filters, hover and selection only change colours.
  useEffect(() => {
    const w = world.current;
    if (!w?.data) return;
    w.colorDirty = true;
    updateFocusLines(w, w.data);
  }, [props.visible, props.focusRegion, props.focusHalf, props.hovered, props.selected]);

  useEffect(() => {
    const w = world.current;
    if (w) w.goal = VIEWS[props.view.name];
  }, [props.view]);

  // ── Helpers (closures over the latest props) ─────────────────────────────
  function inFocus(i: number): boolean {
    const p = live.current;
    const u = UNITS[p.layout.unit[i]];
    if (p.visible && !p.visible.has(i)) return false;
    if (p.focusRegion && u.region !== p.focusRegion) return false;
    if (p.focusHalf !== null && u.half !== 0 && u.half !== p.focusHalf) return false;
    if (p.focusHalf !== null && u.half === 0) return false;
    return true;
  }

  function nodeWorld(w: World, i: number, out: number[] | Float32Array, at = 0) {
    const { layout } = live.current;
    const u = layout.unit[i];
    out[at] = layout.pos[i * 3] + w.off[u * 3];
    out[at + 1] = layout.pos[i * 3 + 1] + w.off[u * 3 + 1];
    out[at + 2] = layout.pos[i * 3 + 2] + w.off[u * 3 + 2];
  }

  function updatePositions(w: World, d: Data) {
    const { samples, snapshot } = live.current;
    explodeOffsets(w.explodeNow, samples, w.off);
    const sp = d.shellPts.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < samples.shellUnit.length; i++) {
      const u = samples.shellUnit[i];
      sp[i * 3] = samples.shell[i * 3] + w.off[u * 3];
      sp[i * 3 + 1] = samples.shell[i * 3 + 1] + w.off[u * 3 + 1];
      sp[i * 3 + 2] = samples.shell[i * 3 + 2] + w.off[u * 3 + 2];
    }
    d.shellPts.geometry.attributes.position.needsUpdate = true;
    const np = d.nodePts.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < snapshot.nodes.length; i++) nodeWorld(w, i, np, i * 3);
    d.nodePts.geometry.attributes.position.needsUpdate = true;
    snapshot.edges.forEach((e, k) => {
      nodeWorld(w, e.s, d.edges.pos, k * 6);
      nodeWorld(w, e.t, d.edges.pos, k * 6 + 3);
    });
    d.edges.g.attributes.position.needsUpdate = true;
    d.citeIdx.forEach((i, k) => {
      d.cites.pos.set(DEZ_POS, k * 6);
      nodeWorld(w, i, d.cites.pos, k * 6 + 3);
    });
    d.cites.g.attributes.position.needsUpdate = true;
    d.scanIdx.forEach((i, k) => {
      d.scanLines.pos.set(DEZ_POS, k * 6);
      nodeWorld(w, i, d.scanLines.pos, k * 6 + 3);
    });
    d.scanLines.g.attributes.position.needsUpdate = true;
    updateFocusLines(w, d);
  }

  function updateFocusLines(w: World, d: Data) {
    const { hovered, selected, snapshot } = live.current;
    const i = hovered ?? selected;
    if (i === null) {
      d.focus.g.setDrawRange(0, 0);
      return;
    }
    let k = 0;
    for (const e of d.adj[i]) {
      if (k >= 96) break;
      const edge = snapshot.edges[e];
      nodeWorld(w, edge.s, d.focus.pos, k * 6);
      nodeWorld(w, edge.t, d.focus.pos, k * 6 + 3);
      d.focus.col.fill(1, k * 6, k * 6 + 6);
      k++;
    }
    d.focus.g.attributes.position.needsUpdate = true;
    d.focus.g.attributes.color.needsUpdate = true;
    d.focus.g.setDrawRange(0, k * 2);
  }

  function updateColors(w: World, d: Data) {
    const p = live.current;
    const { snapshot, samples, scan } = p;
    const S = w.scanT;
    const anyFocus = p.focusRegion !== null || p.focusHalf !== null || p.visible !== null;
    const tmp = new THREE.Color();
    const hot = new THREE.Color();
    const ramp = (base: THREE.Color, s: number, out: THREE.Color) =>
      out.copy(base).lerp(HOT, Math.min(1, s * 1.3)).lerp(WHITE, Math.max(0, (s - 0.6) / 0.4));

    // Cortex: dim outside the focus; heat up around scan hits.
    const sc = d.shellPts.geometry.attributes.aColor.array as Float32Array;
    for (let i = 0; i < samples.shellUnit.length; i++) {
      const u = UNITS[samples.shellUnit[i]];
      const focused =
        (p.focusRegion === null || u.region === p.focusRegion) && (p.focusHalf === null || u.half === p.focusHalf);
      let k = focused ? 1 : 0.25;
      if (S > 0) k *= 1 - 0.65 * S;
      let r = d.shellBase[i * 3] * k, g = d.shellBase[i * 3 + 1] * k, b = d.shellBase[i * 3 + 2] * k;
      const a = d.shellAct?.[i] ?? 0;
      if (S > 0 && a > 0) {
        ramp(HOT, a, hot);
        const m = a * S * 0.75 * (focused ? 1 : 0.25);
        r += hot.r * m;
        g += hot.g * m;
        b += hot.b * m;
      }
      sc[i * 3] = r;
      sc[i * 3 + 1] = g;
      sc[i * 3 + 2] = b;
    }
    d.shellPts.geometry.attributes.aColor.needsUpdate = true;

    // Nodes.
    const nc = d.nodePts.geometry.attributes.aColor.array as Float32Array;
    const ns = d.nodePts.geometry.attributes.aSize.array as Float32Array;
    snapshot.nodes.forEach((n, i) => {
      const f = inFocus(i) ? 1 : 0.08;
      // Crowded regions have smaller dots; dim them too, or additive overlap washes the lobe out.
      let k = f * (0.7 + 0.6 * n.heat) * Math.max(0.3, Math.min(1, p.layout.size[i] / 0.3));
      let size = d.baseSize[i];
      tmp.copy(d.nodeColor[i]);
      if (S > 0) {
        const s = scan.get(i) ?? 0;
        if (s > 0) {
          ramp(d.nodeColor[i], s, hot);
          tmp.lerp(hot, S);
          k = k * (1 - S) + f * (0.9 + 0.9 * s) * S;
          size *= 1 + 1.8 * s * S;
        } else k *= 1 - 0.85 * S;
      }
      if (i === p.selected || i === p.hovered) {
        tmp.lerp(WHITE, 0.6);
        k = Math.max(k, 1.6);
        size *= 1.6;
      }
      nc[i * 3] = tmp.r * k;
      nc[i * 3 + 1] = tmp.g * k;
      nc[i * 3 + 2] = tmp.b * k;
      ns[i] = size;
    });
    d.nodePts.geometry.attributes.aColor.needsUpdate = true;
    d.nodePts.geometry.attributes.aSize.needsUpdate = true;

    // Edges: faint; lit between scan hits; dim outside the focus.
    snapshot.edges.forEach((e, k) => {
      const a = d.nodeColor[e.s], b = d.nodeColor[e.t];
      let m = e.kind === 'link' ? 0.22 : 0.03;
      if (anyFocus && !(inFocus(e.s) || inFocus(e.t))) m *= 0.1;
      if (S > 0) m *= scan.has(e.s) && scan.has(e.t) ? 1 + 2.5 * S : 1 - 0.85 * S;
      d.edges.col.set([a.r * m, a.g * m, a.b * m, b.r * m, b.g * m, b.b * m], k * 6);
    });
    d.edges.g.attributes.color.needsUpdate = true;

    // Citation beams fade while a scan is showing; scan beams brighten by score.
    const gold = new THREE.Color(REGION_COLOR.core);
    d.citeIdx.forEach((i, k) => {
      const m = (anyFocus && !inFocus(i) ? 0.1 : 1) * (1 - 0.85 * S);
      d.cites.col.set([gold.r * 0.5 * m, gold.g * 0.5 * m, gold.b * 0.5 * m, gold.r * 0.12 * m, gold.g * 0.12 * m, gold.b * 0.12 * m], k * 6);
    });
    d.cites.g.attributes.color.needsUpdate = true;
    d.scanIdx.forEach((i, k) => {
      const s = (scan.get(i) ?? 0) * S;
      d.scanLines.col.set([HOT.r * s, HOT.g * s, HOT.b * s, WHITE.r * s * 0.9, WHITE.g * s * 0.9, WHITE.b * s * 0.9], k * 6);
    });
    d.scanLines.g.attributes.color.needsUpdate = true;
    if (S === 0 && !scan.size) {
      d.scanIdx = [];
      d.shellAct = null;
      d.scanLines.g.setDrawRange(0, 0);
    }
    (w.dez.material as THREE.MeshBasicMaterial).opacity = p.focusRegion === null || p.focusRegion === 'core' ? 0.7 : 0.15;
  }

  // Region + half labels and the hover tooltip, positioned from the camera each frame.
  function placeOverlay(w: World, el: HTMLDivElement) {
    const p = live.current;
    const box = labels.current;
    if (!box) return;
    const cw = el.clientWidth, ch = el.clientHeight;
    const v = new THREE.Vector3();
    const place = (node: HTMLElement, vec: THREE.Vector3) => {
      vec.project(w.camera);
      const show = vec.z < 1;
      node.style.display = show ? '' : 'none';
      if (show) node.style.transform = `translate(${(vec.x * 0.5 + 0.5) * cw}px, ${(-vec.y * 0.5 + 0.5) * ch}px) translate(-50%, -50%)`;
    };
    for (const node of Array.from(box.children) as HTMLElement[]) {
      const region = node.dataset.region as Region | undefined;
      const half = node.dataset.half ? (Number(node.dataset.half) as Half) : undefined;
      if (region) {
        if (p.focusRegion && p.focusRegion !== region) {
          node.style.display = 'none';
          continue;
        }
        // Over the half nearer the camera (or the focused half).
        let best: THREE.Vector3 | null = null;
        let bestD = Infinity;
        UNITS.forEach((u, i) => {
          if (u.region !== region) return;
          if (p.focusHalf !== null && u.half !== 0 && u.half !== p.focusHalf) return;
          const c = p.samples.centroid[i];
          v.set(c[0] + w.off[i * 3], c[1] + w.off[i * 3 + 1], c[2] + w.off[i * 3 + 2]);
          const dist = v.distanceToSquared(w.camera.position);
          if (dist < bestD) {
            bestD = dist;
            best = v.clone();
          }
        });
        if (!best) {
          node.style.display = 'none';
          continue;
        }
        const pt = best as THREE.Vector3;
        pt.x += LABEL_LIFT[region][0];
        pt.y += LABEL_LIFT[region][1];
        place(node, pt);
        node.style.opacity = p.focusRegion === region ? '0.9' : '0.32';
      } else if (half !== undefined) {
        if (p.focusHalf !== null && p.focusHalf !== half) {
          node.style.display = 'none';
          continue;
        }
        place(node, v.set(-0.5, 7.4 + 1.5 * w.explodeNow, half * (4.6 + 2.6 * w.explodeNow)));
        node.style.opacity = p.focusHalf === half ? '0.9' : '0.26';
      }
    }

    const t = tip.current;
    if (!t) return;
    const i = p.hovered;
    if (i === null) {
      t.style.display = 'none';
      return;
    }
    const arr = [0, 0, 0];
    nodeWorld(w, i, arr);
    v.set(arr[0], arr[1], arr[2]).project(w.camera);
    t.style.display = 'block';
    t.style.transform = `translate(${(v.x * 0.5 + 0.5) * cw + 14}px, ${(-v.y * 0.5 + 0.5) * ch + 14}px)`;
  }

  const hoveredNode = props.hovered !== null ? props.snapshot.nodes[props.hovered] : null;
  const hoveredScore = props.hovered !== null ? props.scan.get(props.hovered) : undefined;
  return (
    <div className="relative h-full w-full">
      <div ref={host} className="absolute inset-0" />
      <div ref={labels} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        {REGIONS.map((r) => (
          <div key={r.key} data-region={r.key} className="absolute left-0 top-0 whitespace-nowrap text-center font-mono text-[10px] uppercase tracking-[0.1em] text-white transition-opacity">
            {r.name}
            <span className="block font-sans text-[10.5px] normal-case tracking-normal text-white/60">{r.holds.split(' · ')[0]}</span>
          </div>
        ))}
        <div data-half="-1" className="absolute left-0 top-0 font-mono text-xs uppercase tracking-[0.32em]" style={{ color: HALF_TINT.taught }}>
          Taught
        </div>
        <div data-half="1" className="absolute left-0 top-0 font-mono text-xs uppercase tracking-[0.32em]" style={{ color: HALF_TINT.learned }}>
          Learned
        </div>
      </div>
      <div
        ref={tip}
        className="pointer-events-none absolute left-0 top-0 hidden max-w-[17rem] rounded-lg border border-white/10 bg-black/80 px-2.5 py-1.5 text-xs text-white backdrop-blur"
      >
        {hoveredNode && (
          <>
            <div className="font-semibold">{hoveredNode.label}</div>
            <div className="text-white/60">
              {hoveredNode.sector}
              {hoveredNode.cites > 0 && ` · cited ${hoveredNode.cites}×`}
              {hoveredScore !== undefined && ` · ${Math.round(hoveredScore * 100)}% match`}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
