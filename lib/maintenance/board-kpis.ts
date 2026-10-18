/**
 * The Open Board's header numbers. Shared by the board API and the board
 * itself, which recomputes them for whatever is on screen (e.g. with
 * recurring work hidden).
 */

import type { MaintWorkOrder } from './types';

export interface BoardKpis {
  open: number;
  pastDue: number;
  aging30Plus: number;
  p1ThisWeek: number;
  ownerAndDateCoverage: number;
}

const DAY_MS = 86_400_000;

export function computeBoardKpis(open: MaintWorkOrder[], closedThisWeek: MaintWorkOrder[], now = new Date()): BoardKpis {
  const today = now.toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  // Age math uses AppFolio's CreatedAt (catch-up syncs insert old history
  // with fresh row timestamps), falling back to our row insert time.
  const createdAt = (wo: MaintWorkOrder) => wo.appfolio_created_at ?? wo.created_at;
  return {
    open: open.length,
    pastDue: open.filter((wo) => wo.next_action_date && wo.next_action_date < today).length,
    aging30Plus: open.filter((wo) => createdAt(wo) < thirtyDaysAgo).length,
    p1ThisWeek: open
      .concat(closedThisWeek)
      .filter((wo) => wo.priority_class === 'P1' && createdAt(wo) >= sevenDaysAgo).length,
    ownerAndDateCoverage:
      open.length === 0
        ? 100
        : Math.round((open.filter((wo) => wo.owner_name && wo.next_action_date).length / open.length) * 100),
  };
}
