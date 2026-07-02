'use client';

import Link from 'next/link';
import type { ExceptionsData } from '../board-types';

export default function Exceptions({ data }: { data: ExceptionsData | null }) {
  if (!data) {
    return <p className="note">Running the 12 tripwire rules…</p>;
  }

  return (
    <section>
      {data.exceptions.length === 0 ? (
        <div className="kpis">
          <div className="kpi">
            <div className="v ok">ZERO</div>
            <div className="l">
              Exceptions — the sweep is done. Five consecutive business days at zero = Phase-1
              definition of done.
            </div>
          </div>
        </div>
      ) : (
        <table className="mo-table">
          <thead>
            <tr>
              <th>Tripwire</th>
              <th>Item</th>
              <th>Fix required today</th>
              <th>Owner</th>
            </tr>
          </thead>
          <tbody>
            {data.exceptions.map((ex, i) => (
              <tr key={i}>
                <td className="flag" style={{ whiteSpace: 'nowrap' }}>
                  {ex.label}
                </td>
                <td>
                  {ex.workOrderId ? (
                    <Link href={`/maintenance/board/wo/${ex.workOrderId}`}>{ex.item}</Link>
                  ) : (
                    ex.item
                  )}
                </td>
                <td>{ex.fixRequired}</td>
                <td>{ex.owner}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {data.ruleErrors.length > 0 && (
        <p className="note flag">
          Rule errors: {data.ruleErrors.map((e) => `#${e.tripwire}: ${e.error}`).join(' · ')}
        </p>
      )}

      <p className="note">
        The daily sweep ends when this view reads ZERO — every exception gets an owner and a date,
        or gets escalated. Tripwires #1 and #9 await the Haven.AI integration.
      </p>
    </section>
  );
}
