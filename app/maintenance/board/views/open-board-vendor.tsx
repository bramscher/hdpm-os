'use client';

import { useMemo, useState } from 'react';
import type { BoardData } from '../board-types';
import { groupOpenByVendor } from '../board-types';
import { WoCard } from '../components/shared';

/**
 * Vendor-centric consolidation of the open board — every open work order a
 * vendor is on, grouped in one place, so you can see (and chase) a vendor's
 * whole plate at once. Unassigned WOs collect in a bucket at the bottom.
 */
export default function OpenBoardVendor({ board }: { board: BoardData }) {
  const groups = useMemo(() => groupOpenByVendor(board.open), [board.open]);

  // Auto-expand any vendor with a past-due WO so urgent items aren't hidden.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(groups.filter((g) => g.pastDue > 0).map((g) => g.vendorKey)),
  );

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const expandAll = () => setExpanded(new Set(groups.map((g) => g.vendorKey)));
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
          {groups.length} vendor{groups.length === 1 ? '' : 's'} · {board.open.length} open
        </span>
      </div>

      {groups.map((g) => {
        const open = expanded.has(g.vendorKey);
        return (
          <div className="propgrp" key={g.vendorKey}>
            <button
              className="propgrp-head"
              aria-expanded={open}
              onClick={() => toggle(g.vendorKey)}
            >
              <span className="chev">{open ? '▾' : '▸'}</span>
              <span className="pname">{g.vendorName}</span>
              <span className="pmeta">
                {g.total} open
                {g.pastDue > 0 && <span className="flag"> · {g.pastDue} past-due</span>}
                {g.p1 > 0 && <span className="warn"> · {g.p1} P1</span>}
              </span>
            </button>

            {open && (
              <div className="propgrp-body">
                {g.wos.map((wo) => (
                  <WoCard key={wo.id} wo={wo} showStage />
                ))}
              </div>
            )}
          </div>
        );
      })}

      <p className="note">
        One row per vendor; expand to see every open work order assigned to them across all
        properties and stages. Unassigned work orders collect at the bottom. Left edge color =
        priority (red P1, amber P2, green P3, gray P4); red date = past due.
      </p>
    </section>
  );
}
