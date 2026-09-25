/**
 * Fee Management — owner-level fee opportunity model (pure, client + server).
 *
 * AppFolio gives property facts (fee %, doors, occupied market rent) and the
 * current owner group per property. Rows roll up by OWNER SET — the exact set
 * of owners on a property's current owner group — so co-owned properties are
 * one conversation and dollars never double count.
 *
 * Targets come from the DOOR SCHEDULE: the fair rate for an owner's size
 * (total doors across their properties), which is also the rule for new
 * business. Existing clients move toward it in capped steps (max pts per
 * raise), and fees are never lowered for owners already above schedule.
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

export interface DoorBand {
  minDoors: number;
  /** Inclusive upper bound; null = open-ended (e.g. 50+). */
  maxDoors: number | null;
  targetPct: number;
  /** Target is a starting point only — the portfolio gets a manual review. */
  review?: boolean;
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

export const DEFAULT_DOOR_SCHEDULE: DoorBand[] = [
  { minDoors: 1, maxDoors: 1, targetPct: 10 },
  { minDoors: 2, maxDoors: 3, targetPct: 9.5 },
  { minDoors: 4, maxDoors: 10, targetPct: 9 },
  { minDoors: 11, maxDoors: 15, targetPct: 8.5 },
  { minDoors: 16, maxDoors: 25, targetPct: 8 },
  { minDoors: 26, maxDoors: 49, targetPct: 7.5 },
  { minDoors: 50, maxDoors: null, targetPct: 7, review: true },
];

/** Largest single raise for an existing client (5.5% → 7% = two raises). */
export const DEFAULT_MAX_RAISE_PTS = 0.75;

export const DEFAULT_WEIGHTS: PriorityWeights = { addedDollars: 0.6, renewalUrgency: 0.25, feeGap: 0.15 };

export const RENEWAL_WINDOW_DAYS = 180;
export const PERSONAL_CALL_TOP_N = 20;

// ── Helpers ───────────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100;

export function bandFor(doors: number, schedule: DoorBand[]): DoorBand | null {
  return schedule.find((b) => doors >= b.minDoors && (b.maxDoors == null || doors <= b.maxDoors)) ?? null;
}

export function bandLabel(b: DoorBand): string {
  const doors = b.maxDoors == null ? `${b.minDoors}+` : b.minDoors === b.maxDoors ? `${b.minDoors}` : `${b.minDoors}–${b.maxDoors}`;
  return `${doors} door${b.maxDoors === 1 && b.minDoors === 1 ? '' : 's'} · ${b.targetPct}%`;
}

/** Next capped step toward the schedule; never lowers a fee. */
export function nextRaisePct(currentPct: number, targetPct: number, maxRaisePts: number): number {
  if (currentPct >= targetPct) return currentPct;
  return round2(Math.min(targetPct, currentPct + maxRaisePts));
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

export type Segment = 'Personal call' | 'Letter' | 'Renewal-timed' | 'Portfolio review';

export interface OwnerPropertyRow {
  property: PropertyFact;
  targetPct: number | null;
  nextRaisePct: number | null;
  /** $/yr to reach the full schedule rate (0 if already at or above). */
  addedYearly: number;
  nextRaiseYearly: number;
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
  /** Door-schedule rate for this owner's size. */
  targetPct: number | null;
  /** Points below schedule (0 when at or above — fees are never lowered). */
  gapPts: number | null;
  currentFeesMonthly: number;
  addedMonthly: number;
  addedYearly: number;
  /** Rent-weighted blended rate after one capped raise. */
  nextRaisePct: number | null;
  nextRaiseYearly: number;
  /** Raises needed to reach schedule at the cap (0 = already there). */
  raisesToTarget: number;
  band: DoorBand | null;
  bandLabel: string;
  /** 0–100 $ opportunity grade: √(added ÷ largest added) — 0 = at schedule. */
  grade: number;
  earliestRenewal: Renewal | null;
  lastFeeChange: string | null;
  priority: number;
  segments: Segment[];
  campaign: CampaignEntry;
}

export interface RollupInput {
  facts: FeeFacts;
  schedule: DoorBand[];
  maxRaisePts: number;
  weights: PriorityWeights;
  agreements: Agreement[];
  campaign: CampaignEntry[];
  today: string;
}

function emptyCampaign(key: string): CampaignEntry {
  return { ownerSetKey: key, status: 'not_contacted', newFeePct: null, effectiveDate: null, assignedTo: null, notes: null, updatedAt: null };
}

export function buildOwnerRows(input: RollupInput): OwnerRow[] {
  const { facts, schedule, maxRaisePts, weights, today } = input;
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

    const doors = props.reduce((a, p) => a + p.doors, 0);
    const band = bandFor(doors, schedule);
    let rentBase = 0;
    let currentPct = 0; // Σ rent × pct (annual $ at current %)
    let added = 0; // Σ rent × max(0, schedule − pct)
    let nextAdded = 0; // Σ rent × (next capped step − pct)
    let maxGap = 0;
    let flatMonthly = 0;
    let doorPctSum = 0;
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
        const target = band?.targetPct ?? p.feePct;
        const next = nextRaisePct(p.feePct, target, maxRaisePts);
        const rb = p.occupiedRentMonthly * 12;
        const propAdded = (rb * Math.max(0, target - p.feePct)) / 100;
        const propNext = (rb * (next - p.feePct)) / 100;
        rentBase += rb;
        currentPct += (rb * p.feePct) / 100;
        added += propAdded;
        nextAdded += propNext;
        maxGap = Math.max(maxGap, target - p.feePct);
        doorPctSum += p.feePct * p.doors;
        pctDoors += p.doors;
        propRows.push({ property: p, targetPct: band ? target : null, nextRaisePct: next, addedYearly: propAdded, nextRaiseYearly: propNext, renewal, agreement });
      } else {
        if (p.feeType === 'flat') flatMonthly += p.flatMonthly ?? 0;
        propRows.push({ property: p, targetPct: null, nextRaisePct: null, addedYearly: 0, nextRaiseYearly: 0, renewal, agreement });
      }
    }

    let blendedPct: number | null = null;
    let blendedBasis: OwnerRow['blendedBasis'] = null;
    if (rentBase > 0) {
      blendedPct = (currentPct / rentBase) * 100;
      blendedBasis = 'rent';
    } else if (pctDoors > 0) {
      blendedPct = doorPctSum / pctDoors;
      blendedBasis = 'doors';
    }
    const targetPct = blendedPct != null && band ? band.targetPct : null;
    const next = rentBase > 0 ? ((currentPct + nextAdded) / rentBase) * 100 : blendedPct;

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
      targetPct,
      gapPts: blendedPct != null && targetPct != null ? round2(Math.max(0, targetPct - blendedPct)) : null,
      currentFeesMonthly: currentPct / 12 + flatMonthly,
      addedMonthly: added / 12,
      addedYearly: added,
      nextRaisePct: next != null ? round2(next) : null,
      nextRaiseYearly: nextAdded,
      raisesToTarget: maxGap > 0 && maxRaisePts > 0 ? Math.ceil(round2(maxGap / maxRaisePts)) : 0,
      band,
      bandLabel: blendedPct == null ? (flatMonthly > 0 ? 'Flat fee' : 'No fee policy') : band ? bandLabel(band) : 'Unbanded',
      grade: 0,
      earliestRenewal: earliest,
      lastFeeChange,
      priority: 0,
      segments: [],
      campaign: campaignByKey.get(set.key) ?? emptyCampaign(set.key),
    });
  }

  gradeOpportunity(rows);
  scorePriority(rows, weights);
  assignSegments(rows);
  return rows.sort((a, b) => b.grade - a.grade || b.addedYearly - a.addedYearly);
}

/**
 * 0–100 $ opportunity grade. 0 = at or above schedule; 100 = the largest
 * $/yr gap in the portfolio. Square-root curve: dollars are heavily skewed
 * (a few $10k+ owners, median ~$600), so a straight ratio would leave nearly
 * everyone at 0–10; √ keeps the big ones on top and still separates the
 * middle. Any owner with upside grades at least 1.
 */
export function gradeOpportunity(rows: OwnerRow[]): void {
  const max = Math.max(0, ...rows.map((r) => r.addedYearly));
  for (const r of rows) {
    r.grade = max > 0 && r.addedYearly > 0 ? Math.max(1, Math.round(100 * Math.sqrt(r.addedYearly / max))) : 0;
  }
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
    if (r.band?.review) s.push('Portfolio review');
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
  nextRaiseYearly: number;
  nextRaiseEffectivePct: number | null;
  ownersWithUpside: number;
}

export function portfolioSummary(rows: OwnerRow[]): PortfolioSummary {
  const rentBase = rows.reduce((a, r) => a + r.rentBaseYearly, 0);
  const current = rows.reduce((a, r) => a + ((r.blendedBasis === 'rent' ? r.blendedPct ?? 0 : 0) * r.rentBaseYearly) / 100, 0);
  const added = rows.reduce((a, r) => a + r.addedYearly, 0);
  const next = rows.reduce((a, r) => a + r.nextRaiseYearly, 0);
  return {
    rentBaseYearly: rentBase,
    currentPctFeesYearly: current,
    currentEffectivePct: rentBase ? round2((current / rentBase) * 100) : null,
    addedYearly: added,
    addedMonthly: added / 12,
    newEffectivePct: rentBase ? round2(((current + added) / rentBase) * 100) : null,
    nextRaiseYearly: next,
    nextRaiseEffectivePct: rentBase ? round2(((current + next) / rentBase) * 100) : null,
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
    'Est. fees / mo', 'Door band', 'Schedule fee %', 'Gap (pts)', 'Added / mo', 'Added / yr', 'Opportunity grade',
    'Next raise %', 'Next raise $ / yr', 'Raises to schedule',
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
      Math.round(r.currentFeesMonthly), r.bandLabel, r.targetPct ?? '', r.gapPts ?? '',
      Math.round(r.addedMonthly), Math.round(r.addedYearly), r.grade,
      r.nextRaisePct ?? '', Math.round(r.nextRaiseYearly), r.raisesToTarget,
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

/** Bands must start at 1 door and be contiguous; only the last may be open. */
export function parseDoorSchedule(v: unknown): DoorBand[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > 20) return null;
  const out: DoorBand[] = [];
  for (const r of v) {
    const minDoors = Number(r?.minDoors);
    const maxDoors = r?.maxDoors == null || r?.maxDoors === '' ? null : Number(r.maxDoors);
    const targetPct = Number(r?.targetPct);
    if (!Number.isInteger(minDoors) || minDoors < 1) return null;
    if (maxDoors != null && (!Number.isInteger(maxDoors) || maxDoors < minDoors)) return null;
    if (!Number.isFinite(targetPct) || targetPct <= 0 || targetPct > 100) return null;
    out.push({ minDoors, maxDoors, targetPct: round2(targetPct), ...(r?.review ? { review: true } : {}) });
  }
  out.sort((a, b) => a.minDoors - b.minDoors);
  if (out[0].minDoors !== 1) return null;
  for (let i = 1; i < out.length; i++) {
    const prevMax = out[i - 1].maxDoors;
    if (prevMax == null || out[i].minDoors !== prevMax + 1) return null; // gap or overlap
  }
  return out;
}

export function parseMaxRaise(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 10 ? round2(n) : null;
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
