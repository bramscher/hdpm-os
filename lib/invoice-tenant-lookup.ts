/**
 * Tenant details for a tenant-charge invoice, so the tech doesn't have to know
 * them. Matches the work order's property address (+ unit) against the units
 * the nightly AppFolio sync keeps in inspection_properties (current tenants,
 * financially responsible occupants). Pure matching; the route does the query.
 */

export interface TenantUnitRow {
  address_1: string | null;
  address_2: string | null;
  city: string | null;
  resident_name: string | null;
  financially_responsible_occupants: string[] | null;
  last_appfolio_sync_at: string | null;
  active?: boolean | null;
}

export interface TenantMatch {
  /** Name(s) as on the lease: financially responsible occupants, else the primary contact. */
  tenantName: string;
  unit: string;
  address: string;
  syncedAt: string | null;
}

const words = (s: string | null | undefined) =>
  (s || '')
    .toLowerCase()
    .replace(/[.,#]/g, ' ')
    .replace(/\b(street)\b/g, 'st').replace(/\b(avenue)\b/g, 'ave').replace(/\b(drive)\b/g, 'dr')
    .replace(/\b(road)\b/g, 'rd').replace(/\b(lane)\b/g, 'ln').replace(/\b(loop)\b/g, 'lp').replace(/\b(court)\b/g, 'ct')
    .split(/\s+/)
    .filter(Boolean);

/** "Unit 7", "#7", "Apt 7", "7" → "7". */
export function normalizeUnit(unit: string | null | undefined): string {
  return words(unit).filter((w) => !['unit', 'apt', 'apartment', 'ste', 'suite', 'no'].includes(w)).join(' ');
}

/** Street number from an address, e.g. "Rhea Timber Ave - 2053 SW Timber Ave" → "2053". */
export function streetNumber(address: string | null | undefined): string | null {
  return (address || '').match(/\b(\d{1,6})\s+[A-Za-z]/)?.[1] ?? null;
}

/** Does the work order address contain this unit's street address (number + street words)? */
function sameStreet(woAddress: string, unitAddress1: string | null): boolean {
  const unitWords = words(unitAddress1);
  if (unitWords.length < 2) return false;
  const wo = words(woAddress);
  const start = wo.indexOf(unitWords[0]);
  if (start < 0) return false;
  // Number plus the next word (e.g. "2053 sw" / "1501 sw" + street name) must line up.
  return unitWords.slice(0, Math.min(unitWords.length, 3)).every((w, i) => wo[start + i] === w);
}

export function matchTenantUnits(woAddress: string, woUnit: string, rows: TenantUnitRow[]): TenantMatch[] {
  const unit = normalizeUnit(woUnit);
  const onStreet = rows.filter((r) => r.active !== false && sameStreet(woAddress, r.address_1));
  const byUnit = unit ? onStreet.filter((r) => normalizeUnit(r.address_2) === unit) : onStreet;
  const candidates = byUnit.length ? byUnit : onStreet;
  return candidates
    .map((r) => {
      const fr = (r.financially_responsible_occupants || []).filter(Boolean);
      const tenantName = fr.length ? fr.join(', ') : (r.resident_name || '').trim();
      return {
        tenantName,
        unit: (r.address_2 || '').trim(),
        address: [r.address_1, r.address_2].filter(Boolean).join(' '),
        syncedAt: r.last_appfolio_sync_at,
      };
    })
    .filter((m) => m.tenantName);
}
