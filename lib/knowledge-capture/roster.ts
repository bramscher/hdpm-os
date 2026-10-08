/**
 * Knowledge capture roster — every active AppFolio owner and property, built
 * from the cached fee facts (lib/fee-management/facts-cache.ts), with each
 * subject's capture coverage. Pure module — unit tested.
 */

import type { FeeFacts } from '@/lib/fee-management/model';

export type SubjectType = 'owner' | 'property';

export interface RosterOwner {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  properties: { id: string; name: string }[];
  doors: number;
}

export interface RosterProperty {
  id: string;
  name: string;
  address: string;
  doors: number;
  appfolioWebId: string | null;
  owners: { id: string; name: string }[];
}

export interface Coverage {
  recordings: number;
  /** Most recent recording, ISO. */
  lastAt: string | null;
  speakers: string[];
  hasProfile: boolean;
}

export interface Roster {
  owners: RosterOwner[];
  properties: RosterProperty[];
}

/** Owners are individuals (owner sets are split), so each person gets one profile. */
export function buildRoster(facts: FeeFacts): Roster {
  const setByKey = new Map(facts.ownerSets.map((s) => [s.key, s]));
  const owners = new Map<string, RosterOwner>();
  const properties: RosterProperty[] = [];

  for (const p of facts.properties) {
    const set = setByKey.get(p.ownerSetKey);
    const propOwners = (set?.owners ?? []).map((o) => ({ id: o.id, name: o.name }));
    properties.push({
      id: p.id,
      name: p.name,
      address: p.address,
      doors: p.doors,
      appfolioWebId: p.appfolioWebId ?? null,
      owners: propOwners,
    });
    for (const o of set?.owners ?? []) {
      const row = owners.get(o.id) ?? {
        id: o.id,
        name: o.name,
        email: o.email,
        phone: o.phone,
        properties: [],
        doors: 0,
      };
      row.properties.push({ id: p.id, name: p.name });
      row.doors += p.doors;
      owners.set(o.id, row);
    }
  }

  const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);
  return { owners: [...owners.values()].sort(byName), properties: properties.sort(byName) };
}

export interface CoverageRow {
  subject_type: SubjectType;
  subject_id: string;
  speaker_name: string | null;
  speaker_email: string;
  created_at: string;
}

export function coverageKey(type: SubjectType, id: string): string {
  return `${type}:${id}`;
}

export function buildCoverage(
  recordings: CoverageRow[],
  profiles: { subject_type: SubjectType; subject_id: string }[]
): Record<string, Coverage> {
  const out: Record<string, Coverage> = {};
  const get = (key: string) =>
    (out[key] ??= { recordings: 0, lastAt: null, speakers: [], hasProfile: false });
  for (const r of recordings) {
    const c = get(coverageKey(r.subject_type, r.subject_id));
    c.recordings++;
    if (!c.lastAt || r.created_at > c.lastAt) c.lastAt = r.created_at;
    const who = r.speaker_name || r.speaker_email;
    if (!c.speakers.includes(who)) c.speakers.push(who);
  }
  for (const p of profiles) get(coverageKey(p.subject_type, p.subject_id)).hasProfile = true;
  return out;
}
