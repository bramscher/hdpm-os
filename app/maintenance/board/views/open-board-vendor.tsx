'use client';

import { useMemo, useState } from 'react';
import type { BoardData } from '../board-types';
import { groupOpenByVendor } from '../board-types';
import { WoCard } from '../components/shared';

/** Substring that identifies the internal maintenance crew's vendor record. */
const INTERNAL_VENDOR_MATCH = 'high desert maintenance services';

/**
 * Vendor-centric consolidation of the open board — every open work order a
 * vendor is on, grouped in one place, so you can see (and chase) a vendor's
 * whole plate at once. Unassigned WOs collect in a bucket at the bottom.
 *
 * Filters: type to narrow to a single vendor, or check "Internal only" to screen
 * to High Desert Maintenance Services. Each card shows who it's assigned to
 * (assigned_to) so internal work with no one on it is easy to catch.
 */
export default function OpenBoardVendor({ board }: { board: BoardData }) {
  const allGroups = useMemo(() => groupOpenByVendor(board.open), [board.open]);

  const [search, setSearch] = useState('');
  const [internalOnly, setInternalOnly] = useState(false);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allGroups.filter((g) => {
      const name = g.vendorName.toLowerCase();
      if (internalOnly && !name.includes(INTERNAL_VENDOR_MATCH)) return false;
      if (q && !name.includes(q)) return false;
      return true;
    });
  }, [allGroups, search, internalOnly]);

  // Auto-expand any vendor with a past-due WO so urgent items aren't hidden.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(allGroups.filter((g) => g.pastDue > 0).map((g) => g.vendorKey)),
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

  // A single-vendor result is always shown expanded — no reason to hide it.
  const singleResult = groups.length === 1;

  const shownWos = groups.reduce((n, g) => n + g.total, 0);
  const unassigned = groups.reduce(
    (n, g) => n + g.wos.filter((wo) => !wo.assigned_to).length,
    0,
  );

  return (
    <section>
      <div className="grouptools" style={{ flexWrap: 'wrap' }}>
        <input
          type="search"
          className="mo-input"
          placeholder="Search vendor…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search vendor"
          style={{ minWidth: 180 }}
        />
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
        <button className="mo-btn secondary" onClick={expandAll}>
          Expand all
        </button>
        <button className="mo-btn secondary" onClick={collapseAll}>
          Collapse all
        </button>
        <span className="note" style={{ border: 'none', padding: 0, margin: 0 }}>
          {groups.length} vendor{groups.length === 1 ? '' : 's'} · {shownWos} open
          {unassigned > 0 && <span className="flag"> · {unassigned} unassigned</span>}
        </span>
      </div>

      {groups.length === 0 ? (
        <p className="note">
          {allGroups.length === 0 ? 'No open work orders.' : 'No vendors match your filter.'}
        </p>
      ) : (
        groups.map((g) => {
          const open = singleResult || expanded.has(g.vendorKey);
          const groupUnassigned = g.wos.filter((wo) => !wo.assigned_to).length;
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
                  {groupUnassigned > 0 && <span className="flag"> · {groupUnassigned} unassigned</span>}
                </span>
              </button>

              {open && (
                <div className="propgrp-body">
                  {g.wos.map((wo) => (
                    <WoCard key={wo.id} wo={wo} showStage showAssignee />
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}

      <p className="note">
        One row per vendor; expand to see every open work order assigned to them across all
        properties and stages. Search or check <b>Internal only</b> to screen to a single vendor.
        Each card shows who it&apos;s assigned to (👤); <b>⚠ unassigned</b> flags work with no one on
        it. Unassigned-vendor work orders collect at the bottom. Left edge color = priority (red P1,
        amber P2, green P3, gray P4); red date = past due.
      </p>
    </section>
  );
}
