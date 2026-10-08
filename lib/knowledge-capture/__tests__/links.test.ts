import { describe, it, expect } from 'vitest';
import type { Roster, RosterOwner } from '../roster';
import { aliasMap, applyOwnerLinks, normalizeName, ownerIdsFor, suggestOwnerLinks, type OwnerLink } from '../links';

const owner = (id: string, name: string, props: string[], extra: Partial<RosterOwner> = {}): RosterOwner => ({
  id,
  name,
  email: null,
  phone: null,
  properties: props.map((p) => ({ id: p, name: `Prop ${p}` })),
  doors: props.length,
  ...extra,
});

// John is in AppFolio twice (j1 with Mary, j2 alone); group {John, Bob} has a partner unique to it.
const roster: Roster = {
  owners: [
    owner('j1', 'John Smith', ['p1', 'p3'], { email: 'john@x.com' }),
    owner('j2', 'John Smith', ['p2', 'p3'], { phone: '(541) 555-1234' }),
    owner('m1', 'Mary Smith', ['p1']),
    owner('b1', 'Bob Jones', ['p3']),
    owner('t1', 'John Smith Family Trust', ['p4']),
  ],
  properties: [
    { id: 'p1', name: 'Prop p1', address: '', doors: 1, appfolioWebId: null, owners: [{ id: 'j1', name: 'John Smith' }, { id: 'm1', name: 'Mary Smith' }] },
    { id: 'p2', name: 'Prop p2', address: '', doors: 1, appfolioWebId: null, owners: [{ id: 'j2', name: 'John Smith' }] },
    { id: 'p3', name: 'Prop p3', address: '', doors: 2, appfolioWebId: null, owners: [{ id: 'j1', name: 'John Smith' }, { id: 'j2', name: 'John Smith' }, { id: 'b1', name: 'Bob Jones' }] },
    { id: 'p4', name: 'Prop p4', address: '', doors: 1, appfolioWebId: null, owners: [{ id: 't1', name: 'John Smith Family Trust' }] },
  ],
};

const link = (owner_id: string, linked_owner_id: string, kind: OwnerLink['kind'], note: string | null = null): OwnerLink => ({
  owner_id,
  linked_owner_id,
  kind,
  note,
});

describe('applyOwnerLinks', () => {
  it('leaves the roster as-is with no links', () => {
    const linked = applyOwnerLinks(roster, []);
    expect(linked.owners).toHaveLength(5);
    expect(linked.owners.every((o) => o.aliases.length === 0 && o.related.length === 0)).toBe(true);
  });

  it('merges a duplicate into the kept profile without double-counting shared properties', () => {
    const linked = applyOwnerLinks(roster, [link('j2', 'j1', 'same')]);
    const john = linked.owners.find((o) => o.id === 'j1')!;
    expect(linked.owners.find((o) => o.id === 'j2')).toBeUndefined();
    expect(john.aliases).toEqual([{ id: 'j2', name: 'John Smith' }]);
    expect(john.properties.map((p) => p.id).sort()).toEqual(['p1', 'p2', 'p3']);
    expect(john.doors).toBe(4); // p1 1 + p2 1 + p3 2, p3 once
    expect(john.phone).toBe('(541) 555-1234'); // filled from the duplicate
    // Property owner lists point at the kept profile, once.
    const p3 = linked.properties.find((p) => p.id === 'p3')!;
    expect(p3.owners.map((o) => o.id)).toEqual(['j1', 'b1']);
  });

  it('keeps a unique partner separate — the common person is one profile across groups', () => {
    const linked = applyOwnerLinks(roster, [link('j2', 'j1', 'same')]);
    expect(linked.owners.find((o) => o.id === 'b1')!.properties.map((p) => p.id)).toEqual(['p3']);
    expect(linked.owners.find((o) => o.id === 'm1')!.properties.map((p) => p.id)).toEqual(['p1']);
  });

  it('links related owners both ways with the note, through merges', () => {
    const linked = applyOwnerLinks(roster, [link('j2', 'j1', 'same'), link('t1', 'j2', 'related', 'family trust')]);
    expect(linked.owners.find((o) => o.id === 'j1')!.related).toEqual([{ id: 't1', name: 'John Smith Family Trust', note: 'family trust' }]);
    expect(linked.owners.find((o) => o.id === 't1')!.related).toEqual([{ id: 'j1', name: 'John Smith', note: 'family trust' }]);
  });

  it('ignores distinct decisions', () => {
    const linked = applyOwnerLinks(roster, [link('j1', 'j2', 'distinct')]);
    expect(linked.owners).toHaveLength(5);
  });

  it('collapses merge chains and lists every id feeding a profile', () => {
    const links = [link('a', 'b', 'same'), link('b', 'c', 'same')];
    const aliases = aliasMap(links);
    expect(aliases.get('a')).toBe('c');
    expect(ownerIdsFor(aliases, 'c').sort()).toEqual(['a', 'b', 'c']);
    expect(ownerIdsFor(aliases, 'x')).toEqual(['x']);
  });
});

describe('suggestOwnerLinks', () => {
  it('suggests same-person merges and related links, strongest first', () => {
    const s = suggestOwnerLinks(roster.owners, []);
    const pair = (x: string, y: string) => s.find((v) => [v.a.id, v.b.id].sort().join() === [x, y].sort().join());
    expect(pair('j1', 'j2')).toMatchObject({ kind: 'same', reason: 'Same name' });
    expect(pair('j1', 't1')).toMatchObject({ kind: 'related', reason: 'Names overlap' });
    expect(pair('j1', 'm1')).toBeUndefined(); // shared surname alone isn't enough
    expect(pair('j1', 'b1')).toBeUndefined();
    expect(s[0].kind).toBe('same');
  });

  it('matches on email and phone despite different spellings', () => {
    const s = suggestOwnerLinks(
      [
        owner('x', 'J. Smith', [], { email: 'John@X.com ' }),
        owner('y', 'Johnny Smith', [], { email: 'john@x.com' }),
        owner('z', 'Smith Holdings', [], { phone: '541.555.9999' }),
        owner('w', 'Pat Lee', [], { phone: '+1 (541) 555-9999' }),
      ],
      []
    );
    expect(s.map((v) => v.reason).sort()).toEqual(['Same email', 'Same phone number']);
  });

  it('drops pairs already decided, including through merges', () => {
    expect(suggestOwnerLinks(roster.owners, [link('j1', 'j2', 'distinct')]).some((v) => v.a.id === 'j1' && v.b.id === 'j2')).toBe(false);
    // After merging j2 into j1, the trust is still suggested once (not once per record).
    const s = suggestOwnerLinks(roster.owners, [link('j2', 'j1', 'same')]);
    expect(s.filter((v) => [v.a.id, v.b.id].includes('t1'))).toHaveLength(1);
    expect(s.some((v) => [v.a.id, v.b.id].sort().join() === 'j1,j2')).toBe(false);
  });

  it('normalizes names', () => {
    expect(normalizeName('  Smith, John & Mary ')).toBe('smith john and mary');
  });
});
