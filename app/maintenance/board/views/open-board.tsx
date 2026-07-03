'use client';

import type { MaintWorkOrder } from '@/lib/maintenance/types';
import type { BoardData, ExceptionsData } from '../board-types';
import { KpiTile, WoCard } from '../components/shared';

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
  const byStage = new Map<string, MaintWorkOrder[]>();
  for (const col of COLUMNS) byStage.set(col.stage, []);
  for (const wo of board.open) {
    byStage.get(wo.stage)?.push(wo);
  }

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
                  <WoCard key={wo.id} wo={wo} />
                ))}
              </div>
            );
          })}
          <div className="col">
            <h3>
              CLOSED (wk) <span className="cnt">{board.closedThisWeek.length}</span>
            </h3>
            {board.closedThisWeek.slice(0, 10).map((wo) => (
              <WoCard key={wo.id} wo={wo} />
            ))}
          </div>
        </div>
      </div>

      <p className="note">
        Card = one work order: what/where, ONE HDPM owner (accountable team member), next-action
        date. Red date = past due =
        automatic Exception. Left edge color = priority (red P1, amber P2, green P3, gray P4).
      </p>
    </section>
  );
}
