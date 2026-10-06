import { describe, expect, it } from 'vitest';
import { routePropertyLabel, routeUnitLabel } from '../property-label';

const uuid = '73285774-de4a-11ea-9ca3-0273f58630f3';

describe('route sheet labels', () => {
  it('shows the property name, never an AppFolio internal id', () => {
    expect(routePropertyLabel({ name: 'Kyniston Duplex', appfolio_property_id: uuid })).toBe('Kyniston Duplex');
    expect(routePropertyLabel({ name: null, appfolio_property_id: uuid })).toBeNull();
    expect(routePropertyLabel({ name: null, appfolio_property_id: 'McNeil 472' })).toBe('McNeil 472');
    expect(routePropertyLabel(null)).toBeNull();
  });
  it('prefers the unit name and skips internal ids', () => {
    expect(routeUnitLabel('Rhea 631 - F', 'B')).toBe('Rhea 631 - F');
    expect(routeUnitLabel(null, '#7')).toBe('#7');
    expect(routeUnitLabel(uuid, null)).toBeNull();
  });
});
