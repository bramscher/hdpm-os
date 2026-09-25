/**
 * Fee Management — owner-level fee opportunity model (pure, client + server).
 *
 * AppFolio gives property facts (fee %, doors, occupied market rent) and the
 * current owner group per property. Rows roll up by OWNER SET — the exact set
 * of owners on a property's current owner group — so co-owned properties are
 * one conversation and dollars never double count.
 *
 * All $ are estimates on occupied-unit market rent (actual lease rents are
 * not on the v0 API), matching the Fee Index.
 */

// ── Inputs ────────────────────────────────────────────────

export interface PropertyFact {
  id: string;
  name: string;
  address: string;
  feeType: 'percent' | 'flat' | 'none';
  feePct: number | null;
  flatMonthly: number | null;
  /** CurrentManagementFeePolicy.StartDate — when the current fee took effect. */
  feeStartDate: string | null;
  mgmtStartDate: string | null;
  doors: number;
  occupiedDoors: number;
  /** Σ market rent of occupied revenue units, per month. */
  occupiedRentMonthly: number;
  ownerSetKey: string;
}

export interface OwnerContact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  percentOwned: number | null;
}

export interface OwnerSet {
  key: string;
  name: string;
  owners: OwnerContact[];
}

export interface FeeFacts {
  properties: PropertyFact[];
  ownerSets: OwnerSet[];
}

export interface TierRule {
  min: number;
  /** Exclusive upper bound; null = open-ended (e.g. 10%+). */
  max: number | null;
  addPts: number;
}

export interface PriorityWeights {
  addedDollars: number;
  renewalUrgency: number;
  feeGap: number;
}

export interface Agreement {
  propertyId: string;
  startDate: string | null;
  endDate: string | null;
  autoRenew: boolean;
  noticeDays: number | null;
  notes: string | null;
}

export const CAMPAIGN_STATUSES = ['not_contacted', 'contacted', 'accepted', 'declined', 'at_risk'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export const STATUS_LABELS: Record<CampaignStatus, string> = {
  not_contacted: 'Not contacted',
  contacted: 'Contacted',
  accepted: 'Accepted',
  declined: 'Declined',
  at_risk: 'At risk',
};

export interface CampaignEntry {
  ownerSetKey: string;
  status: CampaignStatus;
  newFeePct: number | null;
  effectiveDate: string | null;
  assignedTo: string | null;
  notes: string | null;
  updatedAt: string | null;
}

export const DEFAULT_TIER_RULES: TierRule[] = [
  { min: 5, max: 6, addPts: 1.5 },
  { min: 6, max: 7, addPts: 1.0 },
  { min: 7, max: 8, addPts: 0.75 },
  { min: 8, max: 9, addPts: 0.5 },
  { min: 9, max: 10, addPts: 0.25 },
  { min: 10, max: null, addPts: 0 },
];

export const DEFAULT_WEIGHTS: PriorityWeights = { addedDollars: 0.6, renewalUrgency: 0.25, feeGap: 0.15 };

export const RENEWAL_WINDOW_DAYS = 180;
export const PERSONAL_CALL_TOP_N = 20;

// ── Helpers ───────────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100;

export function ruleFor(pct: number, rules: TierRule[]): TierRule | null {
  return rules.find((r) => pct >= r.min && (r.max == null || pct < r.max)) ?? null;
}

export function targetPctFor(pct: number, rules: TierRule[]): number {
  return round2(pct + (ruleFor(pct, rules)?.addPts ?? 0));
}

export function tierLabel(rule: TierRule): string {
  if (rule.max == null) return `${rule.min}%+`;
  return `${rule.min}–${round2(rule.max - 0.01)}%`;
}

/** ISO yyyy-mm-dd → UTC epoch days; dates here are calendar dates, not instants. */
function toDay(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

function fromDay(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

function addYears(iso: string, years: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  // Feb 29 anniversaries fall on Feb 28 in non-leap years.
  const last = new Date(Date.UTC(y + years, m, 0)).getUTCDate();
  return fromDay(Math.floor(Date.UTC(y + years, m - 1, Math.min(d, last)) / 86_400_000));
}

export interface Renewal {
  date: string;
  /** 'entered' = staff-entered end date; 'projected' = yearly auto-renew from start. */
  source: 'entered' | 'projected';
  daysUntil: number;
  /** Last day to give notice, when a notice period is on file. */
  noticeBy: string | null;
}

/**
 * Next agreement end on or after `today`. Agreements are 1-year terms that
 * auto-renew unless HDPM issues a new one, so a past end date rolls forward
 * a year at a time (unless auto-renew is off, then it stays in the past).
 */
export function nextRenewal(
  mgmtStartDate: string | null,
  agreement: Agreement | undefined,
  today: string
): Renewal | null {
  const t = toDay(today);
  let date: string | null = null;
  let source: Renewal['source'] = 'projected';

  if (agreement?.endDate) {
    source = 'entered';
    date = agreement.endDate;
    if (agreement.autoRenew) {
      for (let i = 1; toDay(date) < t && i <= 100; i++) date = addYears(agreement.endDate, i);
    }
  } else {
    const start = agreement?.startDate ?? mgmtStartDate;
    if (!start) return null;
    date = addYears(start, 1);
    for (let i = 2; toDay(date) < t && i <= 100; i++) date = addYears(start, i);
  }

  const notice = agreement?.noticeDays;
  return {
    date,
    source,
    daysUntil: toDay(date) - t,
    noticeBy: notice != null ? fromDay(toDay(date) - notice) : null,
  };
}

// ── Rollup ────────────────────────────────────────────────

export type Segment = 'Personal call' | 'Letter' | 'Renewal-timed';

export interface OwnerPropertyRow {
  property: PropertyFact;
  targetPct: number | null;
  addedYearly: number;
  renewal: Renewal | null;
  agreement: Agreement | undefined;
}

export interface OwnerRow {
  key: string;
  name: string;
  owners: OwnerContact[];
  properties: OwnerPropertyRow[];
  propertyCount: number;
  doors: number;
  occupiedDoors: number;
  /** Annual occupied market rent on %-fee properties — the base fees apply to. */
  rentBaseYearly: number;
  /** Rent-weighted blended fee %; door-weighted when no %-fee door is occupied. */
  blendedPct: number | null;
  blendedBasis: 'rent' | 'doors' | null;
  targetPct: number | null;
  gapPts: number | null;
  currentFeesMonthly: number;
  addedMonthly: number;
  addedYearly: number;
  tier: string;
  earliestRenewal: Renewal | null;
  lastFeeChange: string | null;
  priority: number;
  segments: Segment[];
  campaign: CampaignEntry;
}

export interface RollupInput {
  facts: FeeFacts;
  rules: TierRule[];
  weights: PriorityWeights;
  agreements: Agreement[];
  campaign: CampaignEntry[];
  today: string;
}

function emptyCampaign(key: string): CampaignEntry {
  return { ownerSetKey: key, status: 'not_contacted', newFeePct: null, effectiveDate: null, assignedTo: null, notes: null, updatedAt: null };
}

export function buildOwnerRows(input: RollupInput): OwnerRow[] {
  const { facts, rules, weights, today } = input;
  const agreementById = new Map(input.agreements.map((a) => [a.propertyId, a]));
  const campaignByKey = new Map(input.campaign.map((c) => [c.ownerSetKey, c]));
  const propsBySet = new Map<string, PropertyFact[]>();
  for (const p of facts.properties) {
    const list = propsBySet.get(p.ownerSetKey) ?? [];
    list.push(p);
    propsBySet.set(p.ownerSetKey, list);
  }

  const rows: OwnerRow[] = [];
  for (const set of facts.ownerSets) {
    const props = propsBySet.get(set.key);
    if (!props?.length) continue;

    let rentBase = 0;
    let currentPct = 0; // Σ rent × pct (annual $ at current %)
    let targetPctFees = 0; // Σ rent × target
    let flatMonthly = 0;
    let doorPctSum = 0;
    let doorTargetSum = 0;
    let pctDoors = 0;
    let earliest: Renewal | null = null;
    let lastFeeChange: string | null = null;
    const propRows: OwnerPropertyRow[] = [];

    for (const p of props) {
      const agreement = agreementById.get(p.id);
      const renewal = nextRenewal(agreement?.startDate ?? p.mgmtStartDate, agreement, today);
      if (renewal && (!earliest || renewal.daysUntil < earliest.daysUntil)) earliest = renewal;
      if (p.feeStartDate && (!lastFeeChange || p.feeStartDate > lastFeeChange)) lastFeeChange = p.feeStartDate;

      if (p.feeType === 'percent' && p.feePct != null) {
        const target = targetPctFor(p.feePct, rules);
        const rb = p.occupiedRentMonthly * 12;
        rentBase += rb;
        currentPct += (rb * p.feePct) / 100;
        targetPctFees += (rb * target) / 100;
        doorPctSum += p.feePct * p.doors;
        doorTargetSum += target * p.doors;
        pctDoors += p.doors;
        propRows.push({ property: p, targetPct: target, addedYearly: (rb * (target - p.feePct)) / 100, renewal, agreement });
      } else {
        if (p.feeType === 'flat') flatMonthly += p.flatMonthly ?? 0;
        propRows.push({ property: p, targetPct: null, addedYearly: 0, renewal, agreement });
      }
    }

    let blendedPct: number | null = null;
    let targetPct: number | null = null;
    let blendedBasis: OwnerRow['blendedBasis'] = null;
    if (rentBase > 0) {
      blendedPct = (currentPct / rentBase) * 100;
      targetPct = (targetPctFees / rentBase) * 100;
      blendedBasis = 'rent';
    } else if (pctDoors > 0) {
      blendedPct = doorPctSum / pctDoors;
      targetPct = doorTargetSum / pctDoors;
      blendedBasis = 'doors';
    }

    const addedYearly = targetPctFees - currentPct;
    const rule = blendedPct != null ? ruleFor(blendedPct, rules) : null;
    rows.push({
      key: set.key,
      name: set.name,
      owners: set.owners,
      properties: propRows.sort((a, b) => b.addedYearly - a.addedYearly),
      propertyCount: props.length,
      doors: props.reduce((a, p) => a + p.doors, 0),
      occupiedDoors: props.reduce((a, p) => a + p.occupiedDoors, 0),
      rentBaseYearly: rentBase,
      blendedPct: blendedPct != null ? round2(blendedPct) : null,
      blendedBasis,
      targetPct: targetPct != null ? round2(targetPct) : null,
      gapPts: blendedPct != null && targetPct != null ? round2(targetPct - blendedPct) : null,
      currentFeesMonthly: currentPct / 12 + flatMonthly,
      addedMonthly: addedYearly / 12,
      addedYearly,
      tier: blendedPct == null ? (flatMonthly > 0 ? 'Flat' : 'No policy') : rule ? tierLabel(rule) : 'Other',
      earliestRenewal: earliest,
      lastFeeChange,
      priority: 0,
      segments: [],
      campaign: campaignByKey.get(set.key) ?? emptyCampaign(set.key),
    });
  }

  scorePriority(rows, weights);
  assignSegments(rows);
  return rows.sort((a, b) => b.priority - a.priority || b.addedYearly - a.addedYearly);
}

/**
 * 0–100. Each component is normalized to 0–1 across the portfolio:
 * added $/yr ÷ max, renewal urgency = 1 − days/365 (sooner = higher; none =
 * 0), fee gap ÷ max. Weighted by the config weights.
 */
export function scorePriority(rows: OwnerRow[], w: PriorityWeights): void {
  const maxAdded = Math.max(0, ...rows.map((r) => r.addedYearly));
  const maxGap = Math.max(0, ...rows.map((r) => r.gapPts ?? 0));
  const total = w.addedDollars + w.renewalUrgency + w.feeGap || 1;
  for (const r of rows) {
    const added = maxAdded > 0 ? Math.max(0, r.addedYearly) / maxAdded : 0;
    const days = r.earliestRenewal?.daysUntil;
    const urgency = days == null ? 0 : 1 - Math.min(Math.max(days, 0), 365) / 365;
    const gap = maxGap > 0 ? Math.max(0, r.gapPts ?? 0) / maxGap : 0;
    r.priority = Math.round((100 * (w.addedDollars * added + w.renewalUrgency * urgency + w.feeGap * gap)) / total);
  }
}

/** Segments can stack: a 3-door owner renewing in 60 days is both. */
export function assignSegments(rows: OwnerRow[]): void {
  const top = new Set(
    [...rows]
      .filter((r) => r.addedYearly > 0)
      .sort((a, b) => b.addedYearly - a.addedYearly)
      .slice(0, PERSONAL_CALL_TOP_N)
      .map((r) => r.key)
  );
  for (const r of rows) {
    const s: Segment[] = [];
    const personal = r.doors >= 3 || top.has(r.key);
    if (personal) s.push('Personal call');
    else if (r.doors === 1) s.push('Letter');
    if (r.earliestRenewal && r.earliestRenewal.daysUntil <= RENEWAL_WINDOW_DAYS) s.push('Renewal-timed');
    r.segments = s;
  }
}

// ── Summaries ─────────────────────────────────────────────

export interface PortfolioSummary {
  rentBaseYearly: number;
  currentPctFeesYearly: number;
  currentEffectivePct: number | null;
  addedYearly: number;
  addedMonthly: number;
  newEffectivePct: number | null;
  ownersWithUpside: number;
}

export function portfolioSummary(rows: OwnerRow[]): PortfolioSummary {
  const rentBase = rows.reduce((a, r) => a + r.rentBaseYearly, 0);
  const current = rows.reduce((a, r) => a + ((r.blendedBasis === 'rent' ? r.blendedPct ?? 0 : 0) * r.rentBaseYearly) / 100, 0);
  const added = rows.reduce((a, r) => a + r.addedYearly, 0);
  return {
    rentBaseYearly: rentBase,
    currentPctFeesYearly: current,
    currentEffectivePct: rentBase ? round2((current / rentBase) * 100) : null,
    addedYearly: added,
    addedMonthly: added / 12,
    newEffectivePct: rentBase ? round2(((current + added) / rentBase) * 100) : null,
    ownersWithUpside: rows.filter((r) => r.addedYearly > 0).length,
  };
}

/**
 * $/yr an owner row represents in the funnel: accepted rows with a new fee on
 * file use that fee; everything else uses the tier-target upside.
 */
export function campaignDollars(r: OwnerRow): number {
  const c = r.campaign;
  if (c.status === 'accepted' && c.newFeePct != null && r.blendedPct != null) {
    const base = r.blendedBasis === 'rent' ? r.rentBaseYearly : 0;
    return (base * (c.newFeePct - r.blendedPct)) / 100;
  }
  return r.addedYearly;
}

export function campaignFunnel(rows: OwnerRow[]): { status: CampaignStatus; count: number; dollarsYearly: number }[] {
  return CAMPAIGN_STATUSES.map((status) => {
    const inStatus = rows.filter((r) => r.campaign.status === status);
    return { status, count: inStatus.length, dollarsYearly: inStatus.reduce((a, r) => a + campaignDollars(r), 0) };
  });
}

// ── CSV ───────────────────────────────────────────────────

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function ownerRowsToCsv(rows: OwnerRow[]): string {
  const header = [
    'Owner', 'Emails', 'Phones', 'Properties', 'Doors', 'Occupied doors', 'Blended fee %', 'Blended basis',
    'Est. fees / mo', 'Target fee %', 'Gap (pts)', 'Added / mo', 'Added / yr', 'Tier',
    'Earliest agreement end', 'End date source', 'Days until', 'Notice by', 'Last fee change',
    'Priority', 'Segments', 'Status', 'New fee %', 'Effective date', 'Assigned to', 'Notes',
  ];
  const lines = rows.map((r) =>
    [
      r.name,
      r.owners.map((o) => o.email).filter(Boolean).join('; '),
      r.owners.map((o) => o.phone).filter(Boolean).join('; '),
      r.propertyCount, r.doors, r.occupiedDoors,
      r.blendedPct ?? '', r.blendedBasis ?? '',
      Math.round(r.currentFeesMonthly), r.targetPct ?? '', r.gapPts ?? '',
      Math.round(r.addedMonthly), Math.round(r.addedYearly), r.tier,
      r.earliestRenewal?.date ?? '', r.earliestRenewal?.source ?? '', r.earliestRenewal?.daysUntil ?? '',
      r.earliestRenewal?.noticeBy ?? '', r.lastFeeChange ?? '',
      r.priority, r.segments.join('; '),
      STATUS_LABELS[r.campaign.status], r.campaign.newFeePct ?? '', r.campaign.effectiveDate ?? '',
      r.campaign.assignedTo ?? '', r.campaign.notes ?? '',
    ].map(csvCell).join(',')
  );
  return [header.join(','), ...lines].join('\n');
}

// ── Validation (API write paths) ──────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v: unknown): v is string => typeof v === 'string' && ISO_DATE.test(v) && !Number.isNaN(Date.parse(v));
const optDate = (v: unknown) => (v == null || v === '' ? null : isDate(v) ? v : undefined);
const optText = (v: unknown, max = 2000) =>
  v == null || v === '' ? null : typeof v === 'string' && v.length <= max ? v.trim() : undefined;

export function parseTierRules(v: unknown): TierRule[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > 20) return null;
  const out: TierRule[] = [];
  for (const r of v) {
    const min = Number(r?.min);
    const max = r?.max == null || r?.max === '' ? null : Number(r.max);
    const addPts = Number(r?.addPts);
    if (!Number.isFinite(min) || min < 0 || min > 100) return null;
    if (max != null && (!Number.isFinite(max) || max <= min || max > 100)) return null;
    if (!Number.isFinite(addPts) || addPts < 0 || addPts > 10) return null;
    out.push({ min, max, addPts });
  }
  out.sort((a, b) => a.min - b.min);
  for (let i = 1; i < out.length; i++) {
    const prevMax = out[i - 1].max;
    if (prevMax == null || prevMax > out[i].min) return null; // overlapping ranges
  }
  return out;
}

export function parseWeights(v: unknown): PriorityWeights | null {
  const o = v as Record<string, unknown> | null;
  const w = { addedDollars: Number(o?.addedDollars), renewalUrgency: Number(o?.renewalUrgency), feeGap: Number(o?.feeGap) };
  if (!Object.values(w).every((n) => Number.isFinite(n) && n >= 0 && n <= 100)) return null;
  if (w.addedDollars + w.renewalUrgency + w.feeGap <= 0) return null;
  return w;
}

export function parseAgreement(v: unknown): Agreement | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o.propertyId !== 'string' || !o.propertyId || o.propertyId.length > 64) return null;
  const startDate = optDate(o.startDate);
  const endDate = optDate(o.endDate);
  const notes = optText(o.notes);
  const noticeDays = o.noticeDays == null || o.noticeDays === '' ? null : Number(o.noticeDays);
  if (startDate === undefined || endDate === undefined || notes === undefined) return null;
  if (noticeDays != null && (!Number.isInteger(noticeDays) || noticeDays < 0 || noticeDays > 365)) return null;
  if (startDate && endDate && endDate < startDate) return null;
  return { propertyId: o.propertyId, startDate, endDate, autoRenew: o.autoRenew !== false, noticeDays, notes };
}

export function parseCampaign(v: unknown): (Omit<CampaignEntry, 'updatedAt'> & { ownerName: string | null }) | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o.ownerSetKey !== 'string' || !o.ownerSetKey || o.ownerSetKey.length > 1000) return null;
  if (!CAMPAIGN_STATUSES.includes(o.status as CampaignStatus)) return null;
  const effectiveDate = optDate(o.effectiveDate);
  const assignedTo = optText(o.assignedTo, 200);
  const notes = optText(o.notes);
  const ownerName = optText(o.ownerName, 500);
  const newFeePct = o.newFeePct == null || o.newFeePct === '' ? null : Number(o.newFeePct);
  if (effectiveDate === undefined || assignedTo === undefined || notes === undefined || ownerName === undefined) return null;
  if (newFeePct != null && (!Number.isFinite(newFeePct) || newFeePct < 0 || newFeePct > 100)) return null;
  return {
    ownerSetKey: o.ownerSetKey,
    ownerName,
    status: o.status as CampaignStatus,
    newFeePct: newFeePct != null ? round2(newFeePct) : null,
    effectiveDate,
    assignedTo,
    notes,
  };
}
