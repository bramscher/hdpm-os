import { describe, expect, it } from 'vitest';
import { accessCodes } from '../access-codes';

// Shaped like real AppFolio Maintenance Notes; names and codes are made up.
describe('access codes from maintenance notes', () => {
  it('keeps door, combo, keyless and gate codes', () => {
    expect(accessCodes('Unit 500 - #11: OTR Warranty Ex: 09.17.2019 Refrigerator warranty ex. 03.13.2019 Filter 20x20x1 Door Code: 1111')).toEqual(['Door Code: 1111']);
    expect(accessCodes('Sample 600 - 463: Filter 14x20x1 Fence Combo Lock #2222')).toEqual(['Fence Combo Lock #2222']);
    expect(accessCodes('Sample 700 - 723: Dead Bolt Key Less Entry Code 33333333')).toEqual(['Key Less Entry Code 33333333']);
    expect(accessCodes(`Sample 800-164 SW: Joe's Landscaping on Monday's Irrigation lock box combo "WORD" 6.30.20 Filter 16x25x3`)).toEqual(['Irrigation lock box combo "WORD"']);
    expect(accessCodes('Sample 900: Door & Garage Code #44444 Lot 16 Garbage pick up Mondays')).toEqual(['Door & Garage Code #44444']);
    expect(accessCodes('Sample Ct -2921: Combo Lock for Power 5555')).toEqual(['Combo Lock for Power 5555']);
    expect(accessCodes('Sample 328: #6666 Entry Gate 08.18.2022 (Try #7777 or #8888) code #9999 Filter 20x20x4')).toEqual(['code #9999', 'Entry Gate #6666']);
    expect(accessCodes('Sample 117: Current Door Code 1212 ')).toEqual(['Current Door Code 1212']);
  });

  it('skips paint, builder property codes and notes with no code', () => {
    expect(accessCodes('Sample 279: Paint Code #420-9708 Landscaping on Tuesdays')).toEqual([]);
    expect(accessCodes('Sample 507 - 63162:  Builder Property code ML221 See Design Addendum')).toEqual([]);
    expect(accessCodes('Sample 520: GDO Overhead Door Brand or Genie Intellacode clicker')).toEqual([]);
    expect(accessCodes('Filter 16X20X4', null, undefined, '')).toEqual([]);
  });

  it('merges unit and property notes without repeats', () => {
    expect(accessCodes('Door Code: 1111', 'Trash Combo Lock 2323', 'Door Code: 1111')).toEqual(['Door Code: 1111', 'Trash Combo Lock 2323']);
  });
});
