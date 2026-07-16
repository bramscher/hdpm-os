'use client';

import { useMemo, useState } from 'react';
import type { MaintWorkOrder } from '@/lib/maintenance/types';
import type { BoardData, ExceptionsData } from '../board-types';
import { isInternalVendor } from '../board-types';
import { KpiTile, WoCard } from '../components/shared';
import OpenBoardGrouped from './open-board-grouped';
import OpenBoardVendor from './open-board-vendor';

const COLUMNS: { stage: MaintWorkOrder['stage']; title: string }[] = [
  { stage: 'NEW', title: 'NEW' },
  { stage: 'TRIAGED', title: 'TRIAGED' },
  { stage: 'SCHEDULED', title: 'SCHEDULED' },
  { stage: 'IN_PROGRESS', title: 'IN PROGRESS' },
  { stage: 'WAITING_ON', title: 'WAITING ON' },
  { stage: 'VERIFY', title: 'VERIFY' },
  { stage: 'BILL', title: 'BILL' },
];

export default function OpenBoard({
  board,
  exceptions,
}: {
  board: BoardData;
  exceptions: ExceptionsData | null;
}) {
  const [mode, setMode] = useState<'grouped' | 'vendor' | 'kanban'>('grouped');

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
      </div>

      {mode === 'grouped' && <OpenBoardGrouped board={board} />}
      {mode === 'vendor' && <OpenBoardVendor board={board} />}
      {mode === 'kanban' && <KanbanBody board={board} />}
    </section>
  );
}

/** Sentinel select value for "assigned to no one". */
const UNASSIGNED = '__unassigned__';

function KanbanBody({ board }: { board: BoardData }) {
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

  const applyFilters = (list: MaintWorkOrder[]) => {
    let out = internalOnly ? list.filter(isInternalVendor) : list;
    if (assignee === UNASSIGNED) out = out.filter((wo) => !wo.assigned_to);
    else if (assignee) out = out.filter((wo) => (wo.assigned_to ?? '').includes(assignee));
    return out;
  };

  const open = applyFilters(board.open);
  const closed = applyFilters(board.closedThisWeek);
  const showAssignee = internalOnly || assignee !== '';

  const byStage = new Map<string, MaintWorkOrder[]>();
  for (const col of COLUMNS) byStage.set(col.stage, []);
  for (const wo of open) {
    byStage.get(wo.stage)?.push(wo);
  }

  return (
    <>
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
          aria-label="Assigned to"
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
          {open.length} open{internalOnly ? ' · HDMS' : ''}
          {assignee === UNASSIGNED
            ? ' · unassigned'
            : assignee
              ? ` · ${assignee}`
              : ''}
        </span>
      </div>

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
        P2, green P3, gray P4). Screen to internal HDMS work and/or a maintenance staffer (or
        Unassigned) with the filters above; filtered cards show the assignee (👤).
      </p>
    </>
  );
}
