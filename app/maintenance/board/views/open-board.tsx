'use client';

import { useMemo, useState } from 'react';
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
  const [mode, setMode] = useState<'grouped' | 'vendor' | 'kanban' | 'route'>('grouped');
  const [internalOnly, setInternalOnly] = useState(false);
  const [assignee, setAssignee] = useState('');

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
        <KpiTile value={board.kpis.open} label="Open work orders" />
        <KpiTile
          value={exceptions ? exceptions.exceptions.length : '…'}
          label="Exceptions (fix today)"
          tone={exceptions && exceptions.exceptions.length > 0 ? 'bad' : undefined}
        />
        <KpiTile
          value={board.kpis.aging30Plus}
          label="30+ days old"
          tone={board.kpis.aging30Plus > 0 ? 'warn' : undefined}
        />
        <KpiTile value={board.kpis.p1ThisWeek} label="P1 this week" />
        <KpiTile value={`${board.kpis.ownerAndDateCoverage}%`} label="Have HDPM owner + date" />
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
