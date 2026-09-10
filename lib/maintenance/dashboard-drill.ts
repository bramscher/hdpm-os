/**
 * Maintenance Dashboard — drill-down filter.
 *
 * A tile click hands the board an id set (WOs or turns) plus a label; the
 * board narrows its already-loaded lists to those ids before its own search
 * and sort run. Pure and client-safe (no Supabase import) so the board client
 * and the unit tests share it. Id lists live in React state, not the URL —
 * they are too long for a query string and `?view=` alone keeps deep links working.
 */

import type { MaintWorkOrder, UnitTurn } from './types';

export type DrillView = 'open' | 'wait' | 'exceptions' | 'turnover' | 'vendor';

export interface Drill {
  view: DrillView;
  /** Work-order ids to narrow to (undefined = no WO filter). */
  ids?: string[];
  /** unit_turn ids to narrow to (undefined = no turn filter). */
  turnIds?: string[];
  /** Shown in the toolbar chip, e.g. "Assigned · over 5 business days". */
  label: string;
}

export function applyWoDrill(wos: MaintWorkOrder[], ids: string[] | null | undefined): MaintWorkOrder[] {
  if (!ids) return wos;
  const set = new Set(ids);
  return wos.filter((wo) => set.has(wo.id));
}

export function applyTurnDrill<T extends Pick<UnitTurn, 'id'>>(
  turns: T[],
  ids: string[] | null | undefined
): T[] {
  if (!ids) return turns;
  const set = new Set(ids);
  return turns.filter((t) => set.has(t.id));
}
