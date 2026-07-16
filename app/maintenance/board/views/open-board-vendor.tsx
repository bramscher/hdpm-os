'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { BoardData } from '../board-types';
import { groupOpenByVendor } from '../board-types';
import { WoCard } from '../components/shared';

/**
 * Vendor-centric consolidation of the open board — every open work order a
 * vendor is on, grouped in one place and sub-grouped by property, so you can
 * see (and schedule) all of a vendor's work at a given address at once.
 *
 * The Internal-HDMS and Assigned-staff filters live on the shared Open-board
 * toolbar (they apply to every layout); here you can additionally type to narrow
 * to a single vendor. Each card shows who it's assigned to (assigned_to).
 */
export default function OpenBoardVendor({ board }: { board: BoardData }) {
  const allGroups = useMemo(() => groupOpenByVendor(board.open), [board.open]);

  const [search, setSearch] = useState('');

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allGroups;
    return allGroups.filter((g) => g.vendorName.toLowerCase().includes(q));
  }, [allGroups, search]);

  // Vendor rows expanded by default: any with a past-due WO.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(allGroups.filter((g) => g.pastDue > 0).map((g) => g.vendorKey)),
  );
  // Property sub-rows expanded, keyed `${vendorKey}::${propKey}`.
  const [expandedProps, setExpandedProps] = useState<Set<string>>(new Set());

  // Auto-expand the vendor when a filter narrows to a single result — but keep
  // it collapsible afterward (only re-fires when the filter itself changes, so
  // the header toggle keeps working).
  const lastAutoSig = useRef('');
  useEffect(() => {
    const sig = search.trim().toLowerCase();
    if (!sig) {
      lastAutoSig.current = '';
      return;
    }
    if (sig !== lastAutoSig.current && groups.length === 1) {
      lastAutoSig.current = sig;
      const key = groups[0].vendorKey;
      setExpanded((prev) => new Set(prev).add(key));
    }
  }, [search, groups]);

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleProp = (key: string) =>
    setExpandedProps((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const expandAll = () => {
    setExpanded(new Set(groups.map((g) => g.vendorKey)));
    setExpandedProps(
      new Set(groups.flatMap((g) => g.properties.map((p) => `${g.vendorKey}::${p.key}`))),
    );
  };
  const collapseAll = () => {
    setExpanded(new Set());
    setExpandedProps(new Set());
  };

  const shownWos = groups.reduce((n, g) => n + g.total, 0);
  const unassigned = groups.reduce(
    (n, g) => n + g.properties.reduce((m, p) => m + p.unassigned, 0),
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
          const open = expanded.has(g.vendorKey);
          const gUnassigned = g.properties.reduce((m, p) => m + p.unassigned, 0);
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
                  {g.total} open · {g.properties.length} propert
                  {g.properties.length === 1 ? 'y' : 'ies'}
                  {g.pastDue > 0 && <span className="flag"> · {g.pastDue} past-due</span>}
                  {g.p1 > 0 && <span className="warn"> · {g.p1} P1</span>}
                  {gUnassigned > 0 && <span className="flag"> · {gUnassigned} unassigned</span>}
                </span>
              </button>

              {open && (
                <div className="propgrp-body">
                  {g.properties.map((p) => {
                    const pKey = `${g.vendorKey}::${p.key}`;
                    const pOpen = expandedProps.has(pKey);
                    return (
                      <div className="propgrp" key={pKey} style={{ marginLeft: 14 }}>
                        <button
                          className="propgrp-head"
                          aria-expanded={pOpen}
                          onClick={() => toggleProp(pKey)}
                        >
                          <span className="chev">{pOpen ? '▾' : '▸'}</span>
                          <span className="pname">{p.name}</span>
                          <span className="pmeta">
                            {p.total} WO{p.total === 1 ? '' : 's'}
                            {p.pastDue > 0 && <span className="flag"> · {p.pastDue} past-due</span>}
                            {p.unassigned > 0 && (
                              <span className="flag"> · {p.unassigned} unassigned</span>
                            )}
                          </span>
                        </button>

                        {pOpen && (
                          <div className="propgrp-body">
                            {p.wos.map((wo) => (
                              <WoCard key={wo.id} wo={wo} showStage showAssignee />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })
      )}

      <p className="note">
        One row per vendor; expand to see their open work orders grouped by property, then expand a
        property to schedule/manage all its work orders together. Use the shared toolbar above to
        screen to internal HDMS work or a single staff member; type here to narrow to one vendor.
        Each card shows who it&apos;s assigned to (👤); <b>⚠ unassigned</b> flags work with no one on
        it. Left edge color = priority (red P1, amber P2, green P3, gray P4); red date = past due.
      </p>
    </section>
  );
}
