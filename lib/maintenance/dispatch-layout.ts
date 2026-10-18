/**
 * How each person left the Dispatch board: collapsed columns, added vendor
 * columns, the Unassigned pile, per-column sorts and the week strip. Kept in
 * this browser only (a per-viewer convenience); anything unreadable falls back
 * to the default layout.
 */

import { PILES, type PileKey } from './dispatch';

export type ColSort = 'priority' | 'age' | 'date';
const SORTS: ColSort[] = ['priority', 'age', 'date'];

export interface DispatchLayout {
  collapsed: string[];
  pinned: string[];
  pile: PileKey;
  sorts: Record<string, ColSort>;
  weekOpen: boolean;
}

export const LAYOUT_KEY = 'dispatch-layout:v1';

export const DEFAULT_LAYOUT: DispatchLayout = { collapsed: [], pinned: [], pile: 'all', sorts: {}, weekOpen: true };

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length < 200))].slice(0, 200) : [];

export function parseLayout(raw: string | null): DispatchLayout {
  if (!raw) return DEFAULT_LAYOUT;
  let v: Record<string, unknown>;
  try {
    v = JSON.parse(raw);
  } catch {
    return DEFAULT_LAYOUT;
  }
  if (!v || typeof v !== 'object') return DEFAULT_LAYOUT;
  const sorts: Record<string, ColSort> = {};
  if (v.sorts && typeof v.sorts === 'object') {
    for (const [k, s] of Object.entries(v.sorts as Record<string, unknown>).slice(0, 200)) {
      if (SORTS.includes(s as ColSort)) sorts[k] = s as ColSort;
    }
  }
  return {
    collapsed: strings(v.collapsed),
    pinned: strings(v.pinned),
    pile: PILES.some((p) => p.key === v.pile) ? (v.pile as PileKey) : 'all',
    sorts,
    weekOpen: typeof v.weekOpen === 'boolean' ? v.weekOpen : true,
  };
}

export function loadLayout(): DispatchLayout {
  try {
    return parseLayout(localStorage.getItem(LAYOUT_KEY));
  } catch {
    return DEFAULT_LAYOUT; // Storage blocked (private browsing): start fresh.
  }
}

export function saveLayout(layout: DispatchLayout): void {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // Storage blocked: the layout just isn't remembered.
  }
}

export function clearLayout(): void {
  try {
    localStorage.removeItem(LAYOUT_KEY);
  } catch {
    // ignore
  }
}
