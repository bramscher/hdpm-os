/**
 * Owner record links. AppFolio can hold one person (or entity) as several
 * owner records, e.g. once per ownership group. Profiles are per person, so:
 *
 *   same     — duplicate records of one person/entity: merged into one profile
 *              (owner_id = the duplicate, linked_owner_id = the profile kept)
 *   related  — different people/entities that belong together (a person and
 *              their trust or LLC, spouses, partners): separate profiles that
 *              point at each other
 *   distinct — a suggestion someone rejected; never suggested again
 *
 * A group with a partner unique to it needs no link at all: the common person
 * is already one profile across every group they are in, and the partner gets
 * their own. Pure module — unit tested.
 */

import type { Roster, RosterOwner } from './roster';

export type LinkKind = 'same' | 'related' | 'distinct';

export interface OwnerLink {
  owner_id: string;
  linked_owner_id: string;
  kind: LinkKind;
  note: string | null;
}

export interface LinkSuggestion {
  a: { id: string; name: string };
  b: { id: string; name: string };
  kind: 'same' | 'related';
  reason: string;
}

/** Duplicate id → the profile it merged into (chains collapsed). */
export function aliasMap(links: OwnerLink[]): Map<string, string> {
  const direct = new Map(links.filter((l) => l.kind === 'same').map((l) => [l.owner_id, l.linked_owner_id]));
  const out = new Map<string, string>();
  for (const id of direct.keys()) {
    let target = direct.get(id)!;
    const seen = new Set([id]);
    while (direct.has(target) && !seen.has(target)) {
      seen.add(target);
      target = direct.get(target)!;
    }
    out.set(id, target);
  }
  return out;
}

export const canonicalOwner = (aliases: Map<string, string>, id: string) => aliases.get(id) ?? id;

/** Every owner id whose recordings belong to this profile (itself + merged duplicates). */
export function ownerIdsFor(aliases: Map<string, string>, canonicalId: string): string[] {
  return [canonicalId, ...[...aliases].filter(([, c]) => c === canonicalId).map(([a]) => a)];
}

export interface LinkedRosterOwner extends RosterOwner {
  /** Duplicate AppFolio records merged into this profile. */
  aliases: { id: string; name: string }[];
  related: { id: string; name: string; note: string | null }[];
}

export interface LinkedRoster extends Roster {
  owners: LinkedRosterOwner[];
}

/** Fold duplicates into their kept profile and attach related owners. */
export function applyOwnerLinks(roster: Roster, links: OwnerLink[]): LinkedRoster {
  const aliases = aliasMap(links);
  const byId = new Map(roster.owners.map((o) => [o.id, o]));
  const owners = new Map<string, LinkedRosterOwner>();

  for (const o of roster.owners) {
    const target = canonicalOwner(aliases, o.id);
    // A duplicate whose kept profile left AppFolio keeps standing on its own.
    const keepId = byId.has(target) ? target : o.id;
    const base = byId.get(keepId)!;
    const row = owners.get(keepId) ?? { ...base, properties: [], doors: 0, aliases: [], related: [] };
    if (o.id !== keepId) {
      row.aliases.push({ id: o.id, name: o.name });
      row.email ??= o.email;
      row.phone ??= o.phone;
    }
    owners.set(keepId, row);
  }

  // Properties are re-attached once per profile, so a duplicate on the same
  // property doesn't double-count doors.
  const doorsByProperty = new Map(roster.properties.map((p) => [p.id, p.doors]));
  for (const o of roster.owners) {
    const row = owners.get(byId.has(canonicalOwner(aliases, o.id)) ? canonicalOwner(aliases, o.id) : o.id)!;
    for (const p of o.properties) {
      if (row.properties.some((x) => x.id === p.id)) continue;
      row.properties.push(p);
      row.doors += doorsByProperty.get(p.id) ?? 0;
    }
  }

  const name = (id: string) => owners.get(id)?.name ?? byId.get(id)?.name;
  for (const l of links.filter((x) => x.kind === 'related')) {
    const a = canonicalOwner(aliases, l.owner_id);
    const b = canonicalOwner(aliases, l.linked_owner_id);
    if (a === b) continue;
    for (const [from, to] of [[a, b], [b, a]]) {
      const row = owners.get(from);
      const toName = name(to);
      if (row && toName && !row.related.some((r) => r.id === to)) row.related.push({ id: to, name: toName, note: l.note });
    }
  }

  const properties = roster.properties.map((p) => {
    const seen = new Set<string>();
    const list: { id: string; name: string }[] = [];
    for (const o of p.owners) {
      const c = canonicalOwner(aliases, o.id);
      const id = owners.has(c) ? c : o.id;
      if (seen.has(id)) continue;
      seen.add(id);
      list.push({ id, name: owners.get(id)?.name ?? o.name });
    }
    return { ...p, owners: list };
  });

  return {
    owners: [...owners.values()].sort((x, y) => x.name.localeCompare(y.name)),
    properties,
  };
}

const ENTITY_WORDS = /\b(llc|l\.l\.c|inc|corp|co|trust|trustee|trustees|family|living|revocable|irrevocable|properties|property|investments|holdings|partners|partnership|lp|ltd|estate|of|the|and|dated|dtd|ttee)\b/g;

/** Lowercase, punctuation-free, '&' → 'and', single-spaced. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Person-ish tokens of a name with entity words removed ("Smith Family Trust" → smith). */
function coreTokens(name: string): Set<string> {
  return new Set(
    normalizeName(name)
      .replace(ENTITY_WORDS, ' ')
      .split(' ')
      .filter((t) => t.length > 1)
  );
}

const normEmail = (e: string | null) => e?.trim().toLowerCase() || null;
const normPhone = (p: string | null) => {
  const d = p?.replace(/\D/g, '') ?? '';
  return d.length >= 10 ? d.slice(-10) : null;
};

/**
 * Likely duplicates and relatives among owner records not already linked or
 * dismissed. 'same': shared email/phone or identical name. 'related': one
 * name's core words all appear in the other (John Smith ↔ John Smith Trust).
 */
export function suggestOwnerLinks(owners: RosterOwner[], links: OwnerLink[]): LinkSuggestion[] {
  const aliases = aliasMap(links);
  const decided = new Set<string>();
  const pairKey = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);
  for (const l of links) decided.add(pairKey(canonicalOwner(aliases, l.owner_id), canonicalOwner(aliases, l.linked_owner_id)));

  const prepared = owners.map((o) => ({
    o,
    c: canonicalOwner(aliases, o.id),
    email: normEmail(o.email),
    phone: normPhone(o.phone),
    name: normalizeName(o.name),
    core: coreTokens(o.name),
  }));

  const out: LinkSuggestion[] = [];
  const suggested = new Set<string>();
  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      const x = prepared[i];
      const y = prepared[j];
      if (x.c === y.c) continue; // already one profile
      const key = pairKey(x.c, y.c);
      if (decided.has(key) || suggested.has(key)) continue;

      let kind: 'same' | 'related' | null = null;
      let reason = '';
      if (x.email && x.email === y.email) [kind, reason] = ['same', 'Same email'];
      else if (x.phone && x.phone === y.phone) [kind, reason] = ['same', 'Same phone number'];
      else if (x.name && x.name === y.name) [kind, reason] = ['same', 'Same name'];
      else {
        const [small, big] = x.core.size <= y.core.size ? [x.core, y.core] : [y.core, x.core];
        // Two or more shared core words (a first + last name), all of the smaller name.
        if (small.size >= 2 && [...small].every((t) => big.has(t))) [kind, reason] = ['related', 'Names overlap'];
      }
      if (!kind) continue;
      suggested.add(key);
      out.push({ a: { id: x.o.id, name: x.o.name }, b: { id: y.o.id, name: y.o.name }, kind, reason });
    }
  }
  return out.sort((p, q) => (p.kind === q.kind ? p.a.name.localeCompare(q.a.name) : p.kind === 'same' ? -1 : 1));
}
