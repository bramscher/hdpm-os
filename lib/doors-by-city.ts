/**
 * Doors by city — one tally shared by the Property Map summary and the KPI
 * dashboard's Growth & Retention section, so both group cities the same way.
 *
 * AppFolio city fields carry stray whitespace ("Bend " vs "Bend"), so cities
 * are keyed trimmed + lowercased and shown with the first trimmed spelling.
 *
 * No I/O — safe to import from client components; unit-tested directly.
 */

export interface CityDoors {
  city: string;
  /** Doors counted toward the total (active / still managed). */
  doors: number;
  /** Doors on their way out (map: yellow "leaving management"). Not in `doors`. */
  leaving: number;
}

export interface DoorCityItem {
  city: string | null | undefined;
  /** Doors this item represents (a property's unit count). Defaults to 1 (one unit). */
  doors?: number;
  /** Count these doors as leaving rather than active. */
  leaving?: boolean;
}

/** Tally doors per city, biggest first (active + leaving), then by name. */
export function tallyDoorsByCity(items: Iterable<DoorCityItem>): CityDoors[] {
  const byCity = new Map<string, CityDoors>();
  for (const item of items) {
    const name = (item.city ?? '').trim() || 'Unknown';
    const key = name.toLowerCase();
    let entry = byCity.get(key);
    if (!entry) {
      entry = { city: name, doors: 0, leaving: 0 };
      byCity.set(key, entry);
    }
    const n = item.doors ?? 1;
    if (item.leaving) entry.leaving += n;
    else entry.doors += n;
  }
  return [...byCity.values()].sort(
    (a, b) => b.doors + b.leaving - (a.doors + a.leaving) || a.city.localeCompare(b.city)
  );
}
