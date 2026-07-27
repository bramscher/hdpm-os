const APPFOLIO_V0_BASE = 'https://api.appfolio.com/api/v0';

interface V0Unit {
  Id: string;
  PropertyId?: string;
  Bedrooms?: number | string;
  Bathrooms?: number | string;
  SquareFeet?: number | string;
  ListedRent?: number | string;
  MarketRent?: number | string;
  RentReady?: boolean;
  PostedToWebsite?: boolean;
  AvailableOn?: string;
  MarketingDescription?: string;
  AppliancesIncluded?: string[];
  Address1?: string;
  Address2?: string | null;
  City?: string;
  State?: string;
  Zip?: string;
  Status?: string;
  Name?: string;
}

interface V0Property {
  Id: string;
  Name?: string;
  Address1?: string;
  Address2?: string;
  City?: string;
  State?: string;
  Zip?: string;
  PropertyType?: string;
  HiddenAt?: string | null;
}

interface V0Tenant {
  Id: string;
  UnitId?: string;
  Status?: string;
  MoveOutOn?: string;
  HiddenAt?: string | null;
}

interface V0ListResponse<T> {
  data: T[];
  next_page_path?: string | null;
}

export interface VacantUnit {
  appfolio_unit_id: string;
  appfolio_property_id: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  bedrooms: number;
  bathrooms: number;
  rent: number;
  sqft: number;
  available_date: string;
  unit_type: string;
  amenities: string[];
  marketing_description: string;
  ready_for_posting: boolean;
  status_reason: string;
}

function parseNumber(val: unknown): number {
  if (val == null) return 0;
  if (typeof val === 'number' && !Number.isNaN(val)) return val;
  if (typeof val === 'string') {
    const n = parseFloat(val.replace(/[^0-9.-]/g, ''));
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

function mapUnitType(propertyType: string): string {
  const t = (propertyType || '').toLowerCase();
  if (t.includes('single') || t.includes('house') || t.includes('sfr')) return 'House';
  if (t.includes('apartment') || t.includes('apt')) return 'Apartment';
  if (t.includes('townhouse') || t.includes('townhome')) return 'Townhouse';
  if (t.includes('duplex')) return 'Duplex';
  if (t.includes('condo')) return 'Condo';
  if (t.includes('manufactured') || t.includes('mobile')) return 'Manufactured';
  if (t.includes('multi')) return 'Multi-Family';
  return propertyType || 'Rental';
}

async function v0Fetch<T>(
  path: string,
  params: Record<string, string>,
  auth: string,
  developerId: string
): Promise<V0ListResponse<T>> {
  const url = new URL(`${APPFOLIO_V0_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

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
    throw new Error(`AppFolio API error (${response.status}): ${text.substring(0, 300)}`);
  }

  return JSON.parse(text) as V0ListResponse<T>;
}

/**
 * Fetch all vacant units directly from the AppFolio v0 API.
 * This is the core logic — no HTTP/auth dependencies.
 */
export async function fetchVacantUnits(): Promise<VacantUnit[]> {
  const clientId = process.env.APPFOLIO_CLIENT_ID;
  const clientSecret = process.env.APPFOLIO_CLIENT_SECRET;
  const developerId = process.env.APPFOLIO_DEVELOPER_ID;

  if (!clientId || !clientSecret || !developerId) {
    throw new Error('AppFolio API credentials not configured');
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const devId = developerId;

  // Helper: paginate through an AppFolio v0 endpoint
  async function fetchAll<T>(
    path: string,
    filters: Record<string, string>,
    pageSize: number,
    maxPages: number
  ): Promise<T[]> {
    const all: T[] = [];
    let page = 1;
    // Follow next_page_path — the server may cap page[size] below what we
    // requested, so a short page is not an end-of-data signal.
    let nextPath: string | null = null;
    while (true) {
      const res: V0ListResponse<T> = await v0Fetch<T>(
        nextPath ?? path,
        nextPath
          ? {}
          : { ...filters, 'page[number]': '1', 'page[size]': String(pageSize) },
        auth,
        devId
      );
      all.push(...(res.data || []));
      if (!res.next_page_path) break;
      nextPath = res.next_page_path.replace(/^\/api\/v0/, '');
      page++;
      if (page > maxPages) break;
    }
    return all;
  }

  // Fetch properties, units, and tenants in parallel
  const [allProperties, allUnits, allTenants] = await Promise.all([
    fetchAll<V0Property>('/properties', { 'filters[LastUpdatedAtFrom]': '1970-01-01T00:00:00Z' }, 1000, 10),
    fetchAll<V0Unit>('/units', { 'filters[LastUpdatedAtFrom]': '2000-01-01T00:00:00Z' }, 1000, 10),
    fetchAll<V0Tenant>('/tenants', { 'filters[LastUpdatedAtFrom]': '2000-01-01T00:00:00Z' }, 1000, 10),
  ]);

  // Build property lookup map (exclude hidden)
  const propertyMap = new Map<string, V0Property>();
  for (const p of allProperties) {
    if (!p.HiddenAt) propertyMap.set(p.Id, p);
  }

  // Map of unitId -> earliest upcoming move-out date for tenants currently on notice
  const noticeUnitMoveOut = new Map<string, string>();
  for (const t of allTenants) {
    if (t.HiddenAt) continue;
    if ((t.Status || '').toLowerCase() !== 'notice') continue;
    if (!t.UnitId || !t.MoveOutOn) continue;
    const existing = noticeUnitMoveOut.get(t.UnitId);
    if (!existing || t.MoveOutOn < existing) {
      noticeUnitMoveOut.set(t.UnitId, t.MoveOutOn);
    }
  }

  // Return ALL units with a readiness flag. The UI's default view filters to
  // ready_for_posting=true; the search box queries across everything.
  const units: VacantUnit[] = [];

  for (const unit of allUnits) {
    const property = unit.PropertyId ? propertyMap.get(unit.PropertyId) : null;
    // Skip units whose parent property is hidden/inactive in AppFolio
    if (unit.PropertyId && !property) continue;

    const address = unit.Address1
      || (property ? [property.Address1, property.Address2].filter(Boolean).join(', ') : '');
    if (!address) continue;

    const city = unit.City || property?.City || '';
    const state = unit.State || property?.State || 'OR';
    const zip = unit.Zip || property?.Zip || '';

    const unitSuffix = unit.Name && unit.Name !== address ? ` ${unit.Name}` : '';
    const fullAddress = `${address}${unitSuffix}`.trim();

    const rent = Math.round(parseNumber(unit.ListedRent) || parseNumber(unit.MarketRent));

    const status = (unit.Status || '').toLowerCase();
    const isVacant = status.includes('vacant') || status.includes('available');
    const isOnNotice = noticeUnitMoveOut.has(unit.Id);

    // Classify readiness by AppFolio's vacancy listing "Website: Posted" flag.
    // When a property manager posts a vacancy to the website in AppFolio,
    // PostedToWebsite becomes true — that's the authoritative signal that
    // this unit is actively marketed and ready for Craigslist posting.
    let readyForPosting = false;
    let statusReason = '';
    if (unit.PostedToWebsite !== true) {
      statusReason = 'Not posted to website';
    } else {
      readyForPosting = true;
      if (isOnNotice) statusReason = 'On notice';
      else if (isVacant) statusReason = 'Vacant';
      else statusReason = 'Posted';
    }

    units.push({
      appfolio_unit_id: unit.Id,
      appfolio_property_id: unit.PropertyId || '',
      address: fullAddress,
      city,
      state,
      zip,
      bedrooms: Math.round(parseNumber(unit.Bedrooms)),
      bathrooms: parseNumber(unit.Bathrooms),
      rent,
      sqft: Math.round(parseNumber(unit.SquareFeet)),
      available_date: unit.AvailableOn || noticeUnitMoveOut.get(unit.Id) || '',
      unit_type: mapUnitType(property?.PropertyType || ''),
      amenities: unit.AppliancesIncluded || [],
      marketing_description: unit.MarketingDescription || '',
      ready_for_posting: readyForPosting,
      status_reason: statusReason,
    });
  }

  units.sort((a, b) => {
    // Ready-to-post units first, then by city/address
    if (a.ready_for_posting !== b.ready_for_posting) {
      return a.ready_for_posting ? -1 : 1;
    }
    return a.city.localeCompare(b.city) || a.address.localeCompare(b.address);
  });

  return units;
}
