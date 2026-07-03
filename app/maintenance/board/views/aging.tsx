'use client';

import Link from 'next/link';
import type { BoardData } from '../board-types';
import { agingBand, daysSince, woCreatedAt, woWhere } from '../board-types';
import { KpiTile } from '../components/shared';

const BAND_LABELS = ['0–7 days', '8–14 days', '15–30 days', '30+ days'] as const;

export default function Aging({ board }: { board: BoardData }) {
  const now = new Date();
  const withAge = board.open.map((wo) => ({ wo, age: daysSince(woCreatedAt(wo), now) ?? 0 }));
  const bands: number[] = [0, 0, 0, 0];
  for (const { age } of withAge) bands[agingBand(age)]++;

  const old = withAge.filter(({ age }) => age > 14).sort((a, b) => b.age - a.age);

  return (
    <section>
      <div className="kpis">
        {BAND_LABELS.map((label, i) => (
          <KpiTile
            key={label}
            value={bands[i]}
            label={label}
            tone={i === 3 && bands[3] > 0 ? 'bad' : i === 2 && bands[2] > 0 ? 'warn' : undefined}
          />
        ))}
      </div>

      <table className="mo-table">
        <thead>
          <tr>
            <th>Work order</th>
            <th>Days</th>
            <th>Stage</th>
            <th>Why it&apos;s old (written reason required)</th>
            <th>Owner</th>
          </tr>
        </thead>
        <tbody>
          {old.map(({ wo, age }) => (
            <tr key={wo.id}>
              <td>
                <Link href={`/maintenance/board/wo/${wo.id}`}>
                  {wo.description.slice(0, 60)} — {woWhere(wo)}
                </Link>
              </td>
              <td className={age > 30 ? 'flag' : 'warn'}>{age}</td>
              <td>
                {wo.stage === 'WAITING_ON' && wo.waiting_reason
                  ? `WAIT-${wo.waiting_reason}`
                  : wo.stage}
              </td>
              <td>{wo.aging_reason || <span className="flag">⚠ no written reason</span>}</td>
              <td>{wo.owner_name}</td>
            </tr>
          ))}
          {old.length === 0 && (
            <tr>
              <td colSpan={5} style={{ color: 'var(--muted)' }}>
                Nothing over 14 days old.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="note">
        Target: 30+ bucket under 5, each with a written reason said aloud on Monday.
      </p>
    </section>
  );
}
