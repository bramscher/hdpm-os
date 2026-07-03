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
  docsCompliance: number;
  demoted: boolean;
  score: number;
  vendor: Vendor;
  open: number;
  overdue: number;
  avgDaysOpen: number | null;
}

// ── Shared display helpers ──

export function woWhere(wo: MaintWorkOrder): string {
  return wo.unit_name ? `${wo.property_name} #${wo.unit_name}` : wo.property_name;
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
