'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { VizSnapshot } from '@/lib/brain/viz';
import { brainMatchDocKey } from '@/lib/brain/viz';
import { LAYER_COLOR } from './colors';

const BrainScene = dynamic(() => import('./BrainScene'), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-white/50">Loading the brain…</div>,
});

type AskResult = { answer: string; sources: { id: string; title: string; url: string; type: string }[]; docs: string[] };

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric' }) : '—';

/** Click-safe URL: only http(s) links are rendered as links. */
const safeUrl = (u: string | null) => (u && /^https?:\/\//i.test(u) ? u : null);

export default function BrainMap() {
  const [snapshot, setSnapshot] = useState<VizSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [sectors, setSectors] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [semanticHits, setSemanticHits] = useState<Set<number>>(new Set());
  const [searching, setSearching] = useState(false);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [ask, setAsk] = useState<AskResult | null>(null);
  const [askError, setAskError] = useState<string | null>(null);

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

  const index = useMemo(() => new Map(snapshot?.nodes.map((n, i) => [n.id, i]) ?? []), [snapshot]);

  const visible = useMemo(() => {
    if (!snapshot || sectors.size === 0) return null;
    return new Set(snapshot.nodes.flatMap((n, i) => (sectors.has(n.sector) ? [i] : [])));
  }, [snapshot, sectors]);

  const textHits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!snapshot || q.length < 2) return new Set<number>();
    return new Set(snapshot.nodes.flatMap((n, i) => (n.label.toLowerCase().includes(q) || n.sector.toLowerCase().includes(q) ? [i] : [])));
  }, [snapshot, query]);

  const askLit = useMemo(() => new Set((ask?.docs ?? []).flatMap((d) => (index.has(d) ? [index.get(d)!] : []))), [ask, index]);
  const lit = useMemo(() => (ask ? askLit : new Set([...textHits, ...semanticHits])), [ask, askLit, textHits, semanticHits]);

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
      const j = (await r.json()) as { matches?: { id: string; node_id: string | null; source_url: string | null }[] };
      setSemanticHits(new Set((j.matches ?? []).flatMap((m) => {
        const i = index.get(brainMatchDocKey(m));
        return i === undefined ? [] : [i];
      })));
    } catch {
      setSemanticHits(new Set());
    } finally {
      setSearching(false);
    }
  }, [query, index]);

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
  const layerOrder = snapshot ? snapshot.layers.map((l) => l.key) : [];
  const sectorList = snapshot ? [...snapshot.sectors].sort((a, b) => layerOrder.indexOf(a.layer) - layerOrder.indexOf(b.layer) || b.count - a.count) : [];

  return (
    <div className="relative h-[calc(100vh-7rem)] min-h-[34rem] overflow-hidden rounded-2xl bg-gray-950">
      {snapshot ? (
        <BrainScene
          snapshot={snapshot}
          visible={visible}
          lit={lit}
          beams={!!ask}
          hovered={hovered}
          selected={selected}
          onHover={setHovered}
          onSelect={setSelected}
        />
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-white/50">Loading the brain…</div>
      )}

      {snapshot && (
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
                  setSemanticHits(new Set());
                  setAsk(null);
                }}
                placeholder="Search titles… (Enter for meaning search)"
                aria-label="Search the brain"
                className="min-h-10 w-full rounded-lg border border-white/10 bg-black/50 px-3 text-sm text-white placeholder:text-white/40 backdrop-blur"
              />
              {(query || searching) && (
                <span className="self-center whitespace-nowrap text-xs text-white/60">{searching ? 'Searching…' : `${lit.size} lit`}</span>
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

          {/* Sector chips */}
          <div className="absolute bottom-0 left-0 max-h-[22%] max-w-full overflow-y-auto p-3 sm:max-h-[40%] sm:max-w-[min(42rem,70%)]">
            <div className="flex flex-wrap gap-1.5">
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
                    className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs backdrop-blur ${on ? 'border-white bg-white/90 text-black' : 'border-white/15 bg-black/50 text-white/80'}`}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: LAYER_COLOR[s.layer] }} />
                    {s.key} <span className="opacity-60">{s.count}</span>
                  </button>
                );
              })}
              {sectors.size > 0 && (
                <button onClick={() => setSectors(new Set())} className="min-h-8 rounded-full px-2.5 text-xs text-white/70 underline">
                  Clear
                </button>
              )}
            </div>
            <p className="mt-2 text-[11px] text-white/40">
              {snapshot.stats.documents} documents · {snapshot.stats.chunks} chunks · {snapshot.stats.citations} citations (90 days) · built {fmtDate(snapshot.generatedAt)}
            </p>
          </div>

          {/* Side panel: selected node or Ask answer */}
          {(node || ask || askError) && (
            <aside className="absolute bottom-3 right-3 top-16 flex w-[min(24rem,calc(100%-1.5rem))] flex-col overflow-y-auto rounded-xl border border-white/10 bg-black/75 p-4 text-sm text-white backdrop-blur">
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
                    {snapshot.layers.find((l) => l.key === node.layer)?.label} · {node.sector}
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
                  <p className="pr-6 text-xs uppercase tracking-wide text-amber-300">Dez’s answer · {askLit.size} sources lit</p>
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
