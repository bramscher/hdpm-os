'use client';

/**
 * /brain — the brain map laid out as a brain. Same nightly snapshot as the
 * galaxy (/brain-2, components/brain/BrainMap); positions come from
 * lib/brain/anatomy in the browser. Search and Ask light up a relevance scan.
 *
 * The chrome started as a copy of BrainMap's. Brain 2 is a fallback, so the
 * two aren't sharing components; delete BrainMap once this one settles.
 */

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VizSnapshot } from '@/lib/brain/viz';
import { brainMatchDocKey } from '@/lib/brain/viz';
import { REGIONS, UNITS, layoutAnatomy, sampleBrain, scanScores, type Half, type Region } from '@/lib/brain/anatomy';
import { HALF_TINT, LAYER_COLOR, REGION_COLOR } from '../colors';
import type { ViewName } from './AnatomyScene';

const AnatomyScene = dynamic(() => import('./AnatomyScene'), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-white/50">Loading the brain…</div>,
});

type AskResult = { answer: string; sources: { id: string; title: string; url: string; type: string }[]; docs: string[] };
type Match = { id: string; node_id: string | null; source_url: string | null; score: number };

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric' }) : '—';

/** Click-safe URL: only http(s) links are rendered as links. */
const safeUrl = (u: string | null) => (u && /^https?:\/\//i.test(u) ? u : null);

const HALVES: { half: Half; name: string; sub: string; color: string; ring: boolean }[] = [
  { half: -1, name: 'Left · Taught', sub: 'Documents and law we gave it, and the jobs that bring them in', color: HALF_TINT.taught, ring: false },
  { half: 1, name: 'Right · Learned', sub: 'Memory Dez has written, and the jobs where Dez acts on it', color: HALF_TINT.learned, ring: true },
];
const VIEW_BUTTONS: { name: ViewName; label: string }[] = [
  { name: 'angled', label: 'Angled' },
  { name: 'side', label: 'Side' },
  { name: 'top', label: 'Top' },
  { name: 'back', label: 'Back' },
];
const btn = 'min-h-8 rounded-md border border-white/15 px-2.5 text-xs text-white/85 hover:border-white/30';
const btnOn = 'border-amber-300/60 text-amber-200';

export default function AnatomyMap() {
  const [snapshot, setSnapshot] = useState<VizSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [sectors, setSectors] = useState<Set<string>>(new Set());
  const [focusRegion, setFocusRegion] = useState<Region | null>(null);
  const [focusHalf, setFocusHalf] = useState<Half | null>(null);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Match[]>([]);
  const [searching, setSearching] = useState(false);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [ask, setAsk] = useState<AskResult | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [explode, setExplode] = useState({ value: 1, slow: true });
  const [explodePct, setExplodePct] = useState(100);
  const [view, setView] = useState<{ name: ViewName; seq: number }>({ name: 'angled', seq: 0 });
  const [skull, setSkull] = useState(true);
  const [spin, setSpin] = useState(true);
  const introTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch('/api/brain/viz')
      .then(async (r) => {
        if (r.status === 404) throw new Error('empty');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setSnapshot)
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  // Opening: apart, then settle into one brain inside the skull.
  const playIntro = useCallback((replay: boolean) => {
    if (introTimer.current) clearTimeout(introTimer.current);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setExplode({ value: 0, slow: false });
      setExplodePct(0);
      return;
    }
    setExplode({ value: 1, slow: !replay });
    if (replay) setView((v) => ({ name: 'angled', seq: v.seq + 1 }));
    introTimer.current = setTimeout(() => setExplode({ value: 0, slow: true }), 900);
  }, []);
  useEffect(() => {
    if (snapshot) playIntro(false);
    return () => {
      if (introTimer.current) clearTimeout(introTimer.current);
    };
  }, [snapshot, playIntro]);

  const samples = useMemo(() => (snapshot ? sampleBrain() : null), [snapshot]);
  const layout = useMemo(() => (snapshot && samples ? layoutAnatomy(snapshot.nodes, samples) : null), [snapshot, samples]);
  const index = useMemo(() => new Map(snapshot?.nodes.map((n, i) => [n.id, i]) ?? []), [snapshot]);

  const visible = useMemo(() => {
    if (!snapshot || sectors.size === 0) return null;
    return new Set(snapshot.nodes.flatMap((n, i) => (sectors.has(n.sector) ? [i] : [])));
  }, [snapshot, sectors]);

  const textHits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!snapshot || q.length < 2) return [];
    return snapshot.nodes.flatMap((n, i) => (n.label.toLowerCase().includes(q) || n.sector.toLowerCase().includes(q) ? [i] : []));
  }, [snapshot, query]);

  const scan = useMemo(() => {
    if (!snapshot) return new Map<number, number>();
    if (ask) return scanScores({ ask: ask.docs }, index, snapshot.edges);
    return scanScores({ semantic: matches.map((m) => ({ key: brainMatchDocKey(m), score: m.score })), text: textHits }, index, snapshot.edges);
  }, [snapshot, ask, matches, textHits, index]);

  const ranked = useMemo(() => [...scan.entries()].sort((a, b) => b[1] - a[1]), [scan]);
  const regionOf = useCallback((i: number) => (layout ? UNITS[layout.unit[i]] : null), [layout]);
  const scanSummary = useMemo(() => {
    if (!ranked.length) return null;
    const per = new Map<string, number>();
    for (const [i] of ranked) {
      const u = regionOf(i);
      if (!u) continue;
      const name = REGIONS.find((r) => r.key === u.region)!.name;
      per.set(name, (per.get(name) ?? 0) + 1);
    }
    const top = [...per.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${k} (${v})`).join(', ');
    return `${ranked.length} documents light up · mostly ${top}`;
  }, [ranked, regionOf]);

  const counts = useMemo(() => {
    const regions = new Map<Region, number>();
    const halves = new Map<Half, number>();
    if (layout) {
      for (let i = 0; i < layout.unit.length; i++) {
        const u = UNITS[layout.unit[i]];
        regions.set(u.region, (regions.get(u.region) ?? 0) + 1);
        halves.set(u.half, (halves.get(u.half) ?? 0) + 1);
      }
    }
    return { regions, halves };
  }, [layout]);

  const neighbours = useMemo(() => {
    if (!snapshot || selected === null) return [];
    return snapshot.edges
      .filter((e) => e.s === selected || e.t === selected)
      .map((e) => ({ i: e.s === selected ? e.t : e.s, kind: e.kind, w: e.w, label: e.label }))
      .sort((a, b) => b.w - a.w);
  }, [snapshot, selected]);

  const runSemantic = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setAsk(null);
    try {
      const r = await fetch('/api/brain/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q, limit: 20 }) });
      const j = (await r.json()) as { matches?: Match[] };
      setMatches(j.matches ?? []);
    } catch {
      setMatches([]);
    } finally {
      setSearching(false);
    }
  }, [query]);

  const runAsk = useCallback(async () => {
    const q = question.trim();
    if (!q) return;
    setAsking(true);
    setAskError(null);
    setSelected(null);
    try {
      const r = await fetch('/api/brain/viz/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setAsk(j as AskResult);
    } catch (e) {
      setAskError((e as Error).message);
    } finally {
      setAsking(false);
    }
  }, [question]);

  const clearScan = () => {
    setQuery('');
    setMatches([]);
    setAsk(null);
    setAskError(null);
  };

  if (loadError) {
    return (
      <div className="rounded-xl border border-sand-200 bg-white p-6 text-sm text-charcoal-700">
        {loadError === 'empty' ? (
          <>
            <p className="font-semibold">The brain map hasn’t been built yet.</p>
            <p className="mt-1 text-charcoal-500">
              It’s rebuilt nightly at about 3:30 AM by the <code>Brain map snapshot</code> routine, once the <code>brain_viz</code> migration is applied.
            </p>
          </>
        ) : (
          <p>Couldn’t load the brain map: {loadError}</p>
        )}
      </div>
    );
  }

  const node = snapshot && selected !== null ? snapshot.nodes[selected] : null;
  const nodeRegion = selected !== null ? regionOf(selected) : null;
  const layerOrder = snapshot ? snapshot.layers.map((l) => l.key) : [];
  const sectorList = snapshot ? [...snapshot.sectors].sort((a, b) => layerOrder.indexOf(a.layer) - layerOrder.indexOf(b.layer) || b.count - a.count) : [];
  const regionName = (r: Region) => REGIONS.find((x) => x.key === r)!.name;
  const halfWord = (h: Half) => (h === -1 ? 'taught' : h === 1 ? 'learned' : 'midline');

  return (
    <div className="relative h-[calc(100vh-7rem)] min-h-[34rem] overflow-hidden rounded-2xl bg-gray-950">
      {snapshot && samples && layout ? (
        <AnatomyScene
          snapshot={snapshot}
          samples={samples}
          layout={layout}
          visible={visible}
          focusRegion={focusRegion}
          focusHalf={focusHalf}
          scan={scan}
          explode={explode}
          skull={skull}
          spin={spin}
          view={view}
          hovered={hovered}
          selected={selected}
          onHover={setHovered}
          onSelect={setSelected}
          onExplodeProgress={setExplodePct}
        />
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-white/50">Loading the brain…</div>
      )}

      {snapshot && layout && (
        <>
          {/* Top bar: search + ask */}
          <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap gap-2 p-3">
            <form
              className="pointer-events-auto flex min-w-[16rem] flex-1 gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void runSemantic();
              }}
            >
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setMatches([]);
                  setAsk(null);
                }}
                placeholder="Search titles… (Enter for meaning search)"
                aria-label="Search the brain"
                className="min-h-10 w-full rounded-lg border border-white/10 bg-black/50 px-3 text-sm text-white placeholder:text-white/40 backdrop-blur"
              />
              {(query || searching) && (
                <span className="self-center whitespace-nowrap text-xs text-white/60">{searching ? 'Searching…' : `${scan.size} lit`}</span>
              )}
            </form>
            <form
              className="pointer-events-auto flex min-w-[16rem] flex-1 gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void runAsk();
              }}
            >
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask Dez… and watch what it reads"
                aria-label="Ask a question"
                className="min-h-10 w-full rounded-lg border border-white/10 bg-black/50 px-3 text-sm text-white placeholder:text-white/40 backdrop-blur"
              />
              <button disabled={asking || !question.trim()} className="min-h-10 rounded-lg bg-amber-400 px-4 text-sm font-semibold text-black disabled:opacity-50">
                {asking ? 'Thinking…' : 'Ask'}
              </button>
            </form>
          </div>

          {/* Left column: legend, then the scan results */}
          <div className="pointer-events-none absolute bottom-28 left-3 top-16 flex w-[min(18rem,calc(100%-1.5rem))] flex-col gap-2">
            <details
              className="pointer-events-auto max-h-full overflow-y-auto rounded-xl border border-white/10 bg-black/60 p-3 text-white backdrop-blur"
              open={typeof window !== 'undefined' && window.innerWidth >= 768}
            >
              <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-white/60">Regions &amp; halves</summary>
              <ul className="mt-2 space-y-0.5">
                {REGIONS.map((r) => (
                  <li key={r.key}>
                    <button
                      onClick={() => setFocusRegion((f) => (f === r.key ? null : r.key))}
                      aria-pressed={focusRegion === r.key}
                      title={`${r.name}: ${r.role}`}
                      className={`grid w-full grid-cols-[10px_1fr_auto] items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-white/5 ${focusRegion === r.key ? 'bg-white/10' : ''}`}
                    >
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: REGION_COLOR[r.key], boxShadow: `0 0 8px ${REGION_COLOR[r.key]}` }} />
                      <span className="min-w-0">
                        <span className="block text-[13px]">{r.name}</span>
                        <span className="block truncate text-[11px] text-white/50">{r.holds}</span>
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-white/50">{r.key === 'core' ? 1 : counts.regions.get(r.key) ?? 0}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-white/50">Halves</p>
              <ul className="mt-1 space-y-0.5">
                {HALVES.map((h) => (
                  <li key={h.half}>
                    <button
                      onClick={() => setFocusHalf((f) => (f === h.half ? null : h.half))}
                      aria-pressed={focusHalf === h.half}
                      title={h.sub}
                      className={`grid w-full grid-cols-[10px_1fr_auto] items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-white/5 ${focusHalf === h.half ? 'bg-white/10' : ''}`}
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={h.ring ? { border: `2px solid ${h.color}` } : { background: h.color, boxShadow: `0 0 8px ${h.color}` }}
                      />
                      <span className="min-w-0">
                        <span className="block text-[13px]">{h.name}</span>
                        <span className="block truncate text-[11px] text-white/50">{h.sub}</span>
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-white/50">{counts.halves.get(h.half) ?? 0}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <details className="mt-2">
                <summary className="cursor-pointer px-2 text-[11px] font-semibold uppercase tracking-wider text-white/50">Filter by source</summary>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {sectorList.map((s) => {
                    const on = sectors.has(s.key);
                    return (
                      <button
                        key={`${s.layer}-${s.key}`}
                        onClick={() =>
                          setSectors((prev) => {
                            const next = new Set(prev);
                            if (next.has(s.key)) next.delete(s.key);
                            else next.add(s.key);
                            return next;
                          })
                        }
                        aria-pressed={on}
                        className={`inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2 text-[11px] ${on ? 'border-white bg-white/90 text-black' : 'border-white/15 bg-black/50 text-white/80'}`}
                      >
                        <span className="h-2 w-2 rounded-full" style={{ background: LAYER_COLOR[s.layer] }} />
                        {s.key} <span className="opacity-60">{s.count}</span>
                      </button>
                    );
                  })}
                  {sectors.size > 0 && (
                    <button onClick={() => setSectors(new Set())} className="min-h-7 rounded-full px-2 text-[11px] text-white/70 underline">
                      Clear
                    </button>
                  )}
                </div>
              </details>
              <p className="mt-2 px-2 text-[11px] text-white/40">
                {snapshot.stats.documents} documents · {snapshot.stats.citations} citations (90 days) · built {fmtDate(snapshot.generatedAt)}
              </p>
            </details>

            {scanSummary && (
              <section className="pointer-events-auto shrink-0 rounded-xl border border-white/10 bg-black/60 p-3 text-white backdrop-blur" aria-label="Scan results">
                <p className="text-xs text-white/70">{scanSummary}</p>
                <ul className="mt-2 space-y-1">
                  {ranked.slice(0, 6).map(([i, s]) => {
                    const u = regionOf(i)!;
                    return (
                      <li key={i}>
                        <button
                          onClick={() => setSelected(i)}
                          onMouseEnter={() => setHovered(i)}
                          onMouseLeave={() => setHovered(null)}
                          className="w-full rounded-md px-2 py-1 text-left hover:bg-white/5"
                        >
                          <span className="flex justify-between gap-2 text-[12.5px]">
                            <span className="truncate">{snapshot.nodes[i].label}</span>
                            <span className="font-mono text-[11px] tabular-nums text-amber-300">{Math.round(s * 100)}%</span>
                          </span>
                          <span className="block text-[11px] text-white/50">
                            {regionName(u.region)} · {halfWord(u.half)}
                          </span>
                          <span className="mt-1 block h-[3px] rounded bg-gradient-to-r from-amber-400 to-amber-100" style={{ width: `${Math.max(6, s * 100)}%` }} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <button onClick={clearScan} className={`${btn} mt-2`}>
                  Clear scan
                </button>
              </section>
            )}
          </div>

          {/* Dock: explode + views */}
          <div className="absolute bottom-3 left-1/2 flex w-[min(44rem,calc(100%-1.5rem))] -translate-x-1/2 flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-white/10 bg-black/60 px-4 py-2.5 text-white backdrop-blur">
            <label className="flex min-w-[14rem] flex-1 items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-white/60">
              <span className="text-white">Explode</span>
              <span>Whole</span>
              <input
                type="range"
                min={0}
                max={100}
                value={explodePct}
                onChange={(e) => {
                  if (introTimer.current) clearTimeout(introTimer.current);
                  const v = Number(e.target.value);
                  setExplodePct(v);
                  setExplode({ value: v / 100, slow: false });
                }}
                className="min-w-0 flex-1 accent-amber-300"
                aria-label="Explode the brain"
              />
              <span>Apart</span>
            </label>
            <div className="flex flex-wrap gap-1.5">
              {VIEW_BUTTONS.map((v) => (
                <button key={v.name} onClick={() => setView((x) => ({ name: v.name, seq: x.seq + 1 }))} className={btn}>
                  {v.label}
                </button>
              ))}
              <button onClick={() => playIntro(true)} className={btn}>
                Replay intro
              </button>
              <button onClick={() => setSkull((s) => !s)} aria-pressed={skull} className={`${btn} ${skull ? btnOn : ''}`}>
                Skull
              </button>
              <button onClick={() => setSpin((s) => !s)} aria-pressed={spin} className={`${btn} ${spin ? btnOn : ''}`}>
                Auto-rotate
              </button>
            </div>
          </div>

          {/* Side panel: selected node or Ask answer */}
          {(node || ask || askError) && (
            <aside className="absolute bottom-28 right-3 top-16 flex w-[min(24rem,calc(100%-1.5rem))] flex-col overflow-y-auto rounded-xl border border-white/10 bg-black/75 p-4 text-sm text-white backdrop-blur">
              <button
                onClick={() => {
                  setSelected(null);
                  setAsk(null);
                  setAskError(null);
                }}
                className="absolute right-3 top-3 text-white/60 hover:text-white"
                aria-label="Close panel"
              >
                ✕
              </button>
              {node ? (
                <>
                  <p className="pr-6 text-xs uppercase tracking-wide" style={{ color: LAYER_COLOR[node.layer] }}>
                    {nodeRegion ? `${regionName(nodeRegion.region)} · ${halfWord(nodeRegion.half)}` : ''} · {node.sector}
                  </p>
                  <h2 className="mt-1 text-base font-semibold">{node.label}</h2>
                  {safeUrl(node.url) && (
                    <a href={safeUrl(node.url)!} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-sky-300 underline">
                      Open source ↗
                    </a>
                  )}
                  {node.excerpt && <p className="mt-3 text-white/80">{node.excerpt}</p>}
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <dt className="text-white/50">Cited by Dez</dt>
                      <dd>{node.cites}× in 90 days</dd>
                    </div>
                    <div>
                      <dt className="text-white/50">{node.layer === 'routines' ? 'Last run' : 'Last updated'}</dt>
                      <dd>{node.layer === 'routines' ? node.status : fmtDate(node.updatedAt)}</dd>
                    </div>
                    {node.chunks > 0 && (
                      <div>
                        <dt className="text-white/50">Chunks</dt>
                        <dd>{node.chunks}</dd>
                      </div>
                    )}
                    {scan.has(selected!) && (
                      <div>
                        <dt className="text-white/50">Scan match</dt>
                        <dd>{Math.round(scan.get(selected!)! * 100)}%</dd>
                      </div>
                    )}
                  </dl>
                  {neighbours.length > 0 && (
                    <>
                      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-white/60">Neighbours</h3>
                      <ul className="mt-1 space-y-1">
                        {neighbours.map((nb) => (
                          <li key={`${nb.i}-${nb.kind}`}>
                            <button onClick={() => setSelected(nb.i)} className="w-full rounded px-2 py-1 text-left hover:bg-white/10">
                              <span className="block truncate">{snapshot.nodes[nb.i].label}</span>
                              <span className="text-xs text-white/50">
                                {nb.kind === 'link' ? nb.label?.replace(/_/g, ' ') : `${Math.round(nb.w * 100)}% similar`} · {snapshot.nodes[nb.i].sector}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              ) : askError ? (
                <p className="pr-6 text-red-300">Couldn’t answer: {askError}</p>
              ) : ask ? (
                <>
                  <p className="pr-6 text-xs uppercase tracking-wide text-amber-300">Dez’s answer · {scan.size} documents lit</p>
                  <div className="mt-2 whitespace-pre-wrap text-white/90">{ask.answer}</div>
                  <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-white/60">Sources</h3>
                  <ol className="mt-1 list-decimal space-y-1 pl-5 text-xs">
                    {ask.sources.map((s) => (
                      <li key={s.id}>
                        {safeUrl(s.url) ? (
                          <a href={safeUrl(s.url)!} target="_blank" rel="noreferrer" className="text-sky-300 underline">
                            {s.title}
                          </a>
                        ) : (
                          s.title
                        )}
                      </li>
                    ))}
                  </ol>
                </>
              ) : null}
            </aside>
          )}
        </>
      )}
    </div>
  );
}
