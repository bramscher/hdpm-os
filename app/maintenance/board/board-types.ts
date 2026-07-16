/** Client-side payload types for the maintenance board views. */

import type {
  MaintWorkOrder,
  TripwireException,
  Turn,
  Vendor,
  VendorAssignment,
} from '@/lib/maintenance/types';

export interface BoardData {
  open: MaintWorkOrder[];
  closedThisWeek: MaintWorkOrder[];
  turns: Turn[];
  assignments: VendorAssignment[];
  waitingSince: Record<string, string>;
  kpis: {
    open: number;
    pastDue: number;
    aging30Plus: number;
    p1ThisWeek: number;
    ownerAndDateCoverage: number;
  };
}

export interface ExceptionsData {
  exceptions: TripwireException[];
  ruleErrors: { tripwire: number; error: string }[];
  ranAt: string;
  /** Triage backlog: open WOs with no next-action date (excl. future-scheduled). */
  needsDate?: TripwireException[];
  needsDateCount?: number;
}

export interface ScoreboardRow {
  vendorId: string;
  name: string;
  assignments90d: number;
  avgAcceptHours: number | null;
  avgCompletionDays: number | null;
  callbackRate: number;
  demoted: boolean;
  /** null = no 90-day assignment data yet (rendered as '—'). */
  score: number | null;
  vendor: Vendor;
  open: number;
  overdue: number;
  avgDaysOpen: number | null;
  medianDaysOpen: number | null;
  /** All-time cycle-time stats from closed WOs (null = no usable history) */
  history: { n: number; medianDays: number; p90Days: number; pctOver30: number } | null;
}

// ── Shared display helpers ──

export function woWhere(wo: MaintWorkOrder): string {
  // AppFolio unit names already carry their own designator (e.g. "RC 603 - #20"),
  // so join with " · " rather than a "#" that would double up.
  return wo.unit_name ? `${wo.property_name} · ${wo.unit_name}` : wo.property_name;
}

/**
 * When the work order was actually created — AppFolio's CreatedAt, falling
 * back to our row insert time. Never use created_at directly for age math:
 * catch-up syncs insert years-old history with a fresh row timestamp.
 */
export function woCreatedAt(wo: MaintWorkOrder): string {
  return wo.appfolio_created_at ?? wo.created_at;
}

export function daysSince(iso: string | null | undefined, now = new Date()): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000));
}

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function fmtDate(d: string | null): string {
  if (!d) return '—';
  const [, m, day] = d.slice(0, 10).split('-');
  return `${parseInt(m, 10)}/${parseInt(day, 10)}`;
}

/** Days-pill urgency class: green ≤2 · amber 3–5 · red >5. */
export function daysPillClass(days: number): string {
  if (days > 5) return 'days d-late';
  if (days >= 3) return 'days d-warn';
  return 'days d-ok';
}

/** Aging band index for a created_at age in days: 0–7 / 8–14 / 15–30 / 30+. */
export function agingBand(days: number): 0 | 1 | 2 | 3 {
  if (days > 30) return 3;
  if (days > 14) return 2;
  if (days > 7) return 1;
  return 0;
}

// ── Board-wide search + sort (shared by every open-WO view) ──

/** Sort keys offered in the board toolbar. 'default' keeps API order. */
export type WoSortKey =
  | 'default'
  | 'property'
  | 'vendor'
  | 'priority'
  | 'date'
  | 'age'
  | 'stage';

export const WO_SORT_OPTIONS: { key: WoSortKey; label: string }[] = [
  { key: 'default', label: 'Default order' },
  { key: 'property', label: 'Property / unit' },
  { key: 'vendor', label: 'Vendor' },
  { key: 'priority', label: 'Priority (P1→P4)' },
  { key: 'date', label: 'Next-action date' },
  { key: 'age', label: 'Age (oldest first)' },
  { key: 'stage', label: 'Stage' },
];

/** Every text field a board search should look through. */
function woHaystack(wo: MaintWorkOrder): string {
  return [
    wo.property_name,
    wo.unit_name,
    wo.vendor_name,
    wo.description,
    wo.wo_number,
    wo.owner_name,
    wo.assigned_tech,
    wo.stage,
    wo.priority_class,
    wo.property_address,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/**
 * Filter WOs by a free-text query. Space-separated terms are ANDed, so
 * "reindeer p1" matches Reindeer-Canyon P1s. Empty query returns the input.
 */
export function filterWorkOrders(wos: MaintWorkOrder[], query: string): MaintWorkOrder[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return wos;
  return wos.filter((wo) => {
    const hay = woHaystack(wo);
    return terms.every((t) => hay.includes(t));
  });
}

const PRIORITY_RANK: Record<string, number> = { P1: 0, P2: 1, P3: 2, P4: 3 };

/** Stable sort of WOs by the chosen key (non-mutating). */
export function sortWorkOrders(wos: MaintWorkOrder[], key: WoSortKey): MaintWorkOrder[] {
  if (key === 'default') return wos;
  const byProp = (a: MaintWorkOrder, b: MaintWorkOrder) =>
    a.property_name.localeCompare(b.property_name) ||
    (a.unit_name ?? '').localeCompare(b.unit_name ?? '');
  const cmp: Record<Exclude<WoSortKey, 'default'>, (a: MaintWorkOrder, b: MaintWorkOrder) => number> = {
    property: byProp,
    vendor: (a, b) =>
      // Unassigned sinks to the bottom.
      Number(!!b.vendor_name) - Number(!!a.vendor_name) ||
      (a.vendor_name ?? '').localeCompare(b.vendor_name ?? '') ||
      byProp(a, b),
    priority: (a, b) =>
      (PRIORITY_RANK[a.priority_class ?? ''] ?? 9) - (PRIORITY_RANK[b.priority_class ?? ''] ?? 9) ||
      byProp(a, b),
    date: (a, b) =>
      // Real dates ascending, "needs date" (null) last.
      (a.next_action_date ?? '9999-99-99').localeCompare(b.next_action_date ?? '9999-99-99') ||
      byProp(a, b),
    age: (a, b) => woCreatedAt(a).localeCompare(woCreatedAt(b)) || byProp(a, b),
    stage: (a, b) =>
      (STAGE_ORDER[a.stage] ?? 99) - (STAGE_ORDER[b.stage] ?? 99) ||
      (a.next_action_date ?? '9999').localeCompare(b.next_action_date ?? '9999'),
  };
  return [...wos].sort(cmp[key]);
}

// ── Property-centric grouping (By Property view) ──

/** Lifecycle order — drives WO sort within a unit and the kanban columns. */
export const STAGE_ORDER: Record<string, number> = {
  NEW: 0,
  TRIAGED: 1,
  SCHEDULED: 2,
  IN_PROGRESS: 3,
  WAITING_ON: 4,
  VERIFY: 5,
  BILL: 6,
  CLOSED: 7,
};

export interface UnitGroup {
  unitKey: string;
  unitName: string | null;
  isTurn: boolean;
  wos: MaintWorkOrder[];
  pastDue: number;
}

export interface PropertyGroup {
  propKey: string;
  propertyName: string;
  propertyAddress: string | null;
  units: UnitGroup[];
  total: number;
  pastDue: number;
  p1: number;
  hasTurn: boolean;
}

function isPastDue(wo: MaintWorkOrder, today: string): boolean {
  return !!wo.next_action_date && wo.next_action_date < today;
}

/** Lifecycle stage, then next-action date. Shared by the grouped views. */
function byStageThenDate(a: MaintWorkOrder, b: MaintWorkOrder): number {
  const s = (STAGE_ORDER[a.stage] ?? 99) - (STAGE_ORDER[b.stage] ?? 99);
  if (s !== 0) return s;
  return (a.next_action_date ?? '9999').localeCompare(b.next_action_date ?? '9999');
}

/**
 * Human label for a unit group.
 *  - unit_name present  → the AppFolio name as-is (e.g. "RC 603 - #20").
 *  - no unit + multi-unit property → "Property-level" (work spans the property,
 *    e.g. a parking sign or an estimate covering several units).
 *  - no unit + single-unit property → the property name (the property IS the
 *    one unit, so "Property-level" would just read as noise).
 *  - unit_id but no name → WO ticket fallback (rare: hidden/sold units that the
 *    /units endpoint no longer returns), so distinct units stay distinguishable.
 */
export function unitGroupLabel(
  unitName: string | null,
  wos: MaintWorkOrder[],
  propertyName: string,
  propertyIsMultiUnit: boolean,
): string {
  // AppFolio unit names are already self-descriptive (e.g. "RC 603 - #20"),
  // so show them as-is rather than prefixing a redundant "Unit".
  if (unitName) return unitName;
  // Genuinely unit-less work (no unit on the AppFolio WO).
  if (!wos.some((w) => w.unit_id)) {
    return propertyIsMultiUnit ? 'Property-level' : propertyName;
  }
  const tickets = [...new Set(wos.map((w) => (w.wo_number ?? '').split('-')[0]).filter(Boolean))];
  if (tickets.length === 1) return `WO #${tickets[0]}`;
  if (tickets.length > 1 && tickets.length <= 3) return `WO ${tickets.map((t) => `#${t}`).join(', ')}`;
  if (tickets.length > 3) return `${tickets.length} tickets`;
  return propertyIsMultiUnit ? 'Property-level' : propertyName;
}

/** A property is multi-unit if any of its open WOs is tied to a specific unit. */
export function propertyIsMultiUnit(units: UnitGroup[]): boolean {
  return units.some((u) => u.wos.some((w) => w.unit_id));
}

/**
 * Shape the flat open-WO list into ordered Property → Unit → WO groups so a
 * turn's scattered per-vendor work orders collapse into one place. Pure — safe
 * to call in render. Sort: properties by past-due desc, then total desc, name;
 * units by turn, then past-due, then name; WOs by lifecycle stage, then date.
 */
export function groupOpenByProperty(open: MaintWorkOrder[]): PropertyGroup[] {
  const today = todayStr();
  const props = new Map<string, PropertyGroup & { unitMap: Map<string, UnitGroup> }>();

  for (const wo of open) {
    const propKey = wo.property_id || wo.property_name || '—';
    let prop = props.get(propKey);
    if (!prop) {
      prop = {
        propKey,
        propertyName: wo.property_name || '— No property —',
        propertyAddress: wo.property_address,
        units: [],
        total: 0,
        pastDue: 0,
        p1: 0,
        hasTurn: false,
        unitMap: new Map(),
      };
      props.set(propKey, prop);
    }

    const unitKey = wo.unit_id || wo.unit_name || '—';
    let unit = prop.unitMap.get(unitKey);
    if (!unit) {
      unit = { unitKey, unitName: wo.unit_name, isTurn: false, wos: [], pastDue: 0 };
      prop.unitMap.set(unitKey, unit);
    }

    unit.wos.push(wo);
    prop.total += 1;
    if (isPastDue(wo, today)) {
      unit.pastDue += 1;
      prop.pastDue += 1;
    }
    if (wo.priority_class === 'P1') prop.p1 += 1;
    if (wo.is_turn) {
      unit.isTurn = true;
      prop.hasTurn = true;
    }
  }

  const result = [...props.values()].map((prop) => {
    const units = [...prop.unitMap.values()]
      .map((u) => ({ ...u, wos: [...u.wos].sort(byStageThenDate) }))
      .sort(
        (a, b) =>
          Number(b.isTurn) - Number(a.isTurn) ||
          b.pastDue - a.pastDue ||
          (a.unitName ?? '').localeCompare(b.unitName ?? ''),
      );
    const { unitMap, ...rest } = prop;
    void unitMap;
    return { ...rest, units };
  });

  return result.sort(
    (a, b) =>
      b.pastDue - a.pastDue ||
      b.total - a.total ||
      a.propertyName.localeCompare(b.propertyName),
  );
}

/** Substring identifying the internal maintenance crew's vendor record (HDMS). */
export const INTERNAL_VENDOR_MATCH = 'high desert maintenance services';

/** True when a work order is assigned to the internal HDMS crew. */
export function isInternalVendor(wo: MaintWorkOrder): boolean {
  return (wo.vendor_name ?? '').toLowerCase().includes(INTERNAL_VENDOR_MATCH);
}

/** A vendor's open work orders for one property (sub-group under a vendor). */
export interface VendorPropertyGroup {
  key: string;
  name: string;
  wos: MaintWorkOrder[];
  total: number;
  pastDue: number;
  unassigned: number;
}

export interface VendorGroup {
  vendorKey: string;
  vendorName: string;
  assigned: boolean;
  wos: MaintWorkOrder[];
  total: number;
  pastDue: number;
  p1: number;
  /** The vendor's WOs sub-grouped by property, for scheduling per address. */
  properties: VendorPropertyGroup[];
}

/** Sub-group an already stage/date-sorted list of WOs by property. */
function groupByProperty(wos: MaintWorkOrder[], today: string): VendorPropertyGroup[] {
  const map = new Map<string, VendorPropertyGroup>();
  for (const wo of wos) {
    const key = wo.property_id || wo.property_name || '—unknown—';
    let p = map.get(key);
    if (!p) {
      p = {
        key,
        name: wo.property_name || '— Unknown property —',
        wos: [],
        total: 0,
        pastDue: 0,
        unassigned: 0,
      };
      map.set(key, p);
    }
    p.wos.push(wo);
    p.total += 1;
    if (isPastDue(wo, today)) p.pastDue += 1;
    // "no tech" gap: internal HDMS work with nobody on it. External-vendor work
    // is assigned to the vendor, so a blank assigned_to there is not a gap.
    if (!wo.assigned_to && isInternalVendor(wo)) p.unassigned += 1;
  }
  return [...map.values()].sort(
    (a, b) => b.pastDue - a.pastDue || b.total - a.total || a.name.localeCompare(b.name),
  );
}

/**
 * Collapse the open board into one group per assigned vendor — every work order
 * a vendor is on, in one place, further sub-grouped by property. Unassigned WOs
 * sort to the bottom under a dedicated bucket. Sort: past-due desc, total desc,
 * name; WOs by stage/date.
 */
export function groupOpenByVendor(open: MaintWorkOrder[]): VendorGroup[] {
  const today = todayStr();
  const map = new Map<string, VendorGroup>();

  for (const wo of open) {
    const assigned = !!(wo.vendor_id || wo.vendor_name);
    const key = wo.vendor_id || wo.vendor_name || '—unassigned—';
    let g = map.get(key);
    if (!g) {
      g = {
        vendorKey: key,
        vendorName: wo.vendor_name || '— Unassigned —',
        assigned,
        wos: [],
        total: 0,
        pastDue: 0,
        p1: 0,
        properties: [],
      };
      map.set(key, g);
    }
    g.wos.push(wo);
    g.total += 1;
    if (isPastDue(wo, today)) g.pastDue += 1;
    if (wo.priority_class === 'P1') g.p1 += 1;
  }

  for (const g of map.values()) {
    g.wos.sort(byStageThenDate);
    g.properties = groupByProperty(g.wos, today);
  }

  return [...map.values()].sort(
    (a, b) =>
      // Unassigned bucket always last.
      Number(b.assigned) - Number(a.assigned) ||
      b.pastDue - a.pastDue ||
      b.total - a.total ||
      a.vendorName.localeCompare(b.vendorName),
  );
}
