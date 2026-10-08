import { describe, it, expect, vi } from 'vitest';
import type { FeeFacts, PropertyFact } from '@/lib/fee-management/model';
import { buildCoverage, buildRoster, coverageKey } from '../roster';

vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: () => ({}) }));
const { splitTranscript, resolveSubject, nodeSlug } = await import('../pipeline');
const { audioExtension } = await import('../synthesize');

const prop = (id: string, name: string, ownerSetKey: string, doors = 1): PropertyFact => ({
  id,
  name,
  address: `${name} St, Bend`,
  feeType: 'percent',
  feePct: 8,
  flatMonthly: null,
  feeStartDate: null,
  mgmtStartDate: null,
  appfolioWebId: null,
  doors,
  occupiedDoors: doors,
  occupiedRentMonthly: 0,
  ownerSetKey,
});

const owner = (id: string, name: string) => ({ id, name, email: `${id}@x.com`, phone: null, percentOwned: null });

const facts: FeeFacts = {
  properties: [
    prop('p1', 'Birch Duplex', 'o1', 2),
    prop('p2', 'Aspen House', 'o1+o2'),
    prop('p3', 'Cedar Lot', 'unlinked:p3'),
  ],
  ownerSets: [
    { key: 'o1', name: 'Ann', owners: [owner('o1', 'Ann')] },
    { key: 'o1+o2', name: 'Ann & Bob', owners: [owner('o1', 'Ann'), owner('o2', 'Bob')] },
    { key: 'unlinked:p3', name: 'Cedar Lot (no owner on file)', owners: [] },
  ],
};

describe('buildRoster', () => {
  const roster = buildRoster(facts);

  it('splits owner sets into individual owners with all their properties', () => {
    expect(roster.owners.map((o) => o.name)).toEqual(['Ann', 'Bob']);
    const ann = roster.owners[0];
    expect(ann.properties.map((p) => p.id).sort()).toEqual(['p1', 'p2']);
    expect(ann.doors).toBe(3);
  });

  it('lists every property, sorted, with its owners (none for unlinked)', () => {
    expect(roster.properties.map((p) => p.name)).toEqual(['Aspen House', 'Birch Duplex', 'Cedar Lot']);
    expect(roster.properties[0].owners.map((o) => o.name)).toEqual(['Ann', 'Bob']);
    expect(roster.properties[2].owners).toEqual([]);
  });

  it('resolves subjects with AppFolio facts and related subjects', () => {
    const ann = resolveSubject(roster, 'owner', 'o1')!;
    expect(ann.related.map((r) => r.id).sort()).toEqual(['p1', 'p2']);
    expect(ann.context.facts).toContain('3 doors');
    const aspen = resolveSubject(roster, 'property', 'p2')!;
    expect(aspen.related.map((r) => r.type)).toEqual(['owner', 'owner']);
    expect(resolveSubject(roster, 'owner', 'nope')).toBeNull();
    expect(resolveSubject(roster, 'property', 'o1')).toBeNull();
  });
});

describe('buildCoverage', () => {
  it('counts takes, distinct speakers and profile presence per subject', () => {
    const cov = buildCoverage(
      [
        { subject_type: 'owner', subject_id: 'o1', speaker_name: 'Matt', speaker_email: 'matt@highdesertpm.com', created_at: '2026-10-01T00:00:00Z' },
        // Craig recorded a conversation with Matt and Penny: both voices count.
        { subject_type: 'owner', subject_id: 'o1', speaker_name: null, speaker_email: 'craig@highdesertpm.com', voices: ['matt@highdesertpm.com', 'penny@highdesertpm.com'], created_at: '2026-10-03T00:00:00Z' },
        { subject_type: 'owner', subject_id: 'o1', speaker_name: 'Matt', speaker_email: 'matt@highdesertpm.com', voices: [], created_at: '2026-10-02T00:00:00Z' },
      ],
      [{ subject_type: 'property', subject_id: 'p1' }]
    );
    expect(cov[coverageKey('owner', 'o1')]).toEqual({
      recordings: 3,
      lastAt: '2026-10-03T00:00:00Z',
      speakers: ['Matt', 'Penny'],
      voices: ['matt@highdesertpm.com', 'penny@highdesertpm.com'],
      hasProfile: false,
    });
    expect(cov[coverageKey('property', 'p1')].hasProfile).toBe(true);
  });
});

describe('splitTranscript', () => {
  it('keeps short transcripts whole', () => {
    expect(splitTranscript('  Hello there.  The water heater is old. ')).toEqual(['Hello there. The water heater is old.']);
  });

  it('windows at sentence boundaries under the limit', () => {
    const text = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
    const parts = splitTranscript(text, 200);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(200);
      expect(p.endsWith('.')).toBe(true);
    }
    expect(parts.join(' ')).toBe(text);
  });

  it('hard-slices a run-on with no punctuation', () => {
    const parts = splitTranscript('a'.repeat(450), 200);
    expect(parts.map((p) => p.length)).toEqual([200, 200, 50]);
  });

  it('returns nothing for an empty transcript', () => {
    expect(splitTranscript('   ')).toEqual([]);
  });
});

describe('helpers', () => {
  it('maps audio mime types to upload extensions', () => {
    expect(audioExtension('audio/webm;codecs=opus')).toBe('webm');
    expect(audioExtension('audio/mp4')).toBe('m4a');
    expect(audioExtension('audio/x-m4a')).toBe('m4a');
    expect(audioExtension('audio/mpeg')).toBe('mp3');
    expect(audioExtension('audio/unknown')).toBe('webm');
  });

  it('builds stable brain node slugs', () => {
    expect(nodeSlug('owner', 'abc')).toBe('owner:appfolio:abc');
    expect(nodeSlug('property', 'xyz')).toBe('property:appfolio:xyz');
  });
});
