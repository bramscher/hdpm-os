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
