'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { BoardData, ExceptionsData, ScoreboardRow } from './board-types';
import OpenBoard from './views/open-board';
import WaitingOn from './views/waiting-on';
import VendorScoreboard from './views/vendor-scoreboard';
import Aging from './views/aging';
import Exceptions from './views/exceptions';
import Turnover from './views/turnover';
import MondayReview from './views/monday-review';

const VIEWS = [
  { key: 'open', label: 'Open Board' },
  { key: 'wait', label: 'Waiting-On' },
  { key: 'vendor', label: 'Vendor Scoreboard' },
  { key: 'aging', label: 'Aging' },
  { key: 'exceptions', label: 'Exceptions' },
  { key: 'turnover', label: 'Turnover' },
  { key: 'monday', label: 'Monday Review' },
] as const;

type ViewKey = (typeof VIEWS)[number]['key'];

export default function BoardClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = (searchParams.get('view') as ViewKey) || 'open';

  const [board, setBoard] = useState<BoardData | null>(null);
  const [exceptions, setExceptions] = useState<ExceptionsData | null>(null);
  const [scoreboard, setScoreboard] = useState<ScoreboardRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

  const setView = (key: ViewKey) => {
    router.replace(`/maintenance/board?view=${key}`, { scroll: false });
  };

  const counts: Partial<Record<ViewKey, number>> = {
    open: board?.kpis.open,
    wait: board?.open.filter((wo) => wo.stage === 'WAITING_ON').length,
    exceptions: exceptions?.exceptions.length,
    turnover: board
      ? board.turns.filter((t) => board.open.some((wo) => wo.id === t.work_order_id)).length
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
          >
            {v.label}
            {counts[v.key] !== undefined && <span className="n">{counts[v.key]}</span>}
          </button>
        ))}
        <button onClick={load} title="Refresh" style={{ marginLeft: 'auto' }}>
          ⟳
        </button>
      </nav>

      {error && <p className="note flag">{error}</p>}

      {!board && loading && <p className="note">Loading the board…</p>}

      {board && (
        <>
          {view === 'open' && <OpenBoard board={board} exceptions={exceptions} />}
          {view === 'wait' && <WaitingOn board={board} />}
          {view === 'vendor' && <VendorScoreboard scoreboard={scoreboard} onRefresh={load} />}
          {view === 'aging' && <Aging board={board} />}
          {view === 'exceptions' && <Exceptions data={exceptions} />}
          {view === 'turnover' && <Turnover board={board} />}
          {view === 'monday' && <MondayReview board={board} exceptions={exceptions} />}
        </>
      )}
    </div>
  );
}
