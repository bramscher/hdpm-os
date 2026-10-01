'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { FeedItem, FeedTone } from '@/lib/agents/activity-feed';
import type { AgentPulse } from '@/lib/agents/pulse';


const ORB: Record<AgentPulse['color'], string> = {
  ok: 'bg-green-500',
  warn: 'bg-amber-500',
  error: 'bg-red-500',
  running: 'bg-blue-500',
  never: 'bg-sand-400',
};

const TONE: Record<FeedTone, string> = {
  good: 'bg-green-500',
  warn: 'bg-amber-500',
  bad: 'bg-red-500',
  neutral: 'bg-sand-400',
  human: 'bg-blue-600',
};

const LEVEL_NAMES = ['Observe', 'Suggest', 'Draft', 'Act + tell', 'Act'];

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '—';

function ago(iso: string, now: number): string {
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

function Orb({ color }: { color: AgentPulse['color'] }) {
  return (
    <span className="relative inline-flex h-3 w-3 shrink-0">
      {color === 'running' && <span className={`absolute inset-0 animate-ping rounded-full opacity-60 ${ORB[color]}`} />}
      <span className={`relative inline-flex h-3 w-3 rounded-full ${ORB[color]}`} />
    </span>
  );
}

function Ladder({ level, ceiling }: { level: number | null; ceiling: number | null }) {
  if (level === null) return <span className="text-xs text-charcoal-400">No autonomy settings</span>;
  return (
    <span className="inline-flex items-center gap-1" title={`L${level} · ${LEVEL_NAMES[level]}${ceiling !== null ? ` (ceiling L${ceiling})` : ''}`}>
      {[0, 1, 2, 3, 4].map((l) => (
        <span
          key={l}
          className={`h-1.5 w-4 rounded-full ${l <= level ? 'bg-charcoal-800' : ceiling !== null && l > ceiling ? 'bg-sand-100' : 'bg-sand-300'}`}
        />
      ))}
      <span className="ml-1 text-xs text-charcoal-600">L{level} · {LEVEL_NAMES[level]}</span>
    </span>
  );
}

export default function AgentsHero({
  motion,
  motionPrev,
  gateDate,
  agents,
  initialFeed,
  initialNow,
}: {
  motion: number | null;
  motionPrev: number | null;
  gateDate: string;
  agents: AgentPulse[];
  initialFeed: FeedItem[];
  initialNow: string;
}) {
  const [feed, setFeed] = useState(initialFeed);
  const [now, setNow] = useState(() => new Date(initialNow).getTime());
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [stale, setStale] = useState(false);
  const known = useRef(new Set(initialFeed.map((i) => i.id)));

  useEffect(() => {
    let live = true;
    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await fetch(`/api/agents/activity?since=${encodeURIComponent(new Date(Date.now() - 86_400_000).toISOString())}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const j = (await res.json()) as { items: FeedItem[]; now: string };
        if (!live) return;
        const added = j.items.filter((i) => !known.current.has(i.id)).map((i) => i.id);
        added.forEach((id) => known.current.add(id));
        setFeed(j.items);
        setNow(new Date(j.now).getTime());
        setStale(false);
        if (added.length) setFresh(new Set(added));
      } catch {
        if (live) setStale(true);
      }
    };
    const id = window.setInterval(tick, 20_000);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, []);

  const gateDays = Math.ceil((new Date(`${gateDate}T00:00:00-07:00`).getTime() - now) / 86_400_000);
  const delta = motion !== null && motionPrev !== null ? motion - motionPrev : null;

  return (
    <section aria-label="Agent pulse" className="mb-8 space-y-4">
      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <div className="space-y-4">
          <div className="rounded-2xl bg-charcoal-900 p-5 text-white shadow-card">
            <p className="text-xs uppercase tracking-wide text-white/60">Motion · human actions, last 7 days</p>
            <p className="mt-1 text-5xl font-semibold tabular-nums">{motion ?? '—'}</p>
            {delta !== null && (
              <p className={`mt-1 text-sm ${delta > 0 ? 'text-green-300' : delta < 0 ? 'text-red-300' : 'text-white/60'}`}>
                {delta > 0 ? '▲' : delta < 0 ? '▼' : '•'} {Math.abs(delta)} vs. the week before
              </p>
            )}
            <p className="mt-3 text-xs text-white/60">The only metric that counts (restart plan §2).</p>
          </div>
          <div className="rounded-2xl border border-sand-200 bg-white p-5 shadow-card">
            <p className="text-xs uppercase tracking-wide text-charcoal-500">Loop 1 gate</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums text-charcoal-900">
              {gateDays > 0 ? `${gateDays} day${gateDays === 1 ? '' : 's'}` : gateDays === 0 ? 'Today' : 'Passed'}
            </p>
            <p className="mt-1 text-xs text-charcoal-500">
              {new Date(`${gateDate}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
            <Link href="/agents/routines" className="mt-3 inline-flex min-h-9 items-center rounded-lg border border-sand-200 px-3 text-sm">
              Routine calendar →
            </Link>
          </div>
        </div>

        <div className="flex min-h-[20rem] flex-col rounded-2xl border border-sand-200 bg-white shadow-card">
          <div className="flex items-center justify-between border-b border-sand-100 px-4 py-3">
            <p className="text-sm font-semibold text-charcoal-900">Live activity · last 24 hours</p>
            <span className="inline-flex items-center gap-1.5 text-xs text-charcoal-500">
              <span className={`h-2 w-2 rounded-full ${stale ? 'bg-amber-500' : 'animate-pulse bg-green-500'}`} />
              {stale ? 'Reconnecting…' : 'Live · updates every 20s'}
            </span>
          </div>
          <ol className="max-h-[26rem] flex-1 divide-y divide-sand-100 overflow-y-auto" aria-live="polite">
            {feed.length === 0 && <li className="p-4 text-sm text-charcoal-500">Nothing in the last 24 hours.</li>}
            {feed.map((i) => {
              const body = (
                <>
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE[i.tone]}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-charcoal-900">{i.text}</span>
                    <span className="block text-xs text-charcoal-500">
                      {i.actor} · {ago(i.at, now)}
                    </span>
                  </span>
                </>
              );
              const cls = `flex gap-3 px-4 py-2.5 transition-colors duration-700 ${fresh.has(i.id) ? 'bg-blue-50' : ''}`;
              return (
                <li key={i.id}>
                  {i.href ? (
                    <Link href={i.href} className={`${cls} hover:bg-sand-50`}>
                      {body}
                    </Link>
                  ) : (
                    <div className={cls}>{body}</div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {agents.map((a) => (
          <div key={a.id} className="rounded-xl border border-sand-200 bg-white p-4 shadow-card">
            <div className="flex items-center gap-2">
              <Orb color={a.color} />
              <p className="truncate font-semibold text-charcoal-900">{a.name}</p>
            </div>
            <p className="mt-0.5 text-xs text-charcoal-500">{a.statusText}</p>
            <div className="mt-3">
              <Ladder level={a.level} ceiling={a.ceiling} />
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div>
                <dt className="text-charcoal-500">Last run</dt>
                <dd className="text-charcoal-800">{when(a.lastRunAt)}</dd>
              </div>
              <div>
                <dt className="text-charcoal-500">Next run</dt>
                <dd className="text-charcoal-800">{when(a.nextRunAt)}</dd>
              </div>
            </dl>
            {a.recipients.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {a.recipients.map((r) => (
                  <span key={r} className="rounded-full bg-sand-100 px-2 py-0.5 text-xs text-charcoal-700">
                    {r}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
