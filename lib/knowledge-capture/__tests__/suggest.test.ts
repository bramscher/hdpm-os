import { describe, expect, it } from 'vitest';
import { suggestSubjects } from '../suggest';
import type { LinkedRosterOwner } from '../links';
import type { RosterProperty } from '../roster';

const owner = (id: string, name: string, aliases: string[] = []): LinkedRosterOwner => ({
  id, name, email: null, phone: null, properties: [], doors: 1, aliases: aliases.map((a, i) => ({ id: `${id}-a${i}`, name: a })), related: [],
});
const prop = (id: string, name: string, address = ''): RosterProperty => ({ id, name, address, doors: 1, appfolioWebId: null, owners: [] });

const owners = [
  owner('o1', 'Malick Family Trust', ['John Malick']),
  owner('o2', 'Garabedian Investments LLC'),
  owner('o3', 'Jane Smith'),
  owner('o4', 'Bob Smith'),
];
const properties = [
  prop('p1', 'Malick 339', '339 NW Elm St, Bend, OR'),
  prop('p2', 'Garabedian Umatilla Duplex', '2853 SW Umatilla Ave, Redmond, OR'),
  prop('p3', 'Coho # 5/Goldberg', '1455 NE Coho Ln, Bend, OR'),
  prop('p4', 'Cedar Creek', '409 Cedar Creek Dr, Bend, OR'),
  prop('p5', 'Soda Creek Beaver', '779 Beaver Ave, Bend, OR'),
];

const top = (t: string) => suggestSubjects(t, owners, properties).map((s) => `${s.type}:${s.id}`);

describe('suggestSubjects', () => {
  it('finds an owner by surname, including "the Malicks"', () => {
    expect(top("Talked to the Malicks today, they're fine with the increase")).toContain('owner:o1');
  });

  it('finds a property by name or by its street', () => {
    expect(top('The Umatilla duplex needs a new water heater')[0]).toBe('property:p2');
    expect(top('Over at 1455 Coho the tenant left a mess')[0]).toBe('property:p3');
  });

  it('needs a distinctive word, not just shared or noise words', () => {
    expect(top('The duplex on the avenue in Bend needs paint')).toEqual([]);
    expect(top('Creek')).toEqual([]);
    expect(top('The tenant by the creek wants a spring move-in')).toEqual([]);
  });

  it('finds an owner by the surname their properties carry', () => {
    const o = owner('o9', 'Andrew Garabedian');
    o.properties = [{ id: 'p2', name: 'Garabedian Umatilla Duplex' }];
    expect(suggestSubjects('Garabedian is happy with the rents', [o], properties).map((s) => s.id)).toContain('o9');
  });

  it('a full name beats a shared surname', () => {
    expect(top('Jane Smith called about her deposit')[0]).toBe('owner:o3');
  });

  it('handles empty transcripts and caps the list', () => {
    expect(suggestSubjects(null, owners, properties)).toEqual([]);
    expect(suggestSubjects('', owners, properties)).toEqual([]);
    expect(top('Malick Garabedian Coho Umatilla Smith Jane').length).toBeLessThanOrEqual(3);
  });

  it('says which words it heard', () => {
    const [s] = suggestSubjects('Garabedian wants the Umatilla place painted', owners, properties);
    expect(s.heard.length).toBeGreaterThan(0);
    expect(s.score).toBeGreaterThanOrEqual(0.6);
  });
});
