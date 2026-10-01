'use client';

/**
 * The 3D brain map, in plain three.js (no React renderer: Next's App Router
 * runs React 19 canary, which @react-three/fiber v8 can't use, and v9 would
 * force React 19 peer deps on the whole repo).
 *
 * One InstancedMesh for every node (a single draw call), faint neighbour
 * edges, highlighted edges for the selected node, pulsing beams from the
 * centre to "lit" nodes (search hits / cited sources), and an UnrealBloom
 * pass for the glow. Loaded with next/dynamic, ssr: false.
 */

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { VizSnapshot } from '@/lib/brain/viz';
import { LAYER_COLOR, STATUS_COLOR } from './colors';

export interface SceneProps {
  snapshot: VizSnapshot;
  /** Node indices passing the sector filter. null = all. */
  visible: Set<number> | null;
  /** Node indices to light up (search hits / cited sources). */
  lit: Set<number>;
  /** Draw beams from the centre to lit nodes (Ask). */
  beams: boolean;
  hovered: number | null;
  selected: number | null;
  onHover: (i: number | null) => void;
  onSelect: (i: number | null) => void;
}

const DIM = new THREE.Color('#1f2937');
const LIT = new THREE.Color('#fff7d6');

function nodeScale(n: VizSnapshot['nodes'][number]): number {
  if (n.layer === 'integrations') return 1.6;
  if (n.layer === 'routines') return 0.9;
  return 0.55 + n.heat * 1.4 + Math.min(n.chunks, 40) * 0.008;
}

function segments(pts: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

interface World {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  nodes: THREE.InstancedMesh | null;
  allEdges: THREE.LineSegments | null;
  focusEdges: THREE.LineSegments | null;
  beams: THREE.LineSegments | null;
  core: THREE.Mesh;
  statics: THREE.Object3D[];
}

export default function BrainScene(props: SceneProps) {
  const host = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const world = useRef<World | null>(null);
  // Latest props for the animation loop and event handlers.
  const live = useRef(props);
  live.current = props;

  // ── Renderer, camera, controls, bloom: once ─────────────────────────────
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.setClearColor('#030712');
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2('#030712', 0.006);
    const camera = new THREE.PerspectiveCamera(50, el.clientWidth / el.clientHeight, 0.1, 500);
    camera.position.set(0, 38, 62);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;
    controls.minDistance = 8;
    controls.maxDistance = 140;

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(el.clientWidth, el.clientHeight), 1.1, 0.5, 0.6);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.6, 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd27a').multiplyScalar(2), wireframe: true, toneMapped: false })
    );
    scene.add(core);

    const w: World = { renderer, scene, camera, controls, composer, bloom, nodes: null, allEdges: null, focusEdges: null, beams: null, core, statics: [] };
    world.current = w;

    // Hover + click via raycasting against the instanced mesh.
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let down: { x: number; y: number } | null = null;
    const pick = (ev: PointerEvent): number | null => {
      if (!w.nodes) return null;
      const r = renderer.domElement.getBoundingClientRect();
      pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(w.nodes, false)[0];
      return hit?.instanceId ?? null;
    };
    const onMove = (ev: PointerEvent) => {
      const i = pick(ev);
      if (i !== live.current.hovered) live.current.onHover(i);
      renderer.domElement.style.cursor = i === null ? 'grab' : 'pointer';
    };
    const onDown = (ev: PointerEvent) => (down = { x: ev.clientX, y: ev.clientY });
    const onUp = (ev: PointerEvent) => {
      // Ignore drags (orbiting): only a near-stationary press is a click.
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
      camera.aspect = cw / ch;
      camera.updateProjectionMatrix();
      renderer.setSize(cw, ch);
      composer.setSize(cw, ch);
      bloom.resolution.set(cw, ch);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    const clock = new THREE.Clock();
    const projected = new THREE.Vector3();
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const t = clock.getElapsedTime();
      const p = live.current;
      controls.autoRotate = p.selected === null && p.hovered === null && p.lit.size === 0;
      controls.update();

      const pulsing = p.beams && p.lit.size > 0;
      core.scale.setScalar(1 + Math.sin(t * (pulsing ? 4 : 1.2)) * (pulsing ? 0.18 : 0.06));
      core.rotation.y = t * 0.15;
      if (w.beams) (w.beams.material as THREE.LineBasicMaterial).opacity = 0.45 + Math.sin(t * 3) * 0.25;

      // Tooltip follows the hovered node on screen.
      const tipEl = tip.current;
      if (tipEl) {
        const n = p.hovered !== null ? p.snapshot.nodes[p.hovered] : null;
        if (n) {
          projected.set(n.pos[0], n.pos[1], n.pos[2]).project(camera);
          const x = ((projected.x + 1) / 2) * el.clientWidth;
          const y = ((1 - projected.y) / 2) * el.clientHeight;
          tipEl.style.transform = `translate(${x}px, ${y}px) translate(-50%, calc(-100% - 12px))`;
          tipEl.style.opacity = projected.z < 1 ? '1' : '0';
        } else {
          tipEl.style.opacity = '0';
        }
      }
      composer.render();
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
        m.geometry?.dispose?.();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => x.dispose());
      });
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      world.current = null;
    };
  }, []);

  const { snapshot, visible, lit, beams, hovered, selected } = props;

  // ── Static geometry for this snapshot: rings, nodes ─────────────────────
  useEffect(() => {
    const w = world.current;
    if (!w) return;
    for (const o of w.statics) {
      w.scene.remove(o);
      (o as THREE.Mesh).geometry?.dispose();
    }
    w.statics = [];

    for (const l of snapshot.layers) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(l.radius - 0.04, l.radius + 0.04, 128),
        new THREE.MeshBasicMaterial({ color: LAYER_COLOR[l.key], transparent: true, opacity: 0.12, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      w.scene.add(ring);
      w.statics.push(ring);
    }

    const nodes = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.32, 10, 10),
      new THREE.MeshBasicMaterial({ toneMapped: false }),
      snapshot.nodes.length
    );
    nodes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    w.scene.add(nodes);
    w.statics.push(nodes);
    w.nodes = nodes;
  }, [snapshot]);

  // ── Node colours and sizes: on every interaction change ─────────────────
  useEffect(() => {
    const mesh = world.current?.nodes;
    if (!mesh) return;
    const obj = new THREE.Object3D();
    const color = new THREE.Color();
    const anyLit = lit.size > 0;
    snapshot.nodes.forEach((n, i) => {
      const shown = !visible || visible.has(i);
      const emphasis = i === selected || i === hovered ? 1.8 : lit.has(i) ? 1.5 : 1;
      obj.position.set(n.pos[0], n.pos[1], n.pos[2]);
      obj.scale.setScalar(nodeScale(n) * emphasis * (shown ? 1 : 0.5));
      obj.updateMatrix();
      mesh.setMatrixAt(i, obj.matrix);

      color.set(n.layer === 'routines' ? STATUS_COLOR[n.status ?? 'never'] ?? LAYER_COLOR.routines : LAYER_COLOR[n.layer]);
      if (lit.has(i)) color.lerp(LIT, 0.6).multiplyScalar(2.2);
      else if (!shown || (anyLit && i !== selected)) color.lerp(DIM, 0.85);
      else color.multiplyScalar(1 + n.heat * 1.4);
      if (i === selected || i === hovered) color.set('#ffffff').multiplyScalar(2.5);
      mesh.setColorAt(i, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [snapshot, visible, lit, hovered, selected]);

  // ── Edges: faint all-edges + bright edges of the selected node ──────────
  useEffect(() => {
    const w = world.current;
    if (!w) return;
    for (const o of [w.allEdges, w.focusEdges]) {
      if (!o) continue;
      w.scene.remove(o);
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
    const p = snapshot.nodes.map((n) => n.pos);
    const all: number[] = [];
    const focus: number[] = [];
    for (const e of snapshot.edges) {
      if (visible && !(visible.has(e.s) && visible.has(e.t))) continue;
      const seg = [...p[e.s], ...p[e.t]];
      all.push(...seg);
      if (selected !== null && (e.s === selected || e.t === selected)) focus.push(...seg);
    }
    w.allEdges = new THREE.LineSegments(
      segments(all),
      new THREE.LineBasicMaterial({ color: '#8ea2c8', transparent: true, opacity: selected === null ? 0.07 : 0.03, depthWrite: false })
    );
    w.focusEdges = new THREE.LineSegments(segments(focus), new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, toneMapped: false }));
    w.scene.add(w.allEdges, w.focusEdges);
  }, [snapshot, selected, visible]);

  // ── Beams from the centre to lit nodes (Ask) ────────────────────────────
  useEffect(() => {
    const w = world.current;
    if (!w) return;
    if (w.beams) {
      w.scene.remove(w.beams);
      w.beams.geometry.dispose();
      (w.beams.material as THREE.Material).dispose();
      w.beams = null;
    }
    if (!beams || lit.size === 0) return;
    const pts: number[] = [];
    for (const i of lit) pts.push(0, 0, 0, ...snapshot.nodes[i].pos);
    w.beams = new THREE.LineSegments(segments(pts), new THREE.LineBasicMaterial({ color: '#ffe9a8', transparent: true, opacity: 0.6, toneMapped: false }));
    w.scene.add(w.beams);
  }, [snapshot, lit, beams]);

  const tipNode = hovered !== null ? snapshot.nodes[hovered] : null;
  return (
    <div ref={host} className="relative h-full w-full overflow-hidden">
      <div
        ref={tip}
        className="pointer-events-none absolute left-0 top-0 z-10 whitespace-nowrap rounded-md bg-black/80 px-2 py-1 text-xs text-white opacity-0 shadow"
        aria-hidden
      >
        {tipNode && (
          <>
            <div className="font-medium">{tipNode.label}</div>
            <div className="text-white/60">
              {tipNode.sector}
              {tipNode.cites > 0 && ` · cited ${tipNode.cites}×`}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
