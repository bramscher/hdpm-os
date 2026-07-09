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
  return wo.unit_name ? `${wo.property_name} #${wo.unit_name}` : wo.property_name;
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

  const byStageThenDate = (a: MaintWorkOrder, b: MaintWorkOrder) => {
    const s = (STAGE_ORDER[a.stage] ?? 99) - (STAGE_ORDER[b.stage] ?? 99);
    if (s !== 0) return s;
    return (a.next_action_date ?? '9999').localeCompare(b.next_action_date ?? '9999');
  };

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
