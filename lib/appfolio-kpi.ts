/**
 * AppFolio KPI Data Fetchers
 *
 * Pulls operational metrics from the AppFolio v0 Database API
 * for the KPI dashboard. Reuses the same credential pattern as
 * lib/appfolio.ts but keeps KPI logic isolated.
 *
 * v0 endpoints used:
 *   /delinquent_charges — delinquency rate (KPI 1)
 *   /leases             — active occupancy count for delinquency denominator
 *   /units              — vacancy rate (KPI 2)
 *   /work_orders        — cycle time (KPI 3)
 *   /tenants            — notice volume (KPI 4)
 *
 * Not available in v0:
 *   /occupancies (404)  — insurance compliance data not exposed
 *
 * Leasing funnel (KPIs 11-12):
 *   /leads               — guest card volume + source breakdown
 *   /rental_applications — application/approval funnel stages
 *   /showings            — 0 results currently, time-to-contact unavailable
 */

import { getSupabaseAdmin } from './supabase';
import { getDashboardConfig } from './dashboard-config';
import { havenResponseMetrics } from './haven';

const APPFOLIO_V0_BASE = 'https://api.appfolio.com/api/v0';

// ============================================
// Config & Auth
// ============================================

interface AppFolioConfig {
  auth: string;
  developerId: string;
}

function getKpiConfig(): AppFolioConfig | null {
  const clientId = process.env.APPFOLIO_CLIENT_ID;
  const clientSecret = process.env.APPFOLIO_CLIENT_SECRET;
  const developerId = process.env.APPFOLIO_DEVELOPER_ID;

  if (!clientId || !clientSecret || !developerId) {
    console.warn('[KPI] Missing AppFolio API credentials');
    return null;
  }

  return {
    auth: Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
    developerId,
  };
}

// ============================================
// v0 Fetch (same pattern as lib/appfolio.ts)
// ============================================

interface V0ListResponse<T> {
  data: T[];
  next_page_path?: string | null;
}

const MAX_RETRIES = 4;
const RETRY_BASE_MS = 2000;

async function v0Fetch<T>(
  path: string,
  params: Record<string, string>,
  config: AppFolioConfig
): Promise<V0ListResponse<T>> {
  const url = new URL(`${APPFOLIO_V0_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Basic ${config.auth}`,
        'X-AppFolio-Developer-ID': config.developerId,
        Accept: 'application/json',
      },
    });

    // Retry on 429 (rate limit) and 533 (data unavailable) with exponential backoff
    if ((response.status === 429 || response.status === 533) && attempt < MAX_RETRIES) {
      const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
      console.warn(`[AppFolio] ${response.status} on ${path}, retry ${attempt}/${MAX_RETRIES} in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`AppFolio v0 error (${response.status}): ${text.substring(0, 300)}`);
    }

    return JSON.parse(text) as V0ListResponse<T>;
  }

  throw new Error(`AppFolio v0 error: max retries exceeded for ${path}`);
}

async function v0FetchAll<T>(
  path: string,
  params: Record<string, string>,
  config: AppFolioConfig,
  pageSize = 200,
  maxPages = 50
): Promise<T[]> {
  const all: T[] = [];
  let nextPath = path;
  let nextParams: Record<string, string> = {
    ...params,
    'page[number]': '1',
    'page[size]': String(pageSize),
  };

  for (let page = 1; page <= maxPages; page++) {
    const res = await v0Fetch<T>(nextPath, nextParams, config);
    all.push(...(res.data || []));

    // The server may cap page[size] below what we asked for (e.g. /leads caps
    // at 100 as of 2026-05), so a short page does NOT mean the last page —
    // next_page_path is the only reliable end-of-data signal. Follow it
    // verbatim; it carries its own query string.
    if (!res.next_page_path) break;
    nextPath = res.next_page_path.replace(/^\/api\/v0/, '');
    nextParams = {};
    // Small delay between pages to avoid 429 rate limits
    await new Promise((r) => setTimeout(r, 200));
  }

  return all;
}

// ============================================
// v0 Types (subset needed for KPIs)
// ============================================

interface V0DelinquentCharge {
  Id: string;
  AmountDue: string;
  ChargedOn: string;
  Description: string;
  OccupancyId: string;
  LastUpdatedAt: string;
}

interface V0Lease {
  Id: string;
  OccupancyId: string;
  Status: string;
  StartOn: string;
  EndOn: string | null;
  RenewedOn: string | null;
  SignedOn: string | null;
  IsMtm: boolean;
  LastUpdatedAt: string;
}

interface V0Unit {
  Id: string;
  PropertyId?: string;
  Status?: string;
  HiddenAt?: string | null;
  City?: string | null;
  MarketRent?: string | null;
  NonRevenue?: boolean;
  CurrentOccupancyId?: string | null;
}

interface V0Property {
  Id: string;
  HiddenAt?: string | null;
}

interface V0OwnerGroup {
  Id: string;
  Current: boolean;
  PropertyId: string | null;
  LastUpdatedAt: string;
}

interface V0RecurringCharge {
  Id: string;
  Amount: string;
  Frequency: string;
  EndDate: string | null;
  OccupancyId: string;
  LastUpdatedAt: string;
}

interface V0BillLineItem {
  Id: string;
  Amount: string;
  Description?: string;
  GlAccountId?: string;
  PropertyId?: string;
  UnitId?: string;
}

interface V0Bill {
  Id: string;
  TotalAmount: string;
  InvoiceDate: string;
  LastUpdatedAt: string;
  VendorId?: string;
  ManagementCompanyAsPayee?: boolean;
  LineItems?: V0BillLineItem[];
}

interface V0GlAccount {
  Id: string;
  Name?: string;
  AccountName?: string;
  Number?: string;
  AccountType?: string;
  LastUpdatedAt?: string;
}

interface V0WorkOrder {
  Id: string;
  Status?: string;
  CreatedAt?: string;
  CompletedOn?: string;
  LastUpdatedAt?: string;
}

interface V0Tenant {
  Id: string;
  PropertyId?: string;
  UnitId?: string;
  Status?: string;
  MoveInOn?: string;
  MoveOutOn?: string;
  LeaseSignedDate?: string;
  HiddenAt?: string | null;
  LastUpdatedAt?: string;
}

// ============================================
// KPI 1: Delinquency Rate
// ============================================

export interface DelinquencyKpi {
  /** % of CURRENT tenancies with balance > threshold */
  rate: number;
  /** open balances owed by current tenancies over the threshold */
  totalDollars: number;
  /** current tenancies over the threshold */
  count: number;
  /** current tenancies (denominator) */
  totalActive: number;
  /** delinquent $ as % of monthly market rent roll — stable across the month */
  dollarRatePct: number | null;
  rentRollMonthly: number | null;
  /** open balances on non-current (former/other) occupancies — collections, not delinquency */
  formerTenantDollars: number;
  thresholdDollars: number;
}

const DELINQUENCY_THRESHOLD = 50;

/**
 * Rewritten 2026-08-04. The old version divided current delinquents by every
 * 'Fully Executed' lease since 2020 (ended leases included — denominator
 * ~3.5x reality, rate meaningless) and counted any open charge with no
 * threshold (day-1-of-month sawtooth). Now: denominator = current tenancies
 * only; numerator = current tenancies with balance > $50; plus a
 * dollars-to-rent-roll ratio that stays comparable across the month.
 */
export async function fetchDelinquencyKpi(): Promise<DelinquencyKpi> {
  const config = getKpiConfig();
  if (!config) {
    return {
      rate: 0, totalDollars: 0, count: 0, totalActive: 0,
      dollarRatePct: null, rentRollMonthly: null, formerTenantDollars: 0,
      thresholdDollars: DELINQUENCY_THRESHOLD,
    };
  }

  const [charges, units] = await Promise.all([
    v0FetchAll<V0DelinquentCharge>('/delinquent_charges', {}, config),
    v0FetchAll<V0Unit>(
      '/units',
      { 'filters[LastUpdatedAtFrom]': '2000-01-01T00:00:00Z' },
      config
    ),
  ]);

  // Current tenancies = units' CurrentOccupancyId (AppFolio's own "who lives
  // here now"). Lease-status filtering was tried first and over-counts —
  // historical MTM leases stay 'Fully Executed' with no EndOn forever.
  const currentOccupancies = new Set(
    units
      .filter((u) => !u.HiddenAt && !u.NonRevenue && u.CurrentOccupancyId)
      .map((u) => u.CurrentOccupancyId as string)
  );

  // Balance per occupancy (a tenant can have several open charges).
  const balanceByOccupancy = new Map<string, number>();
  for (const c of charges) {
    const amt = parseFloat(c.AmountDue || '0') || 0;
    balanceByOccupancy.set(c.OccupancyId, (balanceByOccupancy.get(c.OccupancyId) ?? 0) + amt);
  }

  let totalDollars = 0;
  let formerTenantDollars = 0;
  let count = 0;
  for (const [occ, balance] of balanceByOccupancy) {
    if (!currentOccupancies.has(occ)) {
      formerTenantDollars += balance;
    } else if (balance > DELINQUENCY_THRESHOLD) {
      totalDollars += balance;
      count++;
    }
  }

  const totalActive = currentOccupancies.size;
  const rate = totalActive > 0 ? Math.round((count / totalActive) * 1000) / 10 : 0;

  const rentRollMonthly = units.reduce((sum, u) => {
    if (u.HiddenAt || u.NonRevenue || !u.CurrentOccupancyId) return sum;
    const rent = u.MarketRent != null ? parseFloat(u.MarketRent) : NaN;
    return Number.isFinite(rent) ? sum + rent : sum;
  }, 0);

  return {
    rate,
    totalDollars: Math.round(totalDollars * 100) / 100,
    count,
    totalActive,
    dollarRatePct:
      rentRollMonthly > 0 ? Math.round((totalDollars / rentRollMonthly) * 1000) / 10 : null,
    rentRollMonthly: Math.round(rentRollMonthly),
    formerTenantDollars: Math.round(formerTenantDollars * 100) / 100,
    thresholdDollars: DELINQUENCY_THRESHOLD,
  };
}

// ============================================
// KPI 2: Vacancy Rate
// ============================================

export interface VacancyKpi {
  rate: number;
  vacantCount: number;
  totalUnits: number;
}

export async function fetchVacancyKpi(): Promise<VacancyKpi> {
  const config = getKpiConfig();
  if (!config) {
    return { rate: 0, vacantCount: 0, totalUnits: 0 };
  }

  const units = await v0FetchAll<V0Unit>(
    '/units',
    { 'filters[LastUpdatedAtFrom]': '2000-01-01T00:00:00Z' },
    config
  );

  const activeUnits = units.filter((u) => !u.HiddenAt);
  const totalUnits = activeUnits.length;

  const vacantCount = activeUnits.filter((u) => {
    const status = (u.Status || '').toLowerCase();
    return status.includes('vacant') || status.includes('available');
  }).length;

  const rate = totalUnits > 0 ? Math.round((vacantCount / totalUnits) * 1000) / 10 : 0;

  return { rate, vacantCount, totalUnits };
}

// ============================================
// KPI 3: Work Order Cycle Time
// ============================================

export interface WorkOrderKpi {
  avgDaysToClose: number;
  openCount: number;
}

export async function fetchWorkOrderKpi(): Promise<WorkOrderKpi> {
  const config = getKpiConfig();
  if (!config) {
    return { avgDaysToClose: 0, openCount: 0 };
  }

  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - 90);

  const workOrders = await v0FetchAll<V0WorkOrder>(
    '/work_orders',
    { 'filters[LastUpdatedAtFrom]': sinceDate.toISOString() },
    config
  );

  const now = new Date();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const closedRecently = workOrders.filter((wo) => {
    if (!wo.CompletedOn) return false;
    const completed = new Date(wo.CompletedOn);
    return completed >= thirtyDaysAgo && completed <= now;
  });

  let avgDaysToClose = 0;
  if (closedRecently.length > 0) {
    const totalDays = closedRecently.reduce((sum, wo) => {
      const created = wo.CreatedAt ? new Date(wo.CreatedAt) : now;
      const completed = new Date(wo.CompletedOn!);
      const days = (completed.getTime() - created.getTime()) / (1000 * 60 * 60 * 24);
      return sum + Math.max(0, days);
    }, 0);
    avgDaysToClose = Math.round((totalDays / closedRecently.length) * 10) / 10;
  }

  const openCount = workOrders.filter((wo) => {
    const status = (wo.Status || '').toLowerCase();
    return (
      !status.includes('completed') &&
      !status.includes('complete') &&
      !status.includes('canceled') &&
      !status.includes('cancelled') &&
      !status.includes('closed')
    );
  }).length;

  return { avgDaysToClose, openCount };
}

// ============================================
// KPI 4: 30-Day Notice Volume
// ============================================

export interface NoticeKpi {
  thisWeek: number;
  last30Days: number;
}

export async function fetchNoticeKpi(): Promise<NoticeKpi> {
  const config = getKpiConfig();
  if (!config) {
    return { thisWeek: 0, last30Days: 0 };
  }

  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - 90);

  const tenants = await v0FetchAll<V0Tenant>(
    '/tenants',
    { 'filters[LastUpdatedAtFrom]': sinceDate.toISOString() },
    config
  );

  const now = new Date();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Week boundaries (Monday to Sunday)
  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() + mondayOffset);
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  let thisWeek = 0;
  let last30Days = 0;

  for (const t of tenants) {
    if (t.HiddenAt || !t.MoveOutOn) continue;

    // Only count tenants currently in "Notice" status (active 30-day notices)
    // or with a future MoveOutOn date (pending move-out).
    // Excludes "Past" (already moved out) and "Evict" tenants.
    const status = (t.Status || '').toLowerCase();
    if (status !== 'notice') continue;

    const moveOut = new Date(t.MoveOutOn);

    // Count notices with move-out in the last 30 days or upcoming
    if (moveOut >= thirtyDaysAgo) {
      last30Days++;
      if (moveOut >= weekStart && moveOut < weekEnd) {
        thisWeek++;
      }
    }
  }

  return { thisWeek, last30Days };
}

// ============================================
// KPI 5: Insurance Compliance Rate
// ============================================

export interface InsuranceKpi {
  rate: number;
  compliantCount: number;
  totalCount: number;
}

/**
 * MOCK — renter's insurance status is not exposed by AppFolio v0.
 *
 * Probed 2026-05-20:
 *   - /insurance_policies, /renter_insurance_policies, /renters_insurance,
 *     /tenant_insurance, /occupancies all return 404.
 *   - Tenant.OccupancyCustomFields is null across the whole portfolio
 *     (0/824 current primary tenants).
 *   - Property.CustomFields holds only "Annual Accounting Fee".
 *   - Tenant.Tags includes sparse "RBP" / "RBP - Ins. Only" entries
 *     (5 total), insufficient as a portfolio-wide compliance signal.
 *   - AppFolio Insurance Services income GL accounts (00000000-13,
 *     00000000-14) exist in the chart of accounts but have ZERO activity:
 *     0 recurring_charges and 0 journal_entries reference them.
 *     HDPM is not enrolled in AppFolio's renter insurance partner program,
 *     so the "GL proxy" approach yields no usable signal.
 *
 * Real paths forward, when product is ready: Supabase-backed tracker
 * (manual entry or CSV import of compliant tenants) + a small entry UI,
 * or drop the tile. See scripts/probe-insurance.js and
 * scripts/probe-insurance-gl.js for the investigation.
 */
export async function fetchInsuranceKpi(): Promise<InsuranceKpi> {
  const config = getKpiConfig();
  if (!config) {
    return { rate: 0, compliantCount: 0, totalCount: 0 };
  }
  return {
    rate: 78.5,
    compliantCount: 112,
    totalCount: 143,
  };
}

// ============================================
// KPI 6: Owner Retention Rate
// ============================================

export interface OwnerRetentionKpi {
  rate: number;
  cancellationsLast30Days: number;
  totalOwners: number;
}

/**
 * Uses /owner_groups endpoint. Each owner_group links an owner to a property.
 * Current=true means active management agreement; Current=false means departed.
 * Retention rate = current / total unique property associations.
 */
export async function fetchOwnerRetentionKpi(): Promise<OwnerRetentionKpi> {
  const config = getKpiConfig();
  if (!config) {
    return { rate: 0, cancellationsLast30Days: 0, totalOwners: 0 };
  }

  const ownerGroups = await v0FetchAll<V0OwnerGroup>(
    '/owner_groups',
    { 'filters[LastUpdatedAtFrom]': '2020-01-01T00:00:00Z' },
    config
  );

  const total = ownerGroups.length;
  const current = ownerGroups.filter((g) => g.Current).length;
  const inactive = total - current;

  // Estimate recent cancellations: inactive groups updated in last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const recentCancellations = ownerGroups.filter(
    (g) => !g.Current && new Date(g.LastUpdatedAt) >= thirtyDaysAgo
  ).length;

  const rate = total > 0 ? Math.round((current / total) * 1000) / 10 : 0;

  return {
    rate,
    cancellationsLast30Days: recentCancellations,
    totalOwners: current,
  };
}

// ============================================
// KPI 7: Maintenance Cost as % of Rent Roll
// ============================================

export interface MaintenanceCostKpi {
  rate: number;
  maintenanceDollars: number;
  grossRentDollars: number;
}

/**
 * Rent roll from /recurring_charges (active monthly charges).
 * Vendor spend from /bills line items filtered to maintenance GL accounts:
 * ExpenseGlAccount with account number starting "6" (6100 Maintenance/Repairs,
 * 6200 Cleaning, 6300 Landscaping, 6400 Pest Control, 6500 Keys/Locks).
 */
export async function fetchMaintenanceCostKpi(): Promise<MaintenanceCostKpi> {
  const config = getKpiConfig();
  if (!config) {
    return { rate: 0, maintenanceDollars: 0, grossRentDollars: 0 };
  }

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [recurringCharges, bills, glAccounts] = await Promise.all([
    v0FetchAll<V0RecurringCharge>(
      '/recurring_charges',
      { 'filters[LastUpdatedAtFrom]': '2024-01-01T00:00:00Z' },
      config
    ),
    v0FetchAll<V0Bill>(
      '/bills',
      { 'filters[LastUpdatedAtFrom]': thirtyDaysAgo.toISOString() },
      config
    ),
    v0FetchAll<V0GlAccount>('/gl_accounts', {}, config),
  ]);

  // Monthly rent roll: sum of active monthly recurring charges
  const now = new Date();
  const activeMonthly = recurringCharges.filter((c) => {
    if (c.EndDate && new Date(c.EndDate) < now) return false;
    return c.Frequency === 'Monthly';
  });
  const grossRentDollars = activeMonthly.reduce(
    (sum, c) => sum + parseFloat(c.Amount || '0'), 0
  );

  // Maintenance GL accounts: 6xxx expense accounts (chart-of-accounts convention).
  const maintenanceGlIds = new Set(
    glAccounts
      .filter((a) => a.AccountType === 'ExpenseGlAccount' && (a.Number || '').startsWith('6'))
      .map((a) => a.Id)
  );

  // Sum line-item amounts whose GlAccountId is in the maintenance set.
  let maintenanceDollars = 0;
  for (const bill of bills) {
    for (const li of bill.LineItems || []) {
      if (li.GlAccountId && maintenanceGlIds.has(li.GlAccountId)) {
        maintenanceDollars += parseFloat(li.Amount || '0');
      }
    }
  }

  const rate = grossRentDollars > 0
    ? Math.round((maintenanceDollars / grossRentDollars) * 1000) / 10
    : 0;

  return {
    rate: Math.round(rate * 10) / 10,
    maintenanceDollars: Math.round(maintenanceDollars * 100) / 100,
    grossRentDollars: Math.round(grossRentDollars * 100) / 100,
  };
}

// ============================================
// KPI 8: Average Days to Lease
// ============================================

export interface DaysToLeaseKpi {
  avgDays: number;
  fastest: number;
  slowest: number;
  unitsLeased: number;
}

/**
 * Days from prior tenant's MoveOutOn → new tenant's lease sign date,
 * averaged across tenants who signed in the last 90 days. Pulls 365 days
 * of /tenants so we can find each new tenant's predecessor for the same UnitId.
 *
 * Units with no prior tenancy in the lookback window are skipped — we don't
 * pull /units here for AvailableOn, so brand-new units aren't counted.
 */
export async function fetchDaysToLeaseKpi(): Promise<DaysToLeaseKpi> {
  const config = getKpiConfig();
  if (!config) {
    return { avgDays: 0, fastest: 0, slowest: 0, unitsLeased: 0 };
  }

  const now = new Date();
  const ninetyDaysAgo = new Date(now);
  ninetyDaysAgo.setDate(now.getDate() - 90);
  const yearAgo = new Date(now);
  yearAgo.setDate(now.getDate() - 365);

  const tenants = await v0FetchAll<V0Tenant>(
    '/tenants',
    { 'filters[LastUpdatedAtFrom]': yearAgo.toISOString() },
    config
  );

  // Index prior move-outs by UnitId (sorted ascending so we can binary-search by date).
  const moveOutsByUnit = new Map<string, string[]>();
  for (const t of tenants) {
    if (t.HiddenAt || !t.UnitId || !t.MoveOutOn) continue;
    const arr = moveOutsByUnit.get(t.UnitId) ?? [];
    arr.push(t.MoveOutOn);
    moveOutsByUnit.set(t.UnitId, arr);
  }
  for (const arr of moveOutsByUnit.values()) arr.sort();

  const deltas: number[] = [];
  for (const t of tenants) {
    if (t.HiddenAt || !t.UnitId) continue;
    const signed = t.LeaseSignedDate || t.MoveInOn;
    if (!signed) continue;
    const signedDate = new Date(signed);
    if (signedDate < ninetyDaysAgo || signedDate > now) continue;

    const priorMoveOuts = moveOutsByUnit.get(t.UnitId);
    if (!priorMoveOuts) continue;
    // Most recent MoveOutOn strictly before this tenant's signed date.
    let prior: string | undefined;
    for (let i = priorMoveOuts.length - 1; i >= 0; i--) {
      if (priorMoveOuts[i] < signed) { prior = priorMoveOuts[i]; break; }
    }
    if (!prior) continue;

    const days = Math.round((signedDate.getTime() - new Date(prior).getTime()) / 86400000);
    if (days < 0 || days > 365) continue; // drop outliers / data errors
    deltas.push(days);
  }

  if (deltas.length === 0) {
    return { avgDays: 0, fastest: 0, slowest: 0, unitsLeased: 0 };
  }

  const sum = deltas.reduce((a, b) => a + b, 0);
  return {
    avgDays: Math.round((sum / deltas.length) * 10) / 10,
    fastest: Math.min(...deltas),
    slowest: Math.max(...deltas),
    unitsLeased: deltas.length,
  };
}

// ============================================
// KPI 9: Lease Renewal Rate
// ============================================

export interface LeaseRenewalKpi {
  rate: number;
  renewals: number;
  moveOuts: number;
}

/**
 * Uses /leases (RenewedOn field) for renewals and /tenants (Status=Notice
 * with MoveOutOn) for move-outs. Renewal rate = renewals / (renewals + moveOuts).
 */
export async function fetchLeaseRenewalKpi(): Promise<LeaseRenewalKpi> {
  const config = getKpiConfig();
  if (!config) {
    return { rate: 0, renewals: 0, moveOuts: 0 };
  }

  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const [leases, tenants] = await Promise.all([
    v0FetchAll<V0Lease>(
      '/leases',
      { 'filters[LastUpdatedAtFrom]': ninetyDaysAgo.toISOString() },
      config
    ),
    v0FetchAll<V0Tenant>(
      '/tenants',
      { 'filters[LastUpdatedAtFrom]': ninetyDaysAgo.toISOString() },
      config
    ),
  ]);

  // Renewals: leases with RenewedOn in the last 90 days
  const renewals = leases.filter(
    (l) => l.RenewedOn && new Date(l.RenewedOn) >= ninetyDaysAgo
  ).length;

  // Move-outs: tenants with Status=Notice and a MoveOutOn date
  const moveOuts = tenants.filter((t) => {
    if (t.HiddenAt || !t.MoveOutOn) return false;
    return (t.Status || '').toLowerCase() === 'notice';
  }).length;

  const total = renewals + moveOuts;
  const rate = total > 0 ? Math.round((renewals / total) * 1000) / 10 : 0;

  return { rate, renewals, moveOuts };
}

// ============================================
// KPI 10: Net Doors Added
// ============================================

export interface NetDoorsKpi {
  currentDoors: number;
  currentProperties: number;
  netThisMonth: number;
}

export async function fetchNetDoorsKpi(): Promise<NetDoorsKpi> {
  const config = getKpiConfig();
  if (!config) {
    return { currentDoors: 0, currentProperties: 0, netThisMonth: 0 };
  }

  const [units, properties] = await Promise.all([
    v0FetchAll<V0Unit>(
      '/units',
      { 'filters[LastUpdatedAtFrom]': '2000-01-01T00:00:00Z' },
      config
    ),
    v0FetchAll<V0Property>(
      '/properties',
      { 'filters[LastUpdatedAtFrom]': '1970-01-01T00:00:00Z' },
      config,
      1000,
      10
    ),
  ]);

  const currentDoors = units.filter((u) => !u.HiddenAt).length;
  const currentProperties = properties.filter((p) => !p.HiddenAt).length;

  // netThisMonth = currentDoors − earliest net_doors snapshot of this calendar month (UTC).
  // If no snapshot exists yet for the current month, the delta is 0 by definition.
  let netThisMonth = 0;
  try {
    const now = new Date();
    const startOfMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
    );
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from('kpi_snapshots')
      .select('value')
      .eq('kpi_name', 'net_doors')
      .gte('captured_at', startOfMonth.toISOString())
      .order('captured_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    const baseline = (data?.value as { currentDoors?: number } | null)?.currentDoors;
    if (typeof baseline === 'number') {
      netThisMonth = currentDoors - baseline;
    }
  } catch (e) {
    console.warn('[KPI] net_doors month baseline lookup failed:', e);
  }

  return {
    currentDoors,
    currentProperties,
    netThisMonth,
  };
}

// ============================================
// v0 Types — Leasing Funnel
// ============================================

interface V0Lead {
  Id: string;
  CreatedAt: string;
  Source: string | null;
  Status: string;
  /** Since the 2026-05 API change: 'converted_to_tenant' marks a conversion */
  InactiveReason: string | null;
  PropertyId: string | null;
  RentalApplicationId: string | null;
  RentalApplicationGroupId: string | null;
  FirstName: string;
  LastName: string;
  Email: string | null;
  LastUpdatedAt: string;
}

interface V0RentalApplication {
  Id: string;
  Status: string;
  SubmittedAt: string;
  StatusChangedAt: string | null;
  PropertyId: string | null;
  UnitId: string | null;
  GroupId: string | null;
}

// ============================================
// KPI 11: Guest Card Volume + Source Breakdown
// ============================================

export const SOURCE_BUCKETS: Record<string, string> = {
  'Apartment List': 'Apartment List',
  'Apartmentlist.com': 'Apartment List',
  'Apartments.com': 'Apartments.com',
  'Zillow Rental Network': 'Zillow / Syndication',
  'Zillow': 'Zillow / Syndication',
  'zillow.com': 'Zillow / Syndication',
  'Zumper': 'Zillow / Syndication',
  'Trulia': 'Zillow / Syndication',
  'Realtor.com': 'Zillow / Syndication',
  'Rent.': 'Rent.',
  'HDPM Website': 'HDPM Website',
  'Website': 'HDPM Website',
  'AppFolio': 'AppFolio Portal',
  'Craigslist': 'Craigslist',
  'craigslist': 'Craigslist',
  'Walk-in': 'Direct / Walk-in',
  'Phone': 'Direct / Walk-in',
  'Direct': 'Direct / Walk-in',
};

function normalizeSource(raw: string | null): string {
  if (!raw) return 'Other';
  return SOURCE_BUCKETS[raw] ?? 'Other';
}

function getSourceBreakdown(leads: V0Lead[]): Array<{ source: string; count: number }> {
  const counts: Record<string, number> = {};
  for (const lead of leads) {
    const source = normalizeSource(lead.Source);
    counts[source] = (counts[source] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);
}

export interface GuestCardKpi {
  today: number;
  thisWeek: number;
  thisMonth: number;
  lastWeek: number;
  lastMonth: number;
  weekOverWeekDelta: number;
  monthOverMonthDelta: number;
  sourceBreakdownWeek: Array<{ source: string; count: number }>;
  sourceBreakdownMonth: Array<{ source: string; count: number }>;
}

export async function fetchGuestCardKpi(): Promise<GuestCardKpi> {
  const config = getKpiConfig();
  if (!config) {
    return {
      today: 0, thisWeek: 0, thisMonth: 0, lastWeek: 0, lastMonth: 0,
      weekOverWeekDelta: 0, monthOverMonthDelta: 0,
      sourceBreakdownWeek: [], sourceBreakdownMonth: [],
    };
  }

  // Fetch leads updated in last 90 days (API only supports LastUpdatedAtFrom)
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - 90);

  const leads = await v0FetchAll<V0Lead>(
    '/leads',
    { 'filters[LastUpdatedAtFrom]': sinceDate.toISOString() },
    config
  );

  // Time boundaries (UTC — AppFolio CreatedAt is UTC)
  const now = new Date();

  // Today: midnight UTC
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);

  // This week: Monday 00:00 UTC
  const dayOfWeek = now.getUTCDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const thisWeekStart = new Date(now);
  thisWeekStart.setUTCDate(thisWeekStart.getUTCDate() + mondayOffset);
  thisWeekStart.setUTCHours(0, 0, 0, 0);

  // Last week: prior Monday to prior Sunday
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setUTCDate(lastWeekStart.getUTCDate() - 7);
  const lastWeekEnd = new Date(thisWeekStart);

  // This month: 1st of current month
  const thisMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  // Last month: 1st of prior month to 1st of current month
  const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const lastMonthEnd = thisMonthStart;

  // Slice leads by CreatedAt into time windows
  const todayLeads: V0Lead[] = [];
  const thisWeekLeads: V0Lead[] = [];
  const thisMonthLeads: V0Lead[] = [];
  const lastWeekLeads: V0Lead[] = [];
  const lastMonthLeads: V0Lead[] = [];

  for (const lead of leads) {
    const created = new Date(lead.CreatedAt);
    if (created >= todayStart && created <= now) todayLeads.push(lead);
    if (created >= thisWeekStart && created <= now) thisWeekLeads.push(lead);
    if (created >= thisMonthStart && created <= now) thisMonthLeads.push(lead);
    if (created >= lastWeekStart && created < lastWeekEnd) lastWeekLeads.push(lead);
    if (created >= lastMonthStart && created < lastMonthEnd) lastMonthLeads.push(lead);
  }

  const thisWeek = thisWeekLeads.length;
  const lastWeek = lastWeekLeads.length;
  const thisMonth = thisMonthLeads.length;
  const lastMonth = lastMonthLeads.length;

  return {
    today: todayLeads.length,
    thisWeek,
    thisMonth,
    lastWeek,
    lastMonth,
    weekOverWeekDelta: thisWeek - lastWeek,
    monthOverMonthDelta: thisMonth - lastMonth,
    sourceBreakdownWeek: getSourceBreakdown(thisWeekLeads),
    sourceBreakdownMonth: getSourceBreakdown(thisMonthLeads),
  };
}

// ============================================
// KPI 12: Leasing Funnel + Time to First Contact
// ============================================

// AppFolio lead Status values seen in the wild:
//   active, inactive, applied_review, applied_canceled, applied_denied, converted
// "converted" is set when the lead becomes a tenant (lease executed).
const LEAD_APPLIED_STATUSES = new Set([
  'applied_review',
  'applied_canceled',
  'applied_denied',
  'converted',
]);

export interface LeasingFunnelKpi {
  period: string;
  funnel: {
    guestCards: number;
    applications: number;
    approvals: number;
    moveIns: number;
  };
  conversionRates: {
    guestCardToApplication: number;
    applicationToApproval: number;
    approvalToMoveIn: number;
    overallConversion: number;
  };
  avgDaysLeadToLease: number;
  timeToFirstContact: {
    avgHoursToFirstContact: number | null;
    pctContactedUnder1Hour: number | null;
    pctContactedUnder24Hours: number | null;
    pctNeverContacted: number | null;
    dataSource: 'showings' | 'communications' | 'haven' | 'unavailable';
  };
  /** Since the 2026-05 AppFolio change most leads never get linked to an
   * application or conversion, so stages 2-4 undercount. tenantMoveIns is the
   * authoritative move-in count from tenant records for the same window. */
  dataQuality: {
    tenantMoveIns: number;
    leadLinkageSparse: boolean;
  };
}

export async function fetchLeasingFunnelKpi(): Promise<LeasingFunnelKpi> {
  const config = getKpiConfig();
  const emptyResult: LeasingFunnelKpi = {
    period: 'last_90_days',
    funnel: { guestCards: 0, applications: 0, approvals: 0, moveIns: 0 },
    conversionRates: {
      guestCardToApplication: 0, applicationToApproval: 0,
      approvalToMoveIn: 0, overallConversion: 0,
    },
    avgDaysLeadToLease: 0,
    timeToFirstContact: {
      avgHoursToFirstContact: null, pctContactedUnder1Hour: null,
      pctContactedUnder24Hours: null, pctNeverContacted: null,
      dataSource: 'unavailable',
    },
    dataQuality: { tenantMoveIns: 0, leadLinkageSparse: false },
  };

  if (!config) return emptyResult;

  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - 90);

  // Tenants give the authoritative move-in count — since the 2026-05 change
  // AppFolio rarely links leads to their eventual tenancy, so the lead-cohort
  // stages below undercount and tenantMoveIns is the ground truth.
  const [leads, tenantsForMoveIns] = await Promise.all([
    v0FetchAll<V0Lead>(
      '/leads',
      { 'filters[LastUpdatedAtFrom]': sinceDate.toISOString() },
      config
    ),
    v0FetchAll<V0Tenant>(
      '/tenants',
      { 'filters[LastUpdatedAtFrom]': sinceDate.toISOString() },
      config
    ),
  ]);
  const tenantMoveIns = tenantsForMoveIns.filter(
    (t) => !t.HiddenAt && t.MoveInOn && new Date(t.MoveInOn) >= sinceDate
  ).length;

  // Anchor every stage on the same cohort (leads created in last 90 days),
  // so the funnel is monotonically narrowing rather than four independent metrics.
  const recentLeads = leads.filter((l) => new Date(l.CreatedAt) >= sinceDate);

  // Since the 2026-05 API change, lead Status is only active/inactive: the
  // application linkage moved to RentalApplicationGroupId and the conversion
  // signal to InactiveReason='converted_to_tenant'. The legacy Status values
  // are kept as fallbacks in case AppFolio re-emits them.
  const isConverted = (l: V0Lead) =>
    l.Status === 'converted' || l.InactiveReason === 'converted_to_tenant';
  const isApplication = (l: V0Lead) =>
    !!l.RentalApplicationGroupId ||
    !!l.RentalApplicationId ||
    LEAD_APPLIED_STATUSES.has(l.Status) ||
    isConverted(l);

  // Stage 1: Guest Cards = recent leads.
  const guestCards = recentLeads.length;

  // Stage 2: Applications = lead reached the application stage.
  const applications = recentLeads.filter(isApplication).length;

  // Stage 3: Approvals. Bulk /rental_applications queries return no rows
  // since the 2026-05 change; applications are only reachable per GroupId,
  // so fetch each distinct group linked from the cohort (paced for the ~60
  // req/min v0 rate limit; v0Fetch retries 429s).
  const groupIds = [
    ...new Set(
      recentLeads
        .map((l) => l.RentalApplicationGroupId)
        .filter((id): id is string => !!id)
    ),
  ];
  const groupApps = new Map<string, V0RentalApplication[]>();
  for (const groupId of groupIds) {
    try {
      const res = await v0Fetch<V0RentalApplication>(
        '/rental_applications',
        { 'filters[GroupId]': groupId, 'page[size]': '100' },
        config
      );
      groupApps.set(groupId, res.data || []);
    } catch (err) {
      console.warn(`[KPI] rental_applications GroupId=${groupId} failed:`, err);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  const isGroupApproved = (groupId: string | null) => {
    if (!groupId) return false;
    const apps = groupApps.get(groupId) || [];
    return apps.some((a) => (a.Status || '').toLowerCase().includes('approved'));
  };
  const isApproval = (l: V0Lead) =>
    isConverted(l) || isGroupApproved(l.RentalApplicationGroupId);
  const approvals = recentLeads.filter(isApproval).length;

  // Stage 4: Move-Ins = converted leads (AppFolio's authoritative signal that
  // the applicant became a tenant). Always a subset of approvals by construction.
  const moveIns = recentLeads.filter(isConverted).length;

  const safeDiv = (num: number, den: number) =>
    den > 0 ? Math.round((num / den) * 1000) / 10 : 0;
  const conversionRates = {
    guestCardToApplication: safeDiv(applications, guestCards),
    applicationToApproval: safeDiv(approvals, applications),
    approvalToMoveIn: safeDiv(moveIns, approvals),
    overallConversion: safeDiv(moveIns, guestCards),
  };

  // Avg days lead → lease for converted leads. Prefer the linked rental_app's
  // StatusChangedAt; fall back to the lead's LastUpdatedAt as a proxy for the
  // conversion timestamp.
  let totalDays = 0;
  let countWithDates = 0;
  for (const lead of recentLeads) {
    if (!isConverted(lead)) continue;
    const apps = lead.RentalApplicationGroupId
      ? groupApps.get(lead.RentalApplicationGroupId) || []
      : [];
    const endIso = apps.find((a) => a.StatusChangedAt)?.StatusChangedAt ?? lead.LastUpdatedAt;
    if (!endIso) continue;
    const days = (new Date(endIso).getTime() - new Date(lead.CreatedAt).getTime()) / 86400000;
    if (days >= 0 && days <= 180) {
      totalDays += days;
      countWithDates++;
    }
  }
  const avgDaysLeadToLease = countWithDates > 0
    ? Math.round((totalDays / countWithDates) * 10) / 10
    : 0;

  // Time to first contact — from the Haven PMC leasing-conversations sync
  // (haven_conversation, response_seconds computed from history events).
  // AppFolio v0 has no usable source: /showings returns 0 rows and the
  // communications-style endpoints are all 404 (probed 2026-05-20).
  let timeToFirstContact: LeasingFunnelKpi['timeToFirstContact'] = {
    avgHoursToFirstContact: null,
    pctContactedUnder1Hour: null,
    pctContactedUnder24Hours: null,
    pctNeverContacted: null,
    dataSource: 'unavailable',
  };
  try {
    const haven = await havenResponseMetrics(getSupabaseAdmin(), sinceDate);
    if (haven) {
      timeToFirstContact = {
        avgHoursToFirstContact: haven.avgHoursToFirstContact,
        pctContactedUnder1Hour: haven.pctContactedUnder1Hour,
        pctContactedUnder24Hours: haven.pctContactedUnder24Hours,
        pctNeverContacted: haven.pctNeverContacted,
        dataSource: 'haven',
      };
    }
  } catch (err) {
    console.warn('[KPI] Haven response metrics unavailable:', err);
  }

  return {
    period: 'last_90_days',
    funnel: { guestCards, applications, approvals, moveIns },
    conversionRates,
    avgDaysLeadToLease,
    timeToFirstContact,
    dataQuality: {
      tenantMoveIns,
      leadLinkageSparse: tenantMoveIns > moveIns * 2,
    },
  };
}

// ============================================
// KPI 13: Annual Management Fees
// ============================================

interface ManagementFeesKpi {
  totalProperties: number;               // active under management
  avgFeePct: number | null;              // mean % across percent-fee properties
  tiers: { pct: number; count: number }[];
  flatCount: number;                     // flat-fee properties
  noPolicy: number;                      // properties without a fee policy
  /** Σ occupied-unit market rent × property fee % × 12 (+ flat fees × 12).
      An ESTIMATE — actual lease rents are not on the v0 API. */
  estAnnualFeeRevenue: number | null;
}

interface V0PropertyWithFees {
  Id: string;
  HiddenAt?: string | null;
  ManagementEndDate?: string | null;
  CurrentManagementFeePolicy?: {
    FeeType?: string | null;             // 'Percent' | 'Flat'
    Percentage?: string | null;
    FlatAmount?: string | null;
  } | null;
}

/**
 * Rewritten 2026-08-04. The old version counted a custom field
 * ("Accounting Management Fee" via a CustomValues array) that the API does
 * not return — the field is CustomFields (an object) and the flag is named
 * "Annual Accounting Fee" — so feeCount was 0 forever. The API now exposes
 * CurrentManagementFeePolicy directly, which is the real data.
 */
export async function fetchManagementFeesKpi(): Promise<ManagementFeesKpi> {
  const config = getKpiConfig();
  if (!config) {
    return { totalProperties: 0, avgFeePct: null, tiers: [], flatCount: 0, noPolicy: 0, estAnnualFeeRevenue: null };
  }

  const [properties, units] = await Promise.all([
    v0FetchAll<V0PropertyWithFees>(
      '/properties',
      { 'filters[LastUpdatedAtFrom]': '1970-01-01T00:00:00Z' },
      config,
      1000,
      10
    ),
    v0FetchAll<V0Unit>(
      '/units',
      { 'filters[LastUpdatedAtFrom]': '2000-01-01T00:00:00Z' },
      config
    ),
  ]);

  const active = properties.filter((p) => !p.HiddenAt && !p.ManagementEndDate);
  const pctByProperty = new Map<string, number>();
  const tierCounts = new Map<number, number>();
  let flatCount = 0;
  let noPolicy = 0;
  let flatAnnual = 0;

  for (const p of active) {
    const policy = p.CurrentManagementFeePolicy;
    const pct = policy?.Percentage != null ? parseFloat(policy.Percentage) : NaN;
    if (policy?.FeeType === 'Percent' && Number.isFinite(pct) && pct > 0) {
      pctByProperty.set(p.Id, pct);
      tierCounts.set(pct, (tierCounts.get(pct) ?? 0) + 1);
    } else if (policy?.FeeType === 'Flat' && policy.FlatAmount != null) {
      flatCount++;
      flatAnnual += (parseFloat(policy.FlatAmount) || 0) * 12;
    } else {
      noPolicy++;
    }
  }

  const pcts = [...pctByProperty.values()];
  const avgFeePct = pcts.length
    ? Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 10) / 10
    : null;

  // Estimated annual revenue: occupied, revenue units × market rent × fee %.
  let pctAnnual = 0;
  let ratedUnits = 0;
  for (const u of units) {
    if (u.HiddenAt || u.NonRevenue || !u.CurrentOccupancyId || !u.PropertyId) continue;
    const pct = pctByProperty.get(u.PropertyId);
    const rent = u.MarketRent != null ? parseFloat(u.MarketRent) : NaN;
    if (pct == null || !Number.isFinite(rent)) continue;
    pctAnnual += rent * (pct / 100) * 12;
    ratedUnits++;
  }
  const estAnnualFeeRevenue = ratedUnits > 0 ? Math.round(pctAnnual + flatAnnual) : null;

  return {
    totalProperties: active.length,
    avgFeePct,
    tiers: [...tierCounts.entries()]
      .map(([pct, count]) => ({ pct, count }))
      .sort((a, b) => b.count - a.count),
    flatCount,
    noPolicy,
    estAnnualFeeRevenue,
  };
}

// ============================================
// KPI 14: Occupancy Rate (Section C)
// ============================================

export interface OccupancyKpi {
  rate: number;          // occupied ÷ total, %
  occupiedCount: number;
  vacantCount: number;
  totalUnits: number;
  target: number;        // from config (default 95%)
}

const isVacantStatus = (status: string | undefined): boolean => {
  const s = (status || '').toLowerCase();
  return s.includes('vacant') || s.includes('available');
};

export async function fetchOccupancyKpi(): Promise<OccupancyKpi> {
  const config = getKpiConfig();
  const { targets } = await getDashboardConfig();
  if (!config) {
    return { rate: 0, occupiedCount: 0, vacantCount: 0, totalUnits: 0, target: targets.occupancyPct };
  }

  const units = await v0FetchAll<V0Unit>(
    '/units',
    { 'filters[LastUpdatedAtFrom]': '2000-01-01T00:00:00Z' },
    config
  );

  // Mirror the vacancy KPI's universe (all non-hidden units) so the two tiles
  // reconcile: occupancy% = 100 − vacancy%.
  const activeUnits = units.filter((u) => !u.HiddenAt);
  const totalUnits = activeUnits.length;
  const vacantCount = activeUnits.filter((u) => isVacantStatus(u.Status)).length;
  const occupiedCount = totalUnits - vacantCount;
  const rate = totalUnits > 0 ? Math.round((occupiedCount / totalUnits) * 1000) / 10 : 0;

  return { rate, occupiedCount, vacantCount, totalUnits, target: targets.occupancyPct };
}

// ============================================
// KPI 15: Bend Mix % + Rent Premium (Section B ★)
// ============================================

export interface BendGrowthKpi {
  bendUnits: number;
  totalUnits: number;
  bendPct: number;          // Bend units ÷ total, %
  targetPct: number;        // from config (default ~50%)
  bendAvgRent: number;      // mean MarketRent for Bend units
  nonBendAvgRent: number;   // mean MarketRent for non-Bend units
  premiumPct: number;       // (bendAvg − nonBendAvg) ÷ nonBendAvg, %
}

/**
 * Bend market penetration + the rent premium that justifies it. Units carry a
 * City field directly. "Bend" = City trimmed/lowercased === 'bend' (Redmond,
 * Sisters, Prineville, etc. are non-Bend per the spec's mix definition).
 */
export async function fetchBendGrowthKpi(): Promise<BendGrowthKpi> {
  const config = getKpiConfig();
  const { targets } = await getDashboardConfig();
  const empty: BendGrowthKpi = {
    bendUnits: 0, totalUnits: 0, bendPct: 0, targetPct: targets.bendMixPct,
    bendAvgRent: 0, nonBendAvgRent: 0, premiumPct: 0,
  };
  if (!config) return empty;

  const units = await v0FetchAll<V0Unit>(
    '/units',
    { 'filters[LastUpdatedAtFrom]': '2000-01-01T00:00:00Z' },
    config
  );

  const active = units.filter((u) => !u.HiddenAt && !u.NonRevenue);
  const totalUnits = active.length;
  const isBend = (u: V0Unit) => (u.City || '').trim().toLowerCase() === 'bend';

  const bendUnits = active.filter(isBend).length;
  const bendPct = totalUnits > 0 ? Math.round((bendUnits / totalUnits) * 1000) / 10 : 0;

  const avgRent = (list: V0Unit[]) => {
    const rents = list
      .map((u) => parseFloat(u.MarketRent || '0'))
      .filter((r) => r > 0);
    if (rents.length === 0) return 0;
    return Math.round(rents.reduce((a, b) => a + b, 0) / rents.length);
  };
  const bendAvgRent = avgRent(active.filter(isBend));
  const nonBendAvgRent = avgRent(active.filter((u) => !isBend(u)));
  const premiumPct = nonBendAvgRent > 0
    ? Math.round(((bendAvgRent - nonBendAvgRent) / nonBendAvgRent) * 1000) / 10
    : 0;

  return {
    bendUnits, totalUnits, bendPct, targetPct: targets.bendMixPct,
    bendAvgRent, nonBendAvgRent, premiumPct,
  };
}

// ============================================
// KPI 16: Lease Expirations 30/60/90 (Section C ★)
// ============================================

export interface LeaseExpirationsKpi {
  within30: number;   // cumulative: active leases ending ≤30 days out
  within60: number;   // ≤60 days
  within90: number;   // ≤90 days
  mtm: number;        // month-to-month (no fixed end / IsMtm)
  activeLeases: number;
}

/**
 * Upcoming fixed-term expirations from /leases (EndOn), plus the month-to-month
 * count. Windows are cumulative (within30 ⊆ within60 ⊆ within90).
 *
 * Status='Fully Executed' alone over-counts ~3.4× because AppFolio keeps that
 * status on every historical tenancy. We scope to *currently-occupied* units by
 * intersecting lease OccupancyId with each active unit's CurrentOccupancyId —
 * this reconciles exactly with the occupancy KPI's occupied-unit count.
 */
export async function fetchLeaseExpirationsKpi(): Promise<LeaseExpirationsKpi> {
  const config = getKpiConfig();
  if (!config) {
    return { within30: 0, within60: 0, within90: 0, mtm: 0, activeLeases: 0 };
  }

  const [leases, units] = await Promise.all([
    v0FetchAll<V0Lease>(
      '/leases',
      { 'filters[LastUpdatedAtFrom]': '2020-01-01T00:00:00Z' },
      config
    ),
    v0FetchAll<V0Unit>(
      '/units',
      { 'filters[LastUpdatedAtFrom]': '2000-01-01T00:00:00Z' },
      config
    ),
  ]);

  const currentOccupancyIds = new Set(
    units
      .filter((u) => !u.HiddenAt && u.CurrentOccupancyId)
      .map((u) => u.CurrentOccupancyId as string)
  );

  const now = new Date();
  const dayMs = 86400000;
  const active = leases.filter(
    (l) => l.Status === 'Fully Executed' && currentOccupancyIds.has(l.OccupancyId)
  );

  let within30 = 0, within60 = 0, within90 = 0, mtm = 0;
  for (const l of active) {
    if (l.IsMtm || !l.EndOn) {
      mtm++;
      continue;
    }
    const days = (new Date(l.EndOn).getTime() - now.getTime()) / dayMs;
    if (days < 0) continue; // already expired
    if (days <= 30) within30++;
    if (days <= 60) within60++;
    if (days <= 90) within90++;
  }

  return { within30, within60, within90, mtm, activeLeases: active.length };
}

// ============================================
// KPI 17: Work Orders Completed (MoM) (Section D)
// ============================================

export interface WorkOrdersCompletedKpi {
  thisMonth: number;
  lastMonth: number;
  momDelta: number;
  last90Days: number;
}

export async function fetchWorkOrdersCompletedKpi(): Promise<WorkOrdersCompletedKpi> {
  const config = getKpiConfig();
  if (!config) {
    return { thisMonth: 0, lastMonth: 0, momDelta: 0, last90Days: 0 };
  }

  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - 120);

  const workOrders = await v0FetchAll<V0WorkOrder>(
    '/work_orders',
    { 'filters[LastUpdatedAtFrom]': sinceDate.toISOString() },
    config
  );

  const now = new Date();
  const thisMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400000);

  let thisMonth = 0, lastMonth = 0, last90Days = 0;
  for (const wo of workOrders) {
    if (!wo.CompletedOn) continue;
    const c = new Date(wo.CompletedOn);
    if (c >= thisMonthStart && c <= now) thisMonth++;
    if (c >= lastMonthStart && c < thisMonthStart) lastMonth++;
    if (c >= ninetyDaysAgo && c <= now) last90Days++;
  }

  return { thisMonth, lastMonth, momDelta: thisMonth - lastMonth, last90Days };
}

// ============================================
// KPI 18: Maintenance Economics (Section D ★)
// ============================================

export interface MaintenanceEconomicsKpi {
  totalSpendTTM: number;
  inHouseDollars: number;
  outsourcedDollars: number;
  inHousePct: number;
  byCategory: Array<{ category: string; dollars: number }>;
  workOrdersCompletedTTM: number;
  costPerWorkOrder: number;
  costPerDoor: number;
}

/**
 * Trailing-12-month maintenance economics from /bills line items on the 6xxx
 * maintenance GL accounts, split in-house vs outsourced by the configured
 * internal-vendor IDs, grouped by GL category, with cost-per-WO and cost-per-
 * door derived from /work_orders + /units counts.
 *
 * In-house share is ~0% today by design — HDPM is just standing up its own
 * maintenance division; this KPI tracks that capture climbing over time.
 */
export async function fetchMaintenanceEconomicsKpi(): Promise<MaintenanceEconomicsKpi> {
  const config = getKpiConfig();
  const empty: MaintenanceEconomicsKpi = {
    totalSpendTTM: 0, inHouseDollars: 0, outsourcedDollars: 0, inHousePct: 0,
    byCategory: [], workOrdersCompletedTTM: 0, costPerWorkOrder: 0, costPerDoor: 0,
  };
  if (!config) return empty;

  const { internalVendorIds } = await getDashboardConfig();
  const internalSet = new Set(internalVendorIds);

  const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString();

  const [bills, glAccounts, workOrders, units] = await Promise.all([
    v0FetchAll<V0Bill>('/bills', { 'filters[LastUpdatedAtFrom]': yearAgo }, config),
    v0FetchAll<V0GlAccount>('/gl_accounts', {}, config),
    v0FetchAll<V0WorkOrder>('/work_orders', { 'filters[LastUpdatedAtFrom]': yearAgo }, config),
    v0FetchAll<V0Unit>('/units', { 'filters[LastUpdatedAtFrom]': '2000-01-01T00:00:00Z' }, config),
  ]);

  // Maintenance GL accounts: 6xxx expense accounts.
  const maintGl = new Map<string, string>();
  for (const a of glAccounts) {
    if (a.AccountType === 'ExpenseGlAccount' && (a.Number || '').startsWith('6')) {
      maintGl.set(a.Id, `${a.Number} ${a.Name || a.AccountName || ''}`.trim());
    }
  }

  let totalSpendTTM = 0;
  let inHouseDollars = 0;
  let outsourcedDollars = 0;
  const byCategoryMap = new Map<string, number>();

  for (const bill of bills) {
    let billMaint = 0;
    for (const li of bill.LineItems || []) {
      const catName = li.GlAccountId ? maintGl.get(li.GlAccountId) : undefined;
      if (!catName) continue;
      const amt = parseFloat(li.Amount || '0');
      billMaint += amt;
      byCategoryMap.set(catName, (byCategoryMap.get(catName) || 0) + amt);
    }
    if (billMaint === 0) continue;
    totalSpendTTM += billMaint;
    if (bill.VendorId && internalSet.has(bill.VendorId)) inHouseDollars += billMaint;
    else outsourcedDollars += billMaint;
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const inHousePct = totalSpendTTM > 0
    ? Math.round((inHouseDollars / totalSpendTTM) * 1000) / 10
    : 0;

  const byCategory = Array.from(byCategoryMap.entries())
    .map(([category, dollars]) => ({ category, dollars: round2(dollars) }))
    .sort((a, b) => b.dollars - a.dollars);

  const workOrdersCompletedTTM = workOrders.filter((wo) => {
    if (!wo.CompletedOn) return false;
    return new Date(wo.CompletedOn).toISOString() >= yearAgo;
  }).length;

  const doors = units.filter((u) => !u.HiddenAt).length;
  const costPerWorkOrder = workOrdersCompletedTTM > 0
    ? round2(totalSpendTTM / workOrdersCompletedTTM)
    : 0;
  const costPerDoor = doors > 0 ? round2(totalSpendTTM / doors) : 0;

  return {
    totalSpendTTM: round2(totalSpendTTM),
    inHouseDollars: round2(inHouseDollars),
    outsourcedDollars: round2(outsourcedDollars),
    inHousePct,
    byCategory,
    workOrdersCompletedTTM,
    costPerWorkOrder,
    costPerDoor,
  };
}
