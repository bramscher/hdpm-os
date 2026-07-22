/**
 * AppFolio Database API (v0) Client
 *
 * Fetches property and unit data from AppFolio's v0 Database API,
 * maps to our rental_comps schema for nightly sync.
 *
 * Uses the same credentials and API as the Konmashi integration.
 * API base: https://api.appfolio.com/api/v0
 * Auth: Basic (ClientId:ClientSecret) + X-AppFolio-Developer-ID header
 *
 * Required env vars:
 *   APPFOLIO_CLIENT_ID
 *   APPFOLIO_CLIENT_SECRET
 *   APPFOLIO_DEVELOPER_ID
 */

import type { CreateCompInput, Town, PropertyType } from '@/types/comps';

// ============================================
// Config
// ============================================

const APPFOLIO_V0_BASE = 'https://api.appfolio.com/api/v0';

function getConfig() {
  const clientId = process.env.APPFOLIO_CLIENT_ID;
  const clientSecret = process.env.APPFOLIO_CLIENT_SECRET;
  const developerId = process.env.APPFOLIO_DEVELOPER_ID;

  if (!clientId || !clientSecret || !developerId) {
    console.warn('[AppFolio] Missing API credentials — sync will be skipped');
    console.warn('[AppFolio] Need: APPFOLIO_CLIENT_ID, APPFOLIO_CLIENT_SECRET, APPFOLIO_DEVELOPER_ID');
    return null;
  }

  return { clientId, clientSecret, developerId };
}

// ============================================
// v0 API Client
// ============================================

interface V0ListResponse<T = Record<string, unknown>> {
  data: T[];
  next_page_path?: string | null;
}

async function v0Fetch<T>(
  path: string,
  params: Record<string, string>,
  clientId: string,
  clientSecret: string,
  developerId: string
): Promise<V0ListResponse<T>> {
  const url = new URL(`${APPFOLIO_V0_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Basic ${auth}`,
      'X-AppFolio-Developer-ID': developerId,
      Accept: 'application/json',
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`AppFolio v0 error (${response.status}): ${text.substring(0, 300)}`);
  }

  try {
    return JSON.parse(text) as V0ListResponse<T>;
  } catch {
    throw new Error(`AppFolio v0 invalid JSON: ${text.substring(0, 200)}`);
  }
}

// ============================================
// v0 API Types
// ============================================

interface V0Property {
  Id: string;
  Name?: string;
  Address1?: string;
  Address2?: string;
  City?: string;
  State?: string;
  Zip?: string;
  PropertyType?: string;
  LastUpdatedAt?: string;
  HiddenAt?: string | null;
}

interface V0Unit {
  Id: string;
  PropertyId?: string;
  Bedrooms?: number | string;
  Bathrooms?: number | string;
  SquareFeet?: number | string;
  ListedRent?: number | string;
  MarketRent?: number | string;
  RentReady?: boolean;
  AvailableOn?: string;
  MarketingDescription?: string;
  AppliancesIncluded?: string[];
  LastInspectedDate?: string | null;
  Address1?: string;
  Address2?: string | null;
  City?: string;
  State?: string;
  Zip?: string;
  Status?: string;
  Name?: string;
}

interface V0Vendor {
  Id: string;
  CompanyName?: string;
  FirstName?: string;
  LastName?: string;
  IsCompany?: boolean;
  HiddenAt?: string | null;
  LastUpdatedAt?: string;
}

// ============================================
// Town detection from city
// ============================================

const TOWN_MAP: Record<string, Town> = {
  bend: 'Bend',
  redmond: 'Redmond',
  sisters: 'Sisters',
  prineville: 'Prineville',
  culver: 'Culver',
};

function detectTown(city: string): Town | null {
  const normalized = (city || '').trim().toLowerCase();
  return TOWN_MAP[normalized] || null;
}

// ============================================
// Property type mapping
// ============================================

function mapPropertyType(appfolioType: string): PropertyType {
  const t = (appfolioType || '').toLowerCase();
  if (t.includes('single') || t.includes('house') || t.includes('sfr')) return 'SFR';
  if (t.includes('apartment') || t.includes('apt')) return 'Apartment';
  if (t.includes('townhouse') || t.includes('townhome')) return 'Townhouse';
  if (t.includes('duplex')) return 'Duplex';
  if (t.includes('condo')) return 'Condo';
  if (t.includes('manufactured') || t.includes('mobile')) return 'Manufactured';
  if (t.includes('multi')) return 'Apartment';
  return 'Other';
}

// ============================================
// Number parsing (v0 API returns some as strings)
// ============================================

function parseNumber(val: unknown): number {
  if (val == null) return 0;
  if (typeof val === 'number' && !Number.isNaN(val)) return val;
  if (typeof val === 'string') {
    const n = parseFloat(val.replace(/[^0-9.-]/g, ''));
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

// ============================================
// Fetch Properties (paginated)
// ============================================

async function fetchAllProperties(
  clientId: string,
  clientSecret: string,
  developerId: string
): Promise<V0Property[]> {
  const allProperties: V0Property[] = [];
  let pageNumber = 1;
  const pageSize = 1000;

  while (true) {
    console.log(`[AppFolio] Fetching properties page ${pageNumber}...`);
    const res = await v0Fetch<V0Property>(
      '/properties',
      {
        'filters[LastUpdatedAtFrom]': '1970-01-01T00:00:00Z',
        'page[number]': String(pageNumber),
        'page[size]': String(pageSize),
      },
      clientId,
      clientSecret,
      developerId
    );

    const properties = res.data || [];
    allProperties.push(...properties);
    console.log(`[AppFolio] Page ${pageNumber}: ${properties.length} properties`);

    // If we got fewer than pageSize, we're done
    if (properties.length < pageSize || !res.next_page_path) {
      break;
    }
    pageNumber++;

    // Safety: max 10 pages (10,000 properties)
    if (pageNumber > 10) {
      console.warn('[AppFolio] Hit max page limit (10), stopping pagination');
      break;
    }
  }

  return allProperties;
}

// ============================================
// Fetch Units for a Property
// ============================================

async function fetchUnitsForProperty(
  propertyId: string,
  clientId: string,
  clientSecret: string,
  developerId: string
): Promise<V0Unit[]> {
  const res = await v0Fetch<V0Unit>(
    '/units',
    {
      'filters[PropertyId]': propertyId,
      'filters[LastUpdatedAtFrom]': '1970-01-01T00:00:00Z',
      'page[number]': '1',
      'page[size]': '1000',
    },
    clientId,
    clientSecret,
    developerId
  );

  return res.data || [];
}

/**
 * Every unit across the portfolio, paginated. The v0 work-order endpoint only
 * carries UnitId, so the WO sync needs this to resolve unit_id → unit name.
 */
async function fetchAllUnits(
  clientId: string,
  clientSecret: string,
  developerId: string
): Promise<V0Unit[]> {
  const allUnits: V0Unit[] = [];
  let pageNumber = 1;
  const pageSize = 1000;

  while (true) {
    const res = await v0Fetch<V0Unit>(
      '/units',
      {
        'filters[LastUpdatedAtFrom]': '1970-01-01T00:00:00Z',
        'page[number]': String(pageNumber),
        'page[size]': String(pageSize),
      },
      clientId,
      clientSecret,
      developerId
    );

    const units = res.data || [];
    allUnits.push(...units);

    if (units.length < pageSize || !res.next_page_path) break;
    pageNumber++;
    // Safety: max 20 pages (20,000 units)
    if (pageNumber > 20) {
      console.warn('[AppFolio] Hit max unit page limit (20), stopping pagination');
      break;
    }
  }

  return allUnits;
}

/** A single unit resolved for the WO mirror: id → human name + street address. */
export interface UnitLite {
  id: string;
  name: string | null;
  address: string | null;
}

/**
 * Public unit fetch for the work-order sync. Returns a lightweight shape so the
 * sync can build a unitId → { name, address } map (unit_name is otherwise null,
 * because the v0 WO payload carries only UnitId).
 */
export async function fetchAllUnitsPublic(): Promise<UnitLite[]> {
  const config = getConfig();
  if (!config) return [];
  const units = await fetchAllUnits(config.clientId, config.clientSecret, config.developerId);
  return units.map((u) => ({
    id: u.Id,
    name: u.Name || null,
    address: [u.Address1, u.Address2].filter(Boolean).join(' ') || null,
  }));
}

// ============================================
// Public: Fetch & Map to Comps
// ============================================

export async function fetchAppFolioListings(syncUser: string): Promise<CreateCompInput[]> {
  const config = getConfig();
  if (!config) return [];

  const { clientId, clientSecret, developerId } = config;

  try {
    // Step 1: Fetch all properties
    const allProperties = await fetchAllProperties(clientId, clientSecret, developerId);
    console.log(`[AppFolio] Total properties: ${allProperties.length}`);

    // Step 2: Filter to our Central Oregon service area
    const serviceAreaProperties = allProperties.filter((p) => {
      if (p.HiddenAt) return false; // Skip hidden/inactive properties
      const town = detectTown(p.City || '');
      return town !== null;
    });
    console.log(`[AppFolio] Properties in service area: ${serviceAreaProperties.length}`);

    // Step 3: For each service area property, fetch units
    const comps: CreateCompInput[] = [];
    let unitCount = 0;

    for (const property of serviceAreaProperties) {
      const town = detectTown(property.City || '')!;
      const address = [property.Address1, property.Address2].filter(Boolean).join(', ');
      const fullAddress = [address, property.City, property.State, property.Zip]
        .filter(Boolean)
        .join(', ');

      try {
        const units = await fetchUnitsForProperty(
          property.Id,
          clientId,
          clientSecret,
          developerId
        );
        unitCount += units.length;

        for (const unit of units) {
          const rent = parseNumber(unit.ListedRent) || parseNumber(unit.MarketRent);
          if (!rent || rent <= 0) continue;

          const bedrooms = Math.round(parseNumber(unit.Bedrooms));
          const bathrooms = parseNumber(unit.Bathrooms);
          const rawSqft = parseNumber(unit.SquareFeet);
          const sqft = rawSqft ? Math.round(rawSqft) : undefined;

          comps.push({
            town,
            address: fullAddress || undefined,
            zip_code: property.Zip || undefined,
            bedrooms,
            bathrooms: bathrooms || undefined,
            sqft,
            property_type: mapPropertyType(property.PropertyType || ''),
            amenities: unit.AppliancesIncluded || [],
            monthly_rent: rent,
            rent_per_sqft:
              sqft && sqft > 0
                ? Math.round((rent / sqft) * 10000) / 10000
                : undefined,
            data_source: 'appfolio',
            comp_date: new Date().toISOString().split('T')[0],
            external_id: `appfolio-${property.Id}-${unit.Id}`,
            created_by: syncUser,
          });
        }
      } catch (err) {
        console.error(`[AppFolio] Error fetching units for property ${property.Id}:`, err);
        // Continue with other properties
      }
    }

    console.log(
      `[AppFolio] Fetched ${unitCount} units across ${serviceAreaProperties.length} properties`
    );
    console.log(`[AppFolio] Mapped ${comps.length} comps with rent data`);
    return comps;
  } catch (err) {
    console.error('[AppFolio] Sync error:', err);
    throw err;
  }
}

// ============================================
// Public: Search Properties by Address
// ============================================

export interface AppFolioPropertyResult {
  propertyId: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  propertyType: string;
  units: Array<{
    unitId: string;
    bedrooms: number;
    bathrooms: number;
    sqft: number;
    listedRent: number;
    marketRent: number;
    rentReady: boolean;
  }>;
}

/**
 * Fuzzy match score: how well does a search query match a target string?
 * Returns a score from 0 (no match) to higher = better match.
 * Handles: substring matches, word-order independence, partial words, typos.
 */
function fuzzyScore(query: string, target: string): number {
  if (!target) return 0;
  const q = query.toLowerCase().trim();
  const t = target.toLowerCase().trim();

  // Exact substring match — best score
  if (t.includes(q)) return 100;

  // Split into words for flexible matching
  const queryWords = q.split(/\s+/).filter(Boolean);
  const targetWords = t.split(/[\s,]+/).filter(Boolean);

  if (queryWords.length === 0) return 0;

  let totalScore = 0;

  for (const qw of queryWords) {
    let bestWordScore = 0;

    for (const tw of targetWords) {
      // Exact word match
      if (tw === qw) {
        bestWordScore = Math.max(bestWordScore, 20);
        continue;
      }

      // Word starts with query word (e.g. "main" matches "mainstream")
      if (tw.startsWith(qw)) {
        bestWordScore = Math.max(bestWordScore, 15);
        continue;
      }

      // Target word starts with query word or vice versa
      if (qw.startsWith(tw)) {
        bestWordScore = Math.max(bestWordScore, 12);
        continue;
      }

      // Substring match within a word
      if (tw.includes(qw) || qw.includes(tw)) {
        bestWordScore = Math.max(bestWordScore, 10);
        continue;
      }

      // Levenshtein-based typo tolerance (for words 4+ chars)
      if (qw.length >= 4 && tw.length >= 4) {
        const dist = levenshtein(qw, tw);
        const maxLen = Math.max(qw.length, tw.length);
        const similarity = 1 - dist / maxLen;
        if (similarity >= 0.6) {
          bestWordScore = Math.max(bestWordScore, Math.round(similarity * 12));
        }
      }

      // Number-only comparison (street numbers)
      if (/^\d+$/.test(qw) && tw.includes(qw)) {
        bestWordScore = Math.max(bestWordScore, 18);
      }
    }

    totalScore += bestWordScore;
  }

  return totalScore;
}

/**
 * Simple Levenshtein distance for short strings (typo detection).
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[m][n];
}

// ============================================
// Public: Fetch All Properties (exported for work order sync)
// ============================================

export async function fetchAllPropertiesPublic(): Promise<V0Property[]> {
  const config = getConfig();
  if (!config) return [];
  return fetchAllProperties(config.clientId, config.clientSecret, config.developerId);
}

// ============================================
// Public: Fetch All Vendors (for work order sync)
// ============================================

export async function fetchAllVendors(): Promise<Map<string, string>> {
  const config = getConfig();
  if (!config) return new Map();

  const { clientId, clientSecret, developerId } = config;
  const vendorMap = new Map<string, string>();
  let pageNumber = 1;

  // Fetch all vendors since the beginning of time
  const sinceDate = '2000-01-01T00:00:00Z';

  while (true) {
    const res = await v0Fetch<V0Vendor>(
      '/vendors',
      {
        'filters[LastUpdatedAtFrom]': sinceDate,
        'page[number]': String(pageNumber),
        'page[size]': '200',
      },
      clientId,
      clientSecret,
      developerId
    );

    const vendors = res.data || [];
    console.log(`[AppFolio] Vendors page ${pageNumber}: ${vendors.length} vendors`);

    for (const v of vendors) {
      const name = v.CompanyName
        || [v.FirstName, v.LastName].filter(Boolean).join(' ')
        || 'Unknown Vendor';
      vendorMap.set(v.Id, name);
    }

    if (vendors.length < 200 || !res.next_page_path) break;
    pageNumber++;
    if (pageNumber > 20) break; // safety limit
  }

  console.log(`[AppFolio] Total vendors fetched: ${vendorMap.size}`);
  return vendorMap;
}

export async function searchAppFolioProperties(
  searchAddress: string
): Promise<AppFolioPropertyResult[]> {
  const config = getConfig();
  if (!config) return [];

  const { clientId, clientSecret, developerId } = config;

  try {
    const allProperties = await fetchAllProperties(clientId, clientSecret, developerId);

    // Score all visible properties by fuzzy match quality
    const scored = allProperties
      .filter((p) => !p.HiddenAt)
      .map((p) => {
        const addr = (p.Address1 || '') + ' ' + (p.Address2 || '');
        const name = p.Name || '';
        const city = p.City || '';
        const full = `${addr} ${name} ${city}`.trim();
        const score = Math.max(
          fuzzyScore(searchAddress, addr),
          fuzzyScore(searchAddress, name),
          fuzzyScore(searchAddress, full)
        );
        return { property: p, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);

    // Take top 5 matches
    const topMatches = scored.slice(0, 5);

    // For each match, fetch units
    const results: AppFolioPropertyResult[] = [];

    for (const { property: prop } of topMatches) {
      try {
        const units = await fetchUnitsForProperty(
          prop.Id,
          clientId,
          clientSecret,
          developerId
        );

        results.push({
          propertyId: prop.Id,
          name: prop.Name || '',
          address: [prop.Address1, prop.Address2].filter(Boolean).join(', '),
          city: prop.City || '',
          state: prop.State || '',
          zip: prop.Zip || '',
          propertyType: prop.PropertyType || '',
          units: units.map((u) => ({
            unitId: u.Id,
            bedrooms: Math.round(parseNumber(u.Bedrooms)),
            bathrooms: parseNumber(u.Bathrooms),
            sqft: Math.round(parseNumber(u.SquareFeet)),
            listedRent: parseNumber(u.ListedRent),
            marketRent: parseNumber(u.MarketRent),
            rentReady: u.RentReady || false,
          })),
        });
      } catch (err) {
        console.error(`[AppFolio] Error fetching units for ${prop.Id}:`, err);
      }
    }

    return results;
  } catch (err) {
    console.error('[AppFolio] Property search error:', err);
    throw err;
  }
}

// ============================================
// v0 Work Order Types
// ============================================

interface V0AssignedUser {
  Id: string;
  FirstName?: string;
  LastName?: string;
  Name?: string;
}

interface V0WorkOrder {
  Id: string;
  PropertyId?: string;
  UnitId?: string;
  JobDescription?: string;
  Status?: string;
  Priority?: string;
  AssignedUsers?: V0AssignedUser[];
  VendorId?: string;
  WorkOrderNumber?: string;
  ScheduledStart?: string;
  ScheduledEnd?: string;
  CompletedOn?: string;
  CanceledOn?: string;
  PermissionToEnter?: boolean;
  CreatedAt?: string;
  LastUpdatedAt?: string;
  /** Deep link to the WO page in the AppFolio web app (service_requests/…/work_orders/…) */
  Link?: string;
  // Rich detail fields (not mirrored — fetched live for AI triage)
  TenantRemarks?: string;
  EntryInstructions?: string;
  PreferredTimes?: string;
  TenantAvailability?: string;
  VendorInstructions?: string;
  WorkOrderIssue?: string;
  SmartMaintenanceUrgency?: string;
  Type?: string;
  Recurring?: boolean;
}

export type WorkOrderStatus = 'open' | 'closed' | 'done';

export interface AppFolioWorkOrder {
  appfolioId: string;
  propertyId: string | null;
  unitId: string | null;
  woNumber: string | null;
  description: string;
  status: WorkOrderStatus;
  appfolioStatus: string;
  priority: string | null;
  assignedTo: string | null;
  vendorId: string | null;
  vendorName: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  completedDate: string | null;
  canceledDate: string | null;
  permissionToEnter: boolean;
  createdAt: string | null;
  /** AppFolio's own LastUpdatedAt — seed clock for time-in-status math */
  lastUpdatedAt: string | null;
  /** AppFolio web-app URL for this WO — the dashboard's "edit it in AppFolio" jump-off */
  link: string | null;
  /** AppFolio auto-generates recurring WOs weeks ahead — used to defer them off the board */
  recurring: boolean;
}

// ============================================
// Work Order Status Mapping
// ============================================

function mapWorkOrderStatus(appfolioStatus: string): WorkOrderStatus {
  const s = (appfolioStatus || '').toLowerCase().trim();
  if (s === 'completed' || s === 'complete' || s === 'work completed') return 'done';
  if (s === 'canceled' || s === 'cancelled' || s === 'closed') return 'closed';
  return 'open'; // "Open", "In Progress", etc.
}

// ============================================
// Public: Fetch Work Orders (paginated)
// ============================================

export async function fetchAppFolioWorkOrders(
  days = 90,
  vendorMap?: Map<string, string>
): Promise<AppFolioWorkOrder[]> {
  const config = getConfig();
  if (!config) return [];

  const { clientId, clientSecret, developerId } = config;

  // Fetch work orders updated within the given window.
  // Default 90 days — keeps Sync Now fast. Webhooks handle real-time updates.
  // (1970 causes a 533 "Data unavailable" error, so always use a recent date.)
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - days);
  const lastUpdatedFrom = sinceDate.toISOString();

  const pageSize = 200;

  // Retry logic for 533 "Data unavailable" — AppFolio may need time to prepare
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 3000;

  async function fetchPage(pageNumber: number): Promise<V0ListResponse<V0WorkOrder>> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await v0Fetch<V0WorkOrder>(
          '/work_orders',
          {
            'filters[LastUpdatedAtFrom]': lastUpdatedFrom,
            'page[number]': String(pageNumber),
            'page[size]': String(pageSize),
          },
          clientId,
          clientSecret,
          developerId
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const is533 = msg.includes('(533)');
        if (is533 && attempt < MAX_RETRIES) {
          console.warn(`[AppFolio] 533 on page ${pageNumber}, retrying in ${RETRY_DELAY_MS}ms (attempt ${attempt}/${MAX_RETRIES})...`);
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
        throw err;
      }
    }
    throw new Error('Unreachable');
  }

  // Fetch first page
  console.log(`[AppFolio] Fetching work orders (since ${lastUpdatedFrom})...`);
  const firstPage = await fetchPage(1);

  const allWorkOrders: V0WorkOrder[] = [...(firstPage.data || [])];
  let pageNumber = 1;
  console.log(`[AppFolio] Page 1: ${allWorkOrders.length} work orders`);

  // Continue pagination if first page was full
  if (allWorkOrders.length >= pageSize && firstPage.next_page_path) {
    while (true) {
      pageNumber++;
      console.log(`[AppFolio] Fetching work orders page ${pageNumber}...`);
      const res = await fetchPage(pageNumber);

      const orders = res.data || [];
      allWorkOrders.push(...orders);
      console.log(`[AppFolio] Page ${pageNumber}: ${orders.length} work orders`);

      if (orders.length < pageSize || !res.next_page_path) break;
      if (pageNumber > 50) {
        console.warn('[AppFolio] Hit max page limit (50), stopping pagination');
        break;
      }
    }
  }

  console.log(`[AppFolio] Total work orders fetched: ${allWorkOrders.length}`);

  return allWorkOrders.map((wo) => ({
    appfolioId: wo.Id,
    propertyId: wo.PropertyId || null,
    unitId: wo.UnitId || null,
    woNumber: wo.WorkOrderNumber || null,
    description: wo.JobDescription || '',
    status: mapWorkOrderStatus(wo.Status || ''),
    appfolioStatus: wo.Status || '',
    priority: wo.Priority || null,
    assignedTo: wo.AssignedUsers?.map(u => u.Name || `${u.FirstName || ''} ${u.LastName || ''}`.trim()).filter(Boolean).join(', ') || null,
    vendorId: wo.VendorId || null,
    vendorName: (wo.VendorId && vendorMap?.get(wo.VendorId)) || null,
    scheduledStart: wo.ScheduledStart || null,
    scheduledEnd: wo.ScheduledEnd || null,
    completedDate: wo.CompletedOn || null,
    canceledDate: wo.CanceledOn || null,
    permissionToEnter: wo.PermissionToEnter || false,
    createdAt: wo.CreatedAt || null,
    lastUpdatedAt: wo.LastUpdatedAt || null,
    link: wo.Link || null,
    recurring: wo.Recurring === true,
  }));
}

// ============================================
// Public: Fetch full raw work-order detail by AppFolio ID
// (filters[Id] is supported by the v0 API — single-row response with the
// rich fields we don't mirror: TenantRemarks, EntryInstructions, etc.
// Used by AI triage at generation time.)
// ============================================

export async function fetchWorkOrderDetails(appfolioId: string): Promise<V0WorkOrder | null> {
  const config = getConfig();
  if (!config) return null;

  try {
    const res = await v0Fetch<V0WorkOrder>(
      '/work_orders',
      { 'filters[Id]': appfolioId },
      config.clientId,
      config.clientSecret,
      config.developerId
    );
    return res.data?.[0] ?? null;
  } catch (err) {
    console.error(`[AppFolio] Error fetching work order detail ${appfolioId}:`, err);
    return null;
  }
}

// ============================================
// Public: Fetch a single bill / journal entry by AppFolio ID
// (used by the webhook inspection handler — both endpoints support filters[Id])
// ============================================

/** Fetch one bill by Id (returns the raw v0 record for inspection/capture). */
export async function fetchBillById(
  id: string
): Promise<Record<string, unknown> | null> {
  const config = getConfig();
  if (!config) return null;
  try {
    const res = await v0Fetch<Record<string, unknown>>(
      '/bills',
      { 'filters[Id]': id },
      config.clientId,
      config.clientSecret,
      config.developerId
    );
    return res.data?.[0] ?? null;
  } catch (err) {
    console.error(`[AppFolio] Error fetching bill ${id}:`, err);
    throw err;
  }
}

/** Raw v0 bill record (fields verified against live payloads 2026-07-22). */
export interface V0Bill {
  Id: string;
  Reference?: string | null;
  Description?: string | null;
  VendorId?: string | null;
  TotalAmount?: string | null;
  InvoiceDate?: string | null;
  DueDate?: string | null;
  ApprovalStatus?: string | null;
  LastUpdatedAt?: string | null;
  LineItems?: Array<Record<string, unknown>>;
}

/**
 * Fetch all bills updated since the given ISO timestamp, across all vendors
 * (the /bills endpoint has no VendorId filter — callers filter client-side).
 */
export async function fetchBillsUpdatedSince(isoDate: string): Promise<V0Bill[]> {
  const config = getConfig();
  if (!config) return [];

  const bills: V0Bill[] = [];
  let path = '/bills';
  let params: Record<string, string> | null = {
    'filters[LastUpdatedAtFrom]': isoDate,
    'page[number]': '1',
    'page[size]': '1000',
  };

  while (path) {
    const res: V0ListResponse<V0Bill> = await v0Fetch<V0Bill>(
      path,
      params ?? {},
      config.clientId,
      config.clientSecret,
      config.developerId
    );
    bills.push(...(res.data ?? []));
    if (res.next_page_path) {
      // next_page_path is relative to the API host and carries its own query.
      path = res.next_page_path.replace(/^\/api\/v0/, '');
      params = null;
    } else {
      path = '';
    }
  }

  return bills;
}

/** Fetch one journal entry by Id (the only way to read a journal entry — no list). */
export async function fetchJournalEntryById(
  id: string
): Promise<Record<string, unknown> | null> {
  const config = getConfig();
  if (!config) return null;
  try {
    const res = await v0Fetch<Record<string, unknown>>(
      '/journal_entries',
      { 'filters[Id]': id },
      config.clientId,
      config.clientSecret,
      config.developerId
    );
    return res.data?.[0] ?? null;
  } catch (err) {
    console.error(`[AppFolio] Error fetching journal entry ${id}:`, err);
    throw err;
  }
}

// ============================================
// Public: Fetch Single Work Order by AppFolio ID
// (used by webhook handler — lightweight fetch)
// ============================================

export async function fetchWorkOrderById(
  entityId: string
): Promise<AppFolioWorkOrder | null> {
  const config = getConfig();
  if (!config) return null;

  const { clientId, clientSecret, developerId } = config;

  // Fetch work orders updated in the last 24 hours — the webhook just fired,
  // so the record was recently updated. This keeps the response small.
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  try {
    const res = await v0Fetch<V0WorkOrder>(
      '/work_orders',
      {
        'filters[LastUpdatedAtFrom]': oneDayAgo,
        'page[number]': '1',
        'page[size]': '200',
      },
      clientId,
      clientSecret,
      developerId
    );

    const match = (res.data || []).find((wo) => wo.Id === entityId);
    if (!match) {
      console.warn(`[AppFolio] Work order ${entityId} not found in recent updates`);
      return null;
    }

    return {
      appfolioId: match.Id,
      propertyId: match.PropertyId || null,
      unitId: match.UnitId || null,
      woNumber: match.WorkOrderNumber || null,
      description: match.JobDescription || '',
      status: mapWorkOrderStatus(match.Status || ''),
      appfolioStatus: match.Status || '',
      priority: match.Priority || null,
      assignedTo: match.AssignedUsers?.map(u => u.Name || `${u.FirstName || ''} ${u.LastName || ''}`.trim()).filter(Boolean).join(', ') || null,
      vendorId: match.VendorId || null,
      vendorName: null, // Not resolved in single-fetch — webhook handler doesn't need it
      scheduledStart: match.ScheduledStart || null,
      scheduledEnd: match.ScheduledEnd || null,
      completedDate: match.CompletedOn || null,
      canceledDate: match.CanceledOn || null,
      permissionToEnter: match.PermissionToEnter || false,
      createdAt: match.CreatedAt || null,
      lastUpdatedAt: match.LastUpdatedAt || null,
      link: match.Link || null,
      recurring: match.Recurring === true,
    };
  } catch (err) {
    console.error(`[AppFolio] Error fetching work order ${entityId}:`, err);
    return null;
  }
}

// ============================================
// Public: Fetch Single Property by AppFolio ID
// (used by webhook handler to get name/address)
// ============================================

export async function fetchPropertyById(
  propertyId: string
): Promise<{ name: string; address: string } | null> {
  const config = getConfig();
  if (!config) return null;

  const { clientId, clientSecret, developerId } = config;

  try {
    // Fetch page 1 of properties (most PM companies have < 1000)
    const res = await v0Fetch<V0Property>(
      '/properties',
      {
        'filters[LastUpdatedAtFrom]': '1970-01-01T00:00:00Z',
        'page[number]': '1',
        'page[size]': '1000',
      },
      clientId,
      clientSecret,
      developerId
    );

    const match = (res.data || []).find((p) => p.Id === propertyId);
    if (!match) return null;

    const address = [match.Address1, match.Address2, match.City, match.State, match.Zip]
      .filter(Boolean)
      .join(', ');

    return {
      name: match.Name || match.Address1 || 'Unknown',
      address,
    };
  } catch (err) {
    console.error(`[AppFolio] Error fetching property ${propertyId}:`, err);
    return null;
  }
}

// ============================================
// v0 Tenant Types
// ============================================

interface V0Tenant {
  Id: string;
  FirstName?: string;
  LastName?: string;
  PropertyId?: string;
  UnitId?: string;
  Status?: string;
  MoveInOn?: string;
  MoveOutOn?: string;
  LeaseStartDate?: string;
  LeaseEndDate?: string;
  LeaseSignedDate?: string;
  IsMonthlyLease?: boolean;
  CurrentRent?: string;
  PrimaryTenant?: boolean;
  HiddenAt?: string | null;
  LastUpdatedAt?: string;
  Addresses?: Array<{
    Address1?: string;
    Address2?: string;
    City?: string;
    State?: string;
    PostalCode?: string;
    IsPrimary?: boolean;
  }>;
}

export interface AppFolioTenant {
  id: string;
  firstName: string;
  lastName: string;
  propertyId: string | null;
  unitId: string | null;
  status: string;
  moveInOn: string | null;
  moveOutOn: string | null;
  leaseStartDate: string | null;
  leaseEndDate: string | null;
  email: string | null;
  phone: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  currentRent: number | null;
  isPrimary: boolean;
}

// ============================================
// Public: Fetch All Tenants (paginated)
// ============================================

export async function fetchAppFolioTenants(): Promise<AppFolioTenant[]> {
  const config = getConfig();
  if (!config) return [];

  const { clientId, clientSecret, developerId } = config;
  const allTenants: AppFolioTenant[] = [];
  let pageNumber = 1;
  const pageSize = 200;

  while (true) {
    console.log(`[AppFolio] Fetching tenants page ${pageNumber}...`);
    const res = await v0Fetch<V0Tenant>(
      '/tenants',
      {
        'filters[LastUpdatedAtFrom]': '2000-01-01T00:00:00Z',
        'page[number]': String(pageNumber),
        'page[size]': String(pageSize),
      },
      clientId,
      clientSecret,
      developerId
    );

    const tenants = res.data || [];
    console.log(`[AppFolio] Page ${pageNumber}: ${tenants.length} tenants`);

    for (const t of tenants) {
      if (t.HiddenAt) continue; // Skip hidden/removed tenants

      const primaryAddr = t.Addresses?.find(a => a.IsPrimary) || t.Addresses?.[0];

      allTenants.push({
        id: t.Id,
        firstName: t.FirstName || '',
        lastName: t.LastName || '',
        propertyId: t.PropertyId || null,
        unitId: t.UnitId || null,
        status: t.Status || '',
        moveInOn: t.MoveInOn || null,
        moveOutOn: t.MoveOutOn || null,
        leaseStartDate: t.LeaseStartDate || null,
        leaseEndDate: t.LeaseEndDate || null,
        email: extractEmail(t as unknown as RawRecord),
        phone: extractPhone(t as unknown as RawRecord),
        address1: primaryAddr?.Address1 || null,
        address2: primaryAddr?.Address2 || null,
        city: primaryAddr?.City || null,
        currentRent: t.CurrentRent ? parseFloat(t.CurrentRent) : null,
        isPrimary: t.PrimaryTenant || false,
      });
    }

    if (tenants.length < pageSize || !res.next_page_path) break;
    pageNumber++;
    if (pageNumber > 50) {
      console.warn('[AppFolio] Hit max tenant page limit (50), stopping');
      break;
    }
  }

  console.log(`[AppFolio] Total tenants fetched: ${allTenants.length}`);
  return allTenants;
}

// ============================================
// Public: Fetch All Units with LastInspectedDate
// ============================================

export interface AppFolioUnit {
  id: string;
  propertyId: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  name: string | null;
  status: string | null;
  lastInspectedDate: string | null;
}

export async function fetchAppFolioUnits(): Promise<AppFolioUnit[]> {
  const config = getConfig();
  if (!config) return [];

  const { clientId, clientSecret, developerId } = config;
  const allUnits: AppFolioUnit[] = [];
  let pageNumber = 1;
  const pageSize = 200;

  while (true) {
    console.log(`[AppFolio] Fetching units page ${pageNumber}...`);
    const res = await v0Fetch<V0Unit>(
      '/units',
      {
        'filters[LastUpdatedAtFrom]': '2000-01-01T00:00:00Z',
        'page[number]': String(pageNumber),
        'page[size]': String(pageSize),
      },
      clientId,
      clientSecret,
      developerId
    );

    const units = res.data || [];
    console.log(`[AppFolio] Page ${pageNumber}: ${units.length} units`);

    for (const u of units) {
      if ((u as unknown as Record<string, unknown>).HiddenAt) continue;

      allUnits.push({
        id: u.Id,
        propertyId: u.PropertyId || null,
        address1: u.Address1 || null,
        address2: u.Address2 || null,
        city: u.City || null,
        state: u.State || null,
        zip: u.Zip || null,
        name: u.Name || null,
        status: u.Status || null,
        lastInspectedDate: u.LastInspectedDate || null,
      });
    }

    if (units.length < pageSize || !res.next_page_path) break;
    pageNumber++;
    if (pageNumber > 50) {
      console.warn('[AppFolio] Hit max unit page limit (50), stopping');
      break;
    }
  }

  console.log(`[AppFolio] Total units fetched: ${allUnits.length}`);
  return allUnits;
}

// ============================================
// Public: Fetch Properties with CustomValues (Use Custom Inspection Date / Owner Name)
// ============================================

interface V0PropertyWithCustomValues extends V0Property {
  CustomValues?: Array<{ Name: string; Value: string }>;
}

export interface AppFolioPropertyWithCustomFields {
  appfolioPropertyId: string;
  name: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  ownerName: string | null;
  useCustomInspectionDate: boolean;
  hidden: boolean;
  customValueNames: string[];
}

const TRUTHY_CUSTOM_VALUES = new Set(['yes', 'true', '1', 'y', 'checked', 'on']);

function isTruthyCustomValue(value: string | undefined | null): boolean {
  if (!value) return false;
  return TRUTHY_CUSTOM_VALUES.has(value.trim().toLowerCase());
}

const INSPECTION_FLAG_NAMES = [
  'Use Custom Inspection Date',
  'Custom Inspection Date',
  'Use Custom Inspection Schedule',
];

const OWNER_NAME_FIELD_NAMES = ['Owner Name', 'Owner', 'Property Owner'];

function findCustomValue(
  values: Array<{ Name: string; Value: string }> | undefined,
  candidates: string[]
): { Name: string; Value: string } | undefined {
  if (!values) return undefined;
  for (const candidate of candidates) {
    const match = values.find((cv) => cv.Name === candidate);
    if (match) return match;
  }
  return undefined;
}

// ============================================
// Contact fetching for Zoom Phone sync
// (vendors / owners / tenants, with phone + email)
//
// AppFolio v0 isn't consistent about how it exposes phone/email across entity
// types, so these helpers extract defensively from several possible shapes.
// ============================================

export type ZoomContactType = 'vendor' | 'owner' | 'tenant';

export interface AppFolioContact {
  appfolioId: string;
  type: ZoomContactType;
  /** Display name, formatted per HDPM's spec: "V - ...", "O - ...", "T - ... - <addr>". */
  name: string;
  /** Raw phone as AppFolio returns it; normalized to E.164 by the sync layer. */
  phoneRaw: string | null;
  email: string | null;
  /** Property address for tenants; null otherwise. */
  propertyAddress: string | null;
}

type RawRecord = Record<string, unknown>;

function asString(v: unknown): string | null {
  if (typeof v === 'string') {
    const t = v.trim();
    return t.length ? t : null;
  }
  if (typeof v === 'number') return String(v);
  return null;
}

/** Pull the first usable phone string from the many shapes AppFolio may use. */
function extractPhone(raw: RawRecord): string | null {
  // Array forms: PhoneNumbers: [{ PhoneNumber } | { Number } | string]
  const arr = raw.PhoneNumbers ?? raw.Phones;
  if (Array.isArray(arr)) {
    for (const entry of arr) {
      if (typeof entry === 'string') {
        const s = asString(entry);
        if (s) return s;
      } else if (entry && typeof entry === 'object') {
        const o = entry as RawRecord;
        const s = asString(o.PhoneNumber) ?? asString(o.Number) ?? asString(o.Phone);
        if (s) return s;
      }
    }
  }
  // Scalar forms, in rough priority order.
  const scalarKeys = [
    'MobilePhone', 'CellPhone', 'PrimaryPhone', 'Phone', 'PhoneNumber',
    'HomePhone', 'WorkPhone', 'DayPhone', 'EveningPhone',
  ];
  for (const k of scalarKeys) {
    const s = asString(raw[k]);
    if (s) return s;
  }
  return null;
}

function extractEmail(raw: RawRecord): string | null {
  const direct = asString(raw.Email) ?? asString(raw.EmailAddress) ?? asString(raw.PrimaryEmail);
  if (direct) return direct;
  const arr = raw.Emails ?? raw.EmailAddresses;
  if (Array.isArray(arr)) {
    for (const entry of arr) {
      if (typeof entry === 'string') {
        const s = asString(entry);
        if (s) return s;
      } else if (entry && typeof entry === 'object') {
        const o = entry as RawRecord;
        const s = asString(o.EmailAddress) ?? asString(o.Email);
        if (s) return s;
      }
    }
  }
  return null;
}

async function fetchAllRaw(path: string): Promise<RawRecord[]> {
  const config = getConfig();
  if (!config) return [];
  const { clientId, clientSecret, developerId } = config;

  const all: RawRecord[] = [];
  let pageNumber = 1;
  const pageSize = 200;

  while (true) {
    const res = await v0Fetch<RawRecord>(
      path,
      {
        'filters[LastUpdatedAtFrom]': '2000-01-01T00:00:00Z',
        'page[number]': String(pageNumber),
        'page[size]': String(pageSize),
      },
      clientId,
      clientSecret,
      developerId
    );
    const rows = res.data || [];
    all.push(...rows);
    if (rows.length < pageSize || !res.next_page_path) break;
    pageNumber++;
    if (pageNumber > 50) {
      console.warn(`[AppFolio] Hit max page limit (50) on ${path}, stopping`);
      break;
    }
  }
  return all;
}

export async function fetchAppFolioVendorContacts(): Promise<AppFolioContact[]> {
  const rows = await fetchAllRaw('/vendors');
  const out: AppFolioContact[] = [];
  for (const r of rows) {
    if (r.HiddenAt) continue;
    const id = asString(r.Id);
    if (!id) continue;
    const name =
      asString(r.CompanyName) ||
      [asString(r.FirstName), asString(r.LastName)].filter(Boolean).join(' ') ||
      'Unknown Vendor';
    out.push({
      appfolioId: id,
      type: 'vendor',
      name: `V - ${name}`,
      phoneRaw: extractPhone(r),
      email: extractEmail(r),
      propertyAddress: null,
    });
  }
  console.log(`[AppFolio] Vendor contacts: ${out.length}`);
  return out;
}

export async function fetchAppFolioOwnerContacts(): Promise<AppFolioContact[]> {
  const rows = await fetchAllRaw('/owners');
  const out: AppFolioContact[] = [];
  for (const r of rows) {
    if (r.HiddenAt) continue;
    const id = asString(r.Id);
    if (!id) continue;
    const name =
      asString(r.CompanyName) ||
      [asString(r.FirstName), asString(r.LastName)].filter(Boolean).join(' ') ||
      asString(r.Name) ||
      'Unknown Owner';
    out.push({
      appfolioId: id,
      type: 'owner',
      name: `O - ${name}`,
      phoneRaw: extractPhone(r),
      email: extractEmail(r),
      propertyAddress: null,
    });
  }
  console.log(`[AppFolio] Owner contacts: ${out.length}`);
  return out;
}

export async function fetchAppFolioTenantContacts(): Promise<AppFolioContact[]> {
  const rows = await fetchAllRaw('/tenants');
  const today = new Date().toISOString().split('T')[0];
  const out: AppFolioContact[] = [];

  for (const r of rows) {
    if (r.HiddenAt) continue;
    const id = asString(r.Id);
    if (!id) continue;

    // Current residents only: skip anyone whose move-out date is in the past.
    const moveOut = asString(r.MoveOutOn);
    if (moveOut && moveOut < today) continue;
    const status = (asString(r.Status) || '').toLowerCase();
    if (status === 'past' || status === 'former' || status === 'evicted') continue;

    const fullName =
      [asString(r.FirstName), asString(r.LastName)].filter(Boolean).join(' ') ||
      asString(r.Name) ||
      'Unknown Tenant';

    // Property address from the tenant's primary address.
    let addr: string | null = null;
    const addresses = r.Addresses;
    if (Array.isArray(addresses) && addresses.length) {
      const a =
        (addresses.find((x) => (x as RawRecord)?.IsPrimary) as RawRecord) ||
        (addresses[0] as RawRecord);
      addr = [asString(a.Address1), asString(a.City)].filter(Boolean).join(', ') || null;
    }

    const display = addr ? `T - ${fullName} - ${addr}` : `T - ${fullName}`;

    out.push({
      appfolioId: id,
      type: 'tenant',
      name: display,
      phoneRaw: extractPhone(r),
      email: extractEmail(r),
      propertyAddress: addr,
    });
  }
  console.log(`[AppFolio] Tenant contacts (current): ${out.length}`);
  return out;
}

/** Fetch contacts for the requested types, in one call. */
export async function fetchAppFolioZoomContacts(
  types: ZoomContactType[]
): Promise<AppFolioContact[]> {
  const tasks: Promise<AppFolioContact[]>[] = [];
  if (types.includes('vendor')) tasks.push(fetchAppFolioVendorContacts());
  if (types.includes('owner')) tasks.push(fetchAppFolioOwnerContacts());
  if (types.includes('tenant')) tasks.push(fetchAppFolioTenantContacts());
  const results = await Promise.all(tasks);
  return results.flat();
}

export async function fetchAppFolioPropertiesWithCustomFields(): Promise<
  AppFolioPropertyWithCustomFields[]
> {
  const config = getConfig();
  if (!config) return [];

  const { clientId, clientSecret, developerId } = config;
  const allProperties: V0PropertyWithCustomValues[] = [];
  let pageNumber = 1;
  const pageSize = 1000;

  while (true) {
    console.log(`[AppFolio] Fetching properties (with CustomValues) page ${pageNumber}...`);
    const res = await v0Fetch<V0PropertyWithCustomValues>(
      '/properties',
      {
        'filters[LastUpdatedAtFrom]': '1970-01-01T00:00:00Z',
        'page[number]': String(pageNumber),
        'page[size]': String(pageSize),
      },
      clientId,
      clientSecret,
      developerId
    );

    const props = res.data || [];
    allProperties.push(...props);
    console.log(`[AppFolio] Page ${pageNumber}: ${props.length} properties`);

    if (props.length < pageSize || !res.next_page_path) break;
    pageNumber++;
    if (pageNumber > 10) {
      console.warn('[AppFolio] Hit max property page limit (10), stopping');
      break;
    }
  }

  return allProperties.map((p) => {
    const inspectionFlag = findCustomValue(p.CustomValues, INSPECTION_FLAG_NAMES);
    const ownerField = findCustomValue(p.CustomValues, OWNER_NAME_FIELD_NAMES);
    return {
      appfolioPropertyId: p.Id,
      name: p.Name || null,
      address1: p.Address1 || null,
      address2: p.Address2 || null,
      city: p.City || null,
      state: p.State || null,
      zip: p.Zip || null,
      ownerName: ownerField?.Value?.trim() || null,
      useCustomInspectionDate: isTruthyCustomValue(inspectionFlag?.Value),
      hidden: Boolean(p.HiddenAt),
      customValueNames: (p.CustomValues || []).map((cv) => cv.Name),
    };
  });
}

/**
 * Owner name per property via GET /owners?filters[PropertyId]=… — the
 * "Owner Name" custom field is unused in this AppFolio account, so the
 * owners endpoint is the only reliable source. One request per property,
 * concurrency-limited; multiple owners are joined with " & ".
 */
export async function fetchAppFolioPropertyOwnerMap(
  propertyIds: string[]
): Promise<Map<string, string>> {
  const config = getConfig();
  const map = new Map<string, string>();
  if (!config) return map;
  const { clientId, clientSecret, developerId } = config;

  // The v0 API rate-limits aggressively (429 after ~60 quick requests), so
  // pace lookups and back off on 429. Callers keep the request count small
  // by only asking for properties that still need an owner.
  const CONCURRENCY = 2;
  const PACE_MS = 350;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const queue = [...new Set(propertyIds)];
  async function lookup(propertyId: string): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await v0Fetch<RawRecord>(
          '/owners',
          {
            'filters[LastUpdatedAtFrom]': '2000-01-01T00:00:00Z',
            'filters[PropertyId]': propertyId,
            'page[number]': '1',
            'page[size]': '10',
          },
          clientId,
          clientSecret,
          developerId
        );
        const names = (res.data || [])
          .filter((o) => !o.HiddenAt)
          .map(
            (o) =>
              (asString(o.CompanyName) || '').trim() ||
              [asString(o.FirstName), asString(o.LastName)].filter(Boolean).join(' ').trim()
          )
          .filter(Boolean);
        if (names.length > 0) map.set(propertyId, names.join(' & '));
        return;
      } catch (err) {
        const is429 = err instanceof Error && err.message.includes('(429)');
        if (is429 && attempt < 3) {
          await sleep(15000 * (attempt + 1));
          continue;
        }
        console.warn('[AppFolio] owner lookup failed for property', propertyId, err);
        return;
      }
    }
  }
  async function worker() {
    while (queue.length > 0) {
      const propertyId = queue.shift();
      if (!propertyId) return;
      await lookup(propertyId);
      await sleep(PACE_MS);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  console.log(`[AppFolio] Owner map: ${map.size}/${propertyIds.length} properties resolved`);
  return map;
}

// ============================================
// Vendor contact field audit (Brief D.5 diagnostics)
// ============================================

/**
 * Diagnose why vendor emails come back null: fetch the raw /vendors records
 * for the given AppFolio vendor ids and report what fields actually exist,
 * with any email-looking values redacted to x***@domain. Craig confirmed
 * ~99% of vendors have email+phone in AppFolio, yet extractEmail() finds
 * few — this tells us the real field name(s) so the extractor can be fixed.
 */
export async function auditVendorContactFields(vendorIds: string[]): Promise<
  {
    id: string;
    name: string | null;
    fieldNames: string[];
    emailLike: { path: string; redacted: string }[];
    extractedEmail: string | null;
    extractedPhone: string | null;
  }[]
> {
  const wanted = new Set(vendorIds);
  const rows = await fetchAllRaw('/vendors');
  const out = [];

  const redact = (v: string): string => {
    const at = v.indexOf('@');
    if (at <= 0) return 'x***';
    return `${v[0]}***${v.slice(at)}`;
  };

  const scan = (value: unknown, path: string, depth: number, found: { path: string; redacted: string }[]) => {
    if (depth > 3 || found.length >= 10) return;
    if (typeof value === 'string') {
      if (/@[^@\s]+\.[^@\s]+/.test(value)) found.push({ path, redacted: redact(value.trim()) });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => scan(v, `${path}[${i}]`, depth + 1, found));
      return;
    }
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value as RawRecord)) {
        scan(v, path ? `${path}.${k}` : k, depth + 1, found);
      }
    }
  };

  for (const r of rows) {
    const id = asString(r.Id);
    if (!id || !wanted.has(id)) continue;
    const emailLike: { path: string; redacted: string }[] = [];
    scan(r, '', 0, emailLike);
    out.push({
      id,
      name:
        asString(r.CompanyName) ||
        [asString(r.FirstName), asString(r.LastName)].filter(Boolean).join(' ') ||
        null,
      fieldNames: Object.keys(r),
      emailLike,
      extractedEmail: extractEmail(r),
      extractedPhone: extractPhone(r),
    });
  }
  return out;
}
