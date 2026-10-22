/** AppFolio's internal ids (UUIDs) — never shown to staff. */
const INTERNAL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The property line on a route sheet: the property name, falling back to the
 * legacy short code (e.g. "McNeil 472"). Synced properties carry AppFolio's
 * internal id in appfolio_property_id, which must not be printed.
 */
export function routePropertyLabel(prop: { name?: string | null; appfolio_property_id?: string | null } | null | undefined): string | null {
  const name = prop?.name?.trim();
  if (name && !INTERNAL_ID.test(name)) return name;
  const code = prop?.appfolio_property_id?.trim();
  if (code && !INTERNAL_ID.test(code)) return code;
  return null;
}

/** A unit label only when it reads like one (not an internal id). */
export function routeUnitLabel(unitName?: string | null, address2?: string | null): string | null {
  for (const v of [unitName, address2]) {
    const t = v?.trim();
    if (t && !INTERNAL_ID.test(t)) return t;
  }
  return null;
}

/** The stop's name as AppFolio shows it: "Pine Ave - Pine 123 - B", or just "Smith 456" for a house. */
export function routeStopName(propertyName: string | null, unitLabel: string | null): string | null {
  if (!propertyName || !unitLabel || unitLabel === propertyName) return unitLabel || propertyName;
  return `${propertyName} - ${unitLabel}`;
}

/** The key number in a unit name, always three digits ("Pine 123 - B" → "123", "Smith 234- 1840" → "234", "4321-D 012" → "012"; "#11" is a unit number). */
export function routeKeyNumber(name: string | null): string | null {
  return name?.match(/(?<![#\d])\b(\d{3})\b(?!\d)/)?.[1] ?? null;
}
