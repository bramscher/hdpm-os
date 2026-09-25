/**
 * Fee Schedule — HDPM's standard (non-management) fees: what we charge now,
 * industry benchmarks, and proposed alternates, flowed through to annual
 * revenue using trailing-12-month volumes. Pure; shared by client + API.
 */

export type FeeBasis = 'flat' | 'pct_month' | 'pct_base';
export const BASIS_LABELS: Record<FeeBasis, string> = {
  flat: '$ flat',
  pct_month: "% of a month's rent",
  pct_base: '% of spend',
};

export type VolumeSource =
  | 'newLeases' | 'renewals' | 'newProperties' | 'newOwners' | 'properties' | 'doors' | 'vendorSpend' | 'manual';
export const VOLUME_LABELS: Record<VolumeSource, string> = {
  newLeases: 'New leases / yr',
  renewals: 'Renewals / yr',
  newProperties: 'New properties / yr',
  newOwners: 'New owners / yr',
  properties: 'Properties',
  doors: 'Doors',
  vendorSpend: 'Vendor $ / yr',
  manual: 'Entered',
};

export interface FeeValue {
  basis: FeeBasis;
  amount: number;
}

export interface FeeLine {
  id: string;
  name: string;
  payer: 'owner' | 'tenant';
  volumeSource: VolumeSource;
  /** Replaces the derived volume when set. */
  volumeOverride: number | null;
  current: FeeValue;
  proposed: FeeValue;
  /** Benchmark text (with source) and a typical value to price it at. */
  industry: string;
  typical: FeeValue | null;
  notes: string;
  custom?: boolean;
}

export type MgmtScenario = 'current' | 'firstRaise' | 'schedule';
export const MGMT_SCENARIO_LABELS: Record<MgmtScenario, string> = {
  current: 'Current rates',
  firstRaise: 'After first raise',
  schedule: 'Full door schedule',
};

export interface FeeScheduleConfig {
  lines: FeeLine[];
  mgmtScenario: MgmtScenario;
}

export interface VolumeContext {
  newLeases: number;
  renewals: number;
  newProperties: number;
  newOwners: number;
  properties: number;
  doors: number;
  vendorSpend: number;
  /** Average monthly market rent per occupied door — prices "% of a month" fees. */
  avgMonthlyRent: number;
}

export const DEFAULT_FEE_SCHEDULE: FeeScheduleConfig = {
  mgmtScenario: 'firstRaise',
  lines: [
    {
      id: 'lease_up',
      name: 'Lease-up / tenant placement',
      payer: 'owner',
      volumeSource: 'newLeases',
      volumeOverride: null,
      current: { basis: 'flat', amount: 300 },
      proposed: { basis: 'flat', amount: 300 },
      industry: "50–100% of first month's rent nationally; Bend commonly 50% of a month or ~$495 flat",
      typical: { basis: 'pct_month', amount: 50 },
      notes: 'AppFolio lease fee policy: 100 properties $300 flat, 21 at $500, 324 set to 0% — confirm what is actually billed.',
    },
    {
      id: 'renewal',
      name: 'Lease renewal',
      payer: 'owner',
      volumeSource: 'renewals',
      volumeOverride: null,
      current: { basis: 'flat', amount: 0 },
      proposed: { basis: 'flat', amount: 0 },
      industry: "$150–$300 or 25–50% of a month's rent; Bend ~$250",
      typical: { basis: 'flat', amount: 250 },
      notes: 'Not stored in AppFolio — enter the current fee.',
    },
    {
      id: 'setup',
      name: 'New owner / property setup',
      payer: 'owner',
      volumeSource: 'newProperties',
      volumeOverride: null,
      current: { basis: 'flat', amount: 0 },
      proposed: { basis: 'flat', amount: 0 },
      industry: '$150–$500 one-time; Bend ~$200',
      typical: { basis: 'flat', amount: 250 },
      notes: 'Charged per new property brought under management. Not stored in AppFolio — enter the current fee.',
    },
    {
      id: 'maintenance_markup',
      name: 'Maintenance coordination markup',
      payer: 'owner',
      volumeSource: 'vendorSpend',
      volumeOverride: null,
      current: { basis: 'pct_base', amount: 0 },
      proposed: { basis: 'pct_base', amount: 0 },
      industry: '5–15% of vendor invoices',
      typical: { basis: 'pct_base', amount: 10 },
      notes: 'Applied to outside-vendor spend only (in-house HDMS work excluded).',
    },
    {
      id: 'annual_accounting',
      name: 'Annual accounting / year-end fee',
      payer: 'owner',
      volumeSource: 'manual',
      volumeOverride: 13,
      current: { basis: 'flat', amount: 0 },
      proposed: { basis: 'flat', amount: 0 },
      industry: '—',
      typical: null,
      notes: 'AppFolio flags "Annual Accounting Fee" on 13 properties. Enter the fee; switch the volume to Properties to price it portfolio-wide.',
    },
    {
      id: 'inspection',
      name: 'Property inspection',
      payer: 'owner',
      volumeSource: 'manual',
      volumeOverride: 0,
      current: { basis: 'flat', amount: 0 },
      proposed: { basis: 'flat', amount: 0 },
      industry: '$75–$200 per visit',
      typical: { basis: 'flat', amount: 100 },
      notes: 'Enter inspections billed per year.',
    },
    {
      id: 'eviction',
      name: 'Eviction coordination',
      payer: 'owner',
      volumeSource: 'manual',
      volumeOverride: 0,
      current: { basis: 'flat', amount: 0 },
      proposed: { basis: 'flat', amount: 0 },
      industry: '$300–$1,000+ plus court costs',
      typical: { basis: 'flat', amount: 500 },
      notes: 'Enter evictions per year.',
    },
    {
      id: 'early_termination',
      name: 'Early management termination',
      payer: 'owner',
      volumeSource: 'manual',
      volumeOverride: 0,
      current: { basis: 'flat', amount: 0 },
      proposed: { basis: 'flat', amount: 0 },
      industry: '1–2 months of management fees, or $99–$499',
      typical: { basis: 'flat', amount: 300 },
      notes: 'Enter owners leaving early per year.',
    },
  ],
};

export function volumeFor(line: FeeLine, ctx: VolumeContext): number {
  if (line.volumeOverride != null) return line.volumeOverride;
  return line.volumeSource === 'manual' ? 0 : ctx[line.volumeSource];
}

/** Annual $ for one fee value at a volume. */
export function annualFor(v: FeeValue | null, volume: number, ctx: VolumeContext): number {
  if (!v) return 0;
  if (v.basis === 'flat') return v.amount * volume;
  if (v.basis === 'pct_month') return (v.amount / 100) * ctx.avgMonthlyRent * volume;
  return (v.amount / 100) * volume; // pct_base: volume is dollars
}

export interface FeeLineResult {
  line: FeeLine;
  volume: number;
  currentYearly: number;
  proposedYearly: number;
  typicalYearly: number | null;
  deltaYearly: number;
}

export interface CashFlow {
  lines: FeeLineResult[];
  mgmt: { currentYearly: number; proposedYearly: number };
  currentYearly: number;
  proposedYearly: number;
  deltaYearly: number;
  deltaPct: number | null;
}

export function computeCashFlow(
  cfg: FeeScheduleConfig,
  ctx: VolumeContext,
  mgmt: Record<MgmtScenario, number>
): CashFlow {
  const lines = cfg.lines.map((line) => {
    const volume = volumeFor(line, ctx);
    const currentYearly = annualFor(line.current, volume, ctx);
    const proposedYearly = annualFor(line.proposed, volume, ctx);
    return {
      line,
      volume,
      currentYearly,
      proposedYearly,
      typicalYearly: line.typical ? annualFor(line.typical, volume, ctx) : null,
      deltaYearly: proposedYearly - currentYearly,
    };
  });
  const m = { currentYearly: mgmt.current, proposedYearly: mgmt[cfg.mgmtScenario] };
  const currentYearly = m.currentYearly + lines.reduce((a, l) => a + l.currentYearly, 0);
  const proposedYearly = m.proposedYearly + lines.reduce((a, l) => a + l.proposedYearly, 0);
  return {
    lines,
    mgmt: m,
    currentYearly,
    proposedYearly,
    deltaYearly: proposedYearly - currentYearly,
    deltaPct: currentYearly ? ((proposedYearly - currentYearly) / currentYearly) * 100 : null,
  };
}

// ── Validation ────────────────────────────────────────────

const BASES: FeeBasis[] = ['flat', 'pct_month', 'pct_base'];
const SOURCES = Object.keys(VOLUME_LABELS) as VolumeSource[];
const SCENARIOS = Object.keys(MGMT_SCENARIO_LABELS) as MgmtScenario[];

function parseValue(v: unknown): FeeValue | null {
  const o = v as Record<string, unknown> | null;
  const amount = Number(o?.amount);
  if (!o || !BASES.includes(o.basis as FeeBasis) || !Number.isFinite(amount) || amount < 0) return null;
  if (o.basis !== 'flat' && amount > 1000) return null;
  if (o.basis === 'flat' && amount > 1_000_000) return null;
  return { basis: o.basis as FeeBasis, amount: Math.round(amount * 100) / 100 };
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

export function parseFeeSchedule(v: unknown): FeeScheduleConfig | null {
  const o = v as Record<string, unknown> | null;
  if (!o || !Array.isArray(o.lines) || o.lines.length > 50) return null;
  if (!SCENARIOS.includes(o.mgmtScenario as MgmtScenario)) return null;
  const lines: FeeLine[] = [];
  const ids = new Set<string>();
  for (const raw of o.lines as Record<string, unknown>[]) {
    const id = text(raw?.id, 64);
    const name = text(raw?.name, 120).trim();
    const current = parseValue(raw?.current);
    const proposed = parseValue(raw?.proposed);
    const typical = raw?.typical == null ? null : parseValue(raw.typical);
    const override = raw?.volumeOverride == null || raw.volumeOverride === '' ? null : Number(raw.volumeOverride);
    if (!id || ids.has(id) || !name || !current || !proposed) return null;
    if (raw?.typical != null && !typical) return null;
    if (!SOURCES.includes(raw?.volumeSource as VolumeSource)) return null;
    if (raw?.payer !== 'owner' && raw?.payer !== 'tenant') return null;
    if (override != null && (!Number.isFinite(override) || override < 0 || override > 100_000_000)) return null;
    ids.add(id);
    lines.push({
      id,
      name,
      payer: raw.payer as FeeLine['payer'],
      volumeSource: raw.volumeSource as VolumeSource,
      volumeOverride: override,
      current,
      proposed,
      industry: text(raw.industry, 300),
      typical,
      notes: text(raw.notes, 1000),
      ...(raw.custom ? { custom: true } : {}),
    });
  }
  return { lines, mgmtScenario: o.mgmtScenario as MgmtScenario };
}
