'use client';

import Link from 'next/link';
import type { MaintWorkOrder, Turn } from '@/lib/maintenance/types';
import type { BoardData } from '../board-types';
import { daysSince, fmtDate, woWhere } from '../board-types';

function readiness(turn: Turn): { text: string; cls: string } {
  if (!turn.target_ready) return { text: 'no target set ⚠', cls: 'flag' };
  const today = new Date().toISOString().slice(0, 10);
  if (turn.target_ready < today) return { text: `${fmtDate(turn.target_ready)} slipping`, cls: 'flag' };
  const daysOut = daysSince(today, new Date(turn.target_ready)) ?? 0;
  if (daysOut <= 3) return { text: `${fmtDate(turn.target_ready)} at risk`, cls: 'warn' };
  return { text: `${fmtDate(turn.target_ready)} on track`, cls: 'ok' };
}

export default function Turnover({ board }: { board: BoardData }) {
  const woById = new Map<string, MaintWorkOrder>(board.open.map((wo) => [wo.id, wo]));
  const rows = board.turns
    .map((turn) => ({ turn, wo: woById.get(turn.work_order_id) }))
    .filter((r): r is { turn: Turn; wo: MaintWorkOrder } => !!r.wo)
    .sort((a, b) => a.turn.vacated_at.localeCompare(b.turn.vacated_at));

  return (
    <section>
      <table className="mo-table">
        <thead>
          <tr>
            <th>Unit</th>
            <th>Days vacant</th>
            <th>Target ready</th>
            <th>Current blocker</th>
            <th>Assigned</th>
            <th>Budget / actual</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ turn, wo }) => {
            const vacant = daysSince(turn.vacated_at) ?? 0;
            const ready = readiness(turn);
            return (
              <tr key={turn.work_order_id}>
                <td>
                  <Link href={`/maintenance/board/wo/${wo.id}`}>{woWhere(wo)}</Link>
                </td>
                <td className={vacant > 21 ? 'flag' : vacant > 14 ? 'warn' : ''}>{vacant}</td>
                <td className={ready.cls}>{ready.text}</td>
                <td>{turn.current_blocker || <span className="flag">⚠ no blocker named</span>}</td>
                <td>{wo.assigned_tech || wo.vendor_name || wo.owner_name}</td>
                <td>
                  {turn.budget !== null ? `$${Number(turn.budget).toLocaleString()}` : '—'} /{' '}
                  {turn.actual !== null ? `$${Number(turn.actual).toLocaleString()}` : '—'}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} style={{ color: 'var(--muted)' }}>
                No active turns. Flag a work order as a turn from its detail page.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="note">
        Vacancy is rent lost daily — every turn shows its single current blocker and who owns it.
        Leasing sees target-ready dates from this view.
      </p>
    </section>
  );
}
