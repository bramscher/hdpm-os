'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { BoardData, ExceptionsData, ScoreboardRow, WoSortKey } from './board-types';
import { filterWorkOrders, sortWorkOrders, WO_SORT_OPTIONS } from './board-types';
import type { DashboardData } from '@/lib/maintenance/dashboard';
import type { Drill } from '@/lib/maintenance/dashboard-drill';
import { applyTurnDrill, applyWoDrill } from '@/lib/maintenance/dashboard-drill';
import Dashboard from './views/dashboard';
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
    key: 'dashboard',
    label: 'Dashboard',
    hint: 'Where we are on maintenance at a glance: open work by AppFolio step with time-in-step vs. typical, estimates and owner approvals, waiting, unit turns, and today’s attention list. Click any number to drill.',
  },
  {
    key: 'open',
    label: 'Open Board',
    hint: 'Every open work order — By Property, By Vendor, Kanban, or Route Builder layouts, with the shared staff/HDMS filter.',
  },
  {
    key: 'turnover',
    label: 'Turnover',
    hint: 'Unit turnover pipeline — every vacancy with all of its work orders, tracked against the move-in clock.',
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
    key: 'monday',
    label: 'Monday Review',
    hint: "Weekly stand-up summary: last week's closes, current exceptions, and the stuck pile.",
  },
] as const;

type ViewKey = (typeof VIEWS)[number]['key'];
const DEFAULT_VIEW: ViewKey = 'dashboard';

/** Views whose content is the open-WO list — the search/sort toolbar drives these. */
const WO_LIST_VIEWS = new Set<ViewKey>(['open', 'wait', 'aging', 'turnover', 'monday']);

export default function BoardClient({
  embedded = false,
  initialView = DEFAULT_VIEW,
}: {
  /** Canvas-pane mode: view state stays local and the URL is never touched. */
  embedded?: boolean;
  initialView?: string;
} = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [embedView, setEmbedView] = useState<ViewKey>(initialView as ViewKey);
  const view = embedded ? embedView : (searchParams.get('view') as ViewKey) || DEFAULT_VIEW;

  const [board, setBoard] = useState<BoardData | null>(null);
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [exceptions, setExceptions] = useState<ExceptionsData | null>(null);
  const [scoreboard, setScoreboard] = useState<ScoreboardRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<WoSortKey>('default');
  // Dashboard drill-down: an id set narrowing the lists below. In-memory only —
  // id lists are too long for the URL, and `?view=` alone keeps deep links working.
  const [drill, setDrill] = useState<Drill | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [boardRes, dashRes, excRes, sbRes] = await Promise.all([
        fetch('/api/maintenance/board'),
        fetch('/api/maintenance/dashboard'),
        fetch('/api/maintenance/exceptions'),
        fetch('/api/maintenance/vendors/scoreboard'),
      ]);
      if (!boardRes.ok) throw new Error(`Board load failed (${boardRes.status})`);
      setBoard(await boardRes.json());
      // The dashboard/exceptions/scoreboard payloads are non-fatal: the list views
      // still work without them.
      setDash(dashRes.ok ? await dashRes.json() : null);
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
  const qParam = embedded ? null : searchParams.get('q');
  useEffect(() => {
    if (qParam !== null) setQuery(qParam);
  }, [qParam]);

  const setView = (key: ViewKey) => {
    if (embedded) {
      setEmbedView(key);
    } else {
      router.replace(`/maintenance/board?view=${key}`, { scroll: false });
    }
  };

  /** Nav click = a fresh look at a view, so any dashboard drill is cleared. */
  const navTo = (key: ViewKey) => {
    setDrill(null);
    setView(key);
  };

  const onDrill = (d: Drill) => {
    setDrill(d.ids || d.turnIds ? d : null);
    setView(d.view);
  };

  // Apply the dashboard drill, then the search + sort, to the open-WO list, and
  // hand the derived board to every WO-list view so one toolbar drives them all.
  const filteredBoard = useMemo<BoardData | null>(() => {
    if (!board) return null;
    const drilledOpen = applyWoDrill(board.open, drill?.ids);
    const open = sortWorkOrders(filterWorkOrders(drilledOpen, query), sortKey);
    const closedThisWeek = filterWorkOrders(board.closedThisWeek, query);
    const unitTurns = applyTurnDrill(board.unitTurns ?? [], drill?.turnIds);
    return { ...board, open, closedThisWeek, unitTurns };
  }, [board, query, sortKey, drill]);

  const activeBoard = filteredBoard ?? board;
  const showToolbar = WO_LIST_VIEWS.has(view);
  const searching = query.trim().length > 0;
  const drilled = !!drill && view !== 'dashboard';

  const counts: Partial<Record<ViewKey, number>> = {
    dashboard: dash?.attention.total,
    open: activeBoard?.open.length,
    wait: activeBoard?.open.filter((wo) => wo.stage === 'WAITING_ON').length,
    exceptions: exceptions?.exceptions.length,
    turnover: activeBoard?.unitTurns?.length,
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
            onClick={() => navTo(v.key)}
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

      {drilled && (
        <div className="mo-toolbar drill-bar">
          <span className="drill-chip">
            Dashboard filter: <b>{drill!.label}</b>
            {drill!.ids && activeBoard && ` (${activeBoard.open.length})`}
            {drill!.turnIds && activeBoard && ` (${activeBoard.unitTurns?.length ?? 0})`}
          </span>
          <button className="mo-btn secondary" onClick={() => setDrill(null)}>
            Clear
          </button>
          <button className="mo-btn secondary" onClick={() => navTo('dashboard')}>
            ← Dashboard
          </button>
        </div>
      )}

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

      {!board && loading && (
        <div className="colwrap" aria-label="Loading the board">
          <div className="cols">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="col">
                <div className="animate-pulse">
                  <div className="h-6 rounded-t-md bg-sand-100" />
                  <div className="mt-1.5 h-20 rounded-md bg-sand-100" />
                  <div className="mt-1.5 h-20 rounded-md bg-sand-50" />
                  <div className="mt-1.5 h-20 rounded-md bg-sand-50" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {board && activeBoard && (
        <>
          {view === 'dashboard' && <Dashboard dash={dash} scoreboard={scoreboard} onDrill={onDrill} />}
          {view === 'open' && <OpenBoard board={activeBoard} exceptions={exceptions} />}
          {view === 'triage' && <TriageReview onChanged={load} />}
          {view === 'wait' && <WaitingOn board={activeBoard} />}
          {view === 'vendor' && <VendorScoreboard scoreboard={scoreboard} onRefresh={load} />}
          {view === 'aging' && <Aging board={activeBoard} onChanged={load} />}
          {view === 'exceptions' && <Exceptions data={exceptions} />}
          {view === 'turnover' && <Turnover board={activeBoard} onChanged={load} />}
          {view === 'monday' && (
            <MondayReview board={activeBoard} exceptions={exceptions} onChanged={load} />
          )}
        </>
      )}
    </div>
  );
}
