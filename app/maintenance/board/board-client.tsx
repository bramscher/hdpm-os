'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { BoardData, ExceptionsData, ScoreboardRow, WoSortKey } from './board-types';
import { filterWorkOrders, sortWorkOrders, WO_SORT_OPTIONS } from './board-types';
import OpenBoard from './views/open-board';
import WaitingOn from './views/waiting-on';
import VendorScoreboard from './views/vendor-scoreboard';
import Aging from './views/aging';
import Exceptions from './views/exceptions';
import Turnover from './views/turnover';
import MondayReview from './views/monday-review';
import TriageReview from './views/triage-review';
import InfoHelp from './components/info-help';

const VIEWS = [
  {
    key: 'open',
    label: 'Open Board',
    hint: 'Every open work order — By Property, By Vendor, Kanban, or Route Builder layouts, with the shared staff/HDMS filter.',
  },
  {
    key: 'triage',
    label: '✦ Triage Review',
    hint: 'AI-proposed priority, owner, and next-action date for un-triaged work orders — review, edit, and apply (every apply is audited).',
  },
  {
    key: 'wait',
    label: 'Waiting-On',
    hint: 'Open work orders parked on a wait reason: tenant, vendor, parts, owner, weather, or internal.',
  },
  {
    key: 'vendor',
    label: 'Vendor Scoreboard',
    hint: 'Per-vendor open counts and cycle times (rolling 90 days + all-time history) — who executes and who sits on work.',
  },
  {
    key: 'aging',
    label: 'Aging',
    hint: 'Oldest open work orders (15+ days by AppFolio creation date), with inline owner/date/stage fixes.',
  },
  {
    key: 'exceptions',
    label: 'Exceptions',
    hint: "Today's tripwire hits grouped by accountable owner, the needs-a-date backlog, and the digest-recipients panel.",
  },
  {
    key: 'turnover',
    label: 'Turnover',
    hint: 'Unit-turn work orders — vacancy-critical work tracked against the move-in clock.',
  },
  {
    key: 'monday',
    label: 'Monday Review',
    hint: "Weekly stand-up summary: last week's closes, current exceptions, and the stuck pile.",
  },
] as const;

type ViewKey = (typeof VIEWS)[number]['key'];

/** Views whose content is the open-WO list — the search/sort toolbar drives these. */
const WO_LIST_VIEWS = new Set<ViewKey>(['open', 'wait', 'aging', 'turnover', 'monday']);

export default function BoardClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = (searchParams.get('view') as ViewKey) || 'open';

  const [board, setBoard] = useState<BoardData | null>(null);
  const [exceptions, setExceptions] = useState<ExceptionsData | null>(null);
  const [scoreboard, setScoreboard] = useState<ScoreboardRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<WoSortKey>('default');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [boardRes, excRes, sbRes] = await Promise.all([
        fetch('/api/maintenance/board'),
        fetch('/api/maintenance/exceptions'),
        fetch('/api/maintenance/vendors/scoreboard'),
      ]);
      if (!boardRes.ok) throw new Error(`Board load failed (${boardRes.status})`);
      setBoard(await boardRes.json());
      if (excRes.ok) setExceptions(await excRes.json());
      if (sbRes.ok) setScoreboard((await sbRes.json()).scoreboard ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the board');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Deep links can prefill the search (e.g. the "P1 this week" KPI → ?q=P1).
  const qParam = searchParams.get('q');
  useEffect(() => {
    if (qParam !== null) setQuery(qParam);
  }, [qParam]);

  const setView = (key: ViewKey) => {
    router.replace(`/maintenance/board?view=${key}`, { scroll: false });
  };

  // Apply the search + sort to the open-WO list, then hand the derived board to
  // every WO-list view so one toolbar drives them all.
  const filteredBoard = useMemo<BoardData | null>(() => {
    if (!board) return null;
    const open = sortWorkOrders(filterWorkOrders(board.open, query), sortKey);
    const closedThisWeek = filterWorkOrders(board.closedThisWeek, query);
    return { ...board, open, closedThisWeek };
  }, [board, query, sortKey]);

  const activeBoard = filteredBoard ?? board;
  const showToolbar = WO_LIST_VIEWS.has(view);
  const searching = query.trim().length > 0;

  const counts: Partial<Record<ViewKey, number>> = {
    open: activeBoard?.open.length,
    wait: activeBoard?.open.filter((wo) => wo.stage === 'WAITING_ON').length,
    exceptions: exceptions?.exceptions.length,
    turnover: activeBoard
      ? activeBoard.turns.filter((t) => activeBoard.open.some((wo) => wo.id === t.work_order_id))
          .length
      : undefined,
  };

  return (
    <div className="maint-os p-6 max-w-[1400px]">
      <header className="mo-header">
        <h1>HDMS Maintenance — Live Board</h1>
        <span className="sub">
          {loading
            ? 'loading…'
            : `updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · AppFolio is the system of record`}
        </span>
        <span className="badge">HIGH DESERT PROPERTY MANAGEMENT</span>
      </header>

      <nav className="mo-nav">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            className={view === v.key ? 'active' : ''}
            onClick={() => setView(v.key)}
            data-tip={v.hint}
          >
            {v.label}
            {counts[v.key] !== undefined && <span className="n">{counts[v.key]}</span>}
          </button>
        ))}
        <button onClick={load} title="Refresh" style={{ marginLeft: 'auto' }}>
          ⟳
        </button>
        <InfoHelp viewKey={view} />
      </nav>

      {showToolbar && board && (
        <div className="mo-toolbar">
          <input
            className="mo-input mo-search"
            type="search"
            placeholder="Search property, unit, vendor, WO #, description…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search work orders"
          />
          <label className="mo-sort">
            Sort:
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value as WoSortKey)}>
              {WO_SORT_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {searching && activeBoard && (
            <span className="note" style={{ border: 'none', padding: 0, margin: 0 }}>
              {activeBoard.open.length} of {board.open.length} open match
              <button className="mo-btn secondary" style={{ marginLeft: 8 }} onClick={() => setQuery('')}>
                Clear
              </button>
            </span>
          )}
        </div>
      )}

      {error && <p className="note flag">{error}</p>}

      {!board && loading && <p className="note">Loading the board…</p>}

      {board && activeBoard && (
        <>
          {view === 'open' && <OpenBoard board={activeBoard} exceptions={exceptions} />}
          {view === 'triage' && <TriageReview onChanged={load} />}
          {view === 'wait' && <WaitingOn board={activeBoard} />}
          {view === 'vendor' && <VendorScoreboard scoreboard={scoreboard} onRefresh={load} />}
          {view === 'aging' && <Aging board={activeBoard} onChanged={load} />}
          {view === 'exceptions' && <Exceptions data={exceptions} />}
          {view === 'turnover' && <Turnover board={activeBoard} />}
          {view === 'monday' && <MondayReview board={activeBoard} exceptions={exceptions} />}
        </>
      )}
    </div>
  );
}
