import { describe, it, expect } from 'vitest';
import { vendorZoomPrefix } from '../appfolio';

describe('vendorZoomPrefix', () => {
  const emergency = new Set(['v-1', 'v-2']);

  it("uses 'EV - ' for emergency vendors (so typing EV in Zoom shows only them)", () => {
    expect(vendorZoomPrefix('v-1', emergency)).toBe('EV - ');
    expect(vendorZoomPrefix('v-2', emergency)).toBe('EV - ');
  });

  it("uses 'V - ' for non-emergency vendors", () => {
    expect(vendorZoomPrefix('v-9', emergency)).toBe('V - ');
  });

  it("defaults to 'V - ' when no emergency set is provided", () => {
    expect(vendorZoomPrefix('v-1')).toBe('V - ');
    expect(vendorZoomPrefix('v-1', new Set())).toBe('V - ');
  });
});
