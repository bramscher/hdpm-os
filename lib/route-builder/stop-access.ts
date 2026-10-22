import { fetchUnitNamesAndNotes } from '@/lib/appfolio';
import { accessCodes } from './access-codes';
import { routeKeyNumber, routePropertyLabel, routeStopName, routeUnitLabel } from './property-label';

type StopWithProperty = {
  inspections?: {
    unit_name?: string | null;
    inspection_properties?: { name?: string | null; address_2?: string | null; appfolio_unit_id?: string | null; appfolio_property_id?: string | null } | null;
  } | null;
};

const APPFOLIO_UUID = /^[0-9a-f-]{36}$/i;

/**
 * Each stop's name and access line, shared by the route page and the Outlook event:
 * the unit name as AppFolio shows it ("Pine Ave - Pine 123 - B", fetched from AppFolio
 * when none is stored), the key number in it, and door / lockbox codes from the unit and
 * property Maintenance Notes.
 */
export async function routeStopAccess<T extends StopWithProperty>(stops: T[]): Promise<{ name: string | null; access: string[] }[]> {
  const ids = (key: 'appfolio_unit_id' | 'appfolio_property_id') =>
    stops.map((s) => s.inspections?.inspection_properties?.[key]).filter((v): v is string => !!v && APPFOLIO_UUID.test(v));
  const appfolio = await fetchUnitNamesAndNotes({ units: ids('appfolio_unit_id'), properties: ids('appfolio_property_id') });

  return stops.map((s) => {
    const prop = s.inspections?.inspection_properties;
    const afUnit = appfolio.get(prop?.appfolio_unit_id ?? '');
    const unitLabel = routeUnitLabel(s.inspections?.unit_name, prop?.address_2) ?? routeUnitLabel(afUnit?.name);
    const propertyName = routePropertyLabel(prop);
    const keyNumber = routeKeyNumber(unitLabel || propertyName);
    return {
      name: routeStopName(propertyName, unitLabel),
      access: [
        ...(keyNumber ? [`Key #${keyNumber}`] : []),
        ...accessCodes(afUnit?.notes, appfolio.get(prop?.appfolio_property_id ?? '')?.notes),
      ],
    };
  });
}
