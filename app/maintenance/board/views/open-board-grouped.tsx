'use client';

import { useMemo, useState } from 'react';
import type { BoardData } from '../board-types';
import { groupOpenByProperty, propertyIsMultiUnit, unitGroupLabel } from '../board-types';
import { WoCard } from '../components/shared';

/**
 * Property-centric consolidation of the open board. HDPM writes one WO per
 * vendor, so a single unit turn spawns 4–5 cards; this collapses them into
 * Property → Unit → work-order groups with expandable (chevron) detail.
 */
export default function OpenBoardGrouped({ board }: { board: BoardData }) {
  const groups = useMemo(() => groupOpenByProperty(board.open), [board.open]);

  // Auto-expand any property with a past-due WO so urgent items aren't hidden.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(groups.filter((g) => g.pastDue > 0).map((g) => g.propKey)),
  );

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const expandAll = () => setExpanded(new Set(groups.map((g) => g.propKey)));
  const collapseAll = () => setExpanded(new Set());

  if (groups.length === 0) {
    return <p className="note">No open work orders.</p>;
  }

  return (
    <section>
      <div className="grouptools">
        <button className="mo-btn secondary" onClick={expandAll}>
          Expand all
        </button>
        <button className="mo-btn secondary" onClick={collapseAll}>
          Collapse all
        </button>
        <span className="note" style={{ border: 'none', padding: 0, margin: 0 }}>
          {groups.length} propert{groups.length === 1 ? 'y' : 'ies'} · {board.open.length} open
        </span>
      </div>

      {groups.map((g) => {
        const open = expanded.has(g.propKey);
        const multiUnit = propertyIsMultiUnit(g.units);
        return (
          <div className="propgrp" key={g.propKey}>
            <button
              className="propgrp-head"
              aria-expanded={open}
              onClick={() => toggle(g.propKey)}
            >
              <span className="chev">{open ? '▾' : '▸'}</span>
              <span className="pname">{g.propertyName}</span>
              <span className="pmeta">
                {g.total} open
                {g.pastDue > 0 && <span className="flag"> · {g.pastDue} past-due</span>}
                {g.hasTurn && <span className="turn"> · 🔁 turn</span>}
                {g.p1 > 0 && <span className="warn"> · {g.p1} P1</span>}
              </span>
            </button>

            {open && (
              <div className="propgrp-body">
                {g.units.map((u) => (
                  <div className="unitgrp" key={u.unitKey}>
                    <div className="unitgrp-head">
                      {unitGroupLabel(u.unitName, u.wos, g.propertyName, multiUnit)}
                      {u.isTurn && <span className="turn"> (turn)</span>} —{' '}
                      {u.wos.length} WO{u.wos.length === 1 ? '' : 's'}
                    </div>
                    {u.wos.map((wo) => (
                      <WoCard key={wo.id} wo={wo} showStage />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <p className="note">
        One row per property; expand to see each unit&apos;s work orders across every stage. A
        unit turn&apos;s per-vendor work orders sit together here. Left edge color = priority
        (red P1, amber P2, green P3, gray P4); red date = past due.
      </p>
    </section>
  );
}
