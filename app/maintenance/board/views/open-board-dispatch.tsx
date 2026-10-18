'use client';

/**
 * Dispatch — Trello-style board: an Unassigned pile, one column per in-house
 * tech, one per vendor with open work. Drag a card (or a shift-click selection)
 * onto a column to assign it. Vendor moves are planned here and nudge staff to
 * make the same assignment in AppFolio until the sync shows it.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import type { MaintWorkOrder, VendorAssignment } from '@/lib/maintenance/types';
import {
  DISPATCH_TECHS,
  PILES,
  dispatchPlacement,
  inPile,
  inUnassignedColumn,
  indexVendors,
  isInternalVendor,
  livePlansByWo,
  techColumn,
  type DispatchTarget,
  type DispatchVendor,
  type PileKey,
  type Placement,
} from '@/lib/maintenance/dispatch';
import { daysSince, fmtDate, todayStr, woCreatedAt, woWhere, type BoardData } from '../board-types';

/** Cards rendered per column before "show more" (300+ open WOs). */
const PAGE = 50;

type ColSort = 'priority' | 'age' | 'date';
const PRIORITY_RANK: Record<string, number> = { P1: 0, P2: 1, P3: 2, P4: 3 };

interface Column {
  key: string;
  title: string;
  kind: 'unassigned' | 'tech' | 'vendor' | 'appfolio';
  target: DispatchTarget | null;
  wos: MaintWorkOrder[];
}

interface Local {
  wo: MaintWorkOrder;
  plan: VendorAssignment | null;
}

function sortWos(wos: MaintWorkOrder[], sort: ColSort): MaintWorkOrder[] {
  const out = [...wos];
  if (sort === 'priority') {
    out.sort(
      (a, b) =>
        (PRIORITY_RANK[a.priority_class ?? 'P4'] ?? 3) - (PRIORITY_RANK[b.priority_class ?? 'P4'] ?? 3) ||
        woCreatedAt(a).localeCompare(woCreatedAt(b)),
    );
  } else if (sort === 'age') {
    out.sort((a, b) => woCreatedAt(a).localeCompare(woCreatedAt(b)));
  } else {
    out.sort((a, b) => (a.next_action_date ?? '9999').localeCompare(b.next_action_date ?? '9999'));
  }
  return out;
}

export default function OpenBoardDispatch({ board, onMoved }: { board: BoardData; onMoved?: () => void }) {
  const vendors = useMemo(() => board.vendors ?? [], [board.vendors]);
  const vendorIndex = useMemo(() => indexVendors(vendors), [vendors]);
  const serverPlans = useMemo(() => livePlansByWo(board.assignments), [board.assignments]);
  // Optimistic and server-confirmed changes since the board loaded.
  const [local, setLocal] = useState<Map<string, Local>>(new Map());
  const [pile, setPile] = useState<PileKey>('all');
  const [pinned, setPinned] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<string[] | null>(null);
  const [vendorQuery, setVendorQuery] = useState('');

  const today = todayStr();
  const weekAgoIso = useMemo(() => new Date(Date.now() - 7 * 86_400_000).toISOString(), []);

  const rows = useMemo(
    () =>
      board.open.map((base) => {
        const l = local.get(base.id);
        const wo = l?.wo ?? base;
        const plan = l ? l.plan ?? undefined : serverPlans.get(base.id);
        return { wo, plan, placement: dispatchPlacement(wo, plan, vendorIndex) };
      }),
    [board.open, local, serverPlans, vendorIndex],
  );
  const placementById = useMemo(() => new Map(rows.map((r) => [r.wo.id, r.placement])), [rows]);

  const columns = useMemo(() => {
    const unassigned: Column = { key: 'unassigned', title: 'Unassigned', kind: 'unassigned', target: { kind: 'unassigned' }, wos: [] };
    const techs: Column[] = DISPATCH_TECHS.map((p) => ({
      key: techColumn(p), title: p, kind: 'tech', target: { kind: 'tech', person: p }, wos: [],
    }));
    const others = new Map<string, Column>();
    const ensureVendor = (key: string, title: string, target: DispatchTarget | null) => {
      if (!others.has(key)) others.set(key, { key, title, kind: target ? 'vendor' : 'appfolio', target, wos: [] });
      return others.get(key)!;
    };
    for (const id of pinned) {
      const v = vendorIndex.byId.get(id);
      if (v) ensureVendor(`vendor:${v.id}`, v.name, { kind: 'vendor', vendor_id: v.id });
    }
    for (const { wo, placement } of rows) {
      if (inUnassignedColumn(placement)) {
        if (inPile(pile, wo, placement, today, weekAgoIso)) unassigned.wos.push(wo);
        continue;
      }
      const tech = techs.find((t) => t.key === placement.column);
      if (tech) {
        tech.wos.push(wo);
        continue;
      }
      if (placement.column.startsWith('vendor:')) {
        const v = vendorIndex.byId.get(placement.column.slice(7));
        ensureVendor(placement.column, v?.name ?? wo.vendor_name ?? 'Vendor', v ? { kind: 'vendor', vendor_id: v.id } : null).wos.push(wo);
      } else {
        ensureVendor(placement.column, wo.vendor_name ?? 'AppFolio vendor', null).wos.push(wo);
      }
    }
    const vendorCols = [...others.values()].sort(
      (a, b) =>
        Number(pinned.includes(b.key.slice(7))) - Number(pinned.includes(a.key.slice(7))) ||
        b.wos.length - a.wos.length ||
        a.title.localeCompare(b.title),
    );
    return [unassigned, ...techs, ...vendorCols];
  }, [rows, pile, pinned, vendorIndex, today, weekAgoIso]);

  const pileCounts = useMemo(() => {
    const counts = new Map<PileKey, number>();
    for (const { wo, placement } of rows) {
      if (!inUnassignedColumn(placement)) continue;
      for (const p of PILES) if (inPile(p.key, wo, placement, today, weekAgoIso)) counts.set(p.key, (counts.get(p.key) ?? 0) + 1);
    }
    return counts;
  }, [rows, today, weekAgoIso]);

  const vendorMatches = useMemo(() => {
    const q = vendorQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    const shown = new Set(columns.map((c) => c.key));
    return vendors
      .filter((v) => v.name.toLowerCase().includes(q) && !shown.has(`vendor:${v.id}`) && !isInternalVendor({ vendor_name: v.name }))
      .slice(0, 8);
  }, [vendorQuery, vendors, columns]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    setDragging(selected.has(id) ? [...selected] : [id]);
  };

  async function move(ids: string[], col: Column) {
    const target = col.target;
    if (!target) {
      toast.error(`${col.title} isn't in the vendor list yet. Assign it in AppFolio.`);
      return;
    }
    const shownIn = (p: Placement) => (inUnassignedColumn(p) ? 'unassigned' : p.column);
    const moving = ids.filter((id) => {
      const p = placementById.get(id);
      return p && shownIn(p) !== col.key;
    });
    if (moving.length === 0) return;

    const before = new Map(moving.map((id) => [id, local.get(id)]));
    const byId = new Map(rows.map((r) => [r.wo.id, r]));
    const optimistic = (id: string): Local => {
      const { wo } = byId.get(id)!;
      if (target.kind === 'tech') return { wo: { ...wo, assigned_tech: target.person }, plan: null };
      if (target.kind === 'unassigned') return { wo: { ...wo, assigned_tech: null }, plan: null };
      const v = vendorIndex.byId.get(target.vendor_id);
      const inAppFolio = !!wo.vendor_id && wo.vendor_id === v?.appfolio_vendor_id;
      const plan = inAppFolio
        ? null
        : ({
            id: `pending-${id}`, work_order_id: id, vendor_id: target.vendor_id, sent_at: new Date().toISOString(),
            accepted_at: null, declined_at: null, scheduled_at: null, completed_at: null, callback: false,
            created_by: null, created_at: new Date().toISOString(), source: 'board', withdrawn_at: null,
            af_vendor_at_plan: wo.vendor_id ?? null,
          } satisfies VendorAssignment);
      return { wo: { ...wo, assigned_tech: null }, plan };
    };
    setLocal((prev) => {
      const next = new Map(prev);
      for (const id of moving) next.set(id, optimistic(id));
      return next;
    });
    setSelected(new Set());

    const revert = (ids: string[]) =>
      setLocal((prev) => {
        const next = new Map(prev);
        for (const id of ids) {
          const b = before.get(id);
          if (b) next.set(id, b);
          else next.delete(id);
        }
        return next;
      });

    try {
      const res = await fetch('/api/maintenance/dispatch/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ work_order_ids: moving, to: target }),
      });
      const body = await res.json().catch(() => ({}));
      const results: { id: string; ok: boolean; error?: string; workOrder?: MaintWorkOrder; plan?: VendorAssignment | null }[] =
        body.results ?? [];
      if (!results.length) throw new Error(body.error || `Move failed (${res.status})`);
      const failed = results.filter((r) => !r.ok);
      setLocal((prev) => {
        const next = new Map(prev);
        for (const r of results) if (r.ok && r.workOrder) next.set(r.id, { wo: r.workOrder, plan: r.plan ?? null });
        return next;
      });
      if (failed.length < results.length) onMoved?.();
      if (failed.length) {
        revert(failed.map((r) => r.id));
        toast.error(`${failed.length} not moved: ${failed[0].error}`);
      }
      const ok = results.length - failed.length;
      if (ok && target.kind === 'unassigned') {
        const stillAssigned = results.filter((r) => r.ok && r.workOrder?.vendor_id && !isInternalVendor(r.workOrder)).length;
        if (stillAssigned) toast.info(`${stillAssigned} still has a vendor in AppFolio. Remove it there to unassign.`);
      } else if (ok) {
        toast.success(`${ok} moved to ${col.title}`);
      }
    } catch (e) {
      revert(moving);
      toast.error(e instanceof Error ? e.message : 'Move failed');
    }
  }

  const onDragEnd = (e: DragEndEvent) => {
    const ids = dragging ?? [];
    setDragging(null);
    const col = columns.find((c) => c.key === e.over?.id);
    if (col && ids.length) void move(ids, col);
  };

  const needsAppFolio = rows.filter((r) => r.placement.needsAppFolio).length;
  const draggingWo = dragging?.length ? rows.find((r) => r.wo.id === dragging[0]) : null;

  return (
    <div className="dispatch">
      <div className="grouptools" style={{ flexWrap: 'wrap' }}>
        <input
          className="mo-input"
          placeholder="Add a vendor column…"
          value={vendorQuery}
          onChange={(e) => setVendorQuery(e.target.value)}
          aria-label="Add a vendor column"
          style={{ width: 260 }}
        />
        {vendorMatches.map((v) => (
          <button
            key={v.id}
            className="mo-btn"
            onClick={() => {
              setPinned((p) => [...p, v.id]);
              setVendorQuery('');
            }}
          >
            + {v.name}
          </button>
        ))}
        {selected.size > 0 && (
          <>
            <span className="note" style={{ border: 'none', padding: 0, margin: 0 }}>
              {selected.size} selected — drag any one to move them all
            </span>
            <button className="mo-btn secondary" onClick={() => setSelected(new Set())}>
              Clear selection
            </button>
          </>
        )}
        {needsAppFolio > 0 && (
          <span className="afcount" title="Cards planned here that still need the same change in AppFolio">
            {needsAppFolio} to update in AppFolio
          </span>
        )}
      </div>

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        <div className="colwrap">
          <div className="dcols">
            {columns.map((col) => (
              <DispatchColumn
                key={col.key}
                col={col}
                collapsed={collapsed.has(col.key)}
                onToggle={() =>
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(col.key)) next.delete(col.key);
                    else next.add(col.key);
                    return next;
                  })
                }
                pile={col.kind === 'unassigned' ? pile : undefined}
                pileCounts={pileCounts}
                onPile={setPile}
                placementById={placementById}
                selected={selected}
                onSelect={toggleSelect}
                today={today}
              />
            ))}
          </div>
        </div>
        <DragOverlay dropAnimation={null}>
          {draggingWo ? (
            <div className={`card dcard ${(draggingWo.wo.priority_class ?? 'p4').toLowerCase()} dragging`}>
              {dragging!.length > 1 && <span className="dstack">{dragging!.length} work orders</span>}
              <CardBody wo={draggingWo.wo} placement={draggingWo.placement} today={today} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <p className="note">
        Drag a card onto a tech or vendor to assign it. Shift-click cards to select several. Moves to a vendor are
        planned here: the card says <b>Assign in AppFolio</b> until AppFolio shows the same vendor (it syncs every
        15 minutes). If AppFolio later shows a different vendor, AppFolio wins. Click a card to open the work order.
      </p>
    </div>
  );
}

function DispatchColumn({
  col,
  collapsed,
  onToggle,
  pile,
  pileCounts,
  onPile,
  placementById,
  selected,
  onSelect,
  today,
}: {
  col: Column;
  collapsed: boolean;
  onToggle: () => void;
  pile?: PileKey;
  pileCounts: Map<PileKey, number>;
  onPile: (p: PileKey) => void;
  placementById: Map<string, Placement>;
  selected: Set<string>;
  onSelect: (id: string) => void;
  today: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.key, disabled: !col.target });
  const [sort, setSort] = useState<ColSort>('priority');
  const [limit, setLimit] = useState(PAGE);
  const wos = useMemo(() => sortWos(col.wos, sort), [col.wos, sort]);
  const overdue = col.wos.filter((wo) => wo.next_action_date && wo.next_action_date < today).length;

  return (
    <div ref={setNodeRef} className={`dcol${collapsed ? ' collapsed' : ''}${isOver ? ' over' : ''} k-${col.kind}`}>
      <h3>
        <button className="dcol-toggle" onClick={onToggle} aria-expanded={!collapsed} title={collapsed ? 'Expand' : 'Collapse'}>
          {collapsed ? '▸' : '▾'}
        </button>
        <span className="dcol-title">{col.title}</span>
        <span className="cnt">
          {col.wos.length}
          {overdue > 0 && <span className="dover"> · {overdue} late</span>}
        </span>
      </h3>
      {!collapsed && (
        <>
          {pile && (
            <div className="dpiles">
              {PILES.map((p) => (
                <button key={p.key} className={`chip${pile === p.key ? ' on' : ''}`} onClick={() => onPile(p.key)}>
                  {p.label} {pileCounts.get(p.key) ?? 0}
                </button>
              ))}
            </div>
          )}
          <select className="mo-input dsort" value={sort} onChange={(e) => setSort(e.target.value as ColSort)} aria-label={`Sort ${col.title}`}>
            <option value="priority">Priority</option>
            <option value="age">Oldest first</option>
            <option value="date">Next action</option>
          </select>
          {!col.target && <p className="dhint">Not in our vendor list. Cards can leave, not land.</p>}
          {wos.slice(0, limit).map((wo) => (
            <DispatchCard
              key={wo.id}
              wo={wo}
              placement={placementById.get(wo.id)!}
              selected={selected.has(wo.id)}
              onSelect={onSelect}
              today={today}
            />
          ))}
          {wos.length > limit && (
            <button className="mo-btn dmore" onClick={() => setLimit((l) => l + PAGE)}>
              Show {Math.min(PAGE, wos.length - limit)} more of {wos.length - limit}
            </button>
          )}
          {wos.length === 0 && <p className="dhint">Drop work orders here</p>}
        </>
      )}
    </div>
  );
}

function DispatchCard({
  wo,
  placement,
  selected,
  onSelect,
  today,
}: {
  wo: MaintWorkOrder;
  placement: Placement;
  selected: boolean;
  onSelect: (id: string) => void;
  today: string;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: wo.id });
  const edge = (wo.priority_class ?? 'p4').toLowerCase();
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`card dcard ${edge}${selected ? ' selected' : ''}${isDragging ? ' ghost' : ''}`}
      onClickCapture={(e) => {
        if (e.shiftKey || e.metaKey) {
          e.preventDefault();
          e.stopPropagation();
          onSelect(wo.id);
        }
      }}
    >
      <CardBody wo={wo} placement={placement} today={today} link />
    </div>
  );
}

function CardBody({ wo, placement, today, link }: { wo: MaintWorkOrder; placement: Placement; today: string; link?: boolean }) {
  const pastDue = !!wo.next_action_date && wo.next_action_date < today;
  const age = daysSince(woCreatedAt(wo));
  const title = (
    <b>
      {wo.wo_number && <span className="wonum">#{wo.wo_number}</span>}{' '}
      {wo.description.length > 80 ? `${wo.description.slice(0, 80)}…` : wo.description}
    </b>
  );
  const nudge = placement.needsAppFolio;
  return (
    <>
      {link ? (
        <Link href={`/maintenance/board/wo/${wo.id}`} className="dlink" draggable={false}>
          {title}
        </Link>
      ) : (
        title
      )}
      <span className="dwhere">{woWhere(wo)}</span>
      <span className="dmeta">
        {age !== null && <span title="Days since created">{age}d</span>}
        {' · '}
        {wo.next_action_date ? (
          <span className={pastDue ? 'due past' : 'due'}>
            {pastDue ? `due ${fmtDate(wo.next_action_date)} ⚠` : `act ${fmtDate(wo.next_action_date)}`}
          </span>
        ) : (
          <span className="due needsdate">needs date</span>
        )}
        {wo.stage === 'WAITING_ON' && <> · waiting</>}
        {placement.hdmsNoTech && <> · <span className="due past">HDMS, no tech</span></>}
      </span>
      {nudge && (
        <a
          className="afnudge"
          href={wo.appfolio_link ?? undefined}
          target="_blank"
          rel="noreferrer"
          draggable={false}
          onPointerDown={(e) => e.stopPropagation()}
          title="We can't change AppFolio from here. Make the same assignment there; this clears on the next sync."
        >
          {nudge.kind === 'vendor' ? `Assign ${nudge.vendorName} in AppFolio ↗` : 'Assign HDMS in AppFolio ↗'}
        </a>
      )}
    </>
  );
}
