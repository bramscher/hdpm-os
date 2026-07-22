import { describe, it, expect } from 'vitest';
import { parseKeysDetailCsv } from '../keys-reconcile';

const CSV = `Key Name,Description,Assignee,Assignee Type,Number Checked Out,Unit,Property,Checked Out Date,Unit ID
1963 Woodside Vista 505 - 63174 NE Meridian Place Bend OR 97701,,,,,,,,
505 (1 total),Garage Remote,"Jorgenson, Hannah",Tenant,1,Woodside 505,1963 Woodside Vista 505,09/13/2024,abc-123
505 (4 total),Front Door,"Jorgenson, Hannah",Tenant,2,Woodside 505,1963 Woodside Vista 505,09/13/2024,abc-123
742 (5 total),Front Door,"Johnson (Owner), Greg",Vendor,1,23rd St 742 - #1,23rd St Complex,01/07/2025,def-456
751 (5 total),Front Door,"23rd Street Property, LLC",Owner,1,23rd St 751 - #10,23rd St Complex,,
Total (1120 Results),,,,,,,,`;

describe('parseKeysDetailCsv', () => {
  it('parses checkout rows and skips group/total rows', () => {
    const rows = parseKeysDetailCsv(CSV);
    expect(rows).toHaveLength(4);

    expect(rows[0]).toMatchObject({
      key_name: '505 (1 total)',
      description: 'Garage Remote',
      assignee: 'Jorgenson, Hannah',
      assignee_type: 'Tenant',
      number_checked_out: 1,
      checked_out_date: '2024-09-13',
      unit: 'Woodside 505',
      appfolio_unit_id: 'abc-123',
    });

    // Row without Unit ID or date still parses; join fields stay null.
    expect(rows[3]).toMatchObject({
      assignee: '23rd Street Property, LLC',
      assignee_type: 'Owner',
      appfolio_unit_id: null,
      checked_out_date: null,
    });
  });

  it('rejects a CSV without an Assignee column', () => {
    expect(() => parseKeysDetailCsv('Foo,Bar\n1,2')).toThrow(/Assignee/);
  });

  it('handles ISO dates and single-digit US dates', () => {
    const rows = parseKeysDetailCsv(
      'Assignee,Checked Out Date,Unit ID\nA,2026-01-05,u1\nB,1/7/2026,u2'
    );
    expect(rows.map((r) => r.checked_out_date)).toEqual(['2026-01-05', '2026-01-07']);
  });
});
