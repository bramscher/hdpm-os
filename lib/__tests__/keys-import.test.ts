import { describe, expect, it } from 'vitest';
import {
  buildUnitMatchTargets,
  isOpenRow,
  matchRowToUnit,
  normalizeAddressString,
  parseKeyNumber,
  parseSheetDate,
  validateKeyRows,
  type RawKeyRow,
} from '@/lib/keys-import';
import type { AppFolioPropertyWithCustomFields, AppFolioUnit } from '@/lib/appfolio';

describe('parseKeyNumber', () => {
  it('parses plain and zero-padded numbers', () => {
    expect(parseKeyNumber('1')).toBe(1);
    expect(parseKeyNumber('012')).toBe(12);
    expect(parseKeyNumber(' 972 ')).toBe(972);
  });

  it('rejects non-numbers and zero', () => {
    expect(parseKeyNumber('')).toBeNull();
    expect(parseKeyNumber('abc')).toBeNull();
    expect(parseKeyNumber('12a')).toBeNull();
    expect(parseKeyNumber('0')).toBeNull();
  });
});

describe('isOpenRow', () => {
  it('treats OPEN and blank as open', () => {
    expect(isOpenRow('OPEN')).toBe(true);
    expect(isOpenRow('open')).toBe(true);
    expect(isOpenRow('')).toBe(true);
    expect(isOpenRow('  ')).toBe(true);
  });

  it('treats real addresses as not open', () => {
    expect(isOpenRow('123 Main St')).toBe(false);
  });
});

describe('parseSheetDate', () => {
  it('converts Excel serials', () => {
    // 44256 = 2021-03-01 (Excel epoch 1899-12-30)
    expect(parseSheetDate('44256')).toBe('2021-03-01');
  });

  it('parses text dates', () => {
    expect(parseSheetDate('July-17')).toMatch(/^\d{4}-07-/);
  });

  it('returns null for junk and OPEN', () => {
    expect(parseSheetDate('OPEN')).toBeNull();
    expect(parseSheetDate('')).toBeNull();
    expect(parseSheetDate('n/a')).toBeNull();
  });
});

describe('normalizeAddressString', () => {
  it('standardizes suffixes and case', () => {
    expect(normalizeAddressString('546 NW 28th Street')).toBe('546 nw 28th st');
    expect(normalizeAddressString('546 nw 28th St.')).toBe('546 nw 28th st');
  });

  it('fixes glued direction ("1551NE Perspective Dr.")', () => {
    expect(normalizeAddressString('1551NE Perspective Dr.')).toBe('1551 ne perspective dr');
  });

  it('normalizes unit markers', () => {
    expect(normalizeAddressString('430 SE 6th #A')).toBe(normalizeAddressString('430 SE 6th # A'));
    expect(normalizeAddressString('430 SE 6th Apt A')).toBe(normalizeAddressString('430 SE 6th #A'));
  });
});

// ---------------------------------------------------------------------------
// Matching + validation against fixture units
// ---------------------------------------------------------------------------

function unit(id: string, address1: string, address2: string | null = null): AppFolioUnit {
  return {
    id,
    propertyId: `prop-${id}`,
    address1,
    address2,
    city: 'Bend',
    state: 'OR',
    zip: '97701',
    name: null,
    status: null,
    lastInspectedDate: null,
  };
}

function property(id: string, owner: string): AppFolioPropertyWithCustomFields {
  return {
    appfolioPropertyId: `prop-${id}`,
    name: `Property ${id}`,
    address1: null,
    address2: null,
    city: 'Bend',
    state: 'OR',
    zip: '97701',
    ownerName: owner,
    useCustomInspectionDate: false,
    hidden: false,
    customValueNames: [],
  };
}

const TARGETS = buildUnitMatchTargets(
  [
    unit('u1', '2741 NE Laramie Way'),
    unit('u2', '1551 NE Perspective Dr.', '#2'),
    unit('u3', '430 SE 6th', '#A'),
    unit('u4', '430 SE 6th', '#C'),
  ],
  [property('u1', 'Bramscher'), property('u2', 'DeLay'), property('u3', 'Sokol'), property('u4', 'Sokol')]
);

describe('matchRowToUnit', () => {
  it('matches exact addresses through formatting differences', () => {
    expect(matchRowToUnit('2741 NE Laramie Way', TARGETS)?.appfolioUnitId).toBe('u1');
  });

  it('matches glued-direction spreadsheet typos', () => {
    expect(matchRowToUnit('1551NE Perspective Dr. #2', TARGETS)?.appfolioUnitId).toBe('u2');
  });

  it('distinguishes units of the same building', () => {
    expect(matchRowToUnit('430 SE 6th #A', TARGETS)?.appfolioUnitId).toBe('u3');
    expect(matchRowToUnit('430 SE 6th # C', TARGETS)?.appfolioUnitId).toBe('u4');
  });

  it('returns null on ambiguity (same street, no unit marker)', () => {
    expect(matchRowToUnit('430 SE 6th', TARGETS)).toBeNull();
  });

  it('returns null on no match', () => {
    expect(matchRowToUnit('99999 Nowhere Blvd', TARGETS)).toBeNull();
  });
});

describe('validateKeyRows', () => {
  function row(rowNumber: number, keyNumber: string, address: string, owner = '', dateUsed = ''): RawKeyRow {
    return { rowNumber, keyNumber, address, owner, dateUsed };
  }

  it('classifies open / matched / unmatched / error', () => {
    const preview = validateKeyRows(
      [
        row(2, '1', '2741 NE Laramie Way', 'Bramscher', '45982'),
        row(3, '2', 'OPEN'),
        row(4, '3', '888 Unknown Rd', 'Mystery'),
        row(5, 'x', '123 Bad Row'),
      ],
      TARGETS
    );
    expect(preview.matched).toBe(1);
    expect(preview.open).toBe(1);
    expect(preview.unmatched).toBe(1);
    expect(preview.errors).toBe(1);
    expect(preview.rows[0].appfolio_unit_id).toBe('u1');
    expect(preview.rows[0].date_used).toBe('2025-11-21');
  });

  it('flags duplicate key numbers', () => {
    const preview = validateKeyRows(
      [row(2, '5', 'OPEN'), row(3, '5', '2741 NE Laramie Way')],
      TARGETS
    );
    expect(preview.errors).toBe(1);
    expect(preview.rows[1].issues[0]).toMatch(/Duplicate/);
  });
});

describe('matchRowToUnit — fuzzy passes', () => {
  const FUZZY_TARGETS = buildUnitMatchTargets(
    [
      unit('t1', '1538 SE Tempest Dr', '#1'),
      unit('t2', '1538 SE Tempest Dr', '#2'),
      unit('b1', '1337 NE Barney St'),
      unit('h1', '2214 NE Holliday Ave'),
      unit('c1', '3015 NW Cedar Ave'),
      unit('s1', '205 N Tamarack St'),
      unit('m1', '365 1/4 SE Miller Ave'),
      unit('m2', '365 SE Miller Ave'),
      unit('bw1', '218 NW Broadway St ##1'),
      unit('f1', '2506 SW Fissure Lp'),
    ],
    [
      property('t1', 'Sokol'), property('t2', 'Sokol'), property('b1', 'Gimpl'),
      property('h1', 'Pfeifer'), property('c1', 'Bussiere'), property('s1', 'Thorne'),
      property('m1', 'Coblin'), property('m2', 'Coblin'), property('bw1', 'Fleming'),
      property('f1', 'N2'),
    ]
  );

  it('matches units when the sheet omits the street suffix', () => {
    expect(matchRowToUnit('1538 SE Tempest # 1', FUZZY_TARGETS)?.appfolioUnitId).toBe('t1');
    expect(matchRowToUnit('1538 SE Tempest # 2', FUZZY_TARGETS)?.appfolioUnitId).toBe('t2');
  });

  it('stays null when multiple units exist and the sheet names none', () => {
    expect(matchRowToUnit('1538 SE Tempest', FUZZY_TARGETS)).toBeNull();
  });

  it('matches when the sheet omits or typos the direction', () => {
    expect(matchRowToUnit('1337 Barney St', FUZZY_TARGETS)?.appfolioUnitId).toBe('b1');
    expect(matchRowToUnit('3015 NE Cedar Ave', FUZZY_TARGETS)?.appfolioUnitId).toBe('c1');
  });

  it('strips trailing city names and junk words', () => {
    expect(matchRowToUnit('205 N Tamarack, Sisters', FUZZY_TARGETS)?.appfolioUnitId).toBe('s1');
    expect(matchRowToUnit('365 SE Miller   Bend   Duplex', FUZZY_TARGETS)?.appfolioUnitId).toBe('m2');
  });

  it('treats fractions as unit designators', () => {
    expect(matchRowToUnit('365 SE Miller 1/4  Bend  Duplex', FUZZY_TARGETS)?.appfolioUnitId).toBe('m1');
  });

  it('collapses doubled hash marks from AppFolio address2', () => {
    expect(matchRowToUnit('218 NW Broadway Street #1', FUZZY_TARGETS)?.appfolioUnitId).toBe('bw1');
  });

  it('tolerates small street-name spelling drift', () => {
    expect(matchRowToUnit('2214 NE Holiday Ave', FUZZY_TARGETS)?.appfolioUnitId).toBe('h1');
    expect(matchRowToUnit('2506 SW Fissure Loop', FUZZY_TARGETS)?.appfolioUnitId).toBe('f1');
  });

  it('does not cross-match different streets with the same number', () => {
    expect(matchRowToUnit('1337 Ramsay St', FUZZY_TARGETS)).toBeNull();
  });
});
