/**
 * Owner growth (Phase 0) settings: the one place to tune the goal and the
 * stage weights. Pages and math read from here; nothing else hard-codes them.
 */

export const GROWTH_SETTINGS = {
  /** Net doors to add over the goal period. */
  targetNetDoors: 150,
  /** Day the goal starts (YYYY-MM-DD). Baseline doors = the KPI on/after this day. */
  startDate: '2026-11-06',
  /** Length of the goal in months (150 over 12 = 12.5 a month). */
  months: 12,
  /** Yearly owner churn we want to stay under, as a percent. */
  churnTargetPct: 10,
} as const;

/** Owner pipeline stages, in board order. Keys match the website's lead status values. */
export const BOARD_STAGES = [
  { key: 'new', label: 'New' },
  { key: 'attempted_contact', label: 'Attempted contact' },
  { key: 'engaged', label: 'Engaged' },
  { key: 'consult_booked', label: 'Consult booked' },
  { key: 'proposal_sent', label: 'Proposal sent' },
  { key: 'signed', label: 'Signed' },
  { key: 'lost', label: 'Lost' },
] as const;

export type BoardStage = (typeof BOARD_STAGES)[number]['key'];

export const STAGE_LABELS: Record<string, string> = Object.fromEntries(BOARD_STAGES.map((s) => [s.key, s.label]));

/**
 * Chance a lead in each stage becomes signed doors. Weighted pipeline doors =
 * expected doors × weight. Tune these here.
 */
export const STAGE_WEIGHTS: Record<BoardStage, number> = {
  new: 0.05,
  attempted_contact: 0.1,
  engaged: 0.25,
  consult_booked: 0.4,
  proposal_sent: 0.6,
  signed: 1,
  lost: 0,
};

export function isBoardStage(v: unknown): v is BoardStage {
  return typeof v === 'string' && BOARD_STAGES.some((s) => s.key === v);
}
