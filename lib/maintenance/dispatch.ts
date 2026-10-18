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

// ── Week schedule (part 2) ──

const ZONE = 'America/Los_Angeles';

/** A timestamp or date as a Pacific calendar date (date-only values are already one). */
export function pacificDate(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 10) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-CA', { timeZone: ZONE });
}

/** YYYY-MM-DD plus n days (calendar math at noon UTC, so DST never shifts the date). */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The Monday on or before a date. */
export function mondayOf(date: string): string {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

/** The week to plan: this week, or next week once it's the weekend. */
export function planningMonday(today: string): string {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6 ? addDays(mondayOf(today), 7) : mondayOf(today);
}

export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** A vendor date we planned is stored at noon UTC so its calendar date is the same everywhere. */
export function vendorDateIso(date: string): string {
  return `${date}T12:00:00Z`;
}

/** A tech day on the week strip: a draft (office only) or the published route the tech has. */
export interface TechDay {
  plan_id: string;
  date: string;
  tech: string;
  status: 'draft' | 'published';
  work_order_ids: string[];
  service_minutes: number;
}

/**
 * When the board has a vendor date AppFolio doesn't show yet, staff must set it
 * there too. Returns the board's date, or null when AppFolio agrees (or there is none).
 */
export function vendorDateToSet(wo: Pick<MaintWorkOrder, 'scheduled_start'>, plan: VendorAssignment | undefined | null): string | null {
  const planned = pacificDate(plan?.scheduled_at);
  if (!planned) return null;
  return pacificDate(wo.scheduled_start) === planned ? null : planned;
}
