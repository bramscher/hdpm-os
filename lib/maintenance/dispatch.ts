/**
 * Dispatch board model (pure): which column each open work order sits in, the
 * smart piles inside Unassigned, and when a card must nudge staff to make the
 * same change in AppFolio (we can't write to AppFolio).
 */

import type { MaintWorkOrder, PriorityClass, VendorAssignment } from './types';

/** In-house techs who get their own column (matches the Route Builder). */
export const DISPATCH_TECHS = ['Alberto', 'Brody'] as const;

/** Substring identifying the internal maintenance crew's vendor record (HDMS). */
export const INTERNAL_VENDOR_MATCH = 'high desert maintenance services';

/** True when a work order is assigned to the internal HDMS crew in AppFolio. */
export function isInternalVendor(wo: Pick<MaintWorkOrder, 'vendor_name'>): boolean {
  return (wo.vendor_name ?? '').toLowerCase().includes(INTERNAL_VENDOR_MATCH);
}

export type DispatchTarget =
  | { kind: 'tech'; person: string }
  | { kind: 'vendor'; vendor_id: string }
  | { kind: 'unassigned' };

export interface DispatchVendor {
  id: string;
  name: string;
  appfolio_vendor_id: string | null;
}

/** Column keys: 'unassigned', 'tech:Alberto', 'vendor:<uuid>' or 'af:<AppFolio id>' (vendor not in our table). */
export type ColumnKey = string;

export interface Placement {
  column: ColumnKey;
  /** The vendor planned on the board, when that's what put the card here. */
  planned: DispatchVendor | null;
  /** The board says one thing and AppFolio another: staff must make the change in AppFolio. */
  needsAppFolio: null | { kind: 'vendor'; vendorName: string } | { kind: 'hdms' };
  /** AppFolio has the HDMS crew on it but no tech is assigned yet. */
  hdmsNoTech: boolean;
}

export function techColumn(person: string): ColumnKey {
  return `tech:${person}`;
}

export function columnForTarget(target: DispatchTarget): ColumnKey {
  if (target.kind === 'tech') return techColumn(target.person);
  if (target.kind === 'vendor') return `vendor:${target.vendor_id}`;
  return 'unassigned';
}

/** A board assignment that still counts: not completed, declined or withdrawn. */
export function isLiveAssignment(a: VendorAssignment): boolean {
  return !a.completed_at && !a.declined_at && !a.withdrawn_at;
}

/** Newest live board-planned vendor per work order. */
export function livePlansByWo(assignments: VendorAssignment[]): Map<string, VendorAssignment> {
  const out = new Map<string, VendorAssignment>();
  for (const a of assignments) {
    if (a.source !== 'board' || !isLiveAssignment(a)) continue;
    const prev = out.get(a.work_order_id);
    if (!prev || a.created_at > prev.created_at) out.set(a.work_order_id, a);
  }
  return out;
}

export interface VendorIndex {
  byId: Map<string, DispatchVendor>;
  byAppFolioId: Map<string, DispatchVendor>;
}

export function indexVendors(vendors: DispatchVendor[]): VendorIndex {
  const byId = new Map<string, DispatchVendor>();
  const byAppFolioId = new Map<string, DispatchVendor>();
  for (const v of vendors) {
    byId.set(v.id, v);
    if (v.appfolio_vendor_id) byAppFolioId.set(v.appfolio_vendor_id, v);
  }
  return { byId, byAppFolioId };
}

function techFor(wo: MaintWorkOrder): string | null {
  const t = (wo.assigned_tech ?? '').trim().toLowerCase();
  return DISPATCH_TECHS.find((p) => p.toLowerCase() === t) ?? null;
}

function appFolioColumn(wo: MaintWorkOrder, vendors: VendorIndex): ColumnKey {
  if (!wo.vendor_id) return wo.vendor_name ? `af:${wo.vendor_name}` : 'unassigned';
  const v = vendors.byAppFolioId.get(wo.vendor_id);
  return v ? `vendor:${v.id}` : `af:${wo.vendor_id}`;
}

/**
 * Where a card sits, in order: a local in-house tech; then the board-planned
 * vendor (unless AppFolio has since moved to a third vendor — AppFolio wins);
 * then AppFolio's vendor; otherwise Unassigned.
 */
export function dispatchPlacement(
  wo: MaintWorkOrder,
  plan: VendorAssignment | undefined,
  vendors: VendorIndex,
): Placement {
  const tech = techFor(wo);
  if (tech) {
    return {
      column: techColumn(tech),
      planned: null,
      needsAppFolio: isInternalVendor(wo) ? null : { kind: 'hdms' },
      hdmsNoTech: false,
    };
  }

  const planned = plan ? vendors.byId.get(plan.vendor_id) ?? null : null;
  if (plan && planned) {
    const matched = !!wo.vendor_id && wo.vendor_id === planned.appfolio_vendor_id;
    const appFolioMovedOn = !matched && (wo.vendor_id ?? null) !== (plan.af_vendor_at_plan ?? null);
    if (!appFolioMovedOn) {
      return {
        column: `vendor:${planned.id}`,
        planned,
        needsAppFolio: matched ? null : { kind: 'vendor', vendorName: planned.name },
        hdmsNoTech: false,
      };
    }
  }

  return {
    column: appFolioColumn(wo, vendors),
    planned: null,
    needsAppFolio: null,
    hdmsNoTech: isInternalVendor(wo),
  };
}

// ── Smart piles inside Unassigned (plus HDMS-with-no-tech) ──

export type PileKey = 'all' | 'p1p2' | 'overdue' | 'needs_date' | 'new_week' | 'waiting' | 'hdms_no_tech';

export const PILES: { key: PileKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'p1p2', label: 'P1 / P2' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'needs_date', label: 'Needs date' },
  { key: 'new_week', label: 'New this week' },
  { key: 'waiting', label: 'Waiting on…' },
  { key: 'hdms_no_tech', label: 'HDMS, no tech' },
];

const URGENT: PriorityClass[] = ['P1', 'P2'];

export function inPile(
  pile: PileKey,
  wo: MaintWorkOrder,
  placement: Placement,
  today: string,
  weekAgoIso: string,
): boolean {
  switch (pile) {
    case 'all':
      return true;
    case 'p1p2':
      return !!wo.priority_class && URGENT.includes(wo.priority_class);
    case 'overdue':
      return !!wo.next_action_date && wo.next_action_date < today;
    case 'needs_date':
      return !wo.next_action_date;
    case 'new_week':
      return (wo.appfolio_created_at ?? wo.created_at) >= weekAgoIso;
    case 'waiting':
      return wo.stage === 'WAITING_ON';
    case 'hdms_no_tech':
      return placement.hdmsNoTech;
  }
}

/** The Unassigned column holds unassigned WOs plus HDMS work nobody's on yet. */
export function inUnassignedColumn(placement: Placement): boolean {
  return placement.column === 'unassigned' || placement.hdmsNoTech;
}
