'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MaintWorkOrder } from '@/lib/maintenance/types';
import type { BoardData, ExceptionsData } from '../board-types';
import { isInternalVendor } from '../board-types';
import { KpiTile, WoCard } from '../components/shared';
import OpenBoardGrouped from './open-board-grouped';
import OpenBoardVendor from './open-board-vendor';
import OpenBoardRoute from './open-board-route';

const COLUMNS: { stage: MaintWorkOrder['stage']; title: string }[] = [
  { stage: 'NEW', title: 'NEW' },
  { stage: 'TRIAGED', title: 'TRIAGED' },
  { stage: 'SCHEDULED', title: 'SCHEDULED' },
  { stage: 'IN_PROGRESS', title: 'IN PROGRESS' },
  { stage: 'WAITING_ON', title: 'WAITING ON' },
  { stage: 'VERIFY', title: 'VERIFY' },
  { stage: 'BILL', title: 'BILL' },
];

/** Sentinel select value for "assigned to no one". */
const UNASSIGNED = '__unassigned__';

export default function OpenBoard({
  board,
  exceptions,
}: {
  board: BoardData;
  exceptions: ExceptionsData | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'grouped' | 'vendor' | 'kanban' | 'route'>('grouped');
  const [internalOnly, setInternalOnly] = useState(false);
  const [assignee, setAssignee] = useState('');
  const goTo = (params: string) => router.replace(`/maintenance/board?${params}`, { scroll: false });

  // Distinct staff names from assigned_to (splitting any comma-joined multi-assignees).
  const staffOptions = useMemo(() => {
    const set = new Set<string>();
    for (const wo of board.open) {
      if (!wo.assigned_to) continue;
      for (const name of wo.assigned_to.split(',')) {
        const n = name.trim();
        if (n) set.add(n);
      }
    }
    return [...set].sort();
  }, [board.open]);

  // Shared Internal-HDMS + Assigned-staff filter, applied to every layout so a
  // staff member's queue reads as their to-do list in whichever view you pick,
  // and the selection persists as you switch between the layouts below.
  const filteredBoard = useMemo(() => {
    const apply = (list: MaintWorkOrder[]) => {
      let out = internalOnly ? list.filter(isInternalVendor) : list;
      if (assignee === UNASSIGNED) out = out.filter((wo) => !wo.assigned_to);
      else if (assignee) out = out.filter((wo) => (wo.assigned_to ?? '').includes(assignee));
      return out;
    };
    return { ...board, open: apply(board.open), closedThisWeek: apply(board.closedThisWeek) };
  }, [board, internalOnly, assignee]);

  const showAssignee = internalOnly || assignee !== '';
  const filterLabel =
    assignee === UNASSIGNED ? 'unassigned' : assignee || (internalOnly ? 'HDMS' : '');

  return (
    <section>
      <div className="kpis">
        <KpiTile
          value={board.kpis.open}
          label="Open work orders"
          title="Every work order not yet CLOSED — NEW through BILL — mirrored from AppFolio with HDPM workflow fields on top. Click to see them laid out by stage (Kanban)."
          onClick={() => setMode('kanban')}
        />
        <KpiTile
          value={exceptions ? exceptions.exceptions.length : '…'}
          label="Exceptions (fix today)"
          tone={exceptions && exceptions.exceptions.length > 0 ? 'bad' : undefined}
          title="Today's tripwire hits, each with one accountable owner: unassigned > 1 business day, past next-action dates, estimate approvals stuck > 3 business days, VERIFY items missing docs, and more. Click for the full list grouped by owner."
          onClick={() => goTo('view=exceptions')}
        />
        <KpiTile
          value={exceptions ? (exceptions.needsDateCount ?? 0) : '…'}
          label="Needs a date (triage)"
          tone={exceptions && (exceptions.needsDateCount ?? 0) > 0 ? 'warn' : undefined}
          title="Open work orders with no next-action date at all — not overdue, just never scheduled, so nobody is on the hook for a day yet. Click for the needs-a-date backlog at the bottom of Exceptions."
          onClick={() => goTo('view=exceptions')}
        />
        <KpiTile
          value={board.kpis.aging30Plus}
          label="30+ days old"
          tone={board.kpis.aging30Plus > 0 ? 'warn' : undefined}
          title="Open work orders created more than 30 days ago (AppFolio creation date). Click for the Aging view — oldest first, with inline owner/date fixes."
          onClick={() => goTo('view=aging')}
        />
        <KpiTile
          value={board.kpis.p1ThisWeek}
          label="P1 this week"
          title="Work orders marked P1 (emergency) created in the last 7 days, including any already closed. Click to filter the board to P1 work."
          onClick={() => goTo('view=open&q=P1')}
        />
        <KpiTile
          value={`${board.kpis.ownerAndDateCoverage}%`}
          label="Have HDPM owner + date"
          title="Share of open work orders carrying both an accountable HDPM owner and a next-action date — the core ground rule (no orphaned work). The gaps surface as exceptions; click to see them."
          onClick={() => goTo('view=exceptions')}
        />
      </div>

      <div className="mo-seg" role="tablist" aria-label="Board layout">
        <button
          role="tab"
          aria-selected={mode === 'grouped'}
          className={mode === 'grouped' ? 'on' : ''}
          onClick={() => setMode('grouped')}
        >
          By Property
        </button>
        <button
          role="tab"
          aria-selected={mode === 'vendor'}
          className={mode === 'vendor' ? 'on' : ''}
          onClick={() => setMode('vendor')}
        >
          By Vendor
        </button>
        <button
          role="tab"
          aria-selected={mode === 'kanban'}
          className={mode === 'kanban' ? 'on' : ''}
          onClick={() => setMode('kanban')}
        >
          Kanban
        </button>
        <button
          role="tab"
          aria-selected={mode === 'route'}
          className={mode === 'route' ? 'on' : ''}
          onClick={() => setMode('route')}
        >
          Route Builder
        </button>
      </div>

      {/* Shared staff / HDMS filter — applies to By Property, By Vendor AND Kanban */}
      <div className="grouptools" style={{ flexWrap: 'wrap' }}>
        <label
          style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}
        >
          <input
            type="checkbox"
            checked={internalOnly}
            onChange={(e) => setInternalOnly(e.target.checked)}
          />
          Internal only (High Desert Maintenance Services)
        </label>
        <select
          className="mo-input"
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          aria-label="Assigned to staff member"
        >
          <option value="">All staff</option>
          {staffOptions.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
          <option value={UNASSIGNED}>Unassigned</option>
        </select>
        <span className="note" style={{ border: 'none', padding: 0, margin: 0 }}>
          {filteredBoard.open.length} open{filterLabel ? ` · ${filterLabel}` : ''}
        </span>
      </div>

      {mode === 'grouped' && <OpenBoardGrouped board={filteredBoard} showAssignee={showAssignee} />}
      {mode === 'vendor' && <OpenBoardVendor board={filteredBoard} />}
      {mode === 'kanban' && <KanbanBody board={filteredBoard} showAssignee={showAssignee} />}
      {mode === 'route' && <OpenBoardRoute board={filteredBoard} />}
    </section>
  );
}

function KanbanBody({ board, showAssignee }: { board: BoardData; showAssignee?: boolean }) {
  const open = board.open;
  const closed = board.closedThisWeek;

  const byStage = new Map<string, MaintWorkOrder[]>();
  for (const col of COLUMNS) byStage.set(col.stage, []);
  for (const wo of open) {
    byStage.get(wo.stage)?.push(wo);
  }

  return (
    <>
      <div className="colwrap">
        <div className="cols">
          {COLUMNS.map((col) => {
            const wos = byStage.get(col.stage) ?? [];
            return (
              <div className="col" key={col.stage}>
                <h3>
                  {col.title} <span className="cnt">{wos.length}</span>
                </h3>
                {wos.map((wo) => (
                  <WoCard key={wo.id} wo={wo} showAssignee={showAssignee} />
                ))}
              </div>
            );
          })}
          <div className="col">
            <h3>
              CLOSED (wk) <span className="cnt">{closed.length}</span>
            </h3>
            {closed.slice(0, 10).map((wo) => (
              <WoCard key={wo.id} wo={wo} showAssignee={showAssignee} />
            ))}
          </div>
        </div>
      </div>

      <p className="note">
        Card = one work order: what/where, ONE HDPM owner (accountable team member), next-action
        date. Red date = past due = automatic Exception. Left edge color = priority (red P1, amber
        P2, green P3, gray P4). Use the shared filter above to screen to internal HDMS work and/or a
        staff member (or Unassigned) — it applies to every layout; filtered cards show the assignee
        (👤).
      </p>
    </>
  );
}
