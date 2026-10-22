import { describe, expect, it } from 'vitest';
import { routeKeyNumber, routePropertyLabel, routeStopName, routeUnitLabel } from '../property-label';

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

describe('route stop name and key number', () => {
  it('names the unit the way AppFolio does', () => {
    expect(routeStopName('Sample Pine Ave', 'Sample 123 - B')).toBe('Sample Pine Ave - Sample 123 - B');
    expect(routeStopName('Sample 456', null)).toBe('Sample 456');
    expect(routeStopName('Sample 456', 'Sample 456')).toBe('Sample 456');
    expect(routeStopName(null, null)).toBeNull();
  });

  it('reads the key number from the unit name', () => {
    expect(routeKeyNumber('Sample 123 - B')).toBe('123');
    expect(routeKeyNumber('Sample 456')).toBe('456');
    expect(routeKeyNumber('SP 789 - #11')).toBe('789');
    expect(routeKeyNumber('4321-D 012')).toBe('012');
    expect(routeKeyNumber('Sample 234- 1840')).toBe('234');
    expect(routeKeyNumber('345-2211 SW Quartz')).toBe('345');
    expect(routeKeyNumber('Sample 567-1119')).toBe('567');
    expect(routeKeyNumber('Sample 4 Plex')).toBeNull();
    expect(routeKeyNumber('Sample Pine Ave')).toBeNull();
    expect(routeKeyNumber(null)).toBeNull();
  });
});
