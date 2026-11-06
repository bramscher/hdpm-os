/**
 * Pipeline board data shaping. Pure functions: no I/O, unit-tested.
 */
import { BOARD_STAGES, type BoardStage } from './config';
import { SOURCE_LABELS, type BoardLead } from './lead-api';

const DAY_MS = 86_400_000;

/** Whole days a lead has sat in its current stage (never negative). */
export function daysInStage(lead: Pick<BoardLead, 'statusEnteredAt'>, now: Date = new Date()): number {
  const entered = new Date(lead.statusEnteredAt).getTime();
  if (!Number.isFinite(entered)) return 0;
  return Math.max(0, Math.floor((now.getTime() - entered) / DAY_MS));
}

/** What the card shows as the lead's source: the partner/detail when there is one. */
export function sourceLabel(lead: Pick<BoardLead, 'source' | 'sourceDetail'>): string {
  const base = lead.source ? SOURCE_LABELS[lead.source] ?? lead.source : 'Unknown';
  return lead.sourceDetail ? `${base} · ${lead.sourceDetail}` : base;
}

export interface BoardFilters {
  source?: string;
  /** User id as a string, or 'unassigned'. */
  assignee?: string;
  town?: string;
}

export function filterLeads(leads: BoardLead[], f: BoardFilters): BoardLead[] {
  return leads.filter((l) => {
    if (f.source && (l.source ?? '') !== f.source) return false;
    if (f.assignee) {
      if (f.assignee === 'unassigned') {
        if (l.assignedTo) return false;
      } else if (String(l.assignedTo?.id ?? '') !== f.assignee) return false;
    }
    if (f.town && (l.town ?? '') !== f.town) return false;
    return true;
  });
}

/** Distinct values present in the leads, for the filter dropdowns. */
export function filterOptions(leads: BoardLead[]) {
  const sources = new Set<string>();
  const towns = new Set<string>();
  const assignees = new Map<number, string>();
  for (const l of leads) {
    if (l.source) sources.add(l.source);
    if (l.town) towns.add(l.town);
    if (l.assignedTo) assignees.set(l.assignedTo.id, l.assignedTo.name);
  }
  return {
    sources: [...sources].sort(),
    towns: [...towns].sort(),
    assignees: [...assignees].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export interface BoardColumn {
  key: BoardStage;
  label: string;
  leads: BoardLead[];
  count: number;
  /** Sum of expected doors (leads without a number count as 0). */
  doors: number;
}

/**
 * Group leads into the board's columns, in stage order. Within a column the
 * lead that has waited longest comes first. Leads in other statuses are dropped.
 */
export function buildColumns(leads: BoardLead[]): BoardColumn[] {
  return BOARD_STAGES.map(({ key, label }) => {
    const inStage = leads
      .filter((l) => l.status === key)
      .sort((a, b) => a.statusEnteredAt.localeCompare(b.statusEnteredAt) || a.id - b.id);
    return {
      key,
      label,
      leads: inStage,
      count: inStage.length,
      doors: inStage.reduce((s, l) => s + (l.expectedDoors ?? 0), 0),
    };
  });
}

/**
 * Can this lead be dropped on that stage? Same stage is a no-op; otherwise the
 * website's allowedStatuses decides. (The website still checks on PATCH.)
 */
export function canMove(lead: Pick<BoardLead, 'status' | 'allowedStatuses'>, to: string): boolean {
  return to !== lead.status && lead.allowedStatuses.includes(to);
}

/** Replace one lead in the list (after a PATCH returns the updated lead). */
export function replaceLead(leads: BoardLead[], updated: BoardLead): BoardLead[] {
  return leads.map((l) => (l.id === updated.id ? updated : l));
}
