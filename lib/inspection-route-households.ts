import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppFolioPet } from '@/lib/appfolio';

export interface HouseholdProperty {
  id?: string;
  name?: string | null;
  address_1?: string | null;
  address_2?: string | null;
  city?: string | null;
  zip?: string | null;
  appfolio_unit_id?: string | null;
  resident_name?: string | null;
  financially_responsible_occupants?: string[] | null;
  pets?: AppFolioPet[] | null;
}

function normalize(value: string): string {
  const words: Record<string, string> = { street: 'st', avenue: 'ave', road: 'rd', drive: 'dr', court: 'ct', lane: 'ln', place: 'pl', boulevard: 'blvd' };
  return value.toLowerCase().replace(/[.,]/g, '').replace(/\b(street|avenue|road|drive|court|lane|place|boulevard)\b/g, word => words[word]).replace(/\s+/g, ' ').trim();
}

export function householdAddressKey(property: HouseholdProperty): string | null {
  if (!property.address_1 || !property.city || !property.zip) return null;
  let address = property.address_1;
  let label = property.name || '';
  // Legacy CSV rows sometimes put "Property name - address City, OR ZIP" in address_1.
  const separator = address.lastIndexOf(' - ');
  if (separator >= 0 && /^\d/.test(address.slice(separator + 3))) {
    label = address.slice(0, separator);
    address = address.slice(separator + 3);
  }
  address = normalize(address);
  const city = normalize(property.city);
  const suffix = ` ${city} or ${property.zip}`;
  if (address.endsWith(suffix)) address = address.slice(0, -suffix.length);
  const unit = normalize(property.address_2 || '');
  // The importer stored property labels in address_2. Only discard an exact label,
  // never a genuine apartment/unit designator.
  if (unit && unit !== normalize(label)) address += ` ${unit}`;
  return `${address}|${city}|${property.zip}`;
}

export function findHouseholdSource(property: HouseholdProperty, sources: HouseholdProperty[], residentName?: string | null): HouseholdProperty | null {
  const key = householdAddressKey(property);
  const matches = sources.filter(source => source.appfolio_unit_id && (
    property.appfolio_unit_id
      ? source.appfolio_unit_id === property.appfolio_unit_id
      : key != null && householdAddressKey(source) === key
  ));
  // Ambiguous multi-unit addresses must not borrow a neighbor's occupants/pets.
  if (matches.length === 1) return matches[0];
  if (property.appfolio_unit_id || !residentName || !property.city || !property.zip) return null;
  const label = property.name || property.address_1?.split(' - ')[0];
  if (!label) return null;
  const personKey = (name: string) => normalize(name).split(' ').filter(part => part.length > 1).sort().join('|');
  const person = personKey(residentName);
  if (!person.includes('|')) return null;
  // Multi-unit CSV rows identify the building, not the unit address. Require both
  // the exact property label/location and a uniquely matching current resident.
  const residentMatches = sources.filter(source => source.appfolio_unit_id &&
    normalize(source.name || '') === normalize(label) &&
    normalize(source.city || '') === normalize(property.city!) && source.zip === property.zip &&
    [source.resident_name || '', ...(source.financially_responsible_occupants ?? [])].some(name => personKey(name) === person));
  return residentMatches.length === 1 ? residentMatches[0] : null;
}

type HouseholdStop = { inspections?: { resident_name?: string | null; inspection_properties?: HouseholdProperty | null } | null };

/** Resolve old imported route rows against the current synced unit at read time. */
export async function hydrateRouteHouseholds<T extends HouseholdStop>(supabase: SupabaseClient, stops: T[]): Promise<void> {
  const missing = stops.map(s => s.inspections?.inspection_properties).filter((p): p is HouseholdProperty => !!p && (p.financially_responsible_occupants == null || p.pets == null));
  if (!missing.length) return;
  const sources: HouseholdProperty[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('inspection_properties')
      .select('id,name,address_1,address_2,city,zip,appfolio_unit_id,resident_name,financially_responsible_occupants,pets')
      .not('appfolio_unit_id', 'is', null).order('id').range(from, from + 999);
    if (error) throw new Error(`Could not load route household details: ${error.message}`);
    sources.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  for (const stop of stops) {
    const property = stop.inspections?.inspection_properties;
    if (!property || !missing.includes(property)) continue;
    const source = findHouseholdSource(property, sources, stop.inspections?.resident_name);
    if (!source) continue;
    property.financially_responsible_occupants ??= source.financially_responsible_occupants;
    property.pets ??= source.pets;
  }
}
